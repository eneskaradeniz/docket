// quit-prompt store tests (U-294, U-295): the modal opens on the event and acknowledges, Esc and
// Vazgeç answer false, Kapat ve durdur answers true, Enter and the scrim never answer.
import { describe, expect, it } from 'vitest';

import type { Command } from '../../api/commands';
import type { UiEvent } from '../../api/api';
import { t } from '../labels/t';
import {
  CLOSED_QUIT_PROMPT,
  QUIT_MODAL_KEYS,
  createQuitPromptStore,
  quitIntent,
  quitModalLines,
  quitPromptReducer,
} from './quit-prompt';

const setup = () => {
  const sent: Command[] = [];
  let push: (event: UiEvent) => void = () => undefined;
  const store = createQuitPromptStore({
    api: { command: async (_actor, command) => (sent.push(command), { ok: true as const }) },
    changes: (listener) => {
      push = listener;
      return () => undefined;
    },
    actor: { kind: 'user', id: 'u-1' },
  });
  return { store, sent, push: (event: UiEvent) => push(event) };
};

const REQUEST: UiEvent = { type: 'quit.requested', runs: ['Fatura raporu'], chats: ['Önbellek'] };

describe('quit prompt store', () => {
  it('U-294: opens on quit.requested and acknowledges the shell', () => {
    const { store, sent, push } = setup();
    expect(store.state()).toEqual(CLOSED_QUIT_PROMPT);
    push(REQUEST);
    expect(store.state()).toEqual({ open: true, runs: ['Fatura raporu'], chats: ['Önbellek'] });
    expect(sent).toEqual([{ type: 'quit.ack' }]);
  });

  it('U-295: Esc and Vazgeç answer false and close', () => {
    for (const input of ['escape', 'cancelButton'] as const) {
      const { store, sent, push } = setup();
      push(REQUEST);
      expect(quitIntent(input)).toBe('cancel');
      store.cancel();
      expect(store.state()).toEqual(CLOSED_QUIT_PROMPT);
      expect(sent.at(-1)).toEqual({ type: 'quit.answer', accept: false });
    }
  });

  it('U-295: Kapat ve durdur answers true and closes', () => {
    const { store, sent, push } = setup();
    push(REQUEST);
    expect(quitIntent('confirmButton')).toBe('confirm');
    store.confirm();
    expect(store.state()).toEqual(CLOSED_QUIT_PROMPT);
    expect(sent.at(-1)).toEqual({ type: 'quit.answer', accept: true });
  });

  it('U-295: Enter and the scrim never confirm (nor cancel)', () => {
    expect(quitIntent('enter')).toBeUndefined();
    expect(quitIntent('scrim')).toBeUndefined();
    const { store, sent, push } = setup();
    push(REQUEST);
    // The reducer has no input-driven action: only the two buttons and Esc are wired to answers.
    expect(sent).toEqual([{ type: 'quit.ack' }]);
    expect(store.state().open).toBe(true);
  });

  it('answers once: a closed prompt sends nothing', () => {
    const { store, sent } = setup();
    store.confirm();
    store.cancel();
    expect(sent).toEqual([]);
  });

  it('reducer: a repeated request keeps one open modal', () => {
    const open = quitPromptReducer(CLOSED_QUIT_PROMPT, { type: 'requested', runs: ['a'], chats: [] });
    expect(quitPromptReducer(open, { type: 'requested', runs: ['a'], chats: [] })).toEqual(open);
  });
});

describe('quit modal content', () => {
  const more = (hidden: number): string => t('tr', QUIT_MODAL_KEYS.more).replace('{n}', String(hidden));

  it('U-295: lists at most five titles, then +N more; runs before chats', () => {
    const state = { open: true as const, runs: ['1', '2', '3', '4'], chats: ['5', '6', '7'] };
    expect(quitModalLines(state, more)).toEqual(['1', '2', '3', '4', '5', '+2 tane daha']);
    expect(quitModalLines({ open: true, runs: ['1'], chats: [] }, more)).toEqual(['1']);
  });

  it('U-295: every modal string exists in both bundles', () => {
    for (const key of Object.values(QUIT_MODAL_KEYS)) {
      for (const locale of ['tr', 'en'] as const) expect(t(locale, key).trim()).not.toBe('');
    }
    expect(t('tr', 'quit.cancel')).toBe('Vazgeç');
    expect(t('tr', 'quit.stop')).toBe('Kapat ve durdur');
    expect(t('en', 'quit.title')).toBe('Quit Docket?');
  });
});
