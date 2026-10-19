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

import type { Locale } from '../labels/t';
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

const drawIn = (locale: Locale, ask: OpenPermissionAsk): string =>
  renderToStaticMarkup(createElement(LivePaneScreen, {
    store: paneStoreOf({ runId: 'run-1', items: [], ask, ended: false }),
    locale,
  }));

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

  it('the item stream and its rows may shrink below their content', () => {
    const html = draw({ runId: 'run-1', items, ask: null, ended: false });

    // The stream is the pane's fixed-height log (A5): shrinkable itself, shrinkable rows.
    expect(html).toContain('data-live-stream');
    expect(html).toMatch(/class="[^"]*min-w-0[^"]*"/);
    expect(html).toContain('grid min-w-0 gap-0.5 rounded-card');
  });

  it('the ask card truncates its command with the full text on the title, inside shrinkable boxes', () => {
    const ask: OpenPermissionAsk = { askId: 'ask-1', tool: 'Bash', target: LONG_TARGET, options: ['allow', 'deny'] };
    const html = draw({ runId: 'run-1', items: [], ask, ended: false });

    expect(html).toContain('grid min-w-0 gap-2 rounded-card border border-signal/45');
    expect(html).toContain('class="min-w-0"');
    expect(html).toContain(`title="${LONG_TARGET}"`);
    expect(html).toContain('block truncate');
  });

  it('an open ask for submit_verdict or mcp__docket-pages__submit_verdict formats as detail.zone.tool.submitVerdict', () => {
    const askVerdict: OpenPermissionAsk = { askId: 'ask-1', tool: 'submit_verdict', target: null, options: ['allow', 'deny'] };
    const htmlVerdict = draw({ runId: 'run-1', items: [], ask: askVerdict, ended: false });
    expect(htmlVerdict).toContain('Docket: inceleme kararı');
    expect(htmlVerdict).not.toContain('submit_verdict');

    const askMcp: OpenPermissionAsk = { askId: 'ask-2', tool: 'mcp__docket-pages__submit_verdict', target: null, options: ['allow', 'deny'] };
    const htmlMcp = draw({ runId: 'run-1', items: [], ask: askMcp, ended: false });
    expect(htmlMcp).toContain('Docket: inceleme kararı');
    expect(htmlMcp).not.toContain('mcp__docket-pages__submit_verdict');
  });

  it('U-366: an open ask for page_publish/page_update formats as its Docket label in both locales — bare and prefixed', () => {
    const cases: readonly { readonly tool: string; readonly tr: string; readonly en: string }[] = [
      { tool: 'page_publish', tr: 'Docket: sayfa yayınla', en: 'Docket: publish page' },
      { tool: 'page_update', tr: 'Docket: sayfa güncelle', en: 'Docket: update page' },
      { tool: 'mcp__docket-pages__page_publish', tr: 'Docket: sayfa yayınla', en: 'Docket: publish page' },
      { tool: 'mcp__docket-pages__page_update', tr: 'Docket: sayfa güncelle', en: 'Docket: update page' },
    ];
    for (const one of cases) {
      const ask: OpenPermissionAsk = { askId: 'ask-1', tool: one.tool, target: null, options: ['allow', 'deny'] };
      expect(drawIn('tr', ask)).toContain(one.tr);
      expect(drawIn('tr', ask)).not.toContain(one.tool);
      expect(drawIn('en', ask)).toContain(one.en);
      expect(drawIn('en', ask)).not.toContain(one.tool);
    }
  });
});
