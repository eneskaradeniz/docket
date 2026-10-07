// stores/accounts-frame.ts — the sidebar's Hesaplar section (U-16, cards per U-51): it mirrors
// the `settings.accounts` query into equal cards — every limit as a row, the tightest one
// driving the card's single bar and dot — and owns the section's disclosure and the refresh
// intent, which re-queries usage. A failed query keeps the cards on screen; a slow provider
// delays only the reply the api resolves (U-6's stance, met by keeping the prior cards while
// `refreshing` runs).
import type { Api } from '../../api/api';
import type { Query, SettingsAccountsView } from '../../api/queries';
import { accountStatus } from './account-editor';
import { isQueryFailure } from './results';
import type { SettingsOpenTarget } from './settings-panel';
import { t, type Locale } from '../labels/t';
import { meterListView, type MeterName } from './meter-list';
import type { ShellChangeSignal } from './shell';

/** The tone of what remains (U-51): 40 % or more proceeds, 15–40 % amber, under 15 % red. */
export type RemainingTone = 'proceed' | 'warn' | 'error';

export const remainingTone = (remaining: number): RemainingTone =>
  remaining >= 0.4 ? 'proceed' : remaining >= 0.15 ? 'warn' : 'error';

/** One limit as the card's popover lists it: its own name, the remaining share, the counted
 *  fraction and the reset time — everything the tightest reading is drawn from. */
export interface AccountLimit {
  readonly id: string;
  readonly name: MeterName;
  /** Remaining, 0..1; null when the meter cannot say. */
  readonly remaining: number | null;
  /** "used / limit" for a counted unit; null for shares and money. */
  readonly fraction: string | null;
  readonly resetsAt: number | null;
}

/** One card as the section renders it (U-51): one fixed height whatever its number of limits. */
export interface AccountCard {
  readonly id: string;
  readonly label: string;
  /** The account's provider id — the card's badge resolves its mark from the marks store. */
  readonly provider: string;
  /** Every limit, in the query's order — the popover's rows. */
  readonly limits: readonly AccountLimit[];
  /** The limit with the least remaining; null when no limit carries a reading. */
  readonly tightest: AccountLimit | null;
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
  /** The section's disclosure; the only collapsible part of the sidebar. */
  readonly open: boolean;
  /** True while a refresh re-polls usage; the cards stay listed meanwhile. */
  readonly refreshing: boolean;
}

export interface AccountsFrameStore {
  load(): Promise<void>;
  toggle(): void;
  /** Re-polls usage: one re-query for the section, ended when the reply lands. */
  refresh(): Promise<void>;
  state(): AccountsFrameState;
  subscribe(listener: () => void): () => void;
}

/** The tightest limit: the least remaining among the readable ones, the first on a tie — the
 *  order the api reported. Null when nothing can be read. Pure. */
export const tightestOf = (limits: readonly AccountLimit[]): AccountLimit | null => {
  let best: number | null = null;
  let tightest: AccountLimit | null = null;
  for (const limit of limits) {
    const remaining = limit.remaining;
    if (remaining === null) continue;
    if (best === null || remaining < best) {
      best = remaining;
      tightest = limit;
    }
  }
  return tightest;
};

/** The accounts view as cards: every limit a row (the popover's own list), the tightest one
 *  marked for the card's single bar. A meter without readings stays a row that cannot win. */
export const accountCards = (view: SettingsAccountsView): readonly AccountCard[] =>
  view.accounts.map((account) => {
    const limits: readonly AccountLimit[] = meterListView(account.pools, account.meters).rows.map((row) => ({
      id: row.id,
      name: row.name,
      remaining: row.remaining,
      fraction: row.fraction,
      resetsAt: row.resetsAt,
    }));
    return {
      id: account.id,
      label: account.label,
      provider: account.provider,
      limits,
      tightest: tightestOf(limits),
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
    // The section starts collapsed for the session (U-16, kept by U-51); the operator opens it.
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

/** The section's trailing row (U-37): "n hesap eklenmedi · Gör ›" while discovery holds `count`
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
