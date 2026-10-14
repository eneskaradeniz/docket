import { describe, expect, it } from 'vitest';

import type { CatalogModel } from '../../domain/index';

import { normalizeRouteModel } from './normalize-route-model';

const entry = (id: string, resolvedId?: string): CatalogModel => ({
  id,
  source: 'live',
  contextWindow: null,
  thinking: 'unknown',
  billing: 'included',
  ...(resolvedId !== undefined ? { resolvedId } : {}),
});

const CATALOG = [
  entry('haiku', 'claude-haiku-4-5'),
  entry('sonnet', 'claude-sonnet-5-5'),
];

describe('normalizeRouteModel', () => {
  it('A-389: a catalog id is kept', () => {
    expect(normalizeRouteModel(CATALOG, 'haiku')).toEqual({ ok: true, value: 'haiku' });
  });

  it('A-389: a resolvedId is rewritten to the alias id', () => {
    expect(normalizeRouteModel(CATALOG, 'claude-haiku-4-5')).toEqual({ ok: true, value: 'haiku' });
  });

  it('A-389: an unknown id answers unknown_model with the route valid ids and does not normalize', () => {
    expect(normalizeRouteModel(CATALOG, 'claude-haiku-4-5-extra')).toEqual({
      ok: false,
      error: { code: 'unknown_model', models: ['haiku', 'sonnet'] },
    });
  });

  it('A-389: an empty catalog accepts the id unchanged', () => {
    expect(normalizeRouteModel([], 'claude-haiku-4-5')).toEqual({ ok: true, value: 'claude-haiku-4-5' });
  });
});
