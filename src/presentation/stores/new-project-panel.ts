// stores/new-project-panel.ts — the "Proje ekle" overlay's pure state. Like Settings it is not a
// route: the panel rides over whatever screen the operator is on, so the history never holds it.
// The state carries the open standing and how the panel was opened — the origin the palette's one
// focus rule reads (a pointer-opened panel blurs its opener on close, a keyboard-opened one
// returns focus). The form itself lives in the new-project store, which a close leaves alone.
import type { PaletteOrigin } from './search-palette';

export type NewProjectPanelOrigin = PaletteOrigin;

export interface NewProjectPanelState {
  readonly open: boolean;
  /** Stamped by the open, read by the close. */
  readonly origin: NewProjectPanelOrigin;
}

export type NewProjectPanelAction =
  | { readonly type: 'open'; readonly origin: NewProjectPanelOrigin }
  | { readonly type: 'escape' }
  | { readonly type: 'close' };

/** The standing the shell boots with. The origin's default never fires: it is read only on a
 *  close that follows an open. */
export const CLOSED_NEW_PROJECT_PANEL: NewProjectPanelState = { open: false, origin: 'keyboard' };

export const newProjectPanelReducer = (state: NewProjectPanelState, action: NewProjectPanelAction): NewProjectPanelState => {
  switch (action.type) {
    // An open panel keeps the origin of its first open.
    case 'open':
      return state.open ? state : { open: true, origin: action.origin };
    // The panel has no inner level, so Esc is the close.
    case 'escape':
    case 'close':
      return state.open ? { ...state, open: false } : state;
  }
};
