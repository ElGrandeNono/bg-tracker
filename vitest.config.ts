import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Les tests importent les sources TS des paquets du workspace, pas leur dist.
    conditions: ['source'],
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'seasons/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'seasons/*/src/**'],
    },
  },
});
