import { describe, expect, it } from 'vitest';

import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, titleBarOptionsFor } from './window-options';

describe('window minimum size', () => {
  it('is 1024x640 so the fixed 240px sidebar still leaves a 784px body column', () => {
    expect(WINDOW_MIN_WIDTH).toBe(1024);
    expect(WINDOW_MIN_HEIGHT).toBe(640);
  });
});

describe('titleBarOptionsFor', () => {
  it('darwin hides the native title strip and insets the traffic lights into the shell drag bar', () => {
    expect(titleBarOptionsFor('darwin')).toStrictEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    });
  });

  it('every other platform keeps the default frame — no title bar options at all', () => {
    expect(titleBarOptionsFor('win32')).toStrictEqual({});
    expect(titleBarOptionsFor('linux')).toStrictEqual({});
  });
});
