// use-cases/spend-consent.ts — the recorded consent P-40 of docs/v2/provider-capabilities.md § 14
// asks for: a metered or unverified model may run only while the account names it as consented
// and carries at least one spend cap. Model ids are plain targets, never secrets; nothing here
// reads or writes the vault.
import type { Actor } from '../../domain/index';
import { err, ok, type AccountId, type Result } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';

type AccountCap = AccountRecord['caps'][number];

// A cap that cannot cap must never satisfy the consent gate: spendStatus reads amountUsd <= 0 as
// `ok`, so a non-positive amount would pass the gate while stopping nothing.
export const isCapShape = (cap: AccountCap): boolean =>
  cap.cap.amountUsd > 0 && Number.isFinite(cap.cap.amountUsd) &&
  cap.cap.warnPercent >= 1 && cap.cap.warnPercent <= 100 && Number.isFinite(cap.cap.warnPercent);

/** One cap per scope: a grant replaces the entry its scope already holds, keeping the others. */
export const withCap = (caps: readonly AccountCap[], cap: AccountCap): readonly AccountCap[] => {
  const replaced = caps.some((existing) => existing.scope === cap.scope);
  return replaced ? caps.map((existing) => (existing.scope === cap.scope ? cap : existing)) : [...caps, cap];
};

export async function grantSpendConsent(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  input: {
    readonly accountId: AccountId;
    readonly model: string;
    readonly cap?: AccountCap;
    readonly actor: Actor;
  },
): Promise<Result<void, 'not_found' | 'invalid_model' | 'invalid_cap'>> {
  if (input.model === '') return err('invalid_model');
  if (input.cap !== undefined && !isCapShape(input.cap)) return err('invalid_cap');

  const record = await deps.accounts.get(input.accountId);
  if (record === undefined) return err('not_found');

  // A fresh object per write: the stored record is never mutated through the port.
  const consented = record.consentedModels ?? [];
  const granted: AccountRecord = {
    ...record,
    ...(input.cap !== undefined ? { caps: withCap(record.caps, input.cap) } : {}),
    ...(consented.includes(input.model) ? {} : { consentedModels: [...consented, input.model] }),
  };
  await deps.accounts.save(granted);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'account.consent.granted',
    subject: { kind: 'account', id: input.accountId },
    detail: {
      model: input.model,
      ...(input.cap !== undefined
        ? { capScope: input.cap.scope, capAmountUsd: input.cap.cap.amountUsd }
        : {}),
    },
  });
  return ok(undefined);
}

export async function revokeSpendConsent(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  input: { readonly accountId: AccountId; readonly model: string; readonly actor: Actor },
): Promise<Result<void, 'not_found' | 'invalid_model'>> {
  if (input.model === '') return err('invalid_model');

  const record = await deps.accounts.get(input.accountId);
  if (record === undefined) return err('not_found');

  // Revoking the consent says nothing about the caps: they are account-level and outlive every
  // single model's permission.
  const remaining = (record.consentedModels ?? []).filter((model) => model !== input.model);
  await deps.accounts.save({
    ...record,
    ...(record.consentedModels === undefined && remaining.length === 0 ? {} : { consentedModels: remaining }),
  });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'account.consent.revoked',
    subject: { kind: 'account', id: input.accountId },
    detail: { model: input.model },
  });
  return ok(undefined);
}
