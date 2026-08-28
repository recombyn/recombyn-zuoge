/**
 * Artboard-like tools while composing inside a Lottie plate.
 */
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCircle, LuMousePointer2, LuPenTool, LuSquare, LuType, LuUpload } from 'react-icons/lu';
import Tooltip from '@/components/base/tooltip';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import type { LottieComposeTool } from '@/components/editor/nodes/LottieNode/lottieComposeLayers';
import { cn } from '@/utils/classnames';

const BTN =
  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors text-[var(--ink)] hover:bg-[var(--accent-soft)]';
const BTN_ACTIVE = 'bg-[var(--ink)] text-[var(--on-brand)] hover:bg-[var(--ink)]';
const BTN_DONE =
  'inline-flex h-6 items-center justify-center rounded-md px-2 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]';

function ToolBtn({
  tip,
  active,
  onClick,
  children,
}: {
  tip: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip tip={tip} placement="bottom">
      <button
        type="button"
        aria-label={tip}
        aria-pressed={active}
        className={cn(BTN, active && BTN_ACTIVE)}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function LottieComposeToolbar({
  tool,
  onToolChange,
  onUploadSvg,
  onExit,
}: {
  tool: LottieComposeTool;
  onToolChange: (tool: LottieComposeTool) => void;
  onUploadSvg?: () => void;
  onExit: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <FloatingToolbar className="pointer-events-auto h-8 gap-1.5 px-3 py-0">
      <ToolBtn
        tip={t('editor.lottieCompose.select', { defaultValue: '选择' })}
        active={tool === 'select'}
        onClick={() => onToolChange('select')}
      >
        <LuMousePointer2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        tip={t('editor.lottieCompose.rect', { defaultValue: '矩形' })}
        active={tool === 'rect'}
        onClick={() => onToolChange('rect')}
      >
        <LuSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        tip={t('editor.lottieCompose.ellipse', { defaultValue: '椭圆' })}
        active={tool === 'ellipse'}
        onClick={() => onToolChange('ellipse')}
      >
        <LuCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        tip={t('editor.lottieCompose.pen', { defaultValue: '钢笔' })}
        active={tool === 'pen'}
        onClick={() => onToolChange('pen')}
      >
        <LuPenTool className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        tip={t('editor.lottieCompose.text', { defaultValue: '文字' })}
        active={tool === 'text'}
        onClick={() => onToolChange('text')}
      >
        <LuType className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <ToolBtn
        tip={t('editor.lottieCompose.uploadSvg', { defaultValue: '上传 SVG' })}
        onClick={() => onUploadSvg?.()}
      >
        <LuUpload className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolBtn>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <Tooltip tip={t('editor.lottieCompose.done', { defaultValue: '完成' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.lottieCompose.done', { defaultValue: '完成' })}
          className={BTN_DONE}
          onClick={onExit}
        >
          {t('editor.lottieCompose.done', { defaultValue: '完成' })}
        </button>
      </Tooltip>
    </FloatingToolbar>
  );
}

export default memo(LottieComposeToolbar);
