import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { ColorSliderThumb } from './ColorSliderThumb';

interface HueSliderProps {
  value: number;
  onChange: (hue: number) => void;
  disabled?: boolean;
}

/**
 * Horizontal hue strip (0–360°) with drag support.
 */
export const HueSlider = memo(({ value, onChange, disabled }: HueSliderProps) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateHue = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      onChange(percentage * 360);
    },
    [onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      setIsDragging(true);
      updateHue(e);
    },
    [disabled, updateHue]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => updateHue(e);
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, updateHue]);

  return (
    <div
      ref={sliderRef}
      className='relative h-4 rounded cursor-pointer'
      style={{
        background:
          'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
      }}
      onMouseDown={handleMouseDown}
    >
      <ColorSliderThumb leftPct={(value / 360) * 100} />
    </div>
  );
});

