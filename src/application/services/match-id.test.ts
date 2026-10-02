import { describe, expect, it } from 'vitest';

import type { CatalogModel } from '../../domain/index';

import { matchIdFor } from './match-id';

const entry = (id: string, resolvedId?: string): CatalogModel => ({
  id,
  source: 'live',
  contextWindow: null,
  thinking: 'unknown',
  billing: 'unknown',
  ...(resolvedId !== undefined ? { resolvedId } : {}),
});

describe('matchIdFor', () => {
  it('A-20: the entry for the model names the id it resolves to', () => {
    expect(matchIdFor([entry('opus', 'claude-opus-5-5')], 'opus')).toBe('claude-opus-5-5');
  });

  it('A-20: an unknown model or an entry without resolvedId matches as the model itself', () => {
    expect(matchIdFor([entry('sonnet')], 'sonnet')).toBe('sonnet');
    expect(matchIdFor([], 'opus')).toBe('opus');
  });

  it('A-20: no model matches as the empty string', () => {
    expect(matchIdFor([entry('opus', 'x')], undefined)).toBe('');
  });
});
