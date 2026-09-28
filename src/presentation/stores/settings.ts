// stores/settings.ts — the settings store (U-6): it mirrors the `settings.accounts` query as
// rendering data (accounts with their pools/meters, per-role bindings) and lists discovery rows
// from `providers.discovered`. The api resolves a discovery query only when its whole pass ends
// (per-provider failures arrive as null-fields rows), so "a slow provider delays only its row"
// is honoured by keeping the prior pass's rows listed while a new pass runs — the refresh never
// blanks the list, and a hung provider's row lands as null fields when its pass ends. Discovery
// runs only on the explicit `discover` intent: every query of it spawns a probe pass, so change
// events re-query the accounts view but never re-kick discovery. Removing an account that a
// binding still references warns with the referencing roles BEFORE `account.remove` is issued;
// only an explicit confirmation issues the command (the api stays the last boundary and may
// still refuse `binding_exists` if the bindings moved since the view loaded). Every intent maps
// its CommandResult through results.ts (U-8).
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
import { commandResultKey, isQueryFailure } from './results';

/** The coarse change events the api emits (docs/v2/ui.md, U-12). Notifications carry no
 *  payloads — the store re-queries. Tests inject a fake; the api's `subscribe` satisfies the
 *  signal as-is. */
export type SettingsChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

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
}

export interface SettingsView {
  readonly accounts: readonly AccountDisplay[];
  readonly bindings: readonly SettingsBindingView[];
}

/** One discovered provider as the wire reports it: null bin/version/logged-in mark a probe
 *  that failed or was cut off — a row, never a failed query. */
export interface DiscoveryRow {
  readonly defId: string;
  readonly binPath: string | null;
  readonly version: string | null;
  readonly loggedIn: boolean | null;
  readonly optionalFlags: readonly string[];
}

export interface DiscoveryState {
  /** True while a discovery pass is in flight; the prior rows stay listed meanwhile. */
  readonly running: boolean;
  readonly rows: readonly DiscoveryRow[];
  /** True when the latest finished discovery query failed (e.g. no discovery port). */
  readonly failed: boolean;
}

/** Why the remove intent stopped before issuing: the account is still bound, by these roles. */
export interface RemoveWarning {
  readonly accountId: string;
  readonly roles: readonly string[];
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
  readonly discovery: DiscoveryState;
  /** The latest intent's U-8 mapping; null before the first intent. */
  readonly lastOutcome: SettingsIntentOutcome | null;
  readonly removeWarning: RemoveWarning | null;
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
  /** Kick a discovery pass; rows land when the pass ends (see the module header). */
  discover(): Promise<void>;
  state(): SettingsState;
  /** The reset time of a meter in the active locale, or null when the meter has none.
   *  Computed on demand so a locale switch re-renders without a re-query. */
  resetsAtLabel(resetsAt: number | null): string | null;
  saveAccount(input: AccountSaveInput): Promise<SettingsIntentOutcome>;
  saveBinding(input: BindingSaveInput): Promise<SettingsIntentOutcome>;
  /** Remove an account; with bindings still referencing it, issues nothing and surfaces the
   *  `binding_exists` warning with the referencing roles. */
  removeAccount(accountId: string): Promise<SettingsIntentOutcome>;
  /** The explicit confirmation the warning asks for: issues `account.remove` regardless. */
  confirmRemoveAccount(accountId: string): Promise<SettingsIntentOutcome>;
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

export const createSettingsStore = (deps: SettingsStoreDeps): SettingsStore => {
  const { api, changes, actor, locale, timeZone } = deps;
  const zone = timeZone ?? 'UTC';

  let state: SettingsState = {
    loading: false,
    view: null,
    problem: null,
    discovery: { running: false, rows: [], failed: false },
    lastOutcome: null,
    removeWarning: null,
  };
  const listeners = new Set<() => void>();
  // Separate guards per query kind: only the newest attempt of each may apply its reply, so a
  // change-event re-query cannot drop an in-flight discovery pass's answer (and vice versa).
  let accountsAttempts = 0;
  let discoveryAttempts = 0;

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
    });
  };

  const discover = async (): Promise<void> => {
    const attempt = discoveryAttempts + 1;
    discoveryAttempts = attempt;
    set({ ...state, discovery: { ...state.discovery, running: true, failed: false } });
    const reply: unknown = await api.query({ type: 'providers.discovered' } satisfies Query);
    if (attempt !== discoveryAttempts) return;
    if (isQueryFailure(reply)) {
      // A failed pass keeps the prior rows listed; only the failure surfaces.
      set({ ...state, discovery: { ...state.discovery, running: false, failed: true } });
      return;
    }
    set({
      ...state,
      discovery: { running: false, failed: false, rows: reply as readonly DiscoveryRow[] },
    });
  };

  // Both event kinds can move what settings shows (meters move with runs, accounts with
  // commands), so every notification re-queries the accounts view. Discovery is intentionally
  // absent: a pass spawns probes, and change events must not pay for one.
  changes(() => {
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
    discover,
    state: () => state,
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
    saveBinding: (input) =>
      runIntent({
        type: 'binding.save',
        role: input.role,
        accounts: input.accounts.map((entry) =>
          entry.model === undefined ? { accountId: entry.accountId } : { accountId: entry.accountId, model: entry.model },
        ),
      }),
    removeAccount: async (accountId) => {
      if (state.view === null) return notLoadedOutcome('account.remove');
      const roles = referencingRoles(state.view.bindings, accountId);
      if (roles.length > 0) {
        // The warning is the outcome: the same shape the api would return, derived from the
        // loaded bindings so it surfaces before the command instead of after the refusal.
        const result: CommandResult = { ok: false, code: 'binding_exists', roles };
        const outcome: SettingsIntentOutcome = {
          command: 'account.remove',
          result,
          labelKey: commandResultKey('account.remove', result),
        };
        set({ ...state, lastOutcome: outcome, removeWarning: { accountId, roles } });
        return outcome;
      }
      return runIntent({ type: 'account.remove', id: accountId });
    },
    confirmRemoveAccount: async (accountId) => {
      set({ ...state, removeWarning: null });
      if (state.view === null) return notLoadedOutcome('account.remove');
      return runIntent({ type: 'account.remove', id: accountId });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
