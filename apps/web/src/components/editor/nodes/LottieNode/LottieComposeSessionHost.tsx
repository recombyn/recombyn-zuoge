/**
 * In-plate draw session for Lottie compose mode (rect / ellipse → animationData).
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
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  RcbOverlayPortal,
  rcbSceneToScreen,
  useRcbCamera,
  useRcbScreenToScene,
} from '@/components/rcb';
import { isLottieNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { nodeSceneBox } from '@/components/editor/nodes/ImageNode/mark/markGeometry';
import {
  appendEllipseLayer,
  appendRectLayer,
  ensureLottieAnimationForCompose,
  patchAnimationDataAttr,
  sceneBoxToLottieLocal,
  type LottieComposeTool,
} from '@/components/editor/nodes/LottieNode/lottieComposeLayers';
import { message } from '@/components/base';
import {
  closeLottieComposePanel,
  patchDocumentNode,
} from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const MIN_DRAW = 8;
const OVERLAY_Z = 36;

type Draft = { x0: number; y0: number; x1: number; y1: number };

function LottieComposeSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const toScene = useRcbScreenToScene();
  const panel = useSelector(
    (s: any) =>
      s.editor.lottieComposePanel as null | { nodeId: string; tool: LottieComposeTool }
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const drawing = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nodeId = panel?.nodeId || '';
  const tool = panel?.tool || 'select';
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const active = Boolean(panel && node && isLottieNode(node) && !hidden);
  const drawTool = tool === 'rect' || tool === 'ellipse';

  const plate = useMemo(
    () => (node ? nodeSceneBox(document, node) : null),
    [document, node]
  );

  const anim = useMemo(() => {
    if (!plate || !node) return null;
    return ensureLottieAnimationForCompose(node.attrs?.animationData, plate);
  }, [node, plate]);

  useEffect(() => {
    if (active) return;
    setDraft(null);
    draftRef.current = null;
    drawing.current = false;
  }, [active]);

  const commitShape = useCallback(
    (sceneBox: { x: number; y: number; w: number; h: number }) => {
      if (!nodeId || !plate || !anim) return;
      if (sceneBox.w < MIN_DRAW || sceneBox.h < MIN_DRAW) return;
      const animW = Math.max(1, Number(anim.w) || plate.width);
      const animH = Math.max(1, Number(anim.h) || plate.height);
      const local = sceneBoxToLottieLocal(sceneBox, plate, animW, animH);
      if (local.w < 1 || local.h < 1) return;
      const next =
        tool === 'ellipse'
          ? appendEllipseLayer(anim, local)
          : appendRectLayer(anim, local);
      const json = patchAnimationDataAttr(next);
      if (!json) return;
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: { attrs: { animationData: json } },
        })
      );
    },
    [anim, dispatch, nodeId, plate, tool]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawTool || !plate) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toScene(e.clientX, e.clientY);
    drawing.current = true;
    const next = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    draftRef.current = next;
    setDraft(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    const p = toScene(e.clientX, e.clientY);
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, x1: p.x, y1: p.y };
      draftRef.current = next;
      return next;
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    commitShape({ x, y, w, h });
  };

  const onUploadSvg = () => {
    fileInputRef.current?.click();
  };

  const onSvgPicked = async (file: File | null) => {
    if (!file || !nodeId || !plate) return;
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      message.warning(
        t('editor.lottieCompose.svgOnly', { defaultValue: '请上传 SVG 文件' })
      );
      return;
    }
    try {
      const text = await file.text();
      // v1: stash raw SVG for later layer-split; keep compose session open.
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              lottieSourceSvg: text,
              lottieComposeDirty: 'true',
            },
          },
        })
      );
      message.success(
        t('editor.lottieCompose.svgImported', {
          defaultValue: '已导入 SVG，图层拆分即将支持',
        })
      );
    } catch {
      message.error(
        t('editor.lottieCompose.svgFail', { defaultValue: 'SVG 读取失败' })
      );
    }
  };

  // Expose upload trigger for toolbar via custom event (toolbar is outside host).
  useEffect(() => {
    if (!active) return;
    const onReq = () => onUploadSvg();
    window.addEventListener('resume:lottie-compose-upload-svg', onReq);
    return () => window.removeEventListener('resume:lottie-compose-upload-svg', onReq);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(closeLottieComposePanel());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dispatch]);

  if (!active || !plate) return null;

  const screen = rcbSceneToScreen(camera, { x: plate.left, y: plate.top });
  const z = Math.max(0.05, camera.zoom || 1);
  const shell: CSSProperties = {
    position: 'absolute',
    left: screen.x,
    top: screen.y,
    width: plate.width * z,
    height: plate.height * z,
    zIndex: OVERLAY_Z,
    pointerEvents: drawTool ? 'auto' : 'none',
    cursor: drawTool ? 'crosshair' : 'default',
  };

  let draftStyle: CSSProperties | null = null;
  if (draft && plate) {
    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);
    const tl = rcbSceneToScreen(camera, { x, y });
    draftStyle = {
      position: 'absolute',
      left: tl.x,
      top: tl.y,
      width: Math.max(1, w * z),
      height: Math.max(1, h * z),
      borderRadius: tool === 'ellipse' ? '999px' : 4,
      border: '1.5px solid var(--accent)',
      background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
      pointerEvents: 'none',
      zIndex: OVERLAY_Z + 1,
    };
  }

  return (
    <RcbOverlayPortal>
      <div
        data-lottie-compose-overlay
        style={shell}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {draftStyle ? <div style={draftStyle} /> : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          void onSvgPicked(f);
        }}
      />
    </RcbOverlayPortal>
  );
}

export default memo(LottieComposeSessionHost);
