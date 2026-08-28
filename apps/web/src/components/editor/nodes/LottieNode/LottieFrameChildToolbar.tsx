/**
 * Floating toolbar for scene nodes inside a Lottie 合成台.
 * Rive-style transform strip: XY / WH / rotation / skew / roundness /
 * anchor grid / opacity / blend — with keyframe diamonds (images + shapes).
 */
import { memo, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineLink, HiOutlineLinkSlash } from 'react-icons/hi2';
import Tooltip from '@/components/base/tooltip';
import { ExportSelectionPopover } from '@/components/editor/panels/ExportSelectionPanel';
import {
  findFrameLottieMediaId,
  resolveLottieFrameId,
} from '@/components/editor/nodes/LottieNode/resolveLottieFrameId';
import {
  parseAnchorPreset,
  type LottieAnchorPreset,
} from '@/components/editor/nodes/LottieNode/lottieFrameSync';
import { secToFrame } from '@/components/editor/nodes/LottieNode/lottieTimelineModel';
import {
  removeTransformKeyframe,
  upsertTransformKeyframe,
} from '@/components/editor/nodes/LottieNode/lottieTimelineMutate';
import {
  ensureLottieFrameMedia,
  openShapeStylePanel,
  patchDocumentNode,
} from '@/store/modules/editor';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { supportsCornerRadius } from '@/components/rcb/scene/document/nodeCapabilities';
import { cornerRadiusToolbarDisplay } from '@/components/rcb/scene/document/sceneRadii';
import { SelectionToolbarShell } from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import {
  SEL_ICON_BTN,
  SEL_SIZE_INPUT,
  SEL_TOOL_BTN,
} from '@/components/rcb/selection/chrome/ToolbarValueSlider';
import {
  FillColorSwatch,
  IconCornerRadius,
} from '@/components/rcb/selection/chrome/StyleToolbarIcons';
import BlendModeControl, {
  type BlendModeId,
} from '@/components/rcb/selection/chrome/BlendModeControl';
import { imageToolBtn, ImageToolSep } from '@/components/editor/nodes/ImageNode/imageToolbarShared';
import store from '@/store';
import { cn } from '@/utils/classnames';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
  valueBox?: SceneBox;
  edgePadScene?: number;
  angle?: number;
};

const ANCHOR_CELLS: LottieAnchorPreset[] = [
  'tl',
  'tm',
  'tr',
  'ml',
  'mm',
  'mr',
  'bl',
  'bm',
  'br',
];

function KfDiamond({
  active,
  tip,
  onClick,
}: {
  active: boolean;
  tip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip tip={tip} placement="top">
      <button
        type="button"
        aria-label={tip}
        aria-pressed={active}
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm',
          active ? 'text-[var(--brand)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'
        )}
        onClick={onClick}
      >
        <span
          className={cn(
            'block h-2 w-2 rotate-45 border',
            active
              ? 'border-[var(--brand)] bg-[var(--brand)]'
              : 'border-current bg-transparent'
          )}
        />
      </button>
    </Tooltip>
  );
}

function NumField({
  label,
  value,
  onCommit,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md px-1 text-[11px] text-[var(--muted)]">
      <span>{label}</span>
      <input
        type="number"
        className={SEL_SIZE_INPUT}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onCommit(n);
        }}
      />
      {suffix ? <span className="text-[10px]">{suffix}</span> : null}
    </label>
  );
}

function AnchorPointGrid({
  value,
  onChange,
}: {
  value: LottieAnchorPreset;
  onChange: (next: LottieAnchorPreset) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip
      tip={t('editor.lottieToolbar.anchorPoint', { defaultValue: '锚点 Anchor point' })}
      placement="top"
    >
      <div
        className="grid h-8 w-8 shrink-0 grid-cols-3 grid-rows-3 gap-px rounded border border-[var(--line)] bg-[var(--line)] p-px"
        role="group"
        aria-label={t('editor.lottieToolbar.anchorPoint', { defaultValue: '锚点' })}
      >
        {ANCHOR_CELLS.map((id) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={id}
              aria-pressed={on}
              className={cn(
                'h-full w-full rounded-[1px]',
                on ? 'bg-[var(--brand)]' : 'bg-[var(--panel)] hover:bg-[var(--accent-soft)]'
              )}
              onClick={() => onChange(id)}
            />
          );
        })}
      </div>
    </Tooltip>
  );
}

function propHasKfAt(
  anim: Record<string, unknown> | null,
  layerInd: number,
  propKey: string,
  timeSec: number,
  fps: number
): boolean {
  if (!anim) return false;
  const layers = Array.isArray(anim.layers) ? (anim.layers as any[]) : [];
  const layer = layers.find((l) => Number(l?.ind) === layerInd);
  const prop = layer?.ks?.[propKey];
  if (!prop || Number(prop.a) !== 1 || !Array.isArray(prop.k)) return false;
  const frame = secToFrame(timeSec, fps);
  return prop.k.some((row: any) => Math.abs(Number(row?.t) - frame) <= 0.51);
}

function isAspectLocked(attrs: Record<string, unknown> | null | undefined): boolean {
  const raw = attrs?.lockAspect;
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function LottieFrameChildToolbar({
  document,
  nodeId,
  box,
  valueBox,
  edgePadScene,
  angle,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const playhead = useSelector((s: any) => Number(s.editor.lottiePlayheadSec) || 0);
  const node = document?.deltaSetLike?.[nodeId] as SceneNode | undefined;
  const frameId = resolveLottieFrameId(document, node);
  const hostId = frameId ? findFrameLottieMediaId(document, frameId) : null;
  const host = hostId ? document?.deltaSetLike?.[hostId] : null;
  const anim = useMemo(
    () => parseLottieAnimationData(host?.attrs?.animationData),
    [host?.attrs?.animationData]
  );
  const fps = Math.max(1, Number(anim?.fr) || 30);
  const layerInd = Math.max(1, Number(node?.attrs?.lottieLayerInd) || 0);
  const geom = valueBox || box;
  const w = Math.max(1, geom.width);
  const h = Math.max(1, geom.height);
  const rot = angle ?? (Number(node?.attrs?.angle) || 0);
  const skew = Number(node?.attrs?.skewX ?? node?.attrs?.skew) || 0;
  const opacityRaw = Number(node?.attrs?.opacity);
  const opacity = Number.isFinite(opacityRaw)
    ? opacityRaw <= 1
      ? Math.round(opacityRaw * 100)
      : Math.round(opacityRaw)
    : 100;
  const aspectLocked = isAspectLocked(node?.attrs);
  const anchor = parseAnchorPreset(node?.attrs?.anchorPreset);
  const canRadius = Boolean(node && supportsCornerRadius(node));
  const radius = cornerRadiusToolbarDisplay(node?.attrs);
  const isShape =
    node?.key === 'shape' ||
    node?.key === 'rect' ||
    node?.key === 'ellipse' ||
    node?.key === 'path';
  const isImage = node?.key === 'image';
  const fill = String(node?.attrs?.['fill-color'] || '#3B82F6');
  const blendMode = node?.attrs?.blendMode;

  const ensureLinked = () => {
    if (!frameId) return null;
    dispatch(ensureLottieFrameMedia({ frameId }));
    const doc = store.getState()?.editor?.document;
    const hid = findFrameLottieMediaId(doc, frameId);
    const child = doc?.deltaSetLike?.[nodeId];
    const ind = Number(child?.attrs?.lottieLayerInd);
    const animationData = parseLottieAnimationData(
      doc?.deltaSetLike?.[hid || '']?.attrs?.animationData
    );
    if (!hid || !animationData || !Number.isFinite(ind) || ind <= 0) return null;
    return { hostId: hid, animationData, layerInd: ind };
  };

  const patchAttrs = (attrs: Record<string, unknown>, geomPatch?: Partial<SceneNode>) => {
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          ...(geomPatch || {}),
          attrs,
        },
      })
    );
    if (frameId) dispatch(ensureLottieFrameMedia({ frameId }));
  };

  const toggleKf = (propKey: string) => {
    const linked = ensureLinked();
    if (!linked) return;
    const frame = secToFrame(playhead, fps);
    const has = propHasKfAt(linked.animationData, linked.layerInd, propKey, playhead, fps);
    const next = has
      ? removeTransformKeyframe({
          animationData: linked.animationData,
          sceneKind: 'main',
          layerInd: linked.layerInd,
          propKey,
          frame,
        })
      : upsertTransformKeyframe({
          animationData: linked.animationData,
          sceneKind: 'main',
          layerInd: linked.layerInd,
          propKey,
          frame,
        });
    if (!next) return;
    const json = serializeLottieAnimationData(next);
    if (!json) return;
    dispatch(patchDocumentNode({ nodeId: linked.hostId, patch: { attrs: { animationData: json } } }));
  };

  const commitSize = (nextW: number, nextH: number) => {
    let width = Math.max(1, nextW);
    let height = Math.max(1, nextH);
    if (aspectLocked && w > 0 && h > 0) {
      if (Math.abs(width - w) >= Math.abs(height - h)) {
        height = Math.max(1, Math.round((width * h) / w));
      } else {
        width = Math.max(1, Math.round((height * w) / h));
      }
    }
    patchAttrs({}, { width, height });
  };

  if (!node || !frameId) return null;

  const kfTip = (on: boolean) =>
    on
      ? t('editor.lottieTimeline.removeKf', { defaultValue: '删除播放头处关键帧' })
      : t('editor.lottieTimeline.addKf', { defaultValue: '在播放头添加关键帧' });

  return (
    <SelectionToolbarShell
      box={box}
      edgePadScene={edgePadScene}
      angle={rot}
      hasTitleLabel
    >
      {isShape ? (
        <>
          <Tooltip tip={t('editor.selectionToolbar.color', { defaultValue: '颜色' })} placement="top">
            <button
              type="button"
              aria-label={t('editor.selectionToolbar.color', { defaultValue: '颜色' })}
              className={SEL_ICON_BTN}
              onClick={() => dispatch(openShapeStylePanel({ kind: 'fill', nodeIds: [nodeId] }))}
            >
              <FillColorSwatch color={fill === 'transparent' ? 'transparent' : fill} />
            </button>
          </Tooltip>
          <ImageToolSep />
        </>
      ) : null}

      <NumField label="X" value={geom.left} onCommit={(n) => patchAttrs({}, { x: n })} />
      <NumField label="Y" value={geom.top} onCommit={(n) => patchAttrs({}, { y: n })} />
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 'p', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 'p', playhead, fps))}
        onClick={() => toggleKf('p')}
      />
      <ImageToolSep />

      <NumField label="W" value={w} onCommit={(n) => commitSize(n, h)} />
      <NumField label="H" value={h} onCommit={(n) => commitSize(w, n)} />
      <Tooltip
        tip={
          aspectLocked
            ? t('editor.imageToolbar.unlockAspect', { defaultValue: '解锁比例' })
            : t('editor.imageToolbar.lockAspect', { defaultValue: '锁定比例' })
        }
        placement="top"
      >
        <button
          type="button"
          aria-pressed={aspectLocked}
          className={cn(SEL_ICON_BTN, aspectLocked && 'bg-[var(--accent-soft)] text-[var(--ink)]')}
          onClick={() => patchAttrs({ lockAspect: aspectLocked ? 'false' : 'true' })}
        >
          {aspectLocked ? (
            <HiOutlineLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <HiOutlineLinkSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </Tooltip>
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 's', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 's', playhead, fps))}
        onClick={() => toggleKf('s')}
      />
      <ImageToolSep />

      <NumField
        label="R"
        value={rot}
        suffix="°"
        onCommit={(n) => patchAttrs({ angle: n })}
      />
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 'r', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 'r', playhead, fps))}
        onClick={() => toggleKf('r')}
      />

      <NumField
        label={t('editor.lottieToolbar.skew', { defaultValue: '倾斜' })}
        value={skew}
        suffix="°"
        onCommit={(n) => patchAttrs({ skewX: n })}
      />
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 'sk', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 'sk', playhead, fps))}
        onClick={() => toggleKf('sk')}
      />
      <ImageToolSep />

      {canRadius ? (
        <>
          <Tooltip tip={t('editor.selectionToolbar.cornerRadius', { defaultValue: '圆角' })} placement="top">
            <button
              type="button"
              aria-label={t('editor.selectionToolbar.cornerRadius', { defaultValue: '圆角' })}
              className={SEL_TOOL_BTN}
              onClick={() =>
                dispatch(openShapeStylePanel({ kind: 'radius', nodeIds: [nodeId] }))
              }
            >
              <IconCornerRadius className="h-4 w-4 text-[var(--muted)]" />
            </button>
          </Tooltip>
          <NumField
            label={t('editor.selectionToolbar.cornerRadius', { defaultValue: '圆角' })}
            value={radius}
            onCommit={(n) =>
              patchAttrs({
                cornerRadius: Math.max(0, Math.round(n)),
                cornerRadiusTL: Math.max(0, Math.round(n)),
                cornerRadiusTR: Math.max(0, Math.round(n)),
                cornerRadiusBR: Math.max(0, Math.round(n)),
                cornerRadiusBL: Math.max(0, Math.round(n)),
              })
            }
          />
        </>
      ) : null}

      <ImageToolSep />
      <AnchorPointGrid
        value={anchor}
        onChange={(next) => patchAttrs({ anchorPreset: next })}
      />
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 'a', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 'a', playhead, fps))}
        onClick={() => toggleKf('a')}
      />
      <ImageToolSep />

      <BlendModeControl
        blendMode={blendMode}
        opacity={opacity / 100}
        onBlendModeChange={(mode: BlendModeId) => patchAttrs({ blendMode: mode })}
        onOpacityChange={(v01) =>
          patchAttrs({ opacity: Math.max(0, Math.min(100, Math.round(v01 * 100))) })
        }
      />
      <KfDiamond
        active={propHasKfAt(anim, layerInd, 'o', playhead, fps)}
        tip={kfTip(propHasKfAt(anim, layerInd, 'o', playhead, fps))}
        onClick={() => toggleKf('o')}
      />

      {(isImage || isShape) && (
        <>
          <ImageToolSep />
          <ExportSelectionPopover nodeIds={[nodeId]} triggerClassName={imageToolBtn} />
        </>
      )}
    </SelectionToolbarShell>
  );
}

export default memo(LottieFrameChildToolbar);
