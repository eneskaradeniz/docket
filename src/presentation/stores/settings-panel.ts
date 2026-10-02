// stores/settings-panel.ts — the settings overlay's pure state. Settings is not a route: the
// panel rides over whatever screen the operator is on, so the state carries the open standing,
// how the panel was opened — the same origin the palette's one focus rule reads (a pointer-opened
// panel blurs its opener on close, a keyboard-opened one returns focus) — and the section menu
// with its sub-page (U-28), so Esc order and the Hesaplar dot are unit-tested here.
import { isQueryFailure } from './results';
import type { PaletteOrigin } from './search-palette';

/** How the panel was opened — the pointer press on the gear or a shortcut, or the keyboard
 *  (key activation of the same). It decides where focus lands when the panel closes. */
export type SettingsPanelOrigin = PaletteOrigin;

/** The panel's sections: Çalışma — accounts, roles, capabilities, providers; Uygulama —
 *  appearance (Dil and Tema), phone, update. */
export type SettingsSection =
  | 'accounts'
  | 'roles'
  | 'capabilities'
  | 'providers'
  | 'appearance'
  | 'phone'
  | 'update';

export interface SettingsMenuGroup {
  readonly id: 'work' | 'app';
  readonly sections: readonly SettingsSection[];
}

export const SETTINGS_MENU: readonly SettingsMenuGroup[] = [
  { id: 'work', sections: ['accounts', 'roles', 'capabilities', 'providers'] },
  { id: 'app', sections: ['appearance', 'phone', 'update'] },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_MENU.flatMap((group) => group.sections);

/** The section the nav's Ayarlar row opens. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'accounts';

export interface SettingsPanelState {
  readonly open: boolean;
  /** Stamped by the open, read by the close. */
  readonly origin: SettingsPanelOrigin;
  readonly section: SettingsSection;
  /** The id of the account or role page open inside the section, or null on the section's list.
   *  Not a navigation-history entry. */
  readonly subPage: string | null;
}

export type SettingsPanelAction =
  | { readonly type: 'open'; readonly origin: SettingsPanelOrigin; readonly section?: SettingsSection }
  | { readonly type: 'select'; readonly section: SettingsSection }
  | { readonly type: 'enterSubPage'; readonly id: string }
  | { readonly type: 'leaveSubPage' }
  /** Esc: leaves the sub-page when one is open, closes the panel otherwise. */
  | { readonly type: 'escape' }
  | { readonly type: 'close' };

/** The standing the shell boots with and returns to once the panel has done its work. The
 *  origin's default never fires: it is read only on a close that follows an open. */
export const CLOSED_SETTINGS_PANEL: SettingsPanelState = {
  open: false,
  origin: 'keyboard',
  section: DEFAULT_SETTINGS_SECTION,
  subPage: null,
};

const closed = (state: SettingsPanelState): SettingsPanelState =>
  state.open ? { ...state, open: false, subPage: null } : state;

export const settingsPanelReducer = (state: SettingsPanelState, action: SettingsPanelAction): SettingsPanelState => {
  switch (action.type) {
    // An open panel keeps its standing — a second open (the gear clicked while the panel is
    // already up behind another door's close) re-stamps nothing, but a named section moves it.
    case 'open':
      if (state.open) {
        return action.section === undefined || action.section === state.section
          ? state
          : { ...state, section: action.section, subPage: null };
      }
      return { open: true, origin: action.origin, section: action.section ?? DEFAULT_SETTINGS_SECTION, subPage: null };
    case 'select':
      return state.section === action.section && state.subPage === null
        ? state
        : { ...state, section: action.section, subPage: null };
    case 'enterSubPage':
      return { ...state, subPage: action.id };
    case 'leaveSubPage':
      return state.subPage === null ? state : { ...state, subPage: null };
    case 'escape':
      return state.subPage !== null ? { ...state, subPage: null } : closed(state);
    case 'close':
      return closed(state);
  }
};

/** The slice of an account candidate the dot reads. */
export interface CandidateFacts {
  readonly alreadyAdded: boolean;
  readonly warnings: readonly string[];
}

/** Hesaplar carries an amber dot while discovery holds a candidate not yet added that can be read. */
export const hasUnaddedCandidate = (candidates: readonly CandidateFacts[]): boolean =>
  candidates.some((entry) => !entry.alreadyAdded && !entry.warnings.includes('unreadable'));

export interface CandidateDotSource {
  query(query: { readonly type: 'accounts.candidates' }): Promise<unknown>;
}

export interface CandidateDotStore {
  dot(): boolean;
  load(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const isCandidateFacts = (value: unknown): value is CandidateFacts =>
  typeof value === 'object' &&
  value !== null &&
  'alreadyAdded' in value &&
  typeof value.alreadyAdded === 'boolean' &&
  'warnings' in value &&
  Array.isArray(value.warnings);

/** Mirrors `accounts.candidates` as one boolean; a failed or malformed reply shows no dot. */
export const createCandidateDotStore = (source: CandidateDotSource): CandidateDotStore => {
  let dot = false;
  const listeners = new Set<() => void>();
  return {
    dot: () => dot,
    load: async () => {
      let next = false;
      try {
        const reply = await source.query({ type: 'accounts.candidates' });
        if (!isQueryFailure(reply) && Array.isArray(reply)) {
          next = hasUnaddedCandidate(reply.filter(isCandidateFacts));
        }
      } catch {
        next = false;
      }
      if (next === dot) return;
      dot = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
