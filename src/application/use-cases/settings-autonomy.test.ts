// The global autonomy level setting — A-396 of docs/v2/application.md (D-10): one key, one shared
// parse, a typed error for a damaged value — never a silent `manual`.
import { describe, expect, it } from 'vitest';

import { createFakeDeps } from '../ports/fakes';

import { AUTONOMY_KEY, getAutonomyLevel } from './settings';

const make = () => ({ deps: createFakeDeps() });

describe('global autonomy setting', () => {
  it('A-396: an absent key answers ok(undefined) — absent stays absent, the chain falls on', async () => {
    const { deps } = make();
    expect(await deps.settings.get(AUTONOMY_KEY)).toBeUndefined();
    expect(await getAutonomyLevel(deps)).toEqual({ ok: true, value: undefined });
  });

  it('A-396: a stored member answers itself', async () => {
    const { deps } = make();
    for (const level of ['manual', 'balanced', 'auto'] as const) {
      await deps.settings.set(AUTONOMY_KEY, level);
      expect(await getAutonomyLevel(deps)).toEqual({ ok: true, value: level });
    }
  });

  it('A-396: a stored non-member answers the typed invalid_autonomy_level error, never a default', async () => {
    const { deps } = make();
    await deps.settings.set(AUTONOMY_KEY, 'turbo');
    expect(await getAutonomyLevel(deps)).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });

  it('A-396: a stored non-string answers the typed error the same way', async () => {
    const { deps } = make();
    await deps.settings.set(AUTONOMY_KEY, 7);
    expect(await getAutonomyLevel(deps)).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });
});
