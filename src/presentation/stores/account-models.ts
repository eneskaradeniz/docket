// stores/account-models.ts — the account's model list (P-40, docs/v2/provider-capabilities.md
// § 14): it mirrors the `account.models` query into the settings panel's rows — the billing mark
// (`included` shows none, `metered` a currency mark, `unknown` a question mark, never an amount or
// a price claim), the stale note a kept-after-failed-refresh list carries, and each model's
// recorded consent — and it owns the spend-consent flow: selecting a non-included model opens an
// inline draft that asks for a cap before `account.consent.grant` may issue, allow stays disabled
// until the entered amount parses, and the unpinned default consents through the `*` marker on the
// same flow. Every intent maps its CommandResult through results.ts (U-8); a failed query keeps
// the account's own rows and never another account's.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { AccountModelsView, ModelView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

/** The coarse change events the api emits (docs/v2/ui.md, U-12); the api's `subscribe` satisfies
 *  the signal as-is. */
export type AccountModelsChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' };

export type AccountModelsChangeSignal = (listener: (change: AccountModelsChange) => void) => () => void;

export interface AccountModelsStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: AccountModelsChangeSignal;
  /** Every issued command travels as this actor — the settings panel acts as the user. */
  readonly actor: Actor;
}

/** The account's own cap scopes on the wire (a closed set in the record). */
export type CapScope = 'account_day' | 'account_week' | 'account_month';

export const CAP_SCOPES: readonly CapScope[] = ['account_day', 'account_week', 'account_month'];

/** The warn percent the form's cap rides: the domain's documented default (SpendCap, 1..100). The
 *  consent form asks for scope and amount only. */
export const CAP_WARN_PERCENT = 80;

export type ModelBilling = ModelView['billing'];

/** The billing mark a row shows (P-40): `included` shows none; `metered` a currency mark; `unknown`
 *  a question mark. `unknown` never renders an amount or a price claim. Pure. */
export type BillingMark = 'none' | 'currency' | 'question';

export const billingMark = (billing: ModelBilling): BillingMark =>
  billing === 'metered' ? 'currency' : billing === 'unknown' ? 'question' : 'none';

/** One catalog row as the list renders it: the display name (the id when the list has none), the
 *  tier chip when known, the billing mark, the stale flag and the consent standing. */
export interface ModelRowDisplay {
  readonly id: string;
  readonly name: string;
  readonly tier: 'strong' | 'balanced' | 'fast' | null;
  readonly billing: ModelBilling;
  readonly mark: BillingMark;
  readonly stale: boolean;
  readonly consented: boolean;
}

/** The unpinned default's one line (P-40): the billing an unpinned run would take, and whether the
 *  route's default already carries consent (the account-level `*` marker). */
export interface DefaultModelDisplay {
  readonly billing: ModelBilling;
  readonly mark: BillingMark;
  readonly consented: boolean;
}

/** The catalog as the list's rows. Pure. */
export const modelRows = (view: AccountModelsView): readonly ModelRowDisplay[] =>
  view.models.map((model) => ({
    id: model.id,
    name: model.displayName ?? model.id,
    tier: model.tier ?? null,
    billing: model.billing,
    mark: billingMark(model.billing),
    stale: model.stale,
    consented: model.consented,
  }));

/** A cap amount as the form parses it: a finite number above zero, with the Turkish bundle's
 *  decimal comma accepted. Null when the text does not parse — the allow action needs a cap, and a
 *  cap that cannot cap must never reach the command (the use case would reject it anyway). Pure. */
export const parseAmountUsd = (raw: string): number | null => {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

export interface CapInput {
  readonly scope: CapScope;
  /** The raw text the operator typed; the store parses it. */
  readonly amountUsd: string;
}

/** The inline consent draft (P-40): the model the operator is about to allow (or `*`, the
 *  account-level marker for the unpinned default), what may happen, and the cap being entered.
 *  `allowEnabled` is derived — the allow action stays disabled without a parsable cap. */
export interface ConsentDraft {
  readonly accountId: string;
  /** The model id, or `*` for the route's unpinned default. */
  readonly model: string;
  /** The row's display name; null on the default line, which carries its own copy. */
  readonly name: string | null;
  readonly billing: 'metered' | 'unknown';
  readonly cap: CapInput;
  readonly allowEnabled: boolean;
}

/** What every consent intent reports: the raw CommandResult plus its U-8 copy key. */
export interface AccountModelsOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface AccountModelsState {
  /** The account whose catalog is listed; the panel expands one account at a time. */
  readonly accountId: string | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  /** The last successful query's rows; null before the first success. A failed re-query of the
   *  same account leaves them verbatim; another account's rows never show under this id. */
  readonly rows: readonly ModelRowDisplay[] | null;
  readonly defaultModel: DefaultModelDisplay | null;
  /** True when any row is stale — the list's "may be out of date" note (P-29). */
  readonly stale: boolean;
  /** The failure code of the latest failed query; null while healthy. */
  readonly problem: string | null;
  readonly draft: ConsentDraft | null;
  readonly lastOutcome: AccountModelsOutcome | null;
}

export interface AccountModelsStore {
  load(accountId: string): Promise<void>;
  /** Re-query through the cache-busting refresh (`account.models` with `refresh: true`). */
  refresh(): Promise<void>;
  /** Open the inline consent draft for a non-included model of the loaded account — or for the
   *  unpinned default through the `*` marker. Anything else (an included model, an id the loaded
   *  list does not carry, no loaded account) opens nothing. */
  beginConsent(model: { readonly model: string; readonly name: string | null; readonly billing: ModelBilling }): void;
  editCap(input: { readonly scope?: CapScope; readonly amountUsd?: string }): void;
  /** Issue `account.consent.grant` with the entered cap; without a parsable cap it issues
   *  nothing. A refusal keeps the draft open so the cap can be fixed and retried. */
  allow(): Promise<AccountModelsOutcome | null>;
  cancel(): void;
  /** Withdraw a recorded consent (`account.consent.revoke`) — a model id or the `*` marker. */
  revoke(model: string): Promise<AccountModelsOutcome | null>;
  state(): AccountModelsState;
  subscribe(listener: () => void): () => void;
}

const freshDraft = (accountId: string, model: string, name: string | null, billing: 'metered' | 'unknown'): ConsentDraft => ({
  accountId,
  model,
  name,
  billing,
  cap: { scope: 'account_day', amountUsd: '' },
  allowEnabled: false,
});

export const createAccountModelsStore = (deps: AccountModelsStoreDeps): AccountModelsStore => {
  const { api, changes, actor } = deps;

  let state: AccountModelsState = {
    accountId: null,
    loading: false,
    refreshing: false,
    rows: null,
    defaultModel: null,
    stale: false,
    problem: null,
    draft: null,
    lastOutcome: null,
  };
  const listeners = new Set<() => void>();
  // Which account the listed rows belong to: a failed re-query of that account keeps them, a
  // failed load of another account clears them — rows never travel between accounts.
  let rowsFor: string | null = null;
  // Only the newest attempt may apply its reply, as in the sibling stores.
  let attempts = 0;

  const set = (next: AccountModelsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const query = async (accountId: string, refresh: boolean): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    // Expanding another account never shows the current one's rows while its own list loads —
    // the rows clear up front and the panel shows the load; a refresh keeps them (P-29).
    const sameAccount = rowsFor === accountId;
    set({
      ...state,
      accountId,
      loading: !refresh,
      refreshing: refresh,
      problem: null,
      ...(sameAccount ? {} : { rows: null, defaultModel: null, stale: false }),
    });
    const reply: unknown = await api.query(
      refresh
        ? ({ type: 'account.models', accountId, refresh: true } satisfies Query)
        : ({ type: 'account.models', accountId } satisfies Query),
    );
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The same account's rows stay exactly as they were; only the problem appears (a different
      // account's rows were already cleared when its load began).
      set({ ...state, loading: false, refreshing: false, problem: reply.code });
      return;
    }
    // The contract of the query: a reply that is not a failure is the models view.
    const view = reply as AccountModelsView;
    const rows = modelRows(view);
    rowsFor = accountId;
    set({
      ...state,
      loading: false,
      refreshing: false,
      rows,
      defaultModel: { billing: view.defaultBilling, mark: billingMark(view.defaultBilling), consented: view.defaultConsented },
      stale: rows.some((row) => row.stale),
      problem: null,
    });
  };

  changes((change) => {
    if (change.type === 'update.changed') return;
    if (state.accountId === null) return;
    void query(state.accountId, false);
  });

  const runConsentCommand = async (
    command: Command,
    keepDraftOnRefusal: boolean,
  ): Promise<AccountModelsOutcome | null> => {
    const result = await api.command(actor, command);
    const outcome: AccountModelsOutcome = {
      command: command.type,
      result,
      labelKey: commandResultKey(command.type, result),
    };
    set({ ...state, lastOutcome: outcome, ...(result.ok || !keepDraftOnRefusal ? { draft: null } : {}) });
    // The store mirrors its own mutation: the next query shows the consent's effect.
    if (state.accountId !== null) await query(state.accountId, false);
    return outcome;
  };

  return {
    load: (accountId) => query(accountId, false),
    refresh: () => (state.accountId === null ? Promise.resolve() : query(state.accountId, true)),
    beginConsent: (model) => {
      if (state.accountId === null) return;
      // The billing comes from the loaded view, never from the caller: a stale or wrong claim
      // cannot open a consent for an included model.
      const billing =
        model.model === '*' ? state.defaultModel?.billing : state.rows?.find((row) => row.id === model.model)?.billing;
      if (billing === undefined || billing === 'included') return;
      set({ ...state, draft: freshDraft(state.accountId, model.model, model.name, billing) });
    },
    editCap: (input) => {
      if (state.draft === null) return;
      const cap: CapInput = {
        scope: input.scope ?? state.draft.cap.scope,
        amountUsd: input.amountUsd ?? state.draft.cap.amountUsd,
      };
      set({ ...state, draft: { ...state.draft, cap, allowEnabled: parseAmountUsd(cap.amountUsd) !== null } });
    },
    allow: async () => {
      const draft = state.draft;
      if (draft === null || !draft.allowEnabled) return null;
      const amountUsd = parseAmountUsd(draft.cap.amountUsd);
      if (amountUsd === null) return null;
      return runConsentCommand(
        {
          type: 'account.consent.grant',
          id: draft.accountId,
          model: draft.model,
          cap: { scope: draft.cap.scope, amountUsd, warnPercent: CAP_WARN_PERCENT },
        },
        true,
      );
    },
    cancel: () => {
      if (state.draft !== null) set({ ...state, draft: null });
    },
    revoke: (model) =>
      state.accountId === null
        ? Promise.resolve(null)
        : runConsentCommand({ type: 'account.consent.revoke', id: state.accountId, model }, false),
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
