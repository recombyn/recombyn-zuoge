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
  isLottieNode,
  isNodeOverlayHidden,
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  parseLottieAnimationData,
  resolveThemeSurfaceFill
} from '@/components/rcb/scene/document/nodeFactories';
import {
  buildScenePlateStyle,
  type MediaGeomOverride,
} from '@/components/editor/nodes/shared/mediaPlateGeometry';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';

export type LottieGeomOverride = MediaGeomOverride;

export type LottieHostApi = {
  play: () => void;
  pause: () => void;
  isPaused: () => boolean;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  getSpeed: () => number;
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

function resolveLottiePlateFill(raw: string): string {
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
  hidden,
  mount,
}: {
  nodeId: string;
  scenePlate: CSSProperties & { left: number; top: number; width: number; height: number };
  animationJson: string;
  loop: boolean;
  speed: number;
  plateFill: string;
  hidden?: boolean;
  mount: HTMLElement;
}) {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const fill = resolveLottiePlateFill(plateFill);

  useEffect(() => {
    const host = hostEl;
    if (!host) return undefined;
    const data = parseLottieAnimationData(animationJson);
    if (!data) return undefined;
    host.innerHTML = '';
    let anim: AnimationItem;
    try {
      anim = lottie.loadAnimation({
        container: host,
        // SVG renderer: canvas missed some LLM path/group fills (blank heart).
        // FO + CSS zoom scale still works for path ink; dock/lightbox also use SVG.
        renderer: 'svg',
        loop,
        autoplay: true,
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
    const api: LottieHostApi = {
      play: () => anim.play(),
      pause: () => anim.pause(),
      isPaused: () => Boolean(anim.isPaused),
      setLoop: (next) => {
        anim.loop = next;
      },
      setSpeed: (next) => anim.setSpeed(next),
      getSpeed: () => Number(anim.playSpeed) || 1,
    };
    lottieHosts.set(nodeId, api);
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
        boxShadow: fill === 'transparent' ? undefined : 'inset 0 0 0 1px var(--line)',
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

function LottieNodeOverlay({
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
  return (
    <LottiePlate
      nodeId={nodeId}
      scenePlate={scenePlate}
      animationJson={animationJson}
      loop={readLoop(node.attrs)}
      speed={readSpeed(node.attrs)}
      plateFill={String(node.attrs?.['fill-color'] || '').trim()}
      hidden={isNodeOverlayHidden(document, node, hidden)}
      mount={mount}
    />
  );
}

export default memo(LottieNodeOverlay);
