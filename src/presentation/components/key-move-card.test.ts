// components/key-move-card.test.ts — U-262 as markup: the key-move card is one compact row (title,
// ⓘ, switch) whose explanation lives in the info bubble, and a setup-pending row carries no reason line.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { t } from '../labels/t';
import { KeyMoveCard } from './key-move-card';

describe('KeyMoveCard', () => {
  it('U-262: the card is one row with title, an info trigger and the switch; the body sits in the bubble', () => {
    const esc = (text: string): string => text.replace(/'/g, '&#x27;');
    const out = renderToStaticMarkup(createElement(KeyMoveCard, { locale: 'tr', on: false, onChange: () => undefined }));
    expect(out).toContain(esc(t('tr', 'candidates.keymove.title')));
    expect(out).toContain(`aria-label="${t('tr', 'info.trigger.prefix')}${esc(t('tr', 'candidates.keymove.title'))}"`);
    expect(out).toContain('role="switch"');
    expect(out).toContain('role="tooltip"');
    expect(out).not.toMatch(/<p[ >]/);
    expect(out).toContain(esc(t('tr', 'candidates.keymove.body')));
  });
});
