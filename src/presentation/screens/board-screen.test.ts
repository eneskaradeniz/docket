// board-screen.test.ts — the create form's own contract (#817's walk finding): both inputs carry
// an accessible name, and the name comes from the label bundle in both locales — the wrapping
// label is the name source, so a keyboard or screen reader never meets a nameless textbox. The
// markup is checked as the browser's own computation would: a label names the input inside it,
// so one label's span of output must hold the bundle's text and the input together. The span is
// cut out by string search only — the output is asserted on, never cleaned or taken apart.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoardCreateForm } from './board';
import { t, type Locale } from '../labels/t';

const CLOSE_LABEL = '</label>';

/** The spans of output running from each opening <label to its matching close, in order. */
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

/** A wrapping label names its input when one span holds both the bundle's text and the input. */
const labelNamesInput = (html: string, text: string): boolean =>
  labelSpans(html).some((span) => span.includes(text) && span.includes('<input'));

const renderForm = (locale: Locale): string =>
  renderToStaticMarkup(
    createElement(BoardCreateForm, {
      locale,
      title: '',
      onTitleChange: () => undefined,
      flow: '',
      onFlowChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );

describe('BoardCreateForm names (#817)', () => {
  it('both inputs are named by their wrapping label, in the Turkish bundle', () => {
    const html = renderForm('tr');
    expect(html.split('<input').length - 1).toBe(2);
    expect(labelNamesInput(html, t('tr', 'board.create.titleLabel'))).toBe(true);
    expect(labelNamesInput(html, t('tr', 'board.create.flowLabel'))).toBe(true);
  });

  it('both inputs are named by their wrapping label, in the English bundle', () => {
    const html = renderForm('en');
    expect(html.split('<input').length - 1).toBe(2);
    expect(labelNamesInput(html, t('en', 'board.create.titleLabel'))).toBe(true);
    expect(labelNamesInput(html, t('en', 'board.create.flowLabel'))).toBe(true);
  });

  it('the placeholders ride along from the same bundle, never as the only name', () => {
    const tr = renderForm('tr');
    expect(tr).toContain(`placeholder="${t('tr', 'board.create.titlePlaceholder')}"`);
    expect(tr).toContain(`placeholder="${t('tr', 'board.create.flowPlaceholder')}"`);
    // A placeholder alone is not a name: every input sits in a label span that also carries
    // one of the bundle's label texts.
    const withInputs = labelSpans(tr).filter((span) => span.includes('<input'));
    expect(withInputs.length).toBe(2);
    expect(
      withInputs.every(
        (span) =>
          span.includes(t('tr', 'board.create.titleLabel')) || span.includes(t('tr', 'board.create.flowLabel')),
      ),
    ).toBe(true);
  });
});
