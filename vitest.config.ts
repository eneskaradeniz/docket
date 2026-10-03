import { defineConfig } from 'vitest/config';

// Domain tests run without a DOM (AC9). Core is pure; no React, no jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    // electron/ holds pure shell helpers (window options); their tests import no runtime, so the
    // same node environment covers them.
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
