/**
 * Global test environment (Vitest + Testing Library).
 * Keep shared mocks here; prefer local `vi.mock` for file-specific stubs.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom gaps used by layout / media queries
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// Prefer measureText fallback math in sceneText (no canvas native dep in CI).
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as any;

// lottie-web creates a canvas at import time; getContext(null) above would crash it.
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
      setSpeed: vi.fn(),
      setLoop: vi.fn(),
      goToAndStop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      isPaused: false,
      totalFrames: 0,
      currentFrame: 0,
    })),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; count?: string | number }) => {
      if (opts?.count != null) return `${opts.defaultValue ?? key} ${opts.count}`;
      return opts?.defaultValue ?? key;
    },
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
