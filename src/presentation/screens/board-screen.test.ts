// board-screen.test.ts — the new-work-order dialog's fields carry accessible names from the
// label bundle in both locales. A wrapping label names the control inside it, so one label's
// span of output must hold the bundle's text and the control together.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewWorkOrderWindow } from '../components/new-work-order-window';
import { t, type Locale } from '../labels/t';
import { boardFlowChoices } from '../stores/work-order-window';

const CLOSE_LABEL = '</label>';

const labelSpans = (html: string): readonly string[] => {
  const spans: string[] = [];
  let at = html.indexOf('<label');
  while (at !== -1) {
    const end = html.indexOf(CLOSE_LABEL, at);
    if (end === -1) break;
    spans.push(html.slice(at, end));
    at = html.indexOf('<label', end + CLOSE_LABEL.length);
  }
  return spans;
};

const renderWindow = (locale: Locale): string =>
  renderToStaticMarkup(
    createElement(NewWorkOrderWindow, {
      open: true,
      locale,
      projectName: 'Kadife',
      flows: boardFlowChoices('standard'),
      launchProject: null,
      onClose: () => undefined,
      onCreated: () => undefined,
      onCreate: () => Promise.resolve({ ok: true as const }),
    }),
  );

describe('new work order field names', () => {
  it('the title input and the flow select are named by their wrapping labels, in Turkish', () => {
    const html = renderWindow('tr');
    const spans = labelSpans(html);
    expect(spans.some((span) => span.includes(t('tr', 'workOrder.new.titleLabel')) && span.includes('<input'))).toBe(true);
    expect(spans.some((span) => span.includes(t('tr', 'workOrder.new.flowLabel')) && span.includes('<select'))).toBe(true);
  });

  it('the title input and the flow select are named by their wrapping labels, in English', () => {
    const html = renderWindow('en');
    const spans = labelSpans(html);
    expect(spans.some((span) => span.includes(t('en', 'workOrder.new.titleLabel')) && span.includes('<input'))).toBe(true);
    expect(spans.some((span) => span.includes(t('en', 'workOrder.new.flowLabel')) && span.includes('<select'))).toBe(true);
  });

  it('the title placeholder rides along from the same bundle, never as the only name', () => {
    const html = renderWindow('tr');
    expect(html).toContain(`placeholder="${t('tr', 'workOrder.new.titlePlaceholder')}"`);
    const withInput = labelSpans(html).filter((span) => span.includes('<input'));
    expect(withInput.length).toBe(1);
    expect(withInput[0]).toContain(t('tr', 'workOrder.new.titleLabel'));
  });
});
