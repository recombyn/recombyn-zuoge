import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DEFAULT_LOTTIE_DURATION,
  LOTTIE_DURATIONS,
  AnimationSettingsPanel,
} from '../AnimationSettingsPanel';

describe('AnimationSettingsPanel', () => {
  it('exports duration defaults', () => {
    expect(LOTTIE_DURATIONS).toContain(DEFAULT_LOTTIE_DURATION);
  });

  it('hides aspect row when showAspect is false', () => {
    render(
      <AnimationSettingsPanel
        aspectRatio="1:1"
        duration={3}
        onAspectRatioChange={vi.fn()}
        onDurationChange={vi.fn()}
        showAspect={false}
      />
    );
    expect(screen.queryByTitle('16:9')).toBeNull();
  });

  it('calls duration handler', () => {
    const onDurationChange = vi.fn();
    render(
      <AnimationSettingsPanel
        aspectRatio="1:1"
        duration={3}
        onAspectRatioChange={vi.fn()}
        onDurationChange={onDurationChange}
      />
    );
    const buttons = screen.getAllByRole('button');
    // 5 aspect ratio chips, then duration pills — 5s is index 3 in LOTTIE_DURATIONS
    fireEvent.click(buttons[5 + LOTTIE_DURATIONS.indexOf(5)]!);
    expect(onDurationChange).toHaveBeenCalledWith(5);
  });
});
