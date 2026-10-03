// stores/accounts-frame.ts — the sidebar's accounts frame (U-16): it mirrors the
// `settings.accounts` query into the compact cards the frame lists — one mini bar per window
// with its normalized percent, spend meta where the account carries money — and owns the
// frame's disclosure and the refresh intent, which re-queries usage. A failed query keeps the
// cards on screen; a slow provider delays only the reply the api resolves (U-6's stance, met
// by keeping the prior cards while `refreshing` runs).
import type { Api } from '../../api/api';
import type { Query, SettingsAccountsView, SettingsMeterView } from '../../api/queries';
import { accountStatus } from './account-editor';
import { isQueryFailure } from './results';
import type { SettingsOpenTarget } from './settings-panel';
import { t, type Locale } from '../labels/t';
import type { ShellChangeSignal } from './shell';

/** A bar at or above this share of its window renders warn (U-16's default). */
export const WARN_PERCENT = 80;

/** The window kinds the frame labels; derived from the meter cadence, not the label copy. */
export type WindowKind = 'five_hour' | 'week' | 'month';

/** One card as the frame renders it. */
export interface AccountCard {
  readonly id: string;
  readonly label: string;
  /** The account's provider id — the card's badge resolves its mark from the marks store. */
  readonly provider: string;
  /** One mini bar per window, in the query's order. */
  readonly windows: readonly {
    readonly kind: WindowKind | null;
    /** The meter's own label, for the tooltip; null when the meter has none. */
    readonly name: string | null;
    readonly percent: number;
    readonly warn: boolean;
  }[];
  /** The recorded spend against the cap, when a window carries money; null otherwise. */
  readonly spend: { readonly used: number; readonly cap: number } | null;
  /** A share meter's remaining reached its reserve (U-31's reading): the card reads "rezervde". */
  readonly reserved: boolean;
  /** The account's reserve shares, for the account view's limit band (U-37). */
  readonly reserve: { readonly short: number | null; readonly long: number | null };
}

export interface AccountsFrameState {
  readonly loading: boolean;
  /** The last successful query's cards; null only before the first success. */
  readonly cards: readonly AccountCard[] | null;
  /** The failure code of the latest failed query; null while healthy. */
  readonly problem: string | null;
  /** The frame's disclosure; the only collapsible part of the sidebar. */
  readonly open: boolean;
  /** True while a refresh re-polls usage; the cards stay listed meanwhile. */
  readonly refreshing: boolean;
}

export interface AccountsFrameStore {
  load(): Promise<void>;
  toggle(): void;
  /** Re-polls usage: one re-query for the frame, ended when the reply lands. */
  refresh(): Promise<void>;
  state(): AccountsFrameState;
  subscribe(listener: () => void): () => void;
}

/** The window kind a cadence reads as; the frame labels only the kinds it knows, anything else
 *  falls back to the meter's own label. */
export const windowKind = (cadence: string): WindowKind | null => {
  if (cadence === 'rolling_from_first_use') return 'five_hour';
  if (cadence === 'fixed') return 'week';
  if (cadence === 'billing_cycle') return 'month';
  return null;
};

const cardWindow = (meter: SettingsMeterView) => {
  const percent =
    meter.used === null || meter.limit === null || meter.limit <= 0
      ? 0
      : Math.min(100, Math.round((meter.used / meter.limit) * 100));
  return {
    kind: windowKind(meter.cadence),
    name: meter.label,
    percent,
    warn: percent >= WARN_PERCENT,
  };
};

/** The accounts view as cards: label, one bar per window, spend meta from the first window that
 *  carries money. A window without readings renders an empty bar, never a guess. */
export const accountCards = (view: SettingsAccountsView): readonly AccountCard[] =>
  view.accounts.map((account) => {
    const windows = account.meters.map(cardWindow);
    const money = account.meters.find((meter) => meter.unit === 'usd');
    return {
      id: account.id,
      label: account.label,
      provider: account.provider,
      windows,
      spend:
        money !== undefined && money.used !== null && money.limit !== null
          ? { used: money.used, cap: money.limit }
          : null,
      reserved: accountStatus(account) === 'reserve',
      reserve: account.reserve,
    };
  });

export const createAccountsFrameStore = (deps: {
  readonly api: Pick<Api, 'query'>;
  readonly changes: ShellChangeSignal;
}): AccountsFrameStore => {
  const { api, changes } = deps;

  let state: AccountsFrameState = {
    loading: false,
    cards: null,
    problem: null,
    // The frame starts collapsed for the session (U-16); the operator opens it when needed.
    open: false,
    refreshing: false,
  };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply.
  let attempts = 0;

  const set = (next: AccountsFrameState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ ...state, loading: true });
    const reply: unknown = await api.query({ type: 'settings.accounts' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    set({ ...state, loading: false, problem: null, cards: accountCards(reply as SettingsAccountsView) });
  };

  changes(() => {
    void load();
  });

  return {
    load,
    toggle: () => {
      set({ ...state, open: !state.open });
    },
    refresh: async (): Promise<void> => {
      set({ ...state, refreshing: true });
      await load();
      set({ ...state, refreshing: false });
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** The frame's trailing row (U-37): "n hesap eklenmedi · Gör ›" while discovery holds `count`
 *  accounts not yet added (the candidates store's own count); absent at zero. Pure. */
export const unaddedRow = (
  locale: Locale,
  count: number,
): { readonly text: string; readonly action: string } | null =>
  count <= 0
    ? null
    : {
        text: t(locale, count === 1 ? 'accounts.unadded.one' : 'accounts.unadded').replace('{n}', String(count)),
        action: t(locale, 'accounts.unadded.see'),
      };

/** The row's intent: Settings on Hesaplar's list. */
export const unaddedRowTarget = (): SettingsOpenTarget => ({ section: 'accounts' });
