import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { cn } from '@/utils/classnames';
import {
  harmonyColorsFromBase,
  harmonyHues,
  harmonyOffsets,
  hexFromHsv,
  hsvFromHex,
  hueToWheelXY,
  polarToHsv,
  type ColorHarmonyRule,
} from './colorHarmony';

const WHEEL_SIZE = 220;
const CENTER = WHEEL_SIZE / 2;
const HANDLE_RADIUS = 78;

type Props = {
  value: string;
  rule: ColorHarmonyRule;
  onChange: (hex: string) => void;
  onHarmonyColorsChange?: (colors: string[]) => void;
};

function emitHarmony(
  hex: string,
  rule: ColorHarmonyRule,
  onChange: (hex: string) => void,
  onHarmonyColorsChange?: (colors: string[]) => void
) {
  onChange(hex);
  if (!onHarmonyColorsChange) return;
  const colors = harmonyColorsFromBase(hex, rule);
  onHarmonyColorsChange(colors);
}

function ColorHarmonyWheel({ value, rule, onChange, onHarmonyColorsChange }: Props) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const baseHsv = useMemo(() => hsvFromHex(value), [value]);
  const hues = useMemo(() => harmonyHues(baseHsv.h, rule), [baseHsv.h, rule]);
  const handleRadius = HANDLE_RADIUS * (0.35 + baseHsv.s * 0.65);

  const handles = useMemo(
    () =>
      hues.map((hue, index) => {
        const pos = hueToWheelXY(CENTER, CENTER, handleRadius, hue);
        const hex = hexFromHsv({ ...baseHsv, h: hue });
        return { index, hue, x: pos.x, y: pos.y, hex, primary: index === 0 };
      }),
    [baseHsv, handleRadius, hues]
  );

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = wheelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const scale = WHEEL_SIZE / rect.width;
      const x = (clientX - rect.left) * scale;
      const y = (clientY - rect.top) * scale;
      const hsv = polarToHsv(CENTER, CENTER, x, y, HANDLE_RADIUS);
      const hex = hexFromHsv({ ...baseHsv, h: hsv.h, s: hsv.s });
      emitHarmony(hex, rule, onChange, onHarmonyColorsChange);
    },
    [baseHsv, onChange, onHarmonyColorsChange, rule]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      updateFromPointer(e.clientX, e.clientY);
    },
    [updateFromPointer]
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e: PointerEvent) => updateFromPointer(e.clientX, e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateFromPointer]);

  const spokeCount = harmonyOffsets(rule).length;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={wheelRef}
        className="relative touch-none select-none"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
        onPointerDown={onPointerDown}
        role="slider"
        aria-label="Color harmony wheel"
        aria-valuenow={Math.round(baseHsv.h)}
        aria-valuemin={0}
        aria-valuemax={360}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          }}
        />
        <div
          className="absolute inset-[18%] rounded-full"
          style={{
            background: 'radial-gradient(circle, #fff 0%, rgba(255,255,255,0) 70%)',
          }}
        />
        <div className="absolute inset-[32%] rounded-full bg-[var(--surface)]" />

        <svg
          className="pointer-events-none absolute inset-0"
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          aria-hidden
        >
          {handles.map((handle) => (
            <line
              key={`spoke-${handle.index}`}
              x1={CENTER}
              y1={CENTER}
              x2={handle.x}
              y2={handle.y}
              stroke="rgba(255,255,255,0.85)"
              strokeWidth={1.25}
            />
          ))}
        </svg>

        {handles.map((handle) => (
          <div
            key={`handle-${handle.index}`}
            className={cn(
              'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md',
              handle.primary ? 'h-4 w-4' : 'h-3 w-3'
            )}
            style={{
              left: handle.x,
              top: handle.y,
              background: handle.hex,
              boxShadow: handle.primary
                ? '0 0 0 2px var(--ink), 0 0 0 4px #fff, 0 2px 6px rgba(0,0,0,0.25)'
                : '0 0 0 1px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.2)',
            }}
          />
        ))}

        <div
          className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/10"
          aria-hidden
        />
      </div>

      {spokeCount > 1 ? (
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          {spokeCount} {spokeCount === 1 ? 'color' : 'colors'}
        </p>
      ) : null}
    </div>
  );
}

export default memo(ColorHarmonyWheel);
