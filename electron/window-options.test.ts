import { describe, expect, it } from 'vitest';

import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  clampDefaultWindowSize,
  titleBarOptionsFor,
} from './window-options';

describe('window default size', () => {
  it('opens at 1152x720 and never smaller than either minimum', () => {
    expect(WINDOW_DEFAULT_WIDTH).toBe(1152);
    expect(WINDOW_DEFAULT_HEIGHT).toBe(720);
    expect(WINDOW_DEFAULT_WIDTH).toBeGreaterThanOrEqual(WINDOW_MIN_WIDTH);
    expect(WINDOW_DEFAULT_HEIGHT).toBeGreaterThanOrEqual(WINDOW_MIN_HEIGHT);
  });
});

describe('clampDefaultWindowSize', () => {
  it('leaves the default unchanged on a display whose work area can hold it', () => {
    expect(clampDefaultWindowSize({ width: 1512, height: 920 })).toStrictEqual({
      width: 1152,
      height: 720,
    });
    expect(clampDefaultWindowSize({ width: 2560, height: 1440 })).toStrictEqual({
      width: 1152,
      height: 720,
    });
  });

  it('clamps the default down to a smaller work area', () => {
    expect(clampDefaultWindowSize({ width: 1000, height: 600 })).toStrictEqual({
      width: 1000,
      height: 600,
    });
  });

  it('never goes below the minimums, even when the work area cannot hold them', () => {
    expect(clampDefaultWindowSize({ width: 800, height: 400 })).toStrictEqual({
      width: 1024,
      height: 640,
    });
  });
});

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
