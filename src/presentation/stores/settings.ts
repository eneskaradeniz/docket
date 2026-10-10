// stores/settings.ts — the settings store (U-6): it mirrors the `settings.accounts` query as
// rendering data (accounts with their pools/meters, per-role bindings). Removing an account that a
// binding still references warns with the referencing roles and NEVER issues `account.remove`
// while a reference stands — the use case would refuse the same command again, so the way forward
// is updating the binding in Roller, not insisting (the api stays the last boundary all the same).
// Every intent maps its CommandResult through results.ts (U-8).
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type {
  Query,
  SettingsAccountView,
  SettingsAccountsView,
  SettingsBindingView,
  SettingsPoolView,
} from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import type { Locale } from '../labels/t';
import { resetLine } from './reset-line';
import { commandResultKey, isQueryFailure } from './results';
import { testRefusal, type TestRefusal } from './account-test';
import type { DispatchWrite } from './dispatch-settings';

/** The coarse change events the api emits (docs/v2/ui.md, U-12). Notifications carry no
 *  payloads — the store re-queries. Tests inject a fake; the api's `subscribe` satisfies the
 *  signal as-is. */
export type SettingsChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  // The chat members (U-97) ride the same push channel; stores that do not serve a chat ignore them.
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type SettingsChangeSignal = (listener: (change: SettingsChange) => void) => () => void;

export interface SettingsStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: SettingsChangeSignal;
  /** Every issued command travels as this actor — the settings screen acts as the user. */
  readonly actor: Actor;
  /** The active locale; the locale store's `current()` satisfies it as-is. */
  readonly locale: () => Locale;
  /** Zone the reset timestamps render in; composition passes the machine's zone, tests 'UTC'. */
  readonly timeZone?: string;
}

/** One meter as the settings list renders it: the locale-dependent reset time is formatted on
 *  demand through `resetsAtLabel`, everything else is data. */
export interface MeterDisplay {
  readonly id: string;
  readonly poolId: string;
  readonly label: string;
  readonly unit: string;
  readonly remaining: number | null;
  readonly resetsAt: number | null;
  readonly resetPrecision: string;
  /** The source badge (an `ObservationSource` code): the copy key set for it is not in the
   *  label bundle yet, so the closed code travels to the component verbatim. */
  readonly source: string;
}

export interface AccountDisplay {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly authMode: string;
  readonly plan: string | null;
  readonly pools: readonly SettingsPoolView[];
  readonly meters: readonly MeterDisplay[];
  /** The account exactly as `settings.accounts` reported it (A-48): the account editor reads its
   *  facts, reserve, policy and caps from here. */
  readonly detail: SettingsAccountView;
}

export interface SettingsView {
  readonly accounts: readonly AccountDisplay[];
  readonly bindings: readonly SettingsBindingView[];
}

/** Why the remove intent stopped before issuing: the account is still bound, by these roles. */
export interface RemoveWarning {
  readonly accountId: string;
  readonly roles: readonly string[];
  /** The account is the only one: the roles cannot be given another account from what exists, so
   *  the warning says that another account must be added first instead of offering the jump. */
  readonly onlyAccount: boolean;
}

/** What every intent reports: the raw CommandResult plus its U-8 copy key — the screen toasts
 *  the key's text; nothing else ever renders a result. */
export interface SettingsIntentOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface SettingsState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen. */
  readonly view: SettingsView | null;
  /** The failure code of the latest failed accounts query; null while healthy. */
  readonly problem: string | null;
  /** The latest intent's U-8 mapping; null before the first intent. */
  readonly lastOutcome: SettingsIntentOutcome | null;
  readonly removeWarning: RemoveWarning | null;
  /** The accounts whose `account.test` is open right now (U-39): their button reads "Test
   *  ediliyor…" and is disabled. */
  readonly testing: readonly string[];
  /** The latest refusal of an account's test, by account id; cleared when its next test starts. */
  readonly testRefusals: Readonly<Record<string, TestRefusal>>;
}

export interface AccountSaveInput {
  readonly id?: string;
  readonly provider: string;
  readonly label: string;
  readonly authMode: string;
  readonly plan?: string;
}

export interface BindingSaveInput {
  readonly role: string;
  readonly accounts: readonly { readonly accountId: string; readonly model?: string }[];
}

export interface SettingsStore {
  load(): Promise<void>;
  state(): SettingsState;
  /** The reset time of a meter in the active locale, or null when the meter has none.
   *  Computed on demand so a locale switch re-renders without a re-query. */
  resetsAtLabel(resetsAt: number | null): string | null;
  /** U-20's "…'de sıfırlanır · … kaldı" for a reset instant, read now; null without one. */
  resetLine(resetsAt: number | null): string | null;
  saveAccount(input: AccountSaveInput): Promise<SettingsIntentOutcome>;
  saveBinding(input: BindingSaveInput): Promise<SettingsIntentOutcome>;
  /** Issue any command as the user and re-query (the account editor's writes, U-29). */
  runCommand(command: Command): Promise<SettingsIntentOutcome>;
  /** "Test et" (U-39): sends `account.test` for the saved account — never a `model`, so the
   *  route's default — and re-queries on the answer. A second press while one is open sends
   *  nothing. A refusal lands in `testRefusals`; a finished test is read from the account's `test`. */
  testAccount(accountId: string): Promise<void>;
  /** "Yenile" (U-43): `quota.refresh` for one account, or every account without an id; the view is
   *  re-read when the polls have ended. */
  refreshQuota(accountId?: string): Promise<SettingsIntentOutcome>;
  /** Remove an account; with bindings still referencing it, issues nothing and surfaces the
   *  `binding_exists` warning with the referencing roles (and whether the account is the only
   *  one — then the roles need another account first). There is no force path: the warning's way
   *  forward is updating the binding in Roller. */
  removeAccount(accountId: string): Promise<SettingsIntentOutcome>;
  /** The Eşzamanlılık section's reads and writes (U-70 … U-74). They bypass `lastOutcome`: the
   *  section confirms and refuses inline, so a toast would say it twice. */
  readDispatch(): Promise<unknown>;
  writeDispatch(input: DispatchWrite): Promise<CommandResult>;
  subscribe(listener: () => void): () => void;
}

const accountDisplay = (account: SettingsAccountView): AccountDisplay => {
  const poolById = new Map(account.pools.map((pool) => [pool.id, pool]));
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    authMode: account.authMode,
    plan: account.plan,
    pools: account.pools,
    detail: account,
    meters: account.meters.map((meter) => ({
      id: meter.id,
      poolId: meter.poolId,
      // A meter without its own label renders under its pool's name: the pool is the meter's
      // naming context, and an empty label row would read as a defect.
      label: meter.label ?? poolById.get(meter.poolId)?.label ?? meter.poolId,
      unit: meter.unit,
      remaining: meter.remaining,
      resetsAt: meter.resetsAt,
      resetPrecision: meter.resetPrecision,
      source: meter.source,
    })),
  };
};

/** The roles whose bindings still route the account, in binding order, without duplicates. */
const referencingRoles = (
  bindings: readonly SettingsBindingView[],
  accountId: string,
): readonly string[] => {
  const roles: string[] = [];
  for (const binding of bindings) {
    if (!binding.accounts.some((entry) => entry.accountId === accountId)) continue;
    if (!roles.includes(binding.role)) roles.push(binding.role);
  }
  return roles;
};

/** A standing warning re-read against a fresh view: the roles it names refresh, and one whose
 *  references are gone (the binding was updated in Roller) leaves with the re-query instead of
 *  outliving its cause on a card that no longer describes anything. */
const refreshWarning = (warning: RemoveWarning, view: SettingsAccountsView): RemoveWarning | null => {
  const roles = referencingRoles(view.bindings, warning.accountId);
  return roles.length === 0 ? null : { accountId: warning.accountId, roles, onlyAccount: view.accounts.length === 1 };
};

export const createSettingsStore = (deps: SettingsStoreDeps): SettingsStore => {
  const { api, changes, actor, locale, timeZone } = deps;
  const zone = timeZone ?? 'UTC';

  let state: SettingsState = {
    loading: false,
    view: null,
    problem: null,
    lastOutcome: null,
    removeWarning: null,
    testing: [],
    testRefusals: {},
  };
  const listeners = new Set<() => void>();
  // Only the newest accounts query may apply its reply.
  let accountsAttempts = 0;

  const set = (next: SettingsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = accountsAttempts + 1;
    accountsAttempts = attempt;
    set({ ...state, loading: true, problem: null });
    const reply: unknown = await api.query({ type: 'settings.accounts' } satisfies Query);
    if (attempt !== accountsAttempts) return;
    if (isQueryFailure(reply)) {
      // The previous view stays exactly as it was; only the problem appears.
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    // The contract of the settings query: a reply that is not a failure is SettingsAccountsView.
    const view = reply as SettingsAccountsView;
    set({
      ...state,
      loading: false,
      view: { accounts: view.accounts.map(accountDisplay), bindings: view.bindings },
      problem: null,
      removeWarning: state.removeWarning === null ? null : refreshWarning(state.removeWarning, view),
    });
  };

  // Both event kinds can move what settings shows (meters move with runs, accounts with
  // commands), so every notification re-queries the accounts view. The update channel is
  // absent for the same economy — the update surface tracks it in its own wave.
  changes((change) => {
    if (change.type === 'update.changed') return;
    void load();
  });

  /** An intent with no loaded view has nothing to act on; the refusal maps through U-8 like any
   *  other failure and no command is issued. */
  const notLoadedOutcome = (command: Command['type']): SettingsIntentOutcome => {
    const result: CommandResult = { ok: false, code: 'not_found' };
    return { command, result, labelKey: commandResultKey(command, result) };
  };

  const runIntent = async (command: Command): Promise<SettingsIntentOutcome> => {
    const result = await api.command(actor, command);
    const outcome: SettingsIntentOutcome = {
      command: command.type,
      result,
      labelKey: commandResultKey(command.type, result),
    };
    set({ ...state, lastOutcome: outcome });
    // The store mirrors its own mutation: the next query shows the command's effect.
    await load();
    return outcome;
  };

  // Formatters are compiled once per locale+zone pair and reused across renders.
  const formatters = new Map<string, Intl.DateTimeFormat>();

  return {
    load,
    state: () => state,
    resetLine: (resetsAt) => (resetsAt === null ? null : resetLine(locale(), zone, resetsAt, Date.now())),
    resetsAtLabel: (resetsAt) => {
      if (resetsAt === null) return null;
      const tag = locale();
      const key = `${tag}|${zone}`;
      let formatter = formatters.get(key);
      if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });
        formatters.set(key, formatter);
      }
      return formatter.format(resetsAt);
    },
    saveAccount: (input) =>
      runIntent({
        type: 'account.save',
        ...(input.id !== undefined ? { id: input.id } : {}),
        provider: input.provider,
        label: input.label,
        authMode: input.authMode,
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
      }),
    runCommand: runIntent,
    saveBinding: (input) =>
      runIntent({
        type: 'binding.save',
        role: input.role,
        accounts: input.accounts.map((entry) =>
          entry.model === undefined ? { accountId: entry.accountId } : { accountId: entry.accountId, model: entry.model },
        ),
      }),
    testAccount: async (accountId) => {
      if (state.testing.includes(accountId)) return;
      const { [accountId]: _cleared, ...refusals } = state.testRefusals;
      set({ ...state, testing: [...state.testing, accountId], testRefusals: refusals });
      const result = await api.command(actor, { type: 'account.test', id: accountId });
      set({
        ...state,
        testing: state.testing.filter((id) => id !== accountId),
        testRefusals: result.ok ? state.testRefusals : { ...state.testRefusals, [accountId]: testRefusal(result.code) },
      });
      await load();
    },
    refreshQuota: (accountId) => runIntent(accountId === undefined ? { type: 'quota.refresh' } : { type: 'quota.refresh', id: accountId }),
    removeAccount: async (accountId) => {
      if (state.view === null) return notLoadedOutcome('account.remove');
      const roles = referencingRoles(state.view.bindings, accountId);
      if (roles.length > 0) {
        // The warning is the outcome and the only outcome: the same shape the api would return,
        // derived from the loaded bindings so it surfaces before the command instead of after
        // the refusal. Sending the command anyway would just be refused again, so nothing is
        // sent while a reference stands — the way forward is Roller.
        const result: CommandResult = { ok: false, code: 'binding_exists', roles };
        const outcome: SettingsIntentOutcome = {
          command: 'account.remove',
          result,
          labelKey: commandResultKey('account.remove', result),
        };
        set({
          ...state,
          lastOutcome: outcome,
          removeWarning: { accountId, roles, onlyAccount: state.view.accounts.length === 1 },
        });
        return outcome;
      }
      return runIntent({ type: 'account.remove', id: accountId });
    },
    readDispatch: () => api.query({ type: 'settings.dispatch' } satisfies Query),
    writeDispatch: (input) => api.command(actor, { type: 'settings.setDispatch', ...input }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
