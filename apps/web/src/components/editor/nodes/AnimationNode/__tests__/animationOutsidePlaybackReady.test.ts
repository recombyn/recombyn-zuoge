import { describe, expect, it } from 'vitest';
import { animationOutsidePlaybackReady } from '../AnimationToolbarEditTools';

describe('animationOutsidePlaybackReady', () => {
  it('stays off when animation has no layers', () => {
    expect(
      animationOutsidePlaybackReady({
        hasPlayableContent: false,
        scenePlayWithoutHost: true,
        hasLottieHost: true,
      })
    ).toBe(false);
  });

  it('enables workbench play without a lottie-web host', () => {
    expect(
      animationOutsidePlaybackReady({
        hasPlayableContent: true,
        scenePlayWithoutHost: true,
        hasLottieHost: false,
      })
    ).toBe(true);
  });

  it('requires a host for free LOT preview', () => {
    expect(
      animationOutsidePlaybackReady({
        hasPlayableContent: true,
        scenePlayWithoutHost: false,
        hasLottieHost: false,
      })
    ).toBe(false);
    expect(
      animationOutsidePlaybackReady({
        hasPlayableContent: true,
        scenePlayWithoutHost: false,
        hasLottieHost: true,
      })
    ).toBe(true);
  });
});
