// stores/dispatch-settings.ts — the Eşzamanlılık section's store (U-70 … U-74): the dispatcher's
// concurrency form over `settings.dispatch` / `settings.setDispatch`. The form is edited locally
// and only Kaydet writes; the validation is the backend's own limits rule (a whole cap 1..16,
// per-repo and every per-account limit 1..cap), so a form this store lets through is one the
// backend accepts. The live status is read with the rest of the reply and refreshed by a poll
// that never runs over unsaved edits. Reads and writes are injected; nothing here touches an api.
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { isQueryFailure } from './results';

export type DispatchMode = 'fixed' | 'auto';
export type LoadBand = 'free' | 'reduced' | 'busy';

export interface DispatchForm {
  readonly mode: DispatchMode;
  readonly global: number;
  readonly perRepo: number;
  readonly perAccount: Readonly<Record<string, number>>;
}

/** The backend's defaults (settings use case): Otomatik, 4, 3, no per-account limit. */
export const DEFAULT_DISPATCH_FORM: DispatchForm = { mode: 'auto', global: 4, perRepo: 3, perAccount: {} };

export const MAX_DISPATCH_CAP = 16;
/** How often the open section re-reads the live status. */
export const DISPATCH_POLL_MS = 5000;

export interface DispatchStatusReading {
  readonly mode: DispatchMode;
  readonly cap: number;
  readonly effective: number;
  readonly band: LoadBand;
  readonly load1?: number;
}

export interface DispatchSuggestion {
  readonly suggested: number;
  readonly cores: number;
  readonly totalMemGb: number;
}

/** What `settings.setDispatch` is sent. */
export interface DispatchWrite {
  readonly global: number;
  readonly perRepo: number;
  readonly perAccount: Readonly<Record<string, number>>;
  readonly mode: DispatchMode;
}

export interface DispatchSettingsState {
  readonly loaded: boolean;
  /** The form as the section shows it. */
  readonly form: DispatchForm;
  /** What the backend holds; null before the first successful read. */
  readonly saved: DispatchForm | null;
  readonly suggestion: DispatchSuggestion | null;
  /** The last dispatcher tick's status as of the last read; null until one exists. */
  readonly status: DispatchStatusReading | null;
  readonly dirty: boolean;
  readonly isDefault: boolean;
  readonly saving: boolean;
  /** True from a successful save until the next edit. */
  readonly justSaved: boolean;
  /** The backend's refusal code of the last save; null otherwise. */
  readonly failure: string | null;
  /** The failure code of the latest failed read; null while healthy. */
  readonly problem: string | null;
}

export interface DispatchSettingsStore {
  state(): DispatchSettingsState;
  /** Reads the settings and replaces the form with them (section open). */
  load(): Promise<void>;
  /** The poll's read: replaces everything, except while the form has unsaved edits or a save is open. */
  refresh(): Promise<void>;
  setMode(mode: DispatchMode): void;
  setGlobal(value: number): void;
  setPerRepo(value: number): void;
  setAccountLimit(accountId: string, value: number): void;
  setAccountLimited(accountId: string, limited: boolean): void;
  applySuggestion(): void;
  reset(): void;
  /** Writes the form. `knownAccountIds` are the accounts that exist; limits of any other id are
   *  left out (the backend refuses an unknown account), null sends every entry. */
  save(knownAccountIds: readonly string[] | null): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface DispatchSettingsDeps {
  readonly read: () => Promise<unknown>;
  readonly write: (input: DispatchWrite) => Promise<CommandResult>;
}

export interface DispatchErrors {
  readonly global?: LabelKey;
  readonly perRepo?: LabelKey;
  readonly accounts: Readonly<Record<string, LabelKey>>;
  /** The one message the section shows: cap first, then per-repo, then the accounts in order. */
  readonly first: LabelKey | null;
}

const isCount = (value: number, max: number): boolean => Number.isInteger(value) && value >= 1 && value <= max;

/** The backend's limits rule, per field. `knownAccountIds` narrows the account check to accounts
 *  that exist; null judges every entry. */
export const dispatchErrors = (form: DispatchForm, knownAccountIds: readonly string[] | null): DispatchErrors => {
  const global: LabelKey | undefined = isCount(form.global, MAX_DISPATCH_CAP) ? undefined : 'dispatch.error.global';
  // Against an invalid cap the other limits have no ceiling to be judged by.
  const ceiling = global === undefined ? form.global : MAX_DISPATCH_CAP;
  const below = (value: number): boolean => !Number.isInteger(value) || value < 1;
  const perRepo: LabelKey | undefined = isCount(form.perRepo, ceiling)
    ? undefined
    : below(form.perRepo)
      ? 'dispatch.error.min'
      : 'dispatch.error.perRepo';
  const accounts: Record<string, LabelKey> = {};
  for (const [id, limit] of Object.entries(form.perAccount)) {
    if (knownAccountIds !== null && !knownAccountIds.includes(id)) continue;
    if (!isCount(limit, ceiling)) accounts[id] = below(limit) ? 'dispatch.error.min' : 'dispatch.error.account';
  }
  const firstAccount = Object.values(accounts)[0];
  return {
    ...(global === undefined ? {} : { global }),
    ...(perRepo === undefined ? {} : { perRepo }),
    accounts,
    first: global ?? perRepo ?? firstAccount ?? null,
  };
};

const sameForm = (a: DispatchForm, b: DispatchForm): boolean => {
  if (a.mode !== b.mode || a.global !== b.global || a.perRepo !== b.perRepo) return false;
  const left = Object.entries(a.perAccount);
  return left.length === Object.keys(b.perAccount).length && left.every(([id, limit]) => b.perAccount[id] === limit);
};

/** The live status card's data, or null when the section must not show one: only in Otomatik, only
 *  for a form with no unsaved edits, and only for a status the dispatcher took in that same mode —
 *  a tick from before a mode switch describes the other mode. */
export const statusCard = (
  state: DispatchSettingsState,
): { readonly effective: number; readonly cap: number; readonly band: LoadBand; readonly load1?: number } | null => {
  const { status, saved } = state;
  if (status === null || saved === null || state.dirty) return null;
  if (saved.mode !== 'auto' || status.mode !== 'auto') return null;
  return {
    effective: status.effective,
    cap: status.cap,
    band: status.band,
    ...(status.load1 === undefined ? {} : { load1: status.load1 }),
  };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const isBand = (value: unknown): value is LoadBand => value === 'free' || value === 'reduced' || value === 'busy';

interface Reading {
  readonly form: DispatchForm;
  readonly suggestion: DispatchSuggestion | null;
  readonly status: DispatchStatusReading | null;
}

/** The reply of `settings.dispatch`, or null when it is not that shape. */
const readingOf = (reply: unknown): Reading | null => {
  if (!isRecord(reply)) return null;
  const global = num(reply['global']);
  const perRepo = num(reply['perRepo']);
  if (global === undefined || perRepo === undefined || !isRecord(reply['perAccount'])) return null;
  const perAccount: Record<string, number> = {};
  for (const [id, limit] of Object.entries(reply['perAccount'])) {
    const n = num(limit);
    if (n !== undefined) perAccount[id] = n;
  }
  const mode: DispatchMode = reply['mode'] === 'fixed' ? 'fixed' : 'auto';

  const machine = reply['machine'];
  const suggested = num(reply['suggested']);
  const cores = isRecord(machine) ? num(machine['cores']) : undefined;
  const totalMemGb = isRecord(machine) ? num(machine['totalMemGb']) : undefined;
  const suggestion = suggested !== undefined && cores !== undefined && totalMemGb !== undefined ? { suggested, cores, totalMemGb } : null;

  const raw = reply['status'];
  let status: DispatchStatusReading | null = null;
  if (isRecord(raw) && isBand(raw['band']) && (raw['mode'] === 'fixed' || raw['mode'] === 'auto')) {
    const cap = num(raw['cap']);
    const effective = num(raw['effective']);
    const load1 = num(raw['load1']);
    if (cap !== undefined && effective !== undefined) {
      status = { mode: raw['mode'], cap, effective, band: raw['band'], ...(load1 === undefined ? {} : { load1 }) };
    }
  }
  return { form: { mode, global, perRepo, perAccount }, suggestion, status };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(value)));

export const createDispatchSettingsStore = (deps: DispatchSettingsDeps): DispatchSettingsStore => {
  let state: DispatchSettingsState = {
    loaded: false,
    form: DEFAULT_DISPATCH_FORM,
    saved: null,
    suggestion: null,
    status: null,
    dirty: false,
    isDefault: true,
    saving: false,
    justSaved: false,
    failure: null,
    problem: null,
  };
  const listeners = new Set<() => void>();
  // Only the newest read may apply its reply.
  let attempts = 0;

  const publish = (next: DispatchSettingsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** A new form, with the derived flags recomputed and the confirmation and refusal cleared: any
   *  edit makes both stale. */
  const edit = (form: DispatchForm): void => {
    publish({
      ...state,
      form,
      dirty: state.saved === null || !sameForm(form, state.saved),
      isDefault: sameForm(form, DEFAULT_DISPATCH_FORM),
      justSaved: false,
      failure: null,
    });
  };

  const read = async (poll: boolean): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    const reply = await deps.read();
    // A poll that was in flight when an edit began must not overwrite it.
    if (attempt !== attempts || (poll && (state.dirty || state.saving))) return;
    if (isQueryFailure(reply)) {
      publish({ ...state, problem: reply.code });
      return;
    }
    const reading = readingOf(reply);
    if (reading === null) {
      publish({ ...state, problem: 'invalid_id' });
      return;
    }
    publish({
      ...state,
      loaded: true,
      problem: null,
      saved: reading.form,
      suggestion: reading.suggestion,
      status: reading.status,
      form: reading.form,
      dirty: false,
      isDefault: sameForm(reading.form, DEFAULT_DISPATCH_FORM),
      justSaved: false,
      failure: null,
    });
  };

  return {
    state: () => state,
    load: () => read(false),
    refresh: () => (state.dirty || state.saving ? Promise.resolve() : read(true)),
    setMode: (mode) => edit({ ...state.form, mode }),
    setGlobal: (value) => edit({ ...state.form, global: clamp(value, 1, MAX_DISPATCH_CAP) }),
    setPerRepo: (value) => edit({ ...state.form, perRepo: clamp(value, 1, state.form.global) }),
    setAccountLimit: (accountId, value) => edit({ ...state.form, perAccount: { ...state.form.perAccount, [accountId]: clamp(value, 1, state.form.global) } }),
    setAccountLimited: (accountId, limited) => {
      const { [accountId]: _dropped, ...rest } = state.form.perAccount;
      // A new limit starts at 2, the prototype's first step, or at the cap when that is lower.
      edit({ ...state.form, perAccount: limited ? { ...rest, [accountId]: Math.min(state.form.global, 2) } : rest });
    },
    applySuggestion: () => {
      if (state.suggestion === null) return;
      const global = clamp(state.suggestion.suggested, 1, MAX_DISPATCH_CAP);
      edit({ ...state.form, global, perRepo: Math.min(state.form.perRepo, global) });
    },
    reset: () => edit(DEFAULT_DISPATCH_FORM),
    save: async (knownAccountIds) => {
      if (state.saving || dispatchErrors(state.form, knownAccountIds).first !== null) return;
      const form = state.form;
      const perAccount = Object.fromEntries(Object.entries(form.perAccount).filter(([id]) => knownAccountIds === null || knownAccountIds.includes(id)));
      publish({ ...state, saving: true, failure: null, justSaved: false });
      const result = await deps.write({ global: form.global, perRepo: form.perRepo, perAccount, mode: form.mode });
      if (!result.ok) {
        publish({ ...state, saving: false, failure: result.code });
        return;
      }
      // What the confirmation claims is what the backend now holds: re-read, then confirm.
      publish({ ...state, saving: false });
      await read(false);
      publish({ ...state, justSaved: state.problem === null });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
