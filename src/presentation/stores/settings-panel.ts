// stores/settings-panel.ts — the settings overlay's pure state. Settings is not a route: the
// panel rides over whatever screen the operator is on, so the state carries the open standing,
// how the panel was opened — the same origin the palette's one focus rule reads (a pointer-opened
// panel blurs its opener on close, a keyboard-opened one returns focus) — and the section menu
// with its sub-page (U-28), so Esc order and the Hesaplar dot are unit-tested here.
import type { EditorTab } from './account-editor';
import { listedCandidateCount } from './candidates';
import { isQueryFailure } from './results';
import type { PaletteOrigin } from './search-palette';

/** How the panel was opened — the pointer press on the gear or a shortcut, or the keyboard
 *  (key activation of the same). It decides where focus lands when the panel closes. */
export type SettingsPanelOrigin = PaletteOrigin;

/** The panel's sections: Çalışma — accounts, roles, capabilities, concurrency, providers; Uygulama —
 *  appearance (Dil and Tema), phone, update. */
export type SettingsSection =
  | 'accounts'
  | 'roles'
  | 'capabilities'
  | 'concurrency'
  | 'providers'
  | 'appearance'
  | 'phone'
  | 'update';

export interface SettingsMenuGroup {
  readonly id: 'work' | 'app';
  readonly sections: readonly SettingsSection[];
}

export const SETTINGS_MENU: readonly SettingsMenuGroup[] = [
  { id: 'work', sections: ['accounts', 'roles', 'capabilities', 'concurrency', 'providers'] },
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
  /** The account editor's tab an open asked for (U-37); null leaves the editor's own choice. */
  readonly tab: EditorTab | null;
  /** The role whose "İnce ayar" an open asked to show open on Roller (U-37), or null. */
  readonly fineTune: string | null;
}

/** Where an open lands beyond the origin: the section, a sub-page of it, the editor tab and a
 *  role's fine-tune (U-37). Every field is optional; an empty target is the plain open. */
export interface SettingsOpenTarget {
  readonly section?: SettingsSection;
  readonly subPage?: string;
  readonly tab?: EditorTab;
  readonly fineTune?: string;
}

export type SettingsPanelAction =
  | ({ readonly type: 'open'; readonly origin: SettingsPanelOrigin } & SettingsOpenTarget)
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
  tab: null,
  fineTune: null,
};

const closed = (state: SettingsPanelState): SettingsPanelState =>
  state.open ? { ...state, open: false, subPage: null, tab: null, fineTune: null } : state;

export const settingsPanelReducer = (state: SettingsPanelState, action: SettingsPanelAction): SettingsPanelState => {
  switch (action.type) {
    // An open panel keeps its standing — a second open (the gear clicked while the panel is
    // already up behind another door's close) re-stamps nothing, but a named section moves it.
    case 'open': {
      const next = {
        section: action.section ?? DEFAULT_SETTINGS_SECTION,
        subPage: action.subPage ?? null,
        tab: action.tab ?? null,
        fineTune: action.fineTune ?? null,
      };
      if (state.open) {
        // An open that names nothing new changes nothing; a named target moves the panel.
        const named = action.subPage !== undefined || action.tab !== undefined || action.fineTune !== undefined;
        return !named && (action.section === undefined || action.section === state.section) ? state : { ...state, ...next };
      }
      return { open: true, origin: action.origin, ...next };
    }
    case 'select':
      return state.section === action.section && state.subPage === null
        ? state
        : { ...state, section: action.section, subPage: null, tab: null, fineTune: null };
    case 'enterSubPage':
      return { ...state, subPage: action.id, tab: null };
    case 'leaveSubPage':
      return state.subPage === null ? state : { ...state, subPage: null, tab: null };
    case 'escape':
      return state.subPage !== null ? { ...state, subPage: null, tab: null } : closed(state);
    case 'close':
      return closed(state);
  }
};

/** The slice of an account candidate the dot reads. */
export interface CandidateFacts {
  readonly alreadyAdded: boolean;
  readonly warnings: readonly string[];
}

/** Hesaplar carries an amber dot while the Eklenmemiş list has a row: the dot reads the list's own
 *  count (an unreadable candidate is listed, disabled, and so counts). */
export const hasUnaddedCandidate = (candidates: readonly CandidateFacts[]): boolean => listedCandidateCount(candidates) > 0;

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
