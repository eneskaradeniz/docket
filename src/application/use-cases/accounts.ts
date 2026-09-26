// use-cases/accounts.ts — exact contract from docs/v2/application.md § 2 (rules A-13, A-14).
// Secrets cross this boundary in one direction only: into the vault. A secret is stored through
// SecretVault.put and is never written into a record, an audit entry, or a return value.
import type { Actor, RoleBinding } from '../../domain/index';
import { err, ok, type AccountId, type Result } from '../../domain/index';

import type { AccountRecord, AppDeps, BindingScope } from '../ports';

export async function saveAccount(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets'>,
  input: { readonly record: AccountRecord; readonly secret?: string; readonly actor: Actor },
): Promise<Result<void, 'secret_without_ref'>> {
  if (input.secret !== undefined) {
    const ref = input.record.secretRef;
    if (ref === undefined) return err('secret_without_ref');
    await deps.secrets.put(ref, input.secret);
  }
  // The record is stored verbatim — the secret itself lives only behind the ref in the vault.
  await deps.accounts.save(input.record);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'account.saved',
    subject: { kind: 'account', id: input.record.id },
  });
  return ok(undefined);
}

export async function removeAccount(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets'>,
  input: { readonly id: AccountId; readonly actor: Actor },
): Promise<Result<void, 'not_found'>> {
  const record = await deps.accounts.get(input.id);
  if (record === undefined) return err('not_found');

  if (record.secretRef !== undefined) await deps.secrets.remove(record.secretRef);
  await deps.accounts.remove(input.id);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'account.removed',
    subject: { kind: 'account', id: input.id },
  });
  return ok(undefined);
}

export async function saveBinding(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'bindings'>,
  input: { readonly scope: BindingScope; readonly binding: RoleBinding; readonly actor: Actor },
): Promise<Result<void, 'empty_chain'>> {
  if (input.binding.accounts.length === 0) return err('empty_chain');

  await deps.bindings.save(input.scope, input.binding);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'binding.saved',
    subject: { kind: 'binding', role: input.binding.role },
    detail: { role: input.binding.role },
  });
  return ok(undefined);
}
