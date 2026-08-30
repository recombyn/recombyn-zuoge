/**
 * AE-style puppet pin document model (image nodes).
 * Naming uses `puppet*` — not diffuse mesh / mark pins.
 */

export type PuppetPin = {
  id: string;
  /** Rest UV on the image plate (0–1). */
  u: number;
  v: number;
  /** Displacement from rest in UV space. */
  dx: number;
  dy: number;
};

/** Keyed pin snapshot for timeline scrub / play. */
export type PuppetTrackKeyframe = {
  /** Absolute frame index on the workbench host. */
  f: number;
  pins: PuppetPin[];
};

export const PUPPET_DENSITY_DEFAULT = 16;
export const PUPPET_DENSITY_MIN = 4;
export const PUPPET_DENSITY_MAX = 32;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function asPin(raw: unknown): PuppetPin | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  if (!id) return null;
  const u = Number(o.u);
  const v = Number(o.v);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return {
    id,
    u: clamp01(u),
    v: clamp01(v),
    dx: Number.isFinite(Number(o.dx)) ? Number(o.dx) : 0,
    dy: Number.isFinite(Number(o.dy)) ? Number(o.dy) : 0,
  };
}

export function readPuppetPins(attrs: Record<string, unknown> | null | undefined): PuppetPin[] {
  const raw = attrs?.puppetPins;
  if (!Array.isArray(raw)) return [];
  const out: PuppetPin[] = [];
  for (const item of raw) {
    const pin = asPin(item);
    if (pin) out.push(pin);
  }
  return out;
}

export function readPuppetDensity(attrs: Record<string, unknown> | null | undefined): number {
  const n = Math.round(Number(attrs?.puppetDensity) || PUPPET_DENSITY_DEFAULT);
  return Math.max(PUPPET_DENSITY_MIN, Math.min(PUPPET_DENSITY_MAX, n));
}

export function isPuppetEnabled(attrs: Record<string, unknown> | null | undefined): boolean {
  return attrs?.puppetEnabled === true || attrs?.puppetEnabled === 'true';
}

export function readPuppetTrack(
  attrs: Record<string, unknown> | null | undefined
): PuppetTrackKeyframe[] {
  const raw = attrs?.puppetTrack;
  if (!Array.isArray(raw)) return [];
  const out: PuppetTrackKeyframe[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const f = Math.round(Number(o.f));
    if (!Number.isFinite(f)) continue;
    const pins = Array.isArray(o.pins)
      ? (o.pins.map(asPin).filter(Boolean) as PuppetPin[])
      : [];
    out.push({ f, pins });
  }
  out.sort((a, b) => a.f - b.f);
  return out;
}

export function pinsHaveDisplacement(pins: readonly PuppetPin[]): boolean {
  for (const p of pins) {
    if (Math.abs(p.dx) > 1e-6 || Math.abs(p.dy) > 1e-6) return true;
  }
  return false;
}

/** True when paint should run the warp path (enabled + pins with motion, or track). */
export function nodeNeedsPuppetWarp(
  node: { key?: unknown; attrs?: Record<string, unknown> | null } | null | undefined
): boolean {
  if (!node || String(node.key || '') !== 'image') return false;
  const attrs = node.attrs || {};
  if (!isPuppetEnabled(attrs)) return false;
  const pins = readPuppetPins(attrs);
  if (pinsHaveDisplacement(pins)) return true;
  return readPuppetTrack(attrs).some((k) => pinsHaveDisplacement(k.pins));
}

function lerpPin(a: PuppetPin, b: PuppetPin, t: number): PuppetPin {
  return {
    id: a.id,
    u: a.u,
    v: a.v,
    dx: a.dx + (b.dx - a.dx) * t,
    dy: a.dy + (b.dy - a.dy) * t,
  };
}

/**
 * Sample pins at an absolute frame. Prefers track keyframes; falls back to live attrs.
 */
export function samplePuppetPinsAtFrame(
  attrs: Record<string, unknown> | null | undefined,
  frame: number
): PuppetPin[] {
  const track = readPuppetTrack(attrs);
  const live = readPuppetPins(attrs);
  if (!track.length) return live;

  const f = Number.isFinite(frame) ? frame : 0;
  if (f <= track[0]!.f) return track[0]!.pins.map((p) => ({ ...p }));
  const last = track[track.length - 1]!;
  if (f >= last.f) return last.pins.map((p) => ({ ...p }));

  let i = 0;
  while (i < track.length - 1 && track[i + 1]!.f < f) i += 1;
  const a = track[i]!;
  const b = track[i + 1]!;
  const span = Math.max(1e-6, b.f - a.f);
  const t = (f - a.f) / span;
  const byId = new Map(b.pins.map((p) => [p.id, p]));
  const out: PuppetPin[] = [];
  for (const pa of a.pins) {
    const pb = byId.get(pa.id);
    out.push(pb ? lerpPin(pa, pb, t) : { ...pa });
  }
  for (const pb of b.pins) {
    if (!a.pins.some((p) => p.id === pb.id)) out.push({ ...pb });
  }
  return out;
}

export function upsertPuppetTrackKeyframe(
  track: PuppetTrackKeyframe[],
  frame: number,
  pins: PuppetPin[]
): PuppetTrackKeyframe[] {
  const f = Math.round(frame);
  const next = track.filter((k) => k.f !== f);
  next.push({ f, pins: pins.map((p) => ({ ...p })) });
  next.sort((a, b) => a.f - b.f);
  return next;
}

export function newPuppetPinId(): string {
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Live pins, or track sample when a frame is provided. */
export function effectivePuppetPins(
  attrs: Record<string, unknown> | null | undefined,
  frame?: number
): PuppetPin[] {
  if (!isPuppetEnabled(attrs)) return readPuppetPins(attrs);
  if (Number.isFinite(frame) && readPuppetTrack(attrs).length) {
    return samplePuppetPinsAtFrame(attrs, frame as number);
  }
  return readPuppetPins(attrs);
}
