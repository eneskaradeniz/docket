// stores/account-view.ts — the account view store (U-20): it mirrors the `account.detail` query
// into the account screen's facts — one window bar per window with the normalized used percent
// and its warn standing, the reset times the screen formats, and the active-work rows in the
// query's order — and never blanks the view: a failed query keeps the previous one and surfaces
// the problem. The limit-behaviour band is read-only here (K-5's rule: bilgi → ⓘ, düzenleme →
// Ayarlar penceresi); the store only names the policy's label key.
import type { Api } from '../../api/api';
import type { AccountDetailView, Query } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { resetLine } from './reset-line';
import { isQueryFailure } from './results';
import type { SettingsOpenTarget } from './settings-panel';

/** A bar at or above this share of its window renders warn — the frame's default (U-16), the
 *  account view's blocks speak the same grammar. */
export const WARN_PERCENT = 80;

/** The coarse change events the store re-queries on; the shell's signal satisfies it as-is. */
export type AccountViewChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  // The chat members (U-97) ride the same push channel; stores that do not serve a chat ignore them.
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string };

export type AccountViewChangeSignal = (listener: (change: AccountViewChange) => void) => () => void;

export interface AccountViewStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: AccountViewChangeSignal;
  /** Wall clock, injected: the store never reads `Date` itself. */
  readonly now: () => number;
}

export interface AccountViewState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen. */
  readonly view: AccountDetailView | null;
  /** The failure code of the latest failed query; null while healthy. */
  readonly problem: string | null;
}

/** One window block's facts (U-20): the meter's own label, the normalized percent clamped to the
 *  bar, its warn standing, and the reset stamp the screen formats. */
export interface AccountWindowBar {
  readonly label: string | null;
  readonly percent: number;
  readonly warn: boolean;
  readonly resetsAt: number | null;
}

export interface AccountViewStore {
  load(id: string): Promise<void>;
  state(): AccountViewState;
  /** Milliseconds until the stamp, never negative — zero once it has passed. */
  remainingMs(resetsAt: number): number;
  /** The shared "…'de sıfırlanır · … kaldı" line for a window's reset, read at the injected clock. */
  resetLine(locale: Locale, timeZone: string, resetsAt: number): string;
  subscribe(listener: () => void): () => void;
}

/** The account's windows as bars (U-20). A window without readings renders an empty bar, never a
 *  guess. Pure. */
export const windowBars = (view: AccountDetailView): readonly AccountWindowBar[] =>
  view.windows.map((window) => {
    const used = window.used ?? null;
    const limit = window.limit ?? null;
    const percent =
      used === null || limit === null || limit <= 0
        ? 0
        : Math.min(100, Math.round((used / limit) * 100));
    return {
      label: window.label ?? null,
      percent,
      warn: percent >= WARN_PERCENT,
      resetsAt: window.resetsAt ?? null,
    };
  });

/** The limit policy's label key (U-20). The domain's closed set each carry their own copy; a
 *  wire value outside it reads as the wait-and-resume default, never a broken band. Pure. */
export const policyKey = (policy: string): LabelKey => {
  switch (policy) {
    case 'switch_pool':
      return 'account.policy.switch_pool';
    case 'fallback_account':
      return 'account.policy.fallback_account';
    case 'ask':
      return 'account.policy.ask';
    default:
      return 'account.policy.wait_resume';
  }
};

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

const sharePercent = (share: number | null): number => Math.round((share ?? 0) * 100);

/** The limit band as one sentence (U-37): the policy and the reserve — Yok, one share when both
 *  windows keep the same, kısa · uzun otherwise — composed from label templates. A reserve the
 *  account view does not know yet reads as none. Pure. */
export const limitBand = (
  locale: Locale,
  policy: string,
  reserve: { readonly short: number | null; readonly long: number | null } | null,
): string => {
  const short = sharePercent(reserve?.short ?? null);
  const long = sharePercent(reserve?.long ?? null);
  const reserveText =
    short === 0 && long === 0
      ? t(locale, 'account.band.reserve.none')
      : short === long
        ? fill(t(locale, 'account.band.reserve.one'), { value: String(short) })
        : fill(t(locale, 'account.band.reserve.two'), { short: String(short), long: String(long) });
  return fill(t(locale, 'account.band.sentence'), { policy: t(locale, policyKey(policy)), reserve: reserveText });
};

/** "Ayarlar'da düzenle" (U-37): Settings on that account's sub-page, Limitler tab. */
export const editInSettingsTarget = (accountId: string): SettingsOpenTarget => ({
  section: 'accounts',
  subPage: accountId,
  tab: 'limits',
});

export const createAccountViewStore = (deps: AccountViewStoreDeps): AccountViewStore => {
  const { api, changes, now } = deps;

  let state: AccountViewState = { loading: false, view: null, problem: null };
  // The account the store is bound to: change events re-query it.
  let accountId: string | null = null;
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply, as in the sibling stores.
  let attempts = 0;

  const set = (next: AccountViewState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (id: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    accountId = id;
    set({ ...state, loading: true });
    const reply: unknown = await api.query({ type: 'account.detail', id } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view stays exactly as it was; only the problem appears.
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    // The contract of the account query: a reply that is not a failure is the detail view.
    set({ loading: false, view: reply as AccountDetailView, problem: null });
  };

  // Both event kinds concern the account's active work and windows — runs move and work orders
  // change — so they trigger the same re-query; the update channel does not.
  changes((change) => {
    if (change.type === 'update.changed') return;
    if (accountId === null) return;
    void load(accountId);
  });

  return {
    load,
    state: () => state,
    remainingMs: (resetsAt) => Math.max(0, resetsAt - now()),
    resetLine: (locale, timeZone, resetsAt) => resetLine(locale, timeZone, resetsAt, now()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
