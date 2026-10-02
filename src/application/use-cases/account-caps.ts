// use-cases/account-caps.ts — the settings surface's two cap write paths (A-52). A cap is
// upserted per scope or removed; the cap-shape check is the one the consent grant uses, so the
// two paths can never disagree on what a usable cap is.
import type { Actor } from '../../domain/index';
import { err, ok, type AccountId, type Result } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';

import { isCapShape, withCap } from './spend-consent';

type AccountCap = AccountRecord['caps'][number];

const audit = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log'>,
  actor: Actor,
  id: AccountId,
): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor,
    action: 'account.saved',
    subject: { kind: 'account', id },
  });
};

export async function saveAccountCap(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  input: { readonly accountId: AccountId; readonly cap: AccountCap; readonly actor: Actor },
): Promise<Result<void, 'not_found' | 'invalid_cap'>> {
  if (!isCapShape(input.cap)) return err('invalid_cap');
  const record = await deps.accounts.get(input.accountId);
  if (record === undefined) return err('not_found');

  await deps.accounts.save({ ...record, caps: withCap(record.caps, input.cap) });
  await audit(deps, input.actor, input.accountId);
  return ok(undefined);
}

export async function removeAccountCap(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  input: { readonly accountId: AccountId; readonly scope: AccountCap['scope']; readonly actor: Actor },
): Promise<Result<void, 'not_found' | 'cap_required'>> {
  const record = await deps.accounts.get(input.accountId);
  if (record === undefined) return err('not_found');

  const remaining = record.caps.filter((cap) => cap.scope !== input.scope);
  // P-40: consent without a cap refuses every run, so the last cap cannot go while a consent stands.
  if (remaining.length === 0 && (record.consentedModels ?? []).length > 0) return err('cap_required');

  await deps.accounts.save({ ...record, caps: remaining });
  await audit(deps, input.actor, input.accountId);
  return ok(undefined);
}
