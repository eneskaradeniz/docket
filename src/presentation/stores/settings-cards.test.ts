// stores/settings-cards.test.ts — U-167: which Hesaplar sections stand open. Eklenenler opens by
// default; Eklenmemiş opens only while no account is added. The operator's own toggle wins.
import { describe, expect, it } from 'vitest';

import { addedOpen, unaddedOpen } from './settings-cards';

describe('Hesaplar section defaults (U-167)', () => {
  it('U-167: Eklenenler is open by default', () => {
    expect(addedOpen(null)).toBe(true);
  });

  it('U-167: Eklenmemiş is open when no account is added', () => {
    expect(unaddedOpen(0, null)).toBe(true);
  });

  it('U-167: Eklenmemiş is collapsed once an account is added', () => {
    expect(unaddedOpen(1, null)).toBe(false);
    expect(unaddedOpen(7, null)).toBe(false);
  });

  it('U-167: a toggle by the operator overrides the default in both directions', () => {
    expect(addedOpen(false)).toBe(false);
    expect(unaddedOpen(0, false)).toBe(false);
    expect(unaddedOpen(3, true)).toBe(true);
  });
});
