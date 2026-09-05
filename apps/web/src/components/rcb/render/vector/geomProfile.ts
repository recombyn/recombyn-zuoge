/**
 * DEV / probe timing for densify + fill + stroke.
 * No-ops when disabled.
 */
export type GeomProfileSample = {
  densifyMs: number;
  fillMs: number;
  strokeMs: number;
  totalMs: number;
  pointCount: number;
  fillTris: number;
  strokeTris: number;
  backend: 'js' | 'wasm';
};

export type GeomProfileSnapshot = {
  samples: number;
  densifyMs: number;
  fillMs: number;
  strokeMs: number;
  totalMs: number;
  last: GeomProfileSample | null;
};

const emptySnap = (): GeomProfileSnapshot => ({
  samples: 0,
  densifyMs: 0,
  fillMs: 0,
  strokeMs: 0,
  totalMs: 0,
  last: null,
});

let enabled = false;
let snap = emptySnap();

function envWantsProfile(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('rcb_geom_profile') === '1') return true;
  } catch {
    /* ignore */
  }
  return Boolean((window as Window & { __RCB_GEOM_PROFILE__?: boolean }).__RCB_GEOM_PROFILE__);
}

export function setGeomProfileEnabled(on: boolean): void {
  enabled = Boolean(on);
  if (!enabled) snap = emptySnap();
}

export function isGeomProfileEnabled(): boolean {
  return enabled || envWantsProfile();
}

export function resetGeomProfile(): void {
  snap = emptySnap();
}

export function getGeomProfileSnapshot(): GeomProfileSnapshot {
  return { ...snap, last: snap.last ? { ...snap.last } : null };
}

export function recordGeomProfile(sample: GeomProfileSample): void {
  if (!isGeomProfileEnabled()) return;
  snap.samples += 1;
  snap.densifyMs += sample.densifyMs;
  snap.fillMs += sample.fillMs;
  snap.strokeMs += sample.strokeMs;
  snap.totalMs += sample.totalMs;
  snap.last = sample;
}

/** High-res now; falls back to Date.now. */
export function geomNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

if (typeof window !== 'undefined') {
  (
    window as Window & {
      __RCB_GEOM_PROFILE_SNAP__?: () => GeomProfileSnapshot;
    }
  ).__RCB_GEOM_PROFILE_SNAP__ = () => getGeomProfileSnapshot();
}
