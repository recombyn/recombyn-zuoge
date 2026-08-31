/**
 * High-frequency animation transport — outside Zustand document mirror.
 * Scrub/play updates here + scene events; UI opts in via useSyncExternalStore.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { requestPlayheadSceneApply } from '@/components/editor/nodes/AnimationNode/animationPlayheadApplyEvent';
import { requestPuppetWarpApply } from '@/components/editor/nodes/ImageNode/puppet/puppetWarpApplyEvent';

type TransportState = {
  playheadSec: number;
  playing: boolean;
  playingHostId: string | null;
};

let state: TransportState = {
  playheadSec: 0,
  playing: false,
  playingHostId: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getAnimationPlayheadSec() {
  return state.playheadSec;
}

export function getAnimationPlaying() {
  return state.playing;
}

export function getAnimationPlayingHostId() {
  return state.playingHostId;
}

export function getAnimationTransport(): Readonly<TransportState> {
  return state;
}

export function subscribeAnimationTransport(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Update module + notify React subscribers only (no scene events). */
export function writeAnimationPlayheadSec(sec: number) {
  const n = Math.max(0, Number(sec) || 0);
  if (state.playheadSec === n) return n;
  state = { ...state, playheadSec: n };
  emit();
  return n;
}

export function setAnimationPlayheadSec(
  sec: number,
  opts?: { applyScene?: boolean; applyPuppet?: boolean }
) {
  const n = writeAnimationPlayheadSec(sec);
  if (opts?.applyScene !== false) requestPlayheadSceneApply();
  if (opts?.applyPuppet !== false) requestPuppetWarpApply();
  return n;
}

export function writeAnimationPlaying(
  playing: boolean,
  opts?: { hostNodeId?: string | null }
) {
  const host =
    opts?.hostNodeId !== undefined
      ? String(opts.hostNodeId || '').trim() || null
      : state.playingHostId;
  if (state.playing === playing && state.playingHostId === host) return;
  state = {
    ...state,
    playing: Boolean(playing),
    playingHostId: host,
  };
  emit();
}

export function setAnimationPlaying(
  playing: boolean,
  opts?: { hostNodeId?: string | null }
) {
  writeAnimationPlaying(playing, opts);
}

export function useAnimationPlayheadSec() {
  return useSyncExternalStore(
    subscribeAnimationTransport,
    getAnimationPlayheadSec,
    getAnimationPlayheadSec
  );
}

export function useAnimationPlaying() {
  return useSyncExternalStore(
    subscribeAnimationTransport,
    getAnimationPlaying,
    getAnimationPlaying
  );
}

export function useAnimationTransport() {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return subscribeAnimationTransport(onStoreChange);
  }, []);
  return useSyncExternalStore(subscribe, getAnimationTransport, getAnimationTransport);
}
