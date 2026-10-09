// stores/listbox.ts — the Listbox's keyboard and open/close rules (U-41) as a pure reducer. The
// component keeps the DOM and the focus; this decides what a key or a click does: a closed button
// opens on click or ↓/↑ with the selected option active, an open list moves the active option,
// Enter or Space picks it, Esc or Tab closes and hands focus back to the button, and an outside
// click closes without moving focus.

export interface ListboxState {
  readonly open: boolean;
  /** The option the keyboard stands on while the list is open. */
  readonly active: number;
}

export const LISTBOX_CLOSED: ListboxState = { open: false, active: 0 };

export type ListboxInput =
  | { readonly type: 'click-button' }
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'hover'; readonly index: number }
  | { readonly type: 'click-option'; readonly index: number }
  | { readonly type: 'outside-click' };

export interface ListboxStep {
  readonly state: ListboxState;
  /** The index picked by this input, or null. */
  readonly pick: number | null;
  /** Whether focus returns to the button. */
  readonly focusButton: boolean;
}

const stay = (state: ListboxState): ListboxStep => ({ state, pick: null, focusButton: false });

const clamp = (index: number, count: number): number => Math.max(0, Math.min(count - 1, index));

export const listboxStep = (state: ListboxState, input: ListboxInput, count: number, selected: number): ListboxStep => {
  if (count === 0) return stay(LISTBOX_CLOSED);
  const opened: ListboxState = { open: true, active: clamp(selected, count) };
  switch (input.type) {
    case 'click-button':
      return state.open ? { state: LISTBOX_CLOSED, pick: null, focusButton: true } : stay(opened);
    case 'outside-click':
      return stay(state.open ? LISTBOX_CLOSED : state);
    case 'hover':
      return state.open ? stay({ open: true, active: clamp(input.index, count) }) : stay(state);
    case 'click-option':
      return state.open ? { state: LISTBOX_CLOSED, pick: clamp(input.index, count), focusButton: true } : stay(state);
    case 'key': {
      if (!state.open) return input.key === 'ArrowDown' || input.key === 'ArrowUp' ? stay(opened) : stay(state);
      if (input.key === 'ArrowDown') return stay({ open: true, active: clamp(state.active + 1, count) });
      if (input.key === 'ArrowUp') return stay({ open: true, active: clamp(state.active - 1, count) });
      if (input.key === 'Enter' || input.key === ' ') return { state: LISTBOX_CLOSED, pick: state.active, focusButton: true };
      if (input.key === 'Escape' || input.key === 'Tab') return { state: LISTBOX_CLOSED, pick: null, focusButton: true };
      return stay(state);
    }
  }
};
