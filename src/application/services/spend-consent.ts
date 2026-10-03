// P-40 spend consent, shared by executeRun and the account test.
import type { AccountId, Billing } from '../../domain/index';
import { billingFromPools } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';
import { catalogOrEmpty, matchIdFor } from './match-id';

/** The account-level consent marker: the user allowed the route's own default model (P-40). */
export const DEFAULT_MODEL_CONSENT = '*';

/** An unpinned route runs the CLI's default model, whose billing the catalog cannot name. The
 *  route kind fixes it when it knows (`defaultBilling`); only a subscription rides a plan, and
 *  every other auth mode is `unknown` — never `metered`, which would claim a verified charge (P-51).
 *  Both still need consent and a cap. */
export const defaultBillingOf = (
  capabilities: Pick<AppDeps, 'capabilities'>['capabilities'],
  account: AccountRecord | undefined,
): Billing => {
  const routeId =
    account === undefined
      ? undefined
      : capabilities.routeKindOf({ provider: account.provider, authMode: account.authMode, routeKind: account.routeKind });
  const fixed = routeId === undefined ? undefined : capabilities.routeKind(routeId)?.defaultBilling;
  if (fixed !== undefined) return fixed;
  return account?.authMode === 'subscription' ? 'included' : 'unknown';
};

/** P-40: a run whose model may spend real money starts only with the user's recorded consent and
 *  a spend cap on the account. The refusal happens before any write, so every store reads back
 *  exactly as it was. A pinned model the catalog does not list counts as `unknown`, which is never
 *  assumed to be free — though the account's own quota reading can settle it: an allowance bucket
 *  scoped to the model proves the plan covers it (`billingFromPools`). An unpinned route is gated
 *  by its default billing, consented through the account-level marker. */
export const spendConsentSatisfied = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  accountId: AccountId,
  model: string | undefined,
): Promise<boolean> => {
  const account = await deps.accounts.get(accountId);
  const catalog = model !== undefined ? await catalogOrEmpty(() => deps.modelCatalog.list(accountId)) : [];
  const billing: Billing =
    model !== undefined
      ? billingFromPools(
          catalog.find((candidate) => candidate.id === model)?.billing ?? 'unknown',
          matchIdFor(catalog, model),
          await deps.accounts.pools(accountId),
        )
      : defaultBillingOf(deps.capabilities, account);
  if (billing === 'included') return true;
  const consented = account?.consentedModels?.includes(model ?? DEFAULT_MODEL_CONSENT) ?? false;
  return consented && (account?.caps.length ?? 0) > 0;
};
