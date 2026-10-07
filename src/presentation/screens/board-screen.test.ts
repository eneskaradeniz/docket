// board-screen.test.ts — the create form's own contract (#817's walk finding): both inputs carry
// an accessible name, and the name comes from the label bundle in both locales — the wrapping
// label is the name source, so a keyboard or screen reader never meets a nameless textbox. The
// name is read off static markup the way the browser's own computation reads a wrapping label:
// the label's text content.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoardCreateForm } from './board';
import { t, type Locale } from '../labels/t';

/** The accessible name a wrapping label gives the input inside it: the label's own text. */
const wrappingLabelNames = (html: string): readonly string[] =>
  [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .filter(([, inner]) => inner.includes('<input'))
    .map(([, inner]) => inner.replace(/<[^>]+>/g, '').trim());

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
    expect((html.match(/<input\b/g) ?? []).length).toBe(2);
    expect(wrappingLabelNames(html)).toEqual([t('tr', 'board.create.titleLabel'), t('tr', 'board.create.flowLabel')]);
  });

  it('both inputs are named by their wrapping label, in the English bundle', () => {
    const html = renderForm('en');
    expect((html.match(/<input\b/g) ?? []).length).toBe(2);
    expect(wrappingLabelNames(html)).toEqual([t('en', 'board.create.titleLabel'), t('en', 'board.create.flowLabel')]);
  });

  it('the placeholders ride along from the same bundle, never as the only name', () => {
    const tr = renderForm('tr');
    expect(tr).toContain(`placeholder="${t('tr', 'board.create.titlePlaceholder')}"`);
    expect(tr).toContain(`placeholder="${t('tr', 'board.create.flowPlaceholder')}"`);
    // A placeholder alone is not a name: the label spans stand beside the inputs.
    expect(wrappingLabelNames(tr).every((name) => name !== '')).toBe(true);
  });
});
