import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';
/**
 * Lottie ink portals into the node’s SVG foreignObject mount so paint order
 * follows shared `stackOrder` / `data-z` (same as images & generators).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import lottie, { type AnimationItem } from 'lottie-web';
import { useRcbCamera } from '@/components/rcb';
import {
  isAnimationFrameHostNode,
  isLottieNode,
  isNodeOverlayHidden,
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  parseLottieAnimationData,
  resolveThemeSurfaceFill
} from '@/components/rcb/scene/document/nodeFactories';
import { animationHostHasUnlinkedInk } from '@/components/editor/nodes/AnimationNode/animationFrameSync';
import {
  buildScenePlateStyle,
  type MediaGeomOverride,
} from '@/components/editor/nodes/shared/mediaPlateGeometry';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';
import store from '@/store';
import { shouldHideLottieInkForPrecompEdit } from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';

export type LottieGeomOverride = MediaGeomOverride;

export type LottieHostApi = {
  play: () => void;
  pause: () => void;
  isPaused: () => boolean;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  getSpeed: () => number;
  /** Seek to time in seconds (clamped to animation length). */
  seek: (timeSec: number) => void;
  /** Seek then play in one step (avoids goToAndStop leaving a paused race). */
  playFrom: (timeSec: number) => void;
  getCurrentTime: () => number;
  getDurationSec: () => number;
};

const lottieHosts = new Map<string, LottieHostApi>();

export function getLottieHost(nodeId: string): LottieHostApi | null {
  return lottieHosts.get(nodeId) || null;
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

function LottieZoomSync({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useRcbCamera().zoom;
  useEffect(() => {
    onZoom(Math.max(0.05, zoom || 1));
  }, [zoom, onZoom]);
  return null;
}

function resolveLottiePlateFill(raw: string, frameHost?: boolean): string {
  // 动画工作台内部播放宿主：无底板，只承载时间轴/播放。
  if (frameHost) return 'transparent';
  const s = String(raw || '').trim();
  // Default transparent → theme surface plate (not black).
  if (!s || s === 'transparent') return resolveThemeSurfaceFill('');
  return resolveThemeSurfaceFill(s);
}

function LottiePlate({
  nodeId,
  scenePlate,
  animationJson,
  loop,
  speed,
  plateFill,
  frameHost,
  hidden,
  mount,
}: {
  nodeId: string;
  scenePlate: CSSProperties & { left: number; top: number; width: number; height: number };
  animationJson: string;
  loop: boolean;
  speed: number;
  plateFill: string;
  frameHost?: boolean;
  hidden?: boolean;
  mount: HTMLElement;
}) {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const fill = resolveLottiePlateFill(plateFill, frameHost);

  useEffect(() => {
    const host = hostEl;
    if (!host) return undefined;
    const data = parseLottieAnimationData(animationJson);
    if (!data) return undefined;
    host.innerHTML = '';
    let anim: AnimationItem;
    const editorState = store.getState()?.editor as
      | {
          lottieTimelinePanel?: { nodeId?: string } | null;
          lottiePlayheadSec?: number;
        }
      | undefined;
    const timelineOwns =
      String(editorState?.lottieTimelinePanel?.nodeId || '') === String(nodeId);
    const restoreSec = Math.max(0, Number(editorState?.lottiePlayheadSec) || 0);
    try {
      anim = lottie.loadAnimation({
        container: host,
        // SVG renderer: canvas missed some LLM path/group fills (blank heart).
        // FO + CSS zoom scale still works for path ink; dock/lightbox also use SVG.
        renderer: 'svg',
        loop,
        // When the timeline dock owns this node, stay paused at the playhead
        // so JSON patches don't jump back to t=0 with autoplay.
        autoplay: !timelineOwns,
        animationData: structuredClone
          ? structuredClone(data)
          : JSON.parse(JSON.stringify(data)),
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
    const durationSec = () => {
      const fr = Math.max(1, Number(anim.frameRate) || 30);
      const total = Math.max(1, Number(anim.totalFrames) || 1);
      return total / fr;
    };
    const api: LottieHostApi = {
      play: () => anim.play(),
      pause: () => anim.pause(),
      isPaused: () => Boolean(anim.isPaused),
      setLoop: (next) => {
        anim.loop = next;
      },
      setSpeed: (next) => anim.setSpeed(next),
      getSpeed: () => Number(anim.playSpeed) || 1,
      seek: (timeSec) => {
        const fr = Math.max(1, Number(anim.frameRate) || 30);
        const total = Math.max(1, Number(anim.totalFrames) || 1);
        const frame = Math.max(0, Math.min(total - 1e-3, timeSec * fr));
        // goToAndStop leaves isPaused=true; callers that want playback must play() after.
        anim.goToAndStop(frame, true);
      },
      playFrom: (timeSec) => {
        const fr = Math.max(1, Number(anim.frameRate) || 30);
        const total = Math.max(1, Number(anim.totalFrames) || 1);
        const frame = Math.max(0, Math.min(total - 1e-3, timeSec * fr));
        anim.goToAndPlay(frame, true);
      },
      getCurrentTime: () => {
        const fr = Math.max(1, Number(anim.frameRate) || 30);
        return Math.max(0, Number(anim.currentFrame) || 0) / fr;
      },
      getDurationSec: durationSec,
    };
    lottieHosts.set(nodeId, api);
    if (timelineOwns) {
      api.seek(Math.min(restoreSec, durationSec()));
    }
    return () => {
      anim.destroy();
      animRef.current = null;
      if (lottieHosts.get(nodeId) === api) lottieHosts.delete(nodeId);
      host.innerHTML = '';
    };
    // loop/speed applied below — avoid remounting on toolbar toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [hostEl, animationJson, nodeId]);

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

  return createPortal(
    <div
      data-lottie-node={nodeId}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        borderRadius: scenePlate.borderRadius,
        background: fill,
        boxShadow:
          frameHost || fill === 'transparent' ? undefined : 'inset 0 0 0 1px var(--line)',
        visibility: hidden ? 'hidden' : undefined,
      }}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{
          width: scenePlate.width * z,
          height: scenePlate.height * z,
          transform: `scale(${1 / z})`,
          transformOrigin: '0 0',
        }}
      >
        <div ref={setHostEl} className="h-full w-full" />
      </div>
    </div>,
    mount
  );
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
  const [zoom, setZoom] = useState(1);
  const onZoom = useCallback((z: number) => {
    setZoom((prev) => (Math.abs(prev - z) < 1e-6 ? prev : z));
  }, []);
  void zoom;

  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      if (!isLottieNode(node)) return false;
      return Boolean(parseLottieAnimationData(node?.attrs?.animationData));
    });
  }, [document]);

  if (!ids.length) return null;

  return (
    <>
      <LottieZoomSync onZoom={onZoom} />
      {ids.map((nodeId) => (
        <LottiePlateHost
          key={nodeId}
          nodeId={nodeId}
          document={document}
          hidden={hidden}
          geometryOverrides={geometryOverrides}
        />
      ))}
    </>
  );
}

function LottiePlateHost({
  nodeId,
  document,
  hidden,
  geometryOverrides,
}: {
  nodeId: string;
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, LottieGeomOverride> | null;
}) {
  const mount = useHtmlMediaMount(nodeId);
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || !mount) return null;
  const animationJson = String(node.attrs?.animationData || '').trim();
  if (!parseLottieAnimationData(animationJson)) return null;
  const scenePlate = buildScenePlateStyle(document, node, geometryOverrides?.[nodeId]);
  const frameHost = isAnimationFrameHostNode(node, document);
  // Host ink is usually hidden (scene children are the editable ink). Show it
  // when imported / unlinked layers have nothing on the artboard to draw.
  const hideHostInk =
    frameHost && !animationHostHasUnlinkedInk(node.attrs?.animationData);
  const hideInk =
    hideHostInk ||
    isNodeOverlayHidden(document, node, hidden) ||
    shouldHideLottieInkForPrecompEdit(nodeId);
  return (
    <LottiePlate
      nodeId={nodeId}
      scenePlate={scenePlate}
      animationJson={animationJson}
      loop={readLoop(node.attrs)}
      speed={readSpeed(node.attrs)}
      plateFill={String(node.attrs?.['fill-color'] || '').trim()}
      frameHost={frameHost}
      hidden={hideInk}
      mount={mount}
    />
  );
}

export default memo(AnimationNodeOverlay);
