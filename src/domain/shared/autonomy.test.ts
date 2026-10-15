import { describe, expect, it } from 'vitest';

import { AUTONOMY_LEVELS, USER_ONLY_GATES, parseAutonomyLevel } from './autonomy';

describe('autonomy scale and carve-out', () => {
  it('lists the three levels in the D-10 order and the closed user-only carve-out', () => {
    expect(AUTONOMY_LEVELS).toEqual(['manual', 'balanced', 'auto']);
    expect(USER_ONLY_GATES).toEqual(['deploy', 'merge', 'delete', 'page_approval']);
  });

  it('parses each member of AUTONOMY_LEVELS', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(parseAutonomyLevel(level)).toEqual({ ok: true, value: level });
    }
  });

  it('answers the typed error for a non-member string — never a silent manual', () => {
    expect(parseAutonomyLevel('turbo')).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });

  it('answers the typed error for every other shape, undefined included', () => {
    for (const damaged of [undefined, null, 7, [], {}, '', 'MANUAL', 'auto ']) {
      expect(parseAutonomyLevel(damaged)).toEqual({ ok: false, error: 'invalid_autonomy_level' });
    }
  });
});
