import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineBookOpen } from 'react-icons/hi2';
import type { LlmModel } from '@/service/chat';
import {
  dedupeModelsById,
  isImageKind,
  isVideoKind,
  modelIsImageGenerator,
  modelSupportsVisionInput,
} from '@/components/editor/panels/agent/llmModelMeta';
import { isCustomModelId } from '@/components/editor/panels/agent/customLlmProviders';
import { cn } from '@/utils/classnames';
import LoadingDots from '@/components/base/LoadingDots';
import { FREE_IMAGE_MODEL_ID } from '@/utils/wallet';

const MODEL_ICON_FILES = import.meta.glob('@/assets/model/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** File stem → catalog keys. SVG in the same folder wins over PNG. */
const STEM_ALIASES: Record<string, string[]> = {
  openai: ['openai', 'gpt', 'gpt_image', 'dalle'],
  claude: ['claude', 'anthropic'],
  gemini: ['gemini', 'google'],
  deepseek: ['deepseek'],
  doubao: ['doubao'],
  seedream: ['seedream'],
  qwen: ['qwen', 'dashscope', 'tongyi'],
  kimi: ['kimi', 'moonshot'],
  glm: ['glm', 'zhipu', 'chatglm'],
  dreamina: ['dreamina', 'jimeng'],
  elevenlabs_turbo: ['elevenlabs'],
  flux_kontext_pro: ['flux', 'bfl'],
  ideogram: ['ideogram'],
  kling: ['kling'],
  minimax_music: ['minimax', 'hailuo'],
  sora: ['sora'],
  sync_lipsync: ['lipsync'],
  cohere: ['cohere'],
  deepgram: ['deepgram'],
  meta: ['meta', 'llama'],
  mistrai: ['mistral'],
  nvidia: ['nvidia'],
  perplexity: ['perplexity'],
  spacexal: ['grok', 'xai'],
  thenlper: ['thenlper'],
  voyageal: ['voyage'],
};

const SKIP_PICKER_STEMS = new Set(['faviconv2']);

const STEM_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  doubao: 'Doubao',
  seedream: 'Seedream',
  qwen: 'Qwen',
  kimi: 'Kimi',
  glm: 'GLM',
  dreamina: 'Dreamina',
  elevenlabs_turbo: 'ElevenLabs',
  flux_kontext_pro: 'Flux',
  ideogram: 'Ideogram',
  kling: 'Kling',
  minimax_music: 'MiniMax',
  sora: 'Sora',
  sync_lipsync: 'Lipsync',
  cohere: 'Cohere',
  deepgram: 'Deepgram',
  meta: 'Meta / Llama',
  mistrai: 'Mistral',
  nvidia: 'NVIDIA',
  perplexity: 'Perplexity',
  spacexal: 'xAI / Grok',
  thenlper: 'Thenlper',
  voyageal: 'Voyage',
};

function modelIconStem(path: string): string {
  const file = path.split('/').pop() || path;
  return file.replace(/\.(png|svg)$/i, '').toLowerCase();
}

function isSvgIconPath(path: string): boolean {
  return path.toLowerCase().endsWith('.svg');
}

const STEM_SRC: Record<string, string> = {};
for (const [path, src] of Object.entries(MODEL_ICON_FILES).sort(
  (a, b) => Number(isSvgIconPath(a[0])) - Number(isSvgIconPath(b[0]))
)) {
  STEM_SRC[modelIconStem(path)] = src;
}

const MODEL_ICON_BY_KEY: Record<string, string> = {};
for (const [stem, src] of Object.entries(STEM_SRC)) {
  const keys = STEM_ALIASES[stem] || [stem];
  for (const key of keys) {
    if (!MODEL_ICON_BY_KEY[key]) MODEL_ICON_BY_KEY[key] = src;
  }
}

function iconSrc(key: string): string | undefined {
  return MODEL_ICON_BY_KEY[key];
}

export { isImageKind, isVideoKind };
type ModelIconRef = {
  id?: string | null;
  provider?: string | null;
  kind?: string | null;
  label?: string | null;
  iconUrl?: string | null;
  iconKey?: string | null;
};

const MODEL_ICON_RULES: Array<{ test: (s: string) => boolean; src: string }> = [
  { test: (s) => s.includes('deepseek'), src: iconSrc('deepseek') },
  { test: (s) => s.includes('seedream'), src: iconSrc('seedream') },
  { test: (s) => s.includes('dreamina') || s.includes('jimeng'), src: iconSrc('dreamina') },
  { test: (s) => s.includes('glm') || s.includes('zhipu') || s.includes('chatglm'), src: iconSrc('glm') },
  { test: (s) => s.includes('doubao') || s.includes('seed-2'), src: iconSrc('doubao') },
  { test: (s) => s.includes('qwen') || s.includes('dashscope') || s.includes('tongyi'), src: iconSrc('qwen') },
  { test: (s) => s.includes('banana') || s.includes('gemini') || (s.includes('google') && !s.includes('cloud')), src: iconSrc('gemini') },
  { test: (s) => s.includes('claude') || s.includes('anthropic'), src: iconSrc('claude') },
  { test: (s) => s.includes('dall') || s.includes('dalle') || s.includes('gpt') || s.includes('openai'), src: iconSrc('openai') },
  { test: (s) => s.includes('flux') || s.includes('blackforest') || s.includes('bfl'), src: iconSrc('flux') },
  { test: (s) => s.includes('ideogram'), src: iconSrc('ideogram') },
  { test: (s) => s.includes('kling'), src: iconSrc('kling') },
  { test: (s) => s.includes('sora'), src: iconSrc('sora') },
  { test: (s) => s.includes('minimax') || s.includes('hailuo'), src: iconSrc('minimax') },
  { test: (s) => s.includes('eleven'), src: iconSrc('elevenlabs') },
  { test: (s) => s.includes('lipsync') || s.includes('sync.so'), src: iconSrc('lipsync') },
  { test: (s) => s.includes('moonshot') || s.includes('kimi'), src: iconSrc('kimi') },
  { test: (s) => s.includes('cohere'), src: iconSrc('cohere') },
  { test: (s) => s.includes('deepgram'), src: iconSrc('deepgram') },
  { test: (s) => s.includes('llama') || s.includes('meta'), src: iconSrc('meta') },
  { test: (s) => s.includes('mistral'), src: iconSrc('mistral') },
  { test: (s) => s.includes('nvidia') || s.includes('nim'), src: iconSrc('nvidia') },
  { test: (s) => s.includes('perplexity'), src: iconSrc('perplexity') },
  { test: (s) => s.includes('grok') || s.includes('xai') || s.includes('spacex'), src: iconSrc('grok') },
  { test: (s) => s.includes('voyage'), src: iconSrc('voyage') },
  { test: (s) => s.includes('thenlper'), src: iconSrc('thenlper') },
].filter((row): row is { test: (s: string) => boolean; src: string } => Boolean(row.src));

const MODEL_ICON_BY_PROVIDER: Record<string, string> = {
  ...MODEL_ICON_BY_KEY,
};

export type ModelIconThemeId = 'chat' | 'image' | 'video' | 'audio' | 'china' | 'platform';

export type ModelIconOption = { key: string; label: string };

function withLocalIcons(options: ModelIconOption[]): ModelIconOption[] {
  return options.filter((opt) => Boolean(MODEL_ICON_BY_KEY[opt.key]));
}

/** Themed preset icons for BYOK / custom model forms. */
export const CUSTOM_MODEL_ICON_GROUPS: {
  id: ModelIconThemeId;
  labelKey: string;
  options: ModelIconOption[];
}[] = [
  {
    id: 'chat' as ModelIconThemeId,
    labelKey: 'providerModelIconThemeChat',
    options: withLocalIcons([
      { key: 'openai', label: 'OpenAI' },
      { key: 'claude', label: 'Claude' },
      { key: 'gemini', label: 'Gemini' },
      { key: 'deepseek', label: 'DeepSeek' },
      { key: 'mistral', label: 'Mistral' },
      { key: 'meta', label: 'Meta / Llama' },
      { key: 'cohere', label: 'Cohere' },
      { key: 'perplexity', label: 'Perplexity' },
      { key: 'grok', label: 'xAI / Grok' },
    ]),
  },
  {
    id: 'china' as ModelIconThemeId,
    labelKey: 'providerModelIconThemeChina',
    options: withLocalIcons([
      { key: 'doubao', label: 'Doubao' },
      { key: 'qwen', label: 'Qwen' },
      { key: 'kimi', label: 'Kimi' },
      { key: 'glm', label: 'GLM' },
      { key: 'minimax', label: 'MiniMax' },
      { key: 'dreamina', label: 'Dreamina' },
    ]),
  },
  {
    id: 'image' as ModelIconThemeId,
    labelKey: 'providerModelIconThemeImage',
    options: withLocalIcons([
      { key: 'flux', label: 'Flux' },
      { key: 'ideogram', label: 'Ideogram' },
      { key: 'seedream', label: 'Seedream' },
      { key: 'dreamina', label: 'Dreamina' },
    ]),
  },
  {
    id: 'video' as ModelIconThemeId,
    labelKey: 'providerModelIconThemeVideo',
    options: withLocalIcons([
      { key: 'kling', label: 'Kling' },
      { key: 'sora', label: 'Sora' },
    ]),
  },
  {
    id: 'audio' as ModelIconThemeId,
    labelKey: 'providerModelIconThemeAudio',
    options: withLocalIcons([
      { key: 'elevenlabs', label: 'ElevenLabs' },
      { key: 'minimax', label: 'MiniMax Audio' },
      { key: 'lipsync', label: 'Lipsync' },
    ]),
  },
  {
    id: 'platform' as ModelIconThemeId,
    labelKey: 'providerModelIconThemePlatform',
    options: withLocalIcons([
      { key: 'nvidia', label: 'NVIDIA' },
      { key: 'voyage', label: 'Voyage' },
      { key: 'deepgram', label: 'Deepgram' },
      { key: 'thenlper', label: 'Thenlper' },
    ]),
  },
].filter((g) => g.options.length > 0);

/** Flat preset list for the icon picker (deduped by key, theme order preserved). */
export const CUSTOM_MODEL_ICON_OPTIONS: ModelIconOption[] = (() => {
  const seenKey = new Set<string>();
  const seenSrc = new Set<string>();
  const out: ModelIconOption[] = [];
  function addOpt(opt: ModelIconOption) {
    const src = MODEL_ICON_BY_KEY[opt.key];
    if (!src || seenKey.has(opt.key) || seenSrc.has(src)) return;
    seenKey.add(opt.key);
    seenSrc.add(src);
    out.push(opt);
  }
  for (const g of CUSTOM_MODEL_ICON_GROUPS) {
    for (const opt of g.options) addOpt(opt);
  }
  for (const [stem] of Object.entries(STEM_SRC)) {
    if (SKIP_PICKER_STEMS.has(stem)) continue;
    const key = (STEM_ALIASES[stem] || [stem])[0];
    if (!key) continue;
    addOpt({
      key,
      label: STEM_LABELS[stem] || key.replace(/_/g, ' '),
    });
  }
  return out;
})();

/** Synthetic Auto row — same shape as API models. */
export const AUTO_MODEL: LlmModel = {
  id: 'auto',
  label: 'Auto',
  provider: 'system',
  kind: 'text',
};

function resolveModelIconKey(model?: ModelIconRef | null): string {
  return String(model?.iconKey || '').toLowerCase().trim();
}

function resolveModelIconSrc(model?: ModelIconRef | null): string | null {
  const remote = String(model?.iconUrl || '').trim();
  if (remote) return remote;
  const key = resolveModelIconKey(model);
  if (key && MODEL_ICON_BY_KEY[key]) return MODEL_ICON_BY_KEY[key];
  const id = String(model?.id || '').toLowerCase().trim();
  const provider = String(model?.provider || '').toLowerCase().trim();
  const label = String(model?.label || '').toLowerCase().trim();
  if (!id && !provider && !label) return null;
  if (id === 'auto' || provider === 'system' || label === 'auto') return null;
  const blob = `${id} ${provider} ${label}`;
  for (const rule of MODEL_ICON_RULES) {
    if (rule.test(blob)) return rule.src;
  }
  if (provider && MODEL_ICON_BY_PROVIDER[provider]) return MODEL_ICON_BY_PROVIDER[provider];
  return null;
}

function ModelBrandIcon({
  model,
  className,
  size = 16,
}: {
  model?: ModelIconRef | null;
  className?: string;
  size?: number;
}) {
  const src = resolveModelIconSrc(model);
  if (!src) {
    return (
      <HiOutlineBookOpen
        size={size}
        className={cn('shrink-0 text-[var(--muted)]', className)}
        aria-hidden
      />
    );
  }
  // Mono SVGs use currentColor → render black via <img>; keep light chip (no dark tile).
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

export type ModelPickerTab = 'design' | 'image' | 'video';

/** Shared surface chrome for model / route popovers. */
const PANEL_SHELL =
  'box-border min-w-0 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.18)]';

/** Model popovers (editor + home) — icon + name rows; hug content. */
export const AGENT_POPOVER_PANEL = cn(
  PANEL_SHELL,
  'w-[min(220px,calc(100vw-24px))] overflow-hidden'
);

/** Route-prefs primary panel — compact; fits 模型 + 设计强度 rows. */
export const AGENT_ROUTE_POPOVER_PANEL = cn(
  PANEL_SHELL,
  'w-[min(220px,calc(100vw-24px))] max-h-[min(480px,calc(100vh-24px))] overflow-x-hidden overflow-y-auto'
);

/** Route field / preset side flyout 鈥?300px. */
export const AGENT_ROUTE_SUBMENU_PANEL = cn(
  PANEL_SHELL,
  'w-[min(300px,calc(100vw-24px))] max-h-[min(520px,calc(100vh-24px))] overflow-y-auto'
);

/** 1 = 渚垮疁 路 2 = 閫備腑 路 3 = 杈冭吹 (matches catalog price bands). */
export type ModelPriceLevel = 1 | 2 | 3;

export function parseModelPriceAmount(raw?: string | null): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).trim().split(/\s+/)[0] || '');
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Map catalog `price` 鈫?relative cost level for the orange dots. */
export function modelPriceLevel(
  m: Pick<LlmModel, 'id' | 'kind' | 'price' | 'provider'> | null | undefined
): ModelPriceLevel | null {
  if (!m || m.id === 'auto' || m.provider === 'system' || isCustomModelId(m.id)) return null;
  const n = parseModelPriceAmount(m.price);
  if (n == null) return null;
  if (isImageKind(m)) {
    if (n <= 0.25) return 1;
    if (n <= 0.4) return 2;
    return 3;
  }
  // Text: display 鍏?鐧句竾 tokens
  if (n < 1) return 1;
  if (n < 8) return 2;
  return 3;
}

/** Orange-dot cost tag (title row, top-right) 鈥?same pattern as video model picker. */
function ModelPriceTag({
  level,
  label,
}: {
  level: ModelPriceLevel;
  label: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      <span className="inline-flex items-center gap-[3px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-[5px] w-[5px] rounded-full',
              i <= level ? 'bg-[#f07818]' : 'bg-[#f07818]/30'
            )}
          />
        ))}
      </span>
      <span className="text-[11px] leading-none text-[var(--muted)]">{label}</span>
    </span>
  );
}

/** Soft pill for meta labels (鑷畾涔?/ 澶氭ā鎬? 鈥?matches saved-provider kind tags. */
function ModelMetaBadge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-lg bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] leading-none text-[var(--muted)]">
      {label}
    </span>
  );
}

export function isUserCustomModel(
  m: Pick<LlmModel, 'id' | 'provider'> | null | undefined
): boolean {
  if (!m) return false;
  return isCustomModelId(m.id) || m.provider === 'custom';
}

/** Dots + relative cost label (渚垮疁 / 閫備腑 / 杈冭吹) 鈥?no raw 楼 amounts. */
export function modelPriceTagInfo(
  m: Pick<LlmModel, 'id' | 'kind' | 'price' | 'provider'> | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): { level: ModelPriceLevel; label: string } | null {
  const level = modelPriceLevel(m);
  if (!level) return null;
  if (level === 1) return { level, label: t('agent.priceCheap') };
  if (level === 2) return { level, label: t('agent.priceFair') };
  return { level, label: t('agent.priceCostly') };
}

export function modelTabOf(m: Pick<LlmModel, 'kind' | 'id'> | null | undefined): ModelPickerTab {
  if (isVideoKind(m)) return 'video';
  return isImageKind(m) ? 'image' : 'design';
}

export function modelDescription(
  m: LlmModel,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (m.id === 'auto') return t('agent.modelDescAuto');
  if (isUserCustomModel(m)) return t('agent.modelDescCustom');
  // Prefer per-model catalog copy from the API (admin / seed), not a kind-wide fallback.
  const fromCatalog = String(m.description || '').trim();
  if (fromCatalog) return fromCatalog;
  if (modelIsImageGenerator(m) || m.kind === 'image') return t('agent.modelDescImage');
  if (m.thinking || m.id.includes('reasoner')) return t('agent.modelDescReasonerDesign');
  const vision = modelSupportsVisionInput(m);
  if (m.id.includes('deepseek')) {
    return vision ? t('agent.modelDescDeepseekVision') : t('agent.modelDescDeepseekDesign');
  }
  return vision ? t('agent.modelDescChatVision') : t('agent.modelDescChatDesign');
}

type Props = {
  /** Filters the list: design (=agent/ask) vs image models. */
  tab: ModelPickerTab;
  /** Optional 鈥?kept for callers; mode switch lives in the composer toolbar. */
  onTabChange?: (tab: ModelPickerTab) => void;
  models: LlmModel[];
  selectedId: string;
  onPick: (id: string) => void;
  /** idle | loading | ready | error 鈥?drives empty / loading / error copy. */
  status?: 'idle' | 'loading' | 'ready' | 'error';
  /** Free plan: show all models; only Auto + fixed free image model are selectable. */
  autoOnly?: boolean;
  /** Optional header (e.g. route-prefs field submenu title). */
  title?: string;
  /** Skip injecting the Auto row for design tab (route lane pickers). */
  hideAuto?: boolean;
  /** Use `models` as-is (route field opts already filtered). */
  useModelsAsIs?: boolean;
  /**
   * popover 鈥?standalone card (image/video mode).
   * submenu 鈥?narrower card beside AgentRoutePrefsEditor rows.
   * plain 鈥?list only (parent supplies chrome / Back).
   */
  chrome?: 'popover' | 'submenu' | 'plain';
  /** Called with pointerdown on a row 鈥?keep parent floating menus focused. */
  onRowPointerDown?: (e: { preventDefault: () => void }) => void;
  className?: string;
};

function filterPickerModels(opts: {
  pool: LlmModel[];
  tab: ModelPickerTab;
  useModelsAsIs: boolean;
  hideAuto: boolean;
  autoLabel: string;
}): LlmModel[] {
  const { pool, tab, useModelsAsIs, hideAuto, autoLabel } = opts;
  if (useModelsAsIs) return dedupeModelsById(pool);

  if (tab === 'image') {
    return dedupeModelsById(pool.filter((m) => isImageKind(m)));
  }
  if (tab === 'video') {
    return dedupeModelsById(pool.filter((m) => isVideoKind(m)));
  }

  const design = pool.filter(
    (m) => !isImageKind(m) && !isVideoKind(m) && m.id !== 'auto'
  );
  if (hideAuto) {
    return dedupeModelsById(design);
  }
  const autoRow = pool.find((m) => m.id === 'auto') || {
    ...AUTO_MODEL,
    label: autoLabel,
  };
  return dedupeModelsById([autoRow, ...design]);
}

function shellClassForChrome(chrome: NonNullable<Props['chrome']>): string {
  switch (chrome) {
    case 'submenu':
      return AGENT_ROUTE_SUBMENU_PANEL;
    case 'plain':
      return 'w-full min-w-0';
    default:
      return AGENT_POPOVER_PANEL;
  }
}

function listClassForChrome(
  chrome: NonNullable<Props['chrome']>,
  title?: string
): string {
  switch (chrome) {
    case 'plain':
      return 'pt-0.5';
    case 'submenu':
      return 'overflow-y-auto px-1.5 pb-1.5 pt-0.5';
    default:
      return cn(
        'max-h-[min(360px,calc(100vh-160px))] overflow-y-auto px-1.5 pb-1.5',
        title ? 'pt-0.5' : 'pt-1.5'
      );
  }
}

/**
 * Shared model picker 鈥?one list UI for home, editor, and route-prefs field submenus.
 */
function ModelPickerPanel({
  tab,
  models,
  selectedId,
  onPick,
  status = 'ready',
  autoOnly = false,
  title,
  hideAuto = false,
  useModelsAsIs = false,
  chrome = 'popover',
  onRowPointerDown,
  className,
}: Props): ReactNode {
  const { t } = useTranslation();

  const catalogLoading =
    models.length === 0 && (status === 'loading' || status === 'idle');

  const filtered = filterPickerModels({
    pool: models,
    tab,
    useModelsAsIs,
    hideAuto,
    autoLabel: t('agent.autoToggle'),
  });

  const shell = shellClassForChrome(chrome);

  const list = (
    <div className={cn('min-w-0', listClassForChrome(chrome, title))}>
      {status === 'error' && models.length === 0 ? (
        <div className="px-2 py-4 text-left text-[12px] text-[var(--muted)]">
          <p>{t('agent.apiDown')}</p>
          <p className="mt-1">{t('agent.apiDownHint')}</p>
        </div>
      ) : catalogLoading ? (
        <LoadingDots
          label={t('home.composerModelsLoading')}
          className="px-2 py-8"
        />
      ) : !filtered.length ? (
        <p className="px-2 py-2 text-left text-[12px] text-[var(--muted)]">
          {t('agent.emptyModels')}
        </p>
      ) : (
        filtered.map((m) => {
          const selected = m.id === selectedId;
          const freePick = m.id === 'auto' || m.id === FREE_IMAGE_MODEL_ID;
          const locked = autoOnly && !freePick;
          let tip: string | undefined;
          if (locked) tip = t('agent.freeModelLocked');
          else if (autoOnly && freePick) tip = t('agent.freeModelItemHint');
          return (
            <button
              key={m.id}
              type="button"
              disabled={locked}
              title={tip}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2 py-2 text-left text-[var(--ink)] transition-colors',
                selected && !locked ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]',
                locked && 'cursor-not-allowed opacity-45 hover:bg-transparent'
              )}
              onPointerDown={onRowPointerDown}
              onClick={() => {
                if (locked) return;
                onPick(m.id);
              }}
            >
              <ModelBrandIcon model={m} size={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                {m.label || m.id}
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div className={cn(shell, 'flex flex-col', className)}>
      {title ? (
        <div className="px-3 pt-2.5 pb-1">
          <p className="truncate text-[12px] font-medium text-[var(--muted)]">{title}</p>
        </div>
      ) : null}
      {list}
    </div>
  );
}

export default memo(ModelPickerPanel);

const MemoizedModelBrandIcon = memo(ModelBrandIcon);
export { MemoizedModelBrandIcon as ModelBrandIcon };
const MemoizedModelPriceTag = memo(ModelPriceTag);
export { MemoizedModelPriceTag as ModelPriceTag };
const MemoizedModelMetaBadge = memo(ModelMetaBadge);
export { MemoizedModelMetaBadge as ModelMetaBadge };
