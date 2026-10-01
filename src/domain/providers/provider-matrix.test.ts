// P-36 fixture coverage: the renderer is a pure string function over pre-built rows — stable
// order, no timestamps, and `—` for a route without models. The rows derived from the real
// registry and the committed README block are pinned by the infrastructure drift test.
import { describe, expect, it } from 'vitest';

import type { MatrixRow } from './provider-matrix';
import { renderProviderMatrix } from './provider-matrix';

const HEADER =
  '| Provider | Route kind | Models | Thinking | Context | Cost | Support level |\n' +
  '| --- | --- | --- | --- | --- | --- | --- |';

const row = (overrides: Partial<MatrixRow>): MatrixRow => ({
  provider: 'Probe (`probe`)',
  routeKind: '`probe-route`',
  models: '—',
  thinking: '—',
  context: '—',
  cost: 'equivalent',
  level: 'experimental',
  ...overrides,
});

describe('provider matrix renderer (P-36)', () => {
  it('P-36: renders the header, the separator and one row per route kind in the given order', () => {
    const rows = [row({ routeKind: '`route-a`' }), row({ routeKind: '`route-b`' })];
    expect(renderProviderMatrix(rows)).toBe(
      `${HEADER}\n` +
        '| Probe (`probe`) | `route-a` | — | — | — | equivalent | experimental |\n' +
        '| Probe (`probe`) | `route-b` | — | — | — | equivalent | experimental |',
    );
  });

  it('P-36: a provider with models and thinking levels renders every column', () => {
    const rows = [
      row({
        provider: 'Fixture (`fixture`)',
        routeKind: '`fixture-route`',
        models: '`m-one` (strong), `m-two` (fast)',
        thinking: '`low`, `high`',
        context: '128k',
        cost: 'reported',
        level: 'full',
      }),
    ];
    expect(renderProviderMatrix(rows)).toBe(
      `${HEADER}\n` +
        '| Fixture (`fixture`) | `fixture-route` | `m-one` (strong), `m-two` (fast) | `low`, `high` | 128k | reported | full |',
    );
  });

  it('P-36: rendering the same rows twice yields the same text — no timestamps, no hidden state', () => {
    const rows = [row({ level: 'isolated' })];
    expect(renderProviderMatrix(rows)).toBe(renderProviderMatrix(rows));
  });
});
