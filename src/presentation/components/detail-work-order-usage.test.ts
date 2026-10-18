// detail-work-order-usage.test.ts — the usage line never claims what no transport reported:
// a cache share is capped at 100 %, and zero tokens during a live run read as "not reported yet".
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { UsageSummaryView } from '../../api/queries';
import type { FlowDef } from '../../domain/index';
import { TR } from '../labels/tr';
import { DetailWorkOrderUsage } from './detail-work-order-usage';

const FLOW = { stages: [] } as unknown as FlowDef;

const usage = (overrides: { readonly tokens: number; readonly cacheRatio: number }): UsageSummaryView =>
  ({
    summary: {
      tokens: overrides.tokens,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheRatio: overrides.cacheRatio,
      planningShare: 0,
      runs: 1,
      byStage: [],
    },
    findings: [],
    runsWithoutUsage: 0,
  }) as unknown as UsageSummaryView;

const render = (view: UsageSummaryView, running: boolean): string =>
  renderToStaticMarkup(
    createElement(DetailWorkOrderUsage, {
      locale: 'tr',
      flow: FLOW,
      usage: view,
      usageFailed: false,
      money: { payPerUseUsd: null, payPerUseEstimate: false, includedEquivalentUsd: null },
      onRetry: () => {},
      running,
    }),
  );

describe('work-order usage line (#1277)', () => {
  it('#1277: a cache share above 100 % reads %100, never %155', () => {
    const html = render(usage({ tokens: 500, cacheRatio: 1.55 }), false);
    expect(html).toContain('%100 önbellek');
    expect(html).not.toContain('%155');
  });

  it('#1277: zero tokens while a run is going say "not reported yet", not "0 girdi · 0 çıktı"', () => {
    const html = render(usage({ tokens: 0, cacheRatio: 0 }), true);
    expect(html).toContain(TR['detail.usage.pendingRun']);
    expect(html).not.toContain('0 girdi');
  });

  it('#1277: zero tokens with no run going stay the plain counted line', () => {
    expect(render(usage({ tokens: 0, cacheRatio: 0 }), false)).toContain('0 girdi');
  });
});
