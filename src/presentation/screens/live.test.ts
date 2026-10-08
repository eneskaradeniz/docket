// screens/live.test.ts — the pane's containment contract: a run's unbreakable text (long
// absolute paths, whole commands) must never widen the pane. Every box between such text and the
// pane carries `min-w-0` (intrinsic min-content otherwise grows the pane's grids past the column
// the detail layout pins), wrapped text breaks anywhere, and truncated text keeps its full value
// on the title. The geometry itself is measured by the layout audit's L-14 on the real screen;
// this pins the hooks that geometry depends on, drawn with the server renderer the layer's
// component tests use.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LivePaneItem, LivePaneState, LivePaneStore, OpenPermissionAsk } from '../stores/live-pane';
import { LivePaneScreen } from './live';

// No spaces, ~200 characters — the shape of a real run's tool target.
const LONG_TARGET =
  '/Users/eneskaradeniz/source/antreo/antreo-api/test/Antero.Api.ReconciliationTests/V2/Invoices/Reconciliation/InvoiceReconciliationBackgroundServiceTests/Antero.Api.ReconciliationBackgroundServiceTests.cs';

const paneStoreOf = (state: LivePaneState): LivePaneStore => ({
  state: () => state,
  push: () => {},
  attach: () => Promise.resolve(),
  answer: () => Promise.resolve({ ok: false, code: 'not_found' }),
  subscribe: () => () => {},
});

const draw = (state: LivePaneState): string =>
  renderToStaticMarkup(createElement(LivePaneScreen, { store: paneStoreOf(state), locale: 'tr' }));

describe('live pane — unbreakable stream text stays inside the pane', () => {
  const items: readonly LivePaneItem[] = [
    { kind: 'thought', text: LONG_TARGET },
    { kind: 'message', text: LONG_TARGET },
    { kind: 'toolCall', id: 'komut-1', name: 'Bash', target: LONG_TARGET, status: 'ok' },
  ];

  it('a tool call truncates its target and keeps the full path readable on the title', () => {
    const html = draw({ runId: 'run-1', items, ask: null, ended: false });

    expect(html).toContain('truncate');
    expect(html).toContain(`title="${LONG_TARGET}"`);
  });

  it('thought and message text wraps anywhere instead of widening the pane', () => {
    const html = draw({ runId: 'run-1', items, ask: null, ended: false });

    expect(html.match(/<p class="whitespace-pre-wrap \[overflow-wrap:anywhere][^"]*"/g)?.length).toBe(2);
  });

  it('the item list and its rows may shrink below their content', () => {
    const html = draw({ runId: 'run-1', items, ask: null, ended: false });

    expect(html).toContain('<ol class="grid min-w-0 gap-1.5">');
    expect(html).toContain('<li class="min-w-0 rounded-card border border-hairline bg-surface px-3 py-2">');
  });

  it('the ask card truncates its command with the full text on the title, inside shrinkable boxes', () => {
    const ask: OpenPermissionAsk = { askId: 'ask-1', tool: 'Bash', target: LONG_TARGET, options: ['allow', 'deny'] };
    const html = draw({ runId: 'run-1', items: [], ask, ended: false });

    expect(html).toContain('grid min-w-0 gap-2 rounded-card border border-signal/45');
    expect(html).toContain('class="min-w-0"');
    expect(html).toContain(`title="${LONG_TARGET}"`);
    expect(html).toContain('block truncate');
  });
});
