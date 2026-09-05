import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    include: [
      'src/components/rcb/render/__tests__/soaRenderTiers.bench.test.ts',
      'src/components/rcb/scene/__tests__/canvasStress.bench.test.ts',
      'src/components/rcb/scene/__tests__/canvasFunctionalStress.test.ts',
    ],
    exclude: ['src/private/**'],
    css: false,
    testTimeout: 120_000,
  },
});
