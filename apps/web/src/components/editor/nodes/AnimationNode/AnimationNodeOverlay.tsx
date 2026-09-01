import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';
/**
 * Lottie ink mounts into the node's nested SVG layer (lottie-web SVG renderer).
 * Preview and edit share the same SVG stack; preview is pointer-events:none.
 */
import { useEffect, useMemo, useRef, type ReactNode, memo } from 'react';
import { useSelector } from '@/store';
import { useSceneReloadToken } from '@/store/editorSelectors';
import lottie, { type AnimationItem } from 'lottie-web';
import {
  isAnimationFrameHostNode,
  isLottieNode,
  isNodeHidden,
  isWorkbenchNestedLottieNode,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { isHiddenByAnimationWorkbenchFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { animationHostHasUnlinkedInk } from '@/components/editor/nodes/AnimationNode/animationFrameSync';
import { isPrecompEditSessionNode } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';
import {
  lottieNodeHasInkJson,
  resolveLottieInkJson,
} from '@/components/editor/nodes/AnimationNode/mainSceneLotPreview';
import type { MediaGeomOverride } from '@/components/editor/nodes/shared/mediaPlateGeometry';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';
import store from '@/store';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';

export type LottieGeomOverride = MediaGeomOverride;

export type LottieHostApi = {
  play: () => void;
  pause: () => void;
  isPaused: () => boolean;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  getSpeed: () => number;
  seek: (timeSec: number) => void;
  playFrom: (timeSec: number) => void;
  getCurrentTime: () => number;
  getDurationSec: () => number;
};

const lottieHosts = new Map<string, LottieHostApi>();

export function getLottieHost(nodeId: string): LottieHostApi | null {
  return lottieHosts.get(nodeId) || null;
}

/** Drive nested LOT plates on — —while the workbench timeline plays. */
export function syncFrameNestedLotLottieHosts(opts: {
  document: SceneDocument;
  frameHostId: string;
  timeSec: number;
  playing: boolean;
}) {
  const host = opts.document?.deltaSetLike?.[opts.frameHostId];
  if (!host) return;
  const frameId = resolveAnimationFrameId(opts.document, host);
  if (!frameId) return;
  for (const [id, node] of Object.entries(opts.document.deltaSetLike || {})) {
    if (!node || id === 'ROOT') continue;
    if (node.key !== 'lottie') continue;
    if (isAnimationFrameHostNode(node, opts.document)) continue;
    if (String(node.attrs?.frameId || '').trim() !== frameId) continue;
    if (node.attrs?.hidden === true || node.attrs?.hidden === 'true') continue;
    const api = getLottieHost(id);
    if (!api) continue;
    if (opts.playing) {
      if (api.isPaused()) api.playFrom(opts.timeSec);
      else api.seek(opts.timeSec);
    } else {
      api.seek(opts.timeSec);
      api.pause();
    }
  }
}

function readLoop(attrs: any): boolean {
  const raw = attrs?.lottieLoop;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return true;
}

function readSpeed(attrs: any): number {
  const n = Number(attrs?.lottieSpeed);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

function lottieFrameMetrics(anim: AnimationItem) {
  const fr = Math.max(1, Number(anim.frameRate) || 30);
  const total = Math.max(1, Number(anim.totalFrames) || 1);
  return { fr, total, durationSec: total / fr };
}

function lottieFrameAt(anim: AnimationItem, timeSec: number): number {
  const { fr, total } = lottieFrameMetrics(anim);
  return Math.max(0, Math.min(total - 1e-3, timeSec * fr));
}

function cloneAnimationData(data: Record<string, unknown>) {
  if (structuredClone) return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

type EditorLottieState = {
  lottieTimelinePanel?: { nodeId?: string } | null;
  lottiePlayheadSec?: number;
  lottiePlaying?: boolean;
  lottiePlayingHostId?: string | null;
};

function readEditorLottieState(): EditorLottieState {
  return (store.getState()?.editor as EditorLottieState | undefined) ?? {};
}

function buildLottieHostApi(nodeId: string, anim: AnimationItem): LottieHostApi {
  const metrics = () => lottieFrameMetrics(anim);
  return {
    play: () => anim.play(),
    pause: () => anim.pause(),
    isPaused: () => Boolean(anim.isPaused),
    setLoop: (next) => {
      anim.loop = next;
    },
    setSpeed: (next) => anim.setSpeed(next),
    getSpeed: () => Number(anim.playSpeed) || 1,
    seek: (timeSec) => {
      anim.goToAndStop(lottieFrameAt(anim, timeSec), true);
    },
    playFrom: (timeSec) => {
      anim.goToAndPlay(lottieFrameAt(anim, timeSec), true);
    },
    getCurrentTime: () => {
      const { fr } = metrics();
      return Math.max(0, Number(anim.currentFrame) || 0) / fr;
    },
    getDurationSec: () => metrics().durationSec,
  };
}

function isPlayingHost(nodeId: string, hostId: string): boolean {
  return Boolean(hostId) && hostId === nodeId;
}

function isTimelineHost(nodeId: string, timelineHostId: string): boolean {
  return Boolean(timelineHostId) && timelineHostId === nodeId;
}

function LottiePlate({
  nodeId,
  animationJson,
  loop,
  speed,
  hidden,
  mount,
}: {
  nodeId: string;
  animationJson: string;
  loop: boolean;
  speed: number;
  hidden?: boolean;
  mount: SVGSVGElement;
}) {
  const animRef = useRef<AnimationItem | null>(null);
  const storePlaying = useSelector((s: any) => Boolean(s.editor.lottiePlaying));
  const playingHostId = useSelector((s: any) =>
    String(s.editor.lottiePlayingHostId || '').trim()
  );
  const timelineHostId = useSelector((s: any) =>
    String(s.editor.lottieTimelinePanel?.nodeId || '').trim()
  );

  useEffect(() => {
    mount.style.visibility = hidden ? 'hidden' : 'visible';
  }, [hidden, mount]);

  useEffect(() => {
    const data = parseLottieAnimationData(animationJson);
    if (!data) return undefined;
    mount.innerHTML = '';
    let anim: AnimationItem;
    try {
      anim = lottie.loadAnimation({
        container: mount,
        renderer: 'svg',
        loop,
        autoplay: false,
        animationData: cloneAnimationData(data),
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: false,
          viewBoxOnly: false,
        },
      });
    } catch (err) {
      console.warn('[lottie] load failed', err);
      return undefined;
    }
    anim.setSpeed(speed);
    animRef.current = anim;
    const api = buildLottieHostApi(nodeId, anim);
    lottieHosts.set(nodeId, api);

    const editorState = readEditorLottieState();
    const timelineOwns =
      String(editorState.lottieTimelinePanel?.nodeId || '') === nodeId;
    const restoreSec = Math.max(0, Number(editorState.lottiePlayheadSec) || 0);
    const at = Math.min(restoreSec, api.getDurationSec());
    const playingHost = String(editorState.lottiePlayingHostId || '').trim();
    let hostMatches = timelineOwns;
    if (playingHost) hostMatches = isPlayingHost(nodeId, playingHost);
    if (editorState.lottiePlaying && hostMatches) api.playFrom(at);
    else api.seek(at);

    return () => {
      anim.destroy();
      animRef.current = null;
      if (lottieHosts.get(nodeId) === api) lottieHosts.delete(nodeId);
      mount.innerHTML = '';
    };
    // loop/speed applied below — avoid remounting on toolbar toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [mount, animationJson, nodeId]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    anim.loop = loop;
  }, [loop]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    anim.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    const api = lottieHosts.get(nodeId);
    if (!api) return;
    let mine = isTimelineHost(nodeId, timelineHostId);
    if (playingHostId) mine = isPlayingHost(nodeId, playingHostId);
    if (storePlaying && mine) {
      if (api.isPaused()) api.play();
      return;
    }
    if (!api.isPaused()) api.pause();
  }, [storePlaying, playingHostId, timelineHostId, nodeId, mount, animationJson]);

  useEffect(() => {
    if (hidden) return;
    const api = lottieHosts.get(nodeId);
    if (!api) return;
    const restoreSec = Math.max(0, Number(readEditorLottieState().lottiePlayheadSec) || 0);
    api.seek(restoreSec);
  }, [hidden, nodeId, mount, animationJson]);

  return null;
}

function shouldHideLottieInk(opts: {
  node: SceneNode;
  nodeId: string;
  frameHost: boolean;
  hidden?: boolean;
  precompAssetId: string;
  precompLotId: string;
  precompSessionMaterialized: boolean;
}): boolean {
  const { node, nodeId, frameHost, hidden, precompAssetId, precompLotId, precompSessionMaterialized } =
    opts;
  if (frameHost && !animationHostHasUnlinkedInk(node.attrs?.animationData)) return true;
  if (hidden || isNodeHidden(node) || isHiddenByAnimationWorkbenchFocus(node)) return true;
  if (precompAssetId && frameHost) return true;
  if (!precompAssetId) return false;
  if (isPrecompEditSessionNode(node)) return false;
  if (precompLotId && nodeId === precompLotId) return precompSessionMaterialized;
  if (frameHost) return true;
  if (String(node.attrs?.frameId || '').trim()) return true;
  return false;
}

function AnimationNodeOverlay({
  document,
  hidden,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, LottieGeomOverride> | null;
}): ReactNode {
  const sceneReloadToken = useSceneReloadToken();

  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      return isLottieNode(node) && lottieNodeHasInkJson(document, id, node);
    });
  }, [document]);

  if (!ids.length) return null;

  return (
    <>
      {ids.map((nodeId) => (
        <LottiePlateHost
          key={`${nodeId}:${sceneReloadToken}`}
          nodeId={nodeId}
          document={document}
          hidden={hidden}
          geometryOverrides={geometryOverrides}
          reloadKey={String(sceneReloadToken)}
        />
      ))}
    </>
  );
}

function LottiePlateHost({
  nodeId,
  document,
  hidden,
  reloadKey = '',
}: {
  nodeId: string;
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, LottieGeomOverride> | null;
  reloadKey?: string;
}) {
  const mount = useHtmlMediaMount(nodeId);
  const precompEdit = useSelector(
    (s: any) =>
      s.editor.lottiePrecompEdit as null | {
        assetId?: string;
        lotNodeId?: string | null;
        sessionNodeIds?: string[];
      }
  );
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || !(mount instanceof SVGSVGElement)) return null;

  const frameHost = isAnimationFrameHostNode(node, document);
  const workbenchNested = isWorkbenchNestedLottieNode(node, document);
  const precompAssetId = String(precompEdit?.assetId || '').trim();
  const hostFallback = workbenchNested && !precompAssetId;
  const animationJson = resolveLottieInkJson(document, nodeId, node, { hostFallback });
  if (!animationJson || !parseLottieAnimationData(animationJson)) return null;

  let precompLotId = String(precompEdit?.lotNodeId || '').trim();
  if (!precompLotId && precompAssetId.startsWith('lot_')) {
    precompLotId = precompAssetId.slice(4);
  }
  const hideInk = shouldHideLottieInk({
    node,
    nodeId,
    frameHost,
    hidden,
    precompAssetId,
    precompLotId,
    precompSessionMaterialized: Boolean(precompEdit?.sessionNodeIds?.length),
  });
  const inkRevision = String(node.attrs?.lottieInkRevision ?? '');

  return (
    <LottiePlate
      key={`${nodeId}:${reloadKey}:${inkRevision}:${animationJson.length}`}
      nodeId={nodeId}
      animationJson={animationJson}
      loop={readLoop(node.attrs)}
      speed={readSpeed(node.attrs)}
      hidden={hideInk}
      mount={mount}
    />
  );
}

export default memo(AnimationNodeOverlay);
