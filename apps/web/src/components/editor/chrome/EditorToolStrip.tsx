import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  LuArrowUpRight,
  LuCircle,
  LuFrame,
  LuHand,
  LuHexagon,
  LuImage,
  LuImagePlus,
  LuImageUp,
  LuMinus,
  LuFileJson,
  LuMusic2,
  LuMousePointer2,
  LuPenTool,
  LuPencil,
  LuSquare,
  LuStar,
  LuTriangle,
  LuType,
} from 'react-icons/lu';
import { RiImageUploadLine, RiVideoUploadLine } from 'react-icons/ri';
import { Dropdown, Tooltip, message } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import { readFileAsDataUrl, isUploadAbortError } from '@/utils/uploadImage';
import { uploadCanvasPlaceholderFile } from '@/utils/canvasUploadFlow';
import store from '@/store';
import {
  setActiveTool,
  setShapeKind,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  startAudioUploadPlaceholder,
  spawnLottie,
  spawnImageGenerator,
  spawnVideoGenerator,
  spawnLottieGenerator,
  spawnAudioGenerator,
  finishImageProcess,
  failImageProcess,
} from '@/store/modules/editor';
import {
  ensureCanvasPlugins,
  listCanvasToolbarButtons,
  buildCanvasPluginRuntime,
  type CanvasToolbarButton,
} from '@/plugins/canvas/host';
import {
  fitImageSize,
  measureImageNaturalSize,
  prepareVideoUploadPreview,
  parseLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { sceneToDocumentCoords } from '@/components/rcb/scene/paint/svgToScene';
import {
  rcbLayoutGeneratorPlate,
  rcbScreenToScene,
  GENERATOR_EMPTY_STROKE_OUTSET,
  type RcbCamera,
} from '@/components/rcb';
import {
  getDocumentGridSize,
} from '@/components/rcb/selection/alignGuides';
import { cn } from '@/utils/classnames';
import { getHttpErrorMessage } from '@/service/client';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const MENU_ICON_CLASS = 'h-4 w-4';
const TOOL_ICON_CLASS = 'h-4 w-4 shrink-0';
const STROKE = 1.5;
const MENU_POPUP = 'min-w-[11rem]';

/** Keyboard hints shown in toolbar menus / tooltips — keep in sync with the keydown handler below. */
const TOOL_SHORTCUT = {
  select: 'V',
  pan: 'H',
  frame: 'F',
  text: 'T',
  pen: 'P',
  pencil: 'Shift P',
  rect: 'R',
  line: 'L',
  arrow: 'Shift L',
  circle: 'O',
  polygon: 'G',
  star: 'S',
  upload: 'I',
  imageGenerator: 'A',
  videoGenerator: 'Shift A',
  lottieGenerator: 'M',
  audioGenerator: 'U',
} as const;

function toolTipWithShortcut(label: string, shortcut?: string) {
  return shortcut ? `${label} (${shortcut})` : label;
}

function resolveToolbarShapeKind(shapeKind: string | null | undefined): string {
  if (!shapeKind || shapeKind === 'image') return 'rect';
  return layerIconByKind[shapeKind] ? shapeKind : 'rect';
}

function pickUploadAction(
  key: string,
  actions: {
    image: () => void;
    video: () => void;
    audio: () => void;
    lottie: () => void;
  }
) {
  if (key === 'video') {
    actions.video();
    return;
  }
  if (key === 'audio') {
    actions.audio();
    return;
  }
  if (key === 'lottie') {
    actions.lottie();
    return;
  }
  actions.image();
}

/**
 * Fit a generator plate into the visible stage, center it, snap painted outer
 * ink to the document grid (then inset 0.5 for the empty-state center stroke).
 */
function layoutGeneratorPlateInView(opts: {
  document: SceneDocument;
  camera: RcbCamera;
  stageEl: HTMLElement;
  natural: { width: number; height: number };
  fit?: { minRatio?: number; maxRatio?: number };
}): { x: number; y: number; width: number; height: number } {
  const view = opts.stageEl.getBoundingClientRect();
  const zoom = Math.max(0.05, opts.camera.zoom || 1);
  const center = rcbScreenToScene(
    opts.camera,
    opts.stageEl,
    view.left + view.width / 2,
    view.top + view.height / 2
  );
  const gridSize = getDocumentGridSize(opts.document);
  const laid = rcbLayoutGeneratorPlate({
    natural: opts.natural,
    viewport: { width: view.width, height: view.height },
    zoom,
    center,
    gridSize,
    visualOutset: GENERATOR_EMPTY_STROKE_OUTSET,
    fit: opts.fit,
  });
  const origin = sceneToDocumentCoords(opts.document, laid.left, laid.top);
  return {
    x: origin.x,
    y: origin.y,
    width: laid.width,
    height: laid.height,
  };
}

type LayerIconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

/** Layer glyphs share one stroke weight / optical size. */
const layerIconByKind: Record<string, LayerIconComponent> = {
  text: LuType,
  image: LuImage,
  rect: LuSquare,
  line: LuMinus,
  arrow: LuArrowUpRight,
  circle: LuCircle,
  triangle: LuTriangle,
  star: LuStar,
  polygon: LuHexagon,
  pen: LuPenTool,
  pencil: LuPencil,
  path: LuPenTool,
};

function MenuLabel({
  iconKey,
  label,
  icon,
  shortcut,
}: {
  iconKey?: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
}) {
  const IconComp = iconKey ? layerIconByKind[iconKey] || layerIconByKind.rect : null;
  return (
    <span className="flex w-full items-center gap-2">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ink)]">
        {icon ||
          (IconComp ? (
            <IconComp className={cn('block shrink-0', MENU_ICON_CLASS)} strokeWidth={STROKE} />
          ) : null)}
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-[var(--ink)]">{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-[11px] font-normal tabular-nums text-[var(--muted)]">
          {shortcut}
        </span>
      ) : null}
    </span>
  );
}

function ToolIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center justify-center',
        TOOL_ICON_CLASS,
        '[&>svg]:block [&>svg]:h-full [&>svg]:w-full',
        className
      )}
    >
      {children}
    </span>
  );
}

function ToolBtn({
  tip,
  ariaLabel,
  active,
  disabled,
  onClick,
  children,
}: {
  /** When omitted, no hover tip (use for tools that open a secondary panel). */
  tip?: string;
  ariaLabel?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const label = ariaLabel || tip;
  const btn = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        disabled && 'pointer-events-none opacity-40',
        active
          ? 'bg-[var(--ink)] text-[var(--on-brand)]'
          : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
      )}
    >
      {children}
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip tip={tip} placement="top">
      {btn}
    </Tooltip>
  );
}

/** Click activates tool; hover shows variant panel (no corner chevron). No tip — panel is the hint. */
function SplitToolButton({
  tip,
  active,
  disabled,
  menuOpen,
  onMenuOpenChange,
  items,
  selectedKeys,
  onMenuPick,
  onPrimaryClick,
  menuOffset = 10,
  children,
}: {
  /** Accessible name only; no hover tip (dropdown is the secondary panel). */
  tip: string;
  active?: boolean;
  disabled?: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  items: MenuItemType[];
  selectedKeys: string[];
  onMenuPick: (key: string) => void;
  /** Click the icon → select / re-activate the current sub-tool. */
  onPrimaryClick: () => void;
  /** Gap between trigger and dropdown (px). */
  menuOffset?: number;
  children: ReactNode;
}) {
  return (
    <Dropdown
      trigger="hover"
      open={disabled ? false : menuOpen}
      onOpenChange={(open) => {
        if (disabled) return;
        onMenuOpenChange(open);
      }}
      placement="top"
      offset={menuOffset}
      items={items}
      selectedKeys={selectedKeys}
      onClick={onMenuPick}
      popupClassName={MENU_POPUP}
      floatingClassName="z-50"
      referenceClassName={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        disabled && 'pointer-events-none opacity-40',
        active
          ? 'bg-[var(--ink)] text-[var(--on-brand)]'
          : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
      )}
    >
      <button
        type="button"
        aria-label={tip}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          if (disabled) return;
          onPrimaryClick();
        }}
        className="inline-flex size-full items-center justify-center"
      >
        {children}
      </button>
    </Dropdown>
  );
}

/**
 * Bottom-center tool dock:
 * Select · 形状 · 钢笔 · 画笔 · 文字 · 智能画板 · 图片
 */
function EditorToolStrip({
  className,
  camera,
  stageEl = null,
  compact = false,
  selectOnly = false,
}: {
  className?: string;
  /** Used to place toolbar image uploads at the visible viewport center. */
  camera?: RcbCamera;
  stageEl?: HTMLElement | null;
  compact?: boolean;
  /** Preview / inspect: keep the dock visible but only Select / Pan stay active. */
  selectOnly?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const activeTool = useSelector((state: any) => state.editor.activeTool);
  const shapeKind = useSelector((state: any) => state.editor.shapeKind);
  const document = useSelector((state: any) => state.editor.document);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const lottieInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pluginButtons, setPluginButtons] = useState<CanvasToolbarButton[]>([]);
  const toolsLocked = Boolean(selectOnly);

  useEffect(() => {
    let cancelled = false;
    async function loadPlugins() {
      await ensureCanvasPlugins();
      if (cancelled) return;
      setPluginButtons(listCanvasToolbarButtons());
    }
    void loadPlugins();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toolsLocked) return;
    if (activeTool === 'select' || activeTool === 'pan') return;
    dispatch(setActiveTool('select'));
  }, [toolsLocked, activeTool, dispatch]);

  const L = useMemo(
    () => ({
      select: t('editor.tools.select'),
      pan: t('editor.tools.pan'),
      frame: t('editor.tools.frame'),
      shape: t('editor.tools.shape'),
      pen: t('editor.tools.pen'),
      pencil: t('editor.tools.pencil'),
      text: t('editor.tools.text'),
      rect: t('editor.tools.rect'),
      line: t('editor.tools.line'),
      arrow: t('editor.tools.arrow'),
      circle: t('editor.tools.circle'),
      polygon: t('editor.tools.polygon'),
      star: t('editor.tools.star'),
      uploadImage: t('editor.tools.uploadImage'),
      uploadVideo: t('editor.tools.uploadVideo', {
        defaultValue: '视频上传',
      }),
      uploadAudio: t('editor.tools.uploadAudio', {
        defaultValue: 'Upload audio',
      }),
      uploadLottie: t('editor.tools.uploadLottie', {
        defaultValue: 'Upload Lottie',
      }),
      uploadMedia: t('editor.tools.uploadMedia', {
        defaultValue: '上传文件',
      }),
      imageGenerator: t('editor.tools.imageGenerator'),
      videoGenerator: t('editor.tools.videoGenerator'),
      lottieGenerator: t('editor.tools.lottieGenerator'),
      audioGenerator: t('editor.tools.audioGenerator'),
      uploading: t('editor.tools.uploading'),
      uploadFail: t('editor.tools.uploadFail'),
    }),
    [t]
  );

  const selectItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'select',
        label: (
          <MenuLabel
            label={L.select}
            shortcut={TOOL_SHORTCUT.select}
            icon={<LuMousePointer2 className={MENU_ICON_CLASS} strokeWidth={STROKE} />}
          />
        ),
      },
      {
        key: 'pan',
        label: (
          <MenuLabel
            label={L.pan}
            shortcut={TOOL_SHORTCUT.pan}
            icon={<LuHand className={MENU_ICON_CLASS} strokeWidth={STROKE} />}
          />
        ),
      },
    ],
    [L.pan, L.select]
  );

  const shapeItems: MenuItemType[] = useMemo(
    () => [
      { key: 'rect', label: <MenuLabel iconKey="rect" label={L.rect} shortcut={TOOL_SHORTCUT.rect} /> },
      { key: 'line', label: <MenuLabel iconKey="line" label={L.line} shortcut={TOOL_SHORTCUT.line} /> },
      {
        key: 'arrow',
        label: <MenuLabel iconKey="arrow" label={L.arrow} shortcut={TOOL_SHORTCUT.arrow} />,
      },
      {
        key: 'circle',
        label: <MenuLabel iconKey="circle" label={L.circle} shortcut={TOOL_SHORTCUT.circle} />,
      },
      { key: 'polygon', label: <MenuLabel iconKey="polygon" label={L.polygon} shortcut={TOOL_SHORTCUT.polygon} /> },
      { key: 'star', label: <MenuLabel iconKey="star" label={L.star} shortcut={TOOL_SHORTCUT.star} /> },
    ],
    [L.arrow, L.circle, L.line, L.polygon, L.rect, L.star]
  );

  const uploadItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'image',
        label: (
          <MenuLabel
            label={L.uploadImage}
            icon={<RiImageUploadLine className={MENU_ICON_CLASS} />}
          />
        ),
      },
      {
        key: 'video',
        label: (
          <MenuLabel
            label={L.uploadVideo}
            icon={<RiVideoUploadLine className={MENU_ICON_CLASS} />}
          />
        ),
      },
      {
        key: 'audio',
        label: (
          <MenuLabel
            label={L.uploadAudio}
            icon={<LuMusic2 className={MENU_ICON_CLASS} strokeWidth={1.8} />}
          />
        ),
      },
      {
        key: 'lottie',
        label: (
          <MenuLabel
            label={L.uploadLottie}
            icon={<LuFileJson className={MENU_ICON_CLASS} strokeWidth={1.8} />}
          />
        ),
      },
    ],
    [L.uploadAudio, L.uploadImage, L.uploadLottie, L.uploadVideo]
  );

  const spawnImageGeneratorAtView = () => {
    if (!document) return;
    let width = 360;
    let height = 360;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 1024, height: 1024 },
          fit: { minRatio: 0.28, maxRatio: 0.42 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnImageGenerator({
        x,
        y,
        width,
        height,
        name: L.imageGenerator,
      })
    );
  };

  const spawnVideoGeneratorAtView = () => {
    if (!document) return;
    let width = 640;
    let height = 360;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 1280, height: 720 },
          fit: { minRatio: 0.28, maxRatio: 0.48 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnVideoGenerator({
        x,
        y,
        width,
        height,
        name: L.videoGenerator,
      })
    );
  };

  const spawnLottieGeneratorAtView = () => {
    if (!document) return;
    let width = 200;
    let height = 200;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 200, height: 200 },
          fit: { minRatio: 0.18, maxRatio: 0.32 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnLottieGenerator({
        x,
        y,
        width,
        height,
        name: L.lottieGenerator,
      })
    );
  };

  const spawnAudioGeneratorAtView = () => {
    if (!document) return;
    let width = 360;
    let height = 200;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 720, height: 400 },
          fit: { minRatio: 0.22, maxRatio: 0.4 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnAudioGenerator({
        x,
        y,
        width,
        height,
        name: L.audioGenerator,
      })
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        target?.closest?.(
          '[contenteditable="true"],[data-agent-composer],[data-image-generator],[data-video-generator],[data-lottie-generator],[data-audio-generator]'
        )
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'v' && !e.shiftKey) {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('select'));
      }
      if (key === 'h' && !e.shiftKey) {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('pan'));
      }
      if (toolsLocked) {
        if (key === 'escape') {
          window.dispatchEvent(new Event('resume:exit-path-edit'));
          dispatch(setActiveTool('select'));
        }
        return;
      }
      if (key === 'f' && !e.shiftKey) dispatch(setActiveTool('frame'));
      if (key === 't' && !e.shiftKey) dispatch(setActiveTool('text'));
      if (key === 'r' && !e.shiftKey) dispatch(setShapeKind('rect'));
      if (key === 'l' && !e.shiftKey) dispatch(setShapeKind('line'));
      if (key === 'l' && e.shiftKey) dispatch(setShapeKind('arrow'));
      if (key === 'o' && !e.shiftKey) dispatch(setShapeKind('circle'));
      if (key === 'g' && !e.shiftKey) dispatch(setShapeKind('polygon'));
      if (key === 's' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        dispatch(setShapeKind('star'));
      }
      if (key === 'i' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setOpenMenu('upload');
      }
      if (key === 'a' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnImageGeneratorAtView();
      }
      if (key === 'a' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnVideoGeneratorAtView();
      }
      if (key === 'm' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnLottieGeneratorAtView();
      }
      if (key === 'u' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnAudioGeneratorAtView();
      }
      if (key === 'p' && !e.shiftKey) dispatch(setActiveTool('pen'));
      if (key === 'p' && e.shiftKey) dispatch(setActiveTool('pencil'));
      if (key === 'escape') {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('select'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Intentionally stable: always call latest spawn via closure from this render's effect re-run when deps change.
  }, [
    camera,
    dispatch,
    document,
    L.imageGenerator,
    L.videoGenerator,
    L.lottieGenerator,
    L.audioGenerator,
    stageEl,
    toolsLocked,
  ]);

  const placeAtViewportCenter = (
    natural: { width: number; height: number }
  ): { width: number; height: number; x?: number; y?: number } => {
    const view = stageEl?.getBoundingClientRect() || null;
    const placeable =
      camera && stageEl && document && view && view.width > 0 && view.height > 0
        ? { camera, stageEl, document, view }
        : null;
    if (placeable) {
      const laid = layoutGeneratorPlateInView({
        document: placeable.document,
        camera: placeable.camera,
        stageEl: placeable.stageEl,
        natural,
      });
      return { width: laid.width, height: laid.height, x: laid.x, y: laid.y };
    }
    const { width, height } = fitImageSize(natural.width, natural.height, 2400);
    return { width, height };
  };

  const onPickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const preview = await readFileAsDataUrl(file);
      const natural = await measureImageNaturalSize(preview);
      const { width, height, x, y } = placeAtViewportCenter(natural);
      dispatch(
        startImageUploadPlaceholder({
          src: preview,
          width,
          height,
          x,
          y,
          label: L.uploading,
          name: file.name?.replace(/\.[^.]+$/, '') || 'Image',
        })
      );
      const spawnedId = String(
        (store.getState() as any).editor?.pendingImageProcessId || ''
      );
      await uploadCanvasPlaceholderFile({ dispatch, nodeId: spawnedId, file });
    } catch (err: any) {
      if (isUploadAbortError(err)) return;
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, L.uploadFail));
    }
  };

  const onPickVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const prepared = await prepareVideoUploadPreview(file);
      const { width, height, x, y } = placeAtViewportCenter({
        width: prepared.width,
        height: prepared.height,
      });
      dispatch(
        startVideoUploadPlaceholder({
          src: prepared.preview,
          poster: prepared.poster,
          width,
          height,
          x,
          y,
          label: L.uploading,
          name: prepared.name,
          duration: prepared.duration,
        })
      );
      const spawnedId = String(
        (store.getState() as any).editor?.pendingImageProcessId || ''
      );
      await uploadCanvasPlaceholderFile({
        dispatch,
        nodeId: spawnedId,
        file,
        waitDecode: false,
        extraAttrs: {
          ...(prepared.poster ? { poster: prepared.poster } : {}),
          ...(Number.isFinite(prepared.duration) && prepared.duration > 0
            ? { duration: prepared.duration }
            : {}),
          assetKind: 'video',
        },
      });
    } catch (err: any) {
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, L.uploadFail));
    }
  };

  const onPickAudio = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const preview = await readFileAsDataUrl(file);
      const duration = await new Promise<number | undefined>((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.onloadedmetadata = () =>
          resolve(Number.isFinite(audio.duration) ? audio.duration : undefined);
        audio.onerror = () => resolve(undefined);
        audio.src = preview;
      });
      const { width, height, x, y } = placeAtViewportCenter({ width: 720, height: 400 });
      dispatch(
        startAudioUploadPlaceholder({
          src: preview,
          width,
          height: Math.max(140, height),
          x,
          y,
          label: L.uploading,
          name: file.name?.replace(/\.[^.]+$/, '') || 'Audio',
          duration,
        })
      );
      const spawnedId = String(
        (store.getState() as any).editor?.pendingImageProcessId || ''
      );
      await uploadCanvasPlaceholderFile({
        dispatch,
        nodeId: spawnedId,
        file,
        waitDecode: false,
        extraAttrs: {
          ...(duration ? { duration } : {}),
          assetKind: 'audio',
        },
      });
    } catch (err: any) {
      if (isUploadAbortError(err)) return;
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, L.uploadFail));
    }
  };

  const onPickLottie = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const animationData = parseLottieAnimationData(await file.text());
      if (!animationData) throw new Error('invalid lottie');
      const natural = {
        width: Math.max(1, Number(animationData.w) || 200),
        height: Math.max(1, Number(animationData.h) || 200),
      };
      const { width, height, x, y } = placeAtViewportCenter(natural);
      dispatch(
        spawnLottie({
          animationData,
          width,
          height,
          x,
          y,
          name: file.name?.replace(/\.json$/i, '') || 'Lottie',
        })
      );
    } catch {
      message.error(t('editor.tools.lottieGenInvalidJson', { defaultValue: 'Invalid Lottie JSON' }));
    }
  };

  const openImageUpload = () => {
    imageInputRef.current?.click();
  };

  const openVideoUpload = () => {
    videoInputRef.current?.click();
  };

  const openAudioUpload = () => {
    audioInputRef.current?.click();
  };

  const openLottieUpload = () => {
    lottieInputRef.current?.click();
  };

  const pickUpload = (key: string) => {
    setOpenMenu(null);
    pickUploadAction(key, {
      image: openImageUpload,
      video: openVideoUpload,
      audio: openAudioUpload,
      lottie: openLottieUpload,
    });
  };

  const pickSelect = (key: string) => {
    // Bottom Select / Pan: leave path-edit if open (✓ / Esc also exit).
    window.dispatchEvent(new Event('resume:exit-path-edit'));
    dispatch(setActiveTool(key === 'pan' ? 'pan' : 'select'));
  };
  const pickShape = (id: string) => {
    if (id === 'image') return;
    dispatch(setShapeKind(id));
  };

  const shapeIconKind = resolveToolbarShapeKind(shapeKind);
  const ShapeIcon = layerIconByKind[shapeIconKind];
  const PenIcon = layerIconByKind.pen;
  const PencilIcon = layerIconByKind.pencil;
  const TextIcon = layerIconByKind.text;

  const selectActive = activeTool === 'select' || activeTool === 'pan';
  const frameActive = activeTool === 'frame';
  const shapeActive = activeTool === 'shape';
  const imageActive = activeTool === 'image';
  const penActive = activeTool === 'pen';
  const pencilActive = activeTool === 'pencil';
  const textActive = activeTool === 'text';

  return (
    <div className="relative">
      <FloatingToolbar
        className={cn(compact ? 'gap-1.5 px-2.5 py-1.5' : 'gap-2.5 px-3.5 py-2', className)}
      >
      {/* Select / Move — click selects, hover for 选择/移动 */}
      <SplitToolButton
        tip={`${L.select} / ${L.pan}`}
        active={selectActive}
        menuOpen={openMenu === 'select'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'select' : null);
        }}
        items={selectItems}
        selectedKeys={[activeTool === 'pan' ? 'pan' : 'select']}
        onMenuPick={pickSelect}
        onPrimaryClick={() =>
          dispatch(setActiveTool(activeTool === 'pan' ? 'pan' : 'select'))
        }
      >
        <ToolIcon>
          {activeTool === 'pan' ? (
            <LuHand className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
          ) : (
            <LuMousePointer2 className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
          )}
        </ToolIcon>
      </SplitToolButton>

      {/* 形状 — click draws current shape, hover to switch */}
      <SplitToolButton
        tip={L.shape}
        active={shapeActive}
        disabled={toolsLocked}
        menuOpen={openMenu === 'shape'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'shape' : null);
        }}
        items={shapeItems}
        selectedKeys={[shapeKind]}
        onMenuPick={pickShape}
        onPrimaryClick={() =>
          dispatch(setShapeKind(resolveToolbarShapeKind(shapeKind)))
        }
      >
        <ToolIcon>
          <ShapeIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </SplitToolButton>

      {!compact ? (
        <>
          {/* 钢笔 — options dock at page top-center while active */}
          <ToolBtn
            tip={toolTipWithShortcut(L.pen, TOOL_SHORTCUT.pen)}
            ariaLabel={L.pen}
            active={penActive}
            disabled={toolsLocked}
            onClick={() => dispatch(setActiveTool('pen'))}
          >
            <ToolIcon>
              <PenIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            </ToolIcon>
          </ToolBtn>

          {/* 画笔 — options dock at page top-center while active */}
          <ToolBtn
            tip={toolTipWithShortcut(L.pencil, TOOL_SHORTCUT.pencil)}
            ariaLabel={L.pencil}
            active={pencilActive}
            disabled={toolsLocked}
            onClick={() => dispatch(setActiveTool('pencil'))}
          >
            <ToolIcon>
              <PencilIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            </ToolIcon>
          </ToolBtn>
        </>
      ) : null}

      {/* 文字 */}
      <ToolBtn
        tip={toolTipWithShortcut(L.text, TOOL_SHORTCUT.text)}
        active={textActive}
        disabled={toolsLocked}
        onClick={() => dispatch(setActiveTool('text'))}
      >
        <ToolIcon>
          <TextIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      {/* 智能画板 — free-draw; toolbar appears on the frame after commit */}
      <ToolBtn
        tip={toolTipWithShortcut(L.frame, TOOL_SHORTCUT.frame)}
        active={frameActive}
        disabled={toolsLocked}
        onClick={() => dispatch(setActiveTool('frame'))}
      >
        <ToolIcon className="h-3.5 w-3.5">
          <LuFrame className="h-full w-full" strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />

      {/* 图片/视频上传 — hover opens panel (同形状工具) */}
      <SplitToolButton
        tip={toolTipWithShortcut(L.uploadMedia, TOOL_SHORTCUT.upload)}
        active={imageActive}
        disabled={toolsLocked}
        menuOpen={openMenu === 'upload'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'upload' : null);
        }}
        items={uploadItems}
        selectedKeys={[]}
        onMenuPick={pickUpload}
        onPrimaryClick={() => {
          /* Toolbar icon only opens the panel; upload runs from menu rows. */
        }}
      >
        <ToolIcon>
          <LuImageUp className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </SplitToolButton>

      {/* Image generator on toolbar; video / Lottie / audio via context menu or shortcuts. */}
      <ToolBtn
        tip={toolTipWithShortcut(L.imageGenerator, TOOL_SHORTCUT.imageGenerator)}
        disabled={toolsLocked}
        onClick={spawnImageGeneratorAtView}
      >
        <ToolIcon>
          <LuImagePlus className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      {pluginButtons.map((btn) => (
        <ToolBtn
          key={btn.id}
          tip={btn.tip}
          disabled={toolsLocked}
          onClick={() => {
            const runtime = buildCanvasPluginRuntime(dispatch as any, () => store.getState(), {
              camera,
              stageEl,
            });
            btn.onClick(runtime);
          }}
        >
          <ToolIcon>
            {btn.icon ? (
              btn.icon
            ) : btn.iconSrc ? (
              <img src={btn.iconSrc} alt="" className={TOOL_ICON_CLASS} />
            ) : (
              <LuHexagon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            )}
          </ToolIcon>
        </ToolBtn>
      ))}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onPickVideo}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
        className="hidden"
        onChange={onPickAudio}
      />
      <input
        ref={lottieInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onPickLottie}
      />
      </FloatingToolbar>
    </div>
  );
}

export default memo(EditorToolStrip);
