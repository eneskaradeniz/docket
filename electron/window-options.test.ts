import { describe, expect, it } from 'vitest';

import { titleBarOptionsFor } from './window-options';

describe('titleBarOptionsFor', () => {
  it('darwin hides the native title strip and insets the traffic lights into the app bar', () => {
    expect(titleBarOptionsFor('darwin')).toStrictEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
    });
  });

  it('every other platform keeps the default frame — no title bar options at all', () => {
    expect(titleBarOptionsFor('win32')).toStrictEqual({});
    expect(titleBarOptionsFor('linux')).toStrictEqual({});
  });
});
