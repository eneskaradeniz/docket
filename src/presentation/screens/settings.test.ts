// settings.test.ts — the settings panel's section list (U-24): the sidebar's Telefon and Ayarlar
// rows and the panel's menu walk the same ordered list, so the list is exported and pinned here —
// language first (the gear's door), the phone and update sections appended at the end.
import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from './settings';

describe('SETTINGS_SECTIONS', () => {
  it('U-24: the sections keep their order and gain Telefon and Güncelleme at the end', () => {
    expect(SETTINGS_SECTIONS).toStrictEqual(['language', 'accounts', 'bindings', 'discovery', 'phone', 'update']);
  });

  it('every section appears exactly once — a duplicated door would split the menu', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
  });
});
