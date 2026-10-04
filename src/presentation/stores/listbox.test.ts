import { describe, expect, it } from 'vitest';

import { LISTBOX_CLOSED, listboxStep, type ListboxInput, type ListboxState } from './listbox';

const run = (state: ListboxState, input: ListboxInput, count = 3, selected = 1) => listboxStep(state, input, count, selected);

describe('listbox (U-41)', () => {
  it('U-41: a click or ↓/↑ opens the list on the selected option', () => {
    expect(run(LISTBOX_CLOSED, { type: 'click-button' }).state).toEqual({ open: true, active: 1 });
    expect(run(LISTBOX_CLOSED, { type: 'key', key: 'ArrowDown' }).state).toEqual({ open: true, active: 1 });
    expect(run(LISTBOX_CLOSED, { type: 'key', key: 'ArrowUp' }).state).toEqual({ open: true, active: 1 });
    expect(run(LISTBOX_CLOSED, { type: 'key', key: 'a' }).state).toEqual(LISTBOX_CLOSED);
  });

  it('U-41: ↓/↑ move the active option and stop at the ends', () => {
    expect(run({ open: true, active: 1 }, { type: 'key', key: 'ArrowDown' }).state.active).toBe(2);
    expect(run({ open: true, active: 2 }, { type: 'key', key: 'ArrowDown' }).state.active).toBe(2);
    expect(run({ open: true, active: 0 }, { type: 'key', key: 'ArrowUp' }).state.active).toBe(0);
  });

  it('U-41: Enter and Space pick the active option, close the list and return focus to the button', () => {
    const open: ListboxState = { open: true, active: 2 };
    for (const key of ['Enter', ' ']) {
      expect(run(open, { type: 'key', key })).toEqual({ state: LISTBOX_CLOSED, pick: 2, focusButton: true });
    }
  });

  it('U-41: Esc and Tab close without picking; an outside click closes without moving focus', () => {
    const open: ListboxState = { open: true, active: 2 };
    expect(run(open, { type: 'key', key: 'Escape' })).toEqual({ state: LISTBOX_CLOSED, pick: null, focusButton: true });
    expect(run(open, { type: 'key', key: 'Tab' })).toEqual({ state: LISTBOX_CLOSED, pick: null, focusButton: true });
    expect(run(open, { type: 'outside-click' })).toEqual({ state: LISTBOX_CLOSED, pick: null, focusButton: false });
  });

  it('U-41: a click on an option picks it; a click on the button while open closes it', () => {
    const open: ListboxState = { open: true, active: 0 };
    expect(run(open, { type: 'click-option', index: 2 })).toEqual({ state: LISTBOX_CLOSED, pick: 2, focusButton: true });
    expect(run(open, { type: 'click-button' }).state).toEqual(LISTBOX_CLOSED);
    expect(run(open, { type: 'hover', index: 2 }).state.active).toBe(2);
  });

  it('U-41: a list with no options never opens', () => {
    expect(run(LISTBOX_CLOSED, { type: 'click-button' }, 0).state).toEqual(LISTBOX_CLOSED);
  });
});
