// Operator settings use cases. Today: the dispatcher's concurrency limits (A-105 … A-107); the
// dispatcher reads them again on every tick (A-108), so a save applies without a restart.
import type { AccountId, Actor, DispatchLimits, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';

/** The settings-store key the limits live under. */
export const DISPATCH_LIMITS_KEY = 'dispatch.limits';

export const DEFAULT_DISPATCH_LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

const MAX_GLOBAL = 16;

const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

/** The shape and bounds of a limits value; account existence is checked separately (it needs a port). */
const limitsOf = (value: unknown): DispatchLimits | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { global, perRepo, perAccount } = value as { readonly [key: string]: unknown };
  if (!isCount(global, MAX_GLOBAL) || !isCount(perRepo, global)) return undefined;
  if (typeof perAccount !== 'object' || perAccount === null || Array.isArray(perAccount)) return undefined;
  const entries = Object.entries(perAccount as { readonly [key: string]: unknown });
  const accounts: Record<string, number> = {};
  for (const [id, limit] of entries) {
    if (!isCount(limit, global)) return undefined;
    accounts[id] = limit;
  }
  return { global, perRepo, perAccount: accounts };
};

/** The stored limits, or the defaults when nothing valid is stored — a damaged value must never
 *  stop the dispatcher. */
export async function getDispatchLimits(deps: Pick<AppDeps, 'settings'>): Promise<DispatchLimits> {
  return limitsOf(await deps.settings.get(DISPATCH_LIMITS_KEY)) ?? DEFAULT_DISPATCH_LIMITS;
}

export async function setDispatchLimits(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'settings' | 'accounts'>,
  input: { readonly limits: DispatchLimits; readonly actor: Actor },
): Promise<Result<void, 'invalid_limits' | 'unknown_account'>> {
  const limits = limitsOf(input.limits);
  if (limits === undefined) return err('invalid_limits');
  for (const id of Object.keys(limits.perAccount)) {
    if ((await deps.accounts.get(id as AccountId)) === undefined) return err('unknown_account');
  }

  await deps.settings.set(DISPATCH_LIMITS_KEY, limits);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'settings.dispatch_changed',
    subject: { kind: 'settings', id: 'dispatch' },
    // Numbers only; per-account entries are keyed by the account id (a target, never a credential).
    detail: {
      global: limits.global,
      perRepo: limits.perRepo,
      ...Object.fromEntries(Object.entries(limits.perAccount).map(([id, limit]) => [`account:${id}`, limit])),
    },
  });
  return ok(undefined);
}
