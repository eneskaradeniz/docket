// settings.test.ts — the settings panel's section list: the sidebar's Telefon and Ayarlar rows and
// the panel's menu walk the same ordered list (U-24, regrouped by U-28 — the store pins the groups).
import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from './settings';

describe('SETTINGS_SECTIONS', () => {
  it('U-24: the phone and update sections stay at the end of the list', () => {
    expect(SETTINGS_SECTIONS.slice(-2)).toStrictEqual(['phone', 'update']);
  });

  it('every section appears exactly once — a duplicated door would split the menu', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
  });
});
