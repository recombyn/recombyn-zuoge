import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Frontend unit tests — Vitest + React Testing Library (Vite-native).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src/private/**', '../../src/commercial/**'],
    css: false,
    coverage: {
      provider: 'v8',
      // Only files imported by tests — avoids instrumenting the whole app tree.
      reporter: ['text', 'lcov'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@canvas-plugins': path.resolve(__dirname, '../../plugins/canvas'),
    },
  },
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(''),
    __DOCS_URL__: JSON.stringify(''),
    __DESKTOP_MODE__: JSON.stringify(''),
    __API_BASE_URL__: JSON.stringify(''),
  },
});