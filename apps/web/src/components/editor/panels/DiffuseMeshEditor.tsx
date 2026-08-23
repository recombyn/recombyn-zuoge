import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ColorPanel,
  FILL_SOLID_PRESETS,
  normalizeHex,
} from '@/components/base/colorPanel';
import { SegmentedControl } from '@/components/base';
import { cn } from '@/utils/classnames';
import {
  createMeshGrid,
  MESH_SIZES,
  remeshPoints,
  type MeshPoint,
  type MeshSize,
} from '@/components/rcb/scene/document/sceneDiffuseMesh';
import { defaultGradient, type FillGradient } from '@/components/rcb/scene/document/sceneFill';

type Props = {
  value?: FillGradient | null;
  baseColor?: string;
  onChange: (gradient: FillGradient) => void;
  /** Controlled selected mesh point (synced with on-canvas handles). */
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  showGuides?: boolean;
  onShowGuidesChange?: (show: boolean) => void;
};

type TabId = 'settings' | 'presets';

const PRESETS: Array<{ id: string; label: string; colors: string[] }> = [
  { id: 'pastel', label: 'Pastel', colors: ['#e4f5e0', '#fff3c4', '#d6eaf8', '#fce4ec', '#e8eaf6'] },
  { id: 'sunset', label: 'Sunset', colors: ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a18cd1', '#f6d365'] },
  { id: 'ocean', label: 'Ocean', colors: ['#667eea', '#48dbfb', '#1dd1a1', '#54a0ff', '#c8d6e5'] },
  { id: 'neon', label: 'Neon', colors: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#5f27cd'] },
  { id: 'mono', label: 'Mono', colors: ['#111827', '#6b7280', '#d1d5db', '#f9fafb', '#374151'] },
  { id: 'forest', label: 'Forest', colors: ['#134e4a', '#10b981', '#a7f3d0', '#065f46', '#fef3c7'] },
];

function clonePoints(points: MeshPoint[]): MeshPoint[] {
  return points.map((p) => ({ ...p }));
}

function ensureDiffuse(
  value: FillGradient | null | undefined,
  baseColor: string
): { meshSize: MeshSize; meshPoints: MeshPoint[] } {
  const base = defaultGradient('diffuse', baseColor);
  const size = (MESH_SIZES.includes(Number(value?.meshSize) as MeshSize)
    ? Number(value?.meshSize)
    : base.meshSize || 4) as MeshSize;
  const points =
    value?.type === 'diffuse' && value.meshPoints?.length
      ? remeshPoints(size, value.meshPoints, baseColor)
      : createMeshGrid(size, baseColor);
  return { meshSize: size, meshPoints: points };
}

function toGradient(meshSize: MeshSize, points: MeshPoint[], baseColor: string): FillGradient {
  return {
    type: 'diffuse',
    meshSize,
    meshPoints: clonePoints(points),
    colorStops: [
      { offset: 0, color: points[0]?.color || baseColor, opacity: 100 },
      { offset: 1, color: points[points.length - 1]?.color || baseColor, opacity: 100 },
    ],
  };
}

function applyPresetColors(points: MeshPoint[], colors: string[]): MeshPoint[] {
  if (!colors.length) return points;
  return points.map((p, i) => ({
    ...p,
    color: normalizeHex(colors[i % colors.length], p.color),
  }));
}

function meshPointOpacity(point: MeshPoint | undefined): number {
  const n = Number(point?.opacity ?? 100);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
}

/**
 * Diffuse mesh settings panel — anchors are edited on-canvas (MeshHandlesOverlay).
 */
function DiffuseMeshEditor({
  value,
  baseColor = '#CCCCCC',
  onChange,
  selectedIndex: selectedProp,
  onSelectedIndexChange,
}: Props): ReactNode {
  const { t } = useTranslation();
  const signature = useMemo(() => {
    if (value?.type !== 'diffuse') return `init:${baseColor}`;
    return `${value.meshSize}:${JSON.stringify(value.meshPoints)}`;
  }, [value, baseColor]);

  const initial = useMemo(() => ensureDiffuse(value, baseColor), [signature]);
  const [meshSize, setMeshSize] = useState<MeshSize>(initial.meshSize);
  const [points, setPoints] = useState<MeshPoint[]>(() => clonePoints(initial.meshPoints));
  const [selectedLocal, setSelectedLocal] = useState(0);
  const [tab, setTab] = useState<TabId>('settings');

  const selected = selectedProp ?? selectedLocal;
  const setSelected = (index: number) => {
    setSelectedLocal(index);
    onSelectedIndexChange?.(index);
  };

  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef('');
  pointsRef.current = points;
  onChangeRef.current = onChange;

  const emit = useCallback(
    (size: MeshSize, pts: MeshPoint[]) => {
      const g = toGradient(size, pts, baseColor);
      const key = `${g.meshSize}:${JSON.stringify(g.meshPoints)}`;
      if (key === lastEmittedRef.current) return;
      lastEmittedRef.current = key;
      onChangeRef.current(g);
    },
    [baseColor]
  );

  useEffect(() => {
    if (signature === lastEmittedRef.current) return;
    const next = ensureDiffuse(value, baseColor);
    const key = `${next.meshSize}:${JSON.stringify(next.meshPoints)}`;
    lastEmittedRef.current = key;
    setMeshSize(next.meshSize);
    setPoints(clonePoints(next.meshPoints));
  }, [signature, value, baseColor]);

  const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);
  onSelectedIndexChangeRef.current = onSelectedIndexChange;
  useEffect(() => {
    if (selected >= points.length) {
      const next = Math.max(0, points.length - 1);
      setSelectedLocal(next);
      onSelectedIndexChangeRef.current?.(next);
    }
  }, [points.length, selected]);

  const meshSizeRef = useRef(meshSize);
  meshSizeRef.current = meshSize;

  const setMeshSizeAndRemesh = (size: MeshSize) => {
    const next = remeshPoints(size, points, baseColor);
    setMeshSize(size);
    setPoints(next);
    setSelected(0);
    emit(size, next);
  };

  const updatePoint = useCallback((index: number, patch: Partial<MeshPoint>) => {
    setPoints((prev) => {
      const next = prev.map((p, i) => (i === index ? { ...p, ...patch } : p));
      emit(meshSizeRef.current, next);
      return next;
    });
  }, [emit]);

  const active = points[selected] || points[0];
  const activeOpacity = meshPointOpacity(active);

  const updatePointColor = useCallback(
    (hex: string) => updatePoint(selected, { color: hex }),
    [selected, updatePoint]
  );
  const updatePointOpacity = useCallback(
    (opacity: number) => updatePoint(selected, { opacity }),
    [selected, updatePoint]
  );

  return (
    <div className="space-y-3" data-diffuse-mesh-editor>
      <SegmentedControl
        size="sm"
        fullWidth
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { value: 'settings' as const, label: t('editor.fillDiffuseSettings') },
          { value: 'presets' as const, label: t('editor.fillDiffusePresets') },
        ]}
      />

      {tab === 'settings' ? (
        <div className="space-y-3">
          <ColorPanel
            value={active?.color || baseColor}
            onChange={updatePointColor}
            opacity={activeOpacity}
            onOpacityChange={updatePointOpacity}
            showAlpha
            title=""
            showHeader={false}
            padded={false}
            presets={FILL_SOLID_PRESETS}
            className="w-full !shadow-none !ring-0"
          />

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">
              {t('editor.fillMeshSize')}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MESH_SIZES.map((n) => {
                const activeSize = meshSize === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMeshSizeAndRemesh(n)}
                    className={cn(
                      'h-8 rounded text-[12px] font-medium tabular-nums transition-colors',
                      activeSize
                        ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                        : 'bg-[var(--accent-soft)] text-[var(--muted)] hover:text-[var(--ink)]'
                    )}
                  >
                    {n} × {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const next = applyPresetColors(points, preset.colors);
                setPoints(next);
                emit(meshSize, next);
              }}
              className="overflow-hidden rounded ring-1 ring-[var(--line)] transition hover:ring-[var(--ink)]/30"
            >
              <span
                className="block h-12 w-full"
                style={{
                  background: `linear-gradient(135deg, ${preset.colors.join(', ')})`,
                }}
              />
              <span className="block truncate px-1.5 py-1 text-left text-[11px] text-[var(--muted)]">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(DiffuseMeshEditor);
