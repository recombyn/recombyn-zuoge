import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useSelector } from '@/store';
import { useSelectedNodeId } from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown, HiOutlineLanguage } from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { DropdownPanel, DropdownPanelItem, Tooltip } from '@/components/base';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@/components/rcb';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import {
  closeImageToolPanel,
  startImageProcess,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import { imageToolBtn, imageToolSessionTitle, ImageToolSep, sessionNodeBox } from './imageToolbarShared';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Common seed-translation targets (MediaKit lang codes). */
export const TRANSLATE_TARGET_LANGS = [
  { code: 'zh', labelKey: 'zh' },
  { code: 'zh_hant', labelKey: 'zhHant' },
  { code: 'en', labelKey: 'en' },
  { code: 'ja', labelKey: 'ja' },
  { code: 'ko', labelKey: 'ko' },
  { code: 'fr', labelKey: 'fr' },
  { code: 'de', labelKey: 'de' },
  { code: 'es', labelKey: 'es' },
  { code: 'pt', labelKey: 'pt' },
  { code: 'ru', labelKey: 'ru' },
  { code: 'vi', labelKey: 'vi' },
  { code: 'th', labelKey: 'th' },
  { code: 'id', labelKey: 'id' },
  { code: 'it', labelKey: 'it' },
] as const;

function defaultTargetFromLocale(lng: string | undefined): string {
  const l = String(lng || '').toLowerCase();
  if (l.startsWith('zh-hant') || l.startsWith('zh-tw') || l.startsWith('zh-hk')) {
    return 'zh_hant';
  }
  if (l.startsWith('zh')) return 'en';
  if (l.startsWith('ja')) return 'zh';
  if (l.startsWith('ko')) return 'zh';
  return 'zh';
}

/**
 * Translate-image session: compact bar under the image (same chrome as upscale).
 * Target-language dropdown; MediaKit auto-detects source when omitted.
 */
function TranslateImageSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelectedNodeId();

  const active = panel?.kind === 'translateImage';
  const nodeId = active ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const box = useMemo(() => sessionNodeBox(document, node), [document, node]);

  const [targetLang, setTargetLang] = useState(() => defaultTargetFromLocale(i18n.language));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!active) {
      setMenuOpen(false);
      return;
    }
    setTargetLang(defaultTargetFromLocale(i18n.language));
    setMenuOpen(false);
  }, [active, nodeId, i18n.language]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!selectedNodeId || selectedNodeId !== nodeId) {
      closeImageToolPanel();
    }
  }, [selectedNodeId, active, nodeId]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!node || node.key !== 'image') {
      closeImageToolPanel();
    }
  }, [document, active, nodeId, node]);

  const z = Math.max(0.05, camera.zoom || 1);
  const toolbarGap = rcbScreenPxToScene(10, z);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: box ? box.left + box.width / 2 : 0,
    top: box ? box.top + box.height + toolbarGap : 0,
    anchor: 'top',
  });

  if (!active || !nodeId || !box || hidden) return null;

  const selected =
    TRANSLATE_TARGET_LANGS.find((p) => p.code === targetLang) ?? TRANSLATE_TARGET_LANGS[0];

  const close = () => closeImageToolPanel();

  const onConfirm = () => {
    if (!selected) return;
    startImageProcess({
      sourceId: nodeId,
      kind: 'translateImage',
      label: t('editor.imageToolbar.processingTranslateImage'),
      meta: {
        targetLang: selected.code,
        toolVersion: 'seed-translation',
      },
    });
    close();
  };

  return (
    <RcbOverlayPortal>
      <div
        data-translate-image-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[37]"
        style={toolbarStyle}
        onPointerDown={(e) => e.stopPropagation()}
        // Language list is overflow-y-auto; keep wheel inside the panel so the
        // canvas / image node does not pan-zoom with the dropdown scroll.
        onWheel={(e) => e.stopPropagation()}
      >
        <FloatingToolbar className="relative gap-1 px-2.5 py-1.5">
          <span className={imageToolSessionTitle}>
            <HiOutlineLanguage className="h-4 w-4 shrink-0 text-current" />
            <span>{t('editor.imageToolbar.translateImage')}</span>
          </span>

          <ImageToolSep />

          <div className="relative">
            <button
              type="button"
              className={cn(
                imageToolBtn,
                'gap-1 px-2 font-medium',
                menuOpen && 'bg-[var(--accent-soft)]'
              )}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span>
                {t(`editor.imageToolbar.translateLang.${selected.labelKey}`, {
                  defaultValue: selected.code,
                })}
              </span>
              <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
            </button>

            {menuOpen ? (
              <DropdownPanel
                className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 max-h-64 min-w-[10rem] -translate-x-1/2 overflow-y-auto p-1"
                onWheel={(e) => e.stopPropagation()}
              >
                {TRANSLATE_TARGET_LANGS.map((p) => (
                  <DropdownPanelItem
                    key={p.code}
                    selected={p.code === selected?.code}
                    className="px-3 py-2"
                    onClick={() => {
                      setTargetLang(p.code);
                      setMenuOpen(false);
                    }}
                  >
                    {t(`editor.imageToolbar.translateLang.${p.labelKey}`, {
                      defaultValue: p.code,
                    })}
                  </DropdownPanelItem>
                ))}
              </DropdownPanel>
            ) : null}
          </div>

          <ImageToolSep />

          <button
            type="button"
            className="inline-flex h-7 items-center justify-center rounded-xl px-2.5 text-[12px] font-medium bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90"
            onClick={onConfirm}
          >
            <span>{t('editor.imageToolbar.translateImageConfirm')}</span>
          </button>

          <Tooltip tip={t('editor.imageToolbar.panelExit', '退出')} placement="top">
            <button
              type="button"
              aria-label={t('editor.imageToolbar.panelExit', '退出')}
              className={cn(imageToolBtn, 'px-2.5')}
              onClick={close}
            >
              <BiExit className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        </FloatingToolbar>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(TranslateImageSessionHost);
