/**
 * Event-driven promote / demote scheduler for SoA canvas ink (ADR 0027).
 *
 * SceneDocument remains SoT — this only emits host↔ink commands. Callers apply
 * {@link applySoaHostInkFlags} and paint/bake invalidation.
 *
 * Product mapping:
 * - ACTIVE_SVG — SoftGlow / inline editors (`forceFullIds`), not selection
 * - CANDIDATE — released from forceFull; quiet window (DOM host held)
 * - DEPLOYED_SOA — canvas-idle ink
 *
 * Quiet demote: SoA ink flags flip immediately on CANDIDATE (host still mounted;
 * paint skips slots with a live SVG host). Host release uses one shared wake
 * timer over `Map<id, lastActive>` (not per-id setTimeout): when due, scan and
 * batch-release all quiet candidates.
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
   * Edit pulse on an id: if still forceFull → ACTIVE;
   * if CANDIDATE → bump quiet lastActive (does not re-demote ink).
   */
  noteElementActive: (id: string) => void;
  noteElementsActive: (ids: readonly string[]) => void;
  /** Batch promote (import / AI flush). */
  promoteNow: (ids: readonly string[]) => void;
  /** Batch demote without delay. */
  demoteNow: (ids: readonly string[]) => void;
  /** Cancel tick; drop hints. */
  dispose: () => void;
  /** Test helper — pending host-release candidate ids. */
  pendingDemoteIds: () => string[];
};

function toHostSet(hostIds: ReadonlySet<string> | readonly string[]): Set<string> {
  const src = Array.isArray(hostIds) ? hostIds : hostIds;
  const out = new Set<string>();
  for (const raw of src) {
    const id = String(raw || '').trim();
    if (id) out.add(id);
  }
  return out;
}

function normalizeId(raw: string): string {
  return String(raw || '').trim();
}

/**
 * @param demoteDelayMs Quiet period after ink demote before releasing DOM host (default 300).
 * @param now Injectable clock (tests).
 */
export function createRenderDemotionScheduler(opts: {
  sink: RenderDemotionSink;
  demoteDelayMs?: number;
  onHintsChanged?: () => void;
  now?: () => number;
}): RenderDemotionScheduler {
  const demoteDelayMs = Math.max(0, opts.demoteDelayMs ?? 300);
  const nowFn = opts.now ?? (() => Date.now());
  const hints = new Map<string, RenderHint>();
  /** CANDIDATE ids → last activity ms (host hold until quiet). */
  const lastActive = new Map<string, number>();
  let forceHosts = new Set<string>();
  const pendingAfter = new Set<string>();
  let afterRaf = 0;
  /** At most one wake timer for the whole candidate set. */
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  function notifyHints(): void {
    opts.onHintsChanged?.();
  }

  function dropCandidate(id: string): void {
    lastActive.delete(id);
  }

  function clearWake(): void {
    if (wakeTimer == null) return;
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  function cancelAfterRaf(): void {
    if (!afterRaf) return;
    cancelAnimationFrame(afterRaf);
    afterRaf = 0;
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

  function releaseHostHolds(ids: readonly string[]): void {
    if (!ids.length) return;
    for (const id of ids) {
      dropCandidate(id);
      if (forceHosts.has(id)) {
        hints.set(id, 'ACTIVE_SVG');
        continue;
      }
      hints.set(id, 'DEPLOYED_SOA');
    }
    notifyHints();
  }

  function flushExpiredCandidates(ts: number): void {
    if (lastActive.size === 0) return;
    const due: string[] = [];
    for (const [id, activeAt] of lastActive) {
      if (hints.get(id) !== 'CANDIDATE') {
        dropCandidate(id);
        continue;
      }
      if (forceHosts.has(id)) {
        dropCandidate(id);
        hints.set(id, 'ACTIVE_SVG');
        continue;
      }
      if (ts - activeAt >= demoteDelayMs) due.push(id);
    }
    if (due.length) releaseHostHolds(due);
  }

  function ensureWake(): void {
    clearWake();
    if (lastActive.size === 0 || demoteDelayMs <= 0) return;
    const ts = nowFn();
    let soonest = Infinity;
    for (const activeAt of lastActive.values()) {
      const dueAt = activeAt + demoteDelayMs;
      if (dueAt < soonest) soonest = dueAt;
    }
    if (!Number.isFinite(soonest)) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      flushExpiredCandidates(nowFn());
      ensureWake();
    }, Math.max(0, soonest - ts));
  }

  function armCandidate(id: string): void {
    hints.set(id, 'CANDIDATE');
    lastActive.set(id, nowFn());
    if (demoteDelayMs <= 0) {
      releaseHostHolds([id]);
      return;
    }
    ensureWake();
  }

  function promoteIds(ids: readonly string[]): void {
    if (!ids.length) return;
    for (const id of ids) {
      dropCandidate(id);
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
      dropCandidate(id);
      if (forceHosts.has(id)) continue;
      hints.set(id, 'DEPLOYED_SOA');
      out.push(id);
    }
    if (!out.length) return;
    opts.sink.demote(out);
    queueAfterFlip(out);
    notifyHints();
  }

  function scheduleDemote(id: string): void {
    // Prepare SoA ink while SVG host is still mounted (paint skips host.el).
    opts.sink.demote([id]);
    queueAfterFlip([id]);
    armCandidate(id);
    notifyHints();
  }

  function pulseActiveKey(key: string): void {
    if (forceHosts.has(key)) {
      dropCandidate(key);
      hints.set(key, 'ACTIVE_SVG');
      return;
    }
    if (hints.get(key) !== 'CANDIDATE') return;
    lastActive.set(key, nowFn());
    ensureWake();
  }

  function diffForceHosts(next: Set<string>): { added: string[]; removed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    for (const id of next) {
      if (!forceHosts.has(id)) added.push(id);
    }
    for (const id of forceHosts) {
      if (!next.has(id)) removed.push(id);
    }
    return { added, removed };
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
      const { added, removed } = diffForceHosts(next);
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
      clearWake();
      cancelAfterRaf();
      lastActive.clear();
      hints.clear();
      forceHosts = new Set();
      pendingAfter.clear();
    },

    pendingDemoteIds(): string[] {
      return [...lastActive.keys()].sort();
    },
  };
}
