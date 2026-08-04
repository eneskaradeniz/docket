import { defineConfig } from 'vitest/config';

// Domain tests run without a DOM (AC9). Core is pure; no React, no jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
