/**
 * Event-driven promote / demote scheduler for SoA canvas ink (ADR 0027).
 *
 * SceneDocument remains SoT — this only emits host↔ink commands. Callers apply
 * {@link applySoaHostInkFlags} and paint/bake invalidation.
 *
 * Product mapping:
 * - ACTIVE_SVG — SoftGlow / inline editors (`forceFullIds`), not selection
 * - CANDIDATE — released from forceFull; quiet timer running (DOM host held)
 * - DEPLOYED_SOA — canvas-idle ink
 *
 * Quiet demote: SoA ink flags flip immediately on CANDIDATE (host still mounted;
 * paint skips slots with a live SVG host). Timer only releases the host hold so
 * there is no blank frame when SoftGlow/editors end.
 *
 * Promote is flushed synchronously. Paint/bake wakes coalesce via rAF.
 */

export type RenderHint = 'ACTIVE_SVG' | 'CANDIDATE' | 'DEPLOYED_SOA';

export type RenderDemotionSink = {
  /** Immediate promote to DOM host ink flags. */
  promote: (ids: readonly string[]) => void;
  /** Demote to SoA canvas ink (flags / QT / bake bind). */
  demote: (ids: readonly string[]) => void;
  /** Optional: one paint/bake wake after coalesced flips. */
  afterFlips?: (ids: readonly string[]) => void;
};

export type RenderDemotionScheduler = {
  getHint: (id: string) => RenderHint;
  /** Ids that must keep a DOM host (ACTIVE_SVG + CANDIDATE). */
  heldHostIds: () => ReadonlySet<string>;
  /** Diff force-full host set; promote adds immediately; schedule demote on removes. */
  setForceHosts: (hostIds: ReadonlySet<string> | readonly string[]) => void;
  /**
   * Edit pulse on an id: cancel demote timer; if still forceFull → ACTIVE;
   * if CANDIDATE → restart quiet timer; does not promote selection onto SVG.
   */
  noteElementActive: (id: string) => void;
  noteElementsActive: (ids: readonly string[]) => void;
  /** Batch promote (import / AI flush). */
  promoteNow: (ids: readonly string[]) => void;
  /** Batch demote without delay. */
  demoteNow: (ids: readonly string[]) => void;
  /** Cancel timers; drop hints. */
  dispose: () => void;
  /** Test helper — pending demote ids. */
  pendingDemoteIds: () => string[];
};

function toHostSet(hostIds: ReadonlySet<string> | readonly string[]): Set<string> {
  if (Array.isArray(hostIds)) return new Set(hostIds.filter(Boolean).map(String));
  return new Set([...hostIds].map(String).filter(Boolean));
}

function normalizeId(raw: string): string {
  return String(raw || '').trim();
}

/**
 * @param demoteDelayMs Quiet period after ink demote before releasing DOM host (default 300).
 */
export function createRenderDemotionScheduler(opts: {
  sink: RenderDemotionSink;
  demoteDelayMs?: number;
  onHintsChanged?: () => void;
}): RenderDemotionScheduler {
  const demoteDelayMs = Math.max(0, opts.demoteDelayMs ?? 300);
  const hints = new Map<string, RenderHint>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let forceHosts = new Set<string>();
  const pendingAfter = new Set<string>();
  let afterRaf = 0;

  function notifyHints(): void {
    opts.onHintsChanged?.();
  }

  function clearTimer(id: string): void {
    const t = timers.get(id);
    if (t == null) return;
    clearTimeout(t);
    timers.delete(id);
  }

  function queueAfterFlip(ids: readonly string[]): void {
    for (const id of ids) pendingAfter.add(id);
    if (afterRaf || !opts.sink.afterFlips) return;
    afterRaf = requestAnimationFrame(() => {
      afterRaf = 0;
      const batch = [...pendingAfter];
      pendingAfter.clear();
      if (batch.length) opts.sink.afterFlips?.(batch);
    });
  }

  function promoteIds(ids: readonly string[]): void {
    if (!ids.length) return;
    for (const id of ids) {
      clearTimer(id);
      hints.set(id, 'ACTIVE_SVG');
    }
    opts.sink.promote(ids);
    queueAfterFlip(ids);
    notifyHints();
  }

  /** Full demote: ink flags + tip DEPLOYED (host released). */
  function demoteIds(ids: readonly string[]): void {
    if (!ids.length) return;
    const out: string[] = [];
    for (const id of ids) {
      clearTimer(id);
      if (forceHosts.has(id)) continue;
      hints.set(id, 'DEPLOYED_SOA');
      out.push(id);
    }
    if (!out.length) return;
    opts.sink.demote(out);
    queueAfterFlip(out);
    notifyHints();
  }

  /** Release host hold only — ink already demoted at CANDIDATE start. */
  function releaseHostHold(id: string): void {
    clearTimer(id);
    if (forceHosts.has(id)) {
      hints.set(id, 'ACTIVE_SVG');
      notifyHints();
      return;
    }
    hints.set(id, 'DEPLOYED_SOA');
    notifyHints();
  }

  function scheduleDemote(id: string): void {
    clearTimer(id);
    hints.set(id, 'CANDIDATE');
    // Prepare SoA ink while SVG host is still mounted (paint skips host.el).
    opts.sink.demote([id]);
    queueAfterFlip([id]);
    notifyHints();
    if (demoteDelayMs <= 0) {
      hints.set(id, 'DEPLOYED_SOA');
      notifyHints();
      return;
    }
    const handle = setTimeout(() => {
      timers.delete(id);
      releaseHostHold(id);
    }, demoteDelayMs);
    timers.set(id, handle);
  }

  /** Shared by noteElementActive / noteElementsActive. */
  function pulseActiveKey(key: string): void {
    clearTimer(key);
    if (forceHosts.has(key)) {
      hints.set(key, 'ACTIVE_SVG');
      return;
    }
    if (hints.get(key) === 'CANDIDATE') scheduleDemote(key);
  }

  return {
    getHint(id: string): RenderHint {
      return hints.get(id) ?? 'DEPLOYED_SOA';
    },

    heldHostIds(): ReadonlySet<string> {
      const out = new Set(forceHosts);
      for (const [id, hint] of hints) {
        if (hint === 'ACTIVE_SVG' || hint === 'CANDIDATE') out.add(id);
      }
      return out;
    },

    setForceHosts(hostIds: ReadonlySet<string> | readonly string[]): void {
      const next = toHostSet(hostIds);
      const added: string[] = [];
      const removed: string[] = [];
      for (const id of next) {
        if (!forceHosts.has(id)) added.push(id);
      }
      for (const id of forceHosts) {
        if (!next.has(id)) removed.push(id);
      }
      forceHosts = next;
      if (added.length) promoteIds(added);
      for (const id of removed) scheduleDemote(id);
    },

    noteElementActive(id: string): void {
      const key = normalizeId(id);
      if (!key) return;
      pulseActiveKey(key);
      notifyHints();
    },

    noteElementsActive(ids: readonly string[]): void {
      for (const raw of ids) {
        const key = normalizeId(raw);
        if (key) pulseActiveKey(key);
      }
      notifyHints();
    },

    promoteNow(ids: readonly string[]): void {
      promoteIds(ids.map(String).filter(Boolean));
    },

    demoteNow(ids: readonly string[]): void {
      demoteIds(ids.map(String).filter(Boolean));
    },

    dispose(): void {
      for (const id of [...timers.keys()]) clearTimer(id);
      hints.clear();
      forceHosts = new Set();
      pendingAfter.clear();
      if (!afterRaf) return;
      cancelAnimationFrame(afterRaf);
      afterRaf = 0;
    },

    pendingDemoteIds(): string[] {
      return [...timers.keys()].sort();
    },
  };
}
