import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_RESOLUTION,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  VideoSettingsPanel,
} from '../VideoSettingsPanel';

describe('VideoSettingsPanel', () => {
  it('exports expected defaults and option lists', () => {
    expect(VIDEO_ASPECT_RATIOS).toContain('16:9');
    expect(VIDEO_RESOLUTIONS).toContain(DEFAULT_VIDEO_RESOLUTION);
    expect(VIDEO_DURATIONS).toContain(DEFAULT_VIDEO_DURATION);
  });

  it('calls change handlers for ratio, resolution, and duration', () => {
    const onAspectRatioChange = vi.fn();
    const onResolutionChange = vi.fn();
    const onDurationChange = vi.fn();

    render(
      <VideoSettingsPanel
        aspectRatio="16:9"
        resolution="720p"
        duration={5}
        onAspectRatioChange={onAspectRatioChange}
        onResolutionChange={onResolutionChange}
        onDurationChange={onDurationChange}
      />
    );

    fireEvent.click(screen.getByTitle('9:16'));
    expect(onAspectRatioChange).toHaveBeenCalledWith('9:16');

    fireEvent.click(screen.getByRole('button', { name: '1080p' }));
    expect(onResolutionChange).toHaveBeenCalledWith('1080p');

    const buttons = screen.getAllByRole('button');
    // 5 aspect + 3 resolution + duration index for 10s
    fireEvent.click(buttons[5 + 3 + VIDEO_DURATIONS.indexOf(10)]!);
    expect(onDurationChange).toHaveBeenCalledWith(10);
  });
});
