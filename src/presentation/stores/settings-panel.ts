// stores/settings-panel.ts — the settings overlay's pure state. Settings is not a route: the
// panel rides over whatever screen the operator is on, so the state carries only the open
// standing and how the panel was opened — the same origin the palette's one focus rule reads
// (a pointer-opened panel blurs its opener on close, a keyboard-opened one returns focus). The
// shell maps its entry points to these two intents and nothing else.
import type { PaletteOrigin } from './search-palette';

/** How the panel was opened — the pointer press on the gear or a shortcut, or the keyboard
 *  (key activation of the same). It decides where focus lands when the panel closes. */
export type SettingsPanelOrigin = PaletteOrigin;

export interface SettingsPanelState {
  readonly open: boolean;
  /** Stamped by the open, read by the close. */
  readonly origin: SettingsPanelOrigin;
}

export type SettingsPanelAction =
  | { readonly type: 'open'; readonly origin: SettingsPanelOrigin }
  | { readonly type: 'close' };

/** The standing the shell boots with and returns to once the panel has done its work. The
 *  origin's default never fires: it is read only on a close that follows an open. */
export const CLOSED_SETTINGS_PANEL: SettingsPanelState = { open: false, origin: 'keyboard' };

export const settingsPanelReducer = (state: SettingsPanelState, action: SettingsPanelAction): SettingsPanelState => {
  switch (action.type) {
    // An open panel keeps its standing — a second open (the gear clicked while the panel is
    // already up behind another door's close) re-stamps nothing.
    case 'open':
      return state.open ? state : { open: true, origin: action.origin };
    case 'close':
      return state.open ? { ...state, open: false } : state;
  }
};
