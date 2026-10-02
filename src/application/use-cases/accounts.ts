// use-cases/accounts.ts — exact contract from docs/v2/application.md § 2 (rules A-13, A-14, A-43,
// A-44). Secrets cross this boundary in one direction only: into the vault. A secret is stored
// through SecretVault.put and is never written into a record, an audit entry, or a return value.
import type { Actor, RoleBinding, RoleSlug } from '../../domain/index';
import { err, ok, RESERVE_MAX, type AccountId, type QuotaReserve, type Result } from '../../domain/index';

import type { AccountRecord, AppDeps, BindingScope } from '../ports';

/** The account is still routed to by bindings; removal stays refused until they are rebound. */
export interface BindingExists {
  readonly code: 'binding_exists';
  readonly roles: readonly RoleSlug[];
}

// A-43: `URL` normalises the protocol and host, so a non-https or unparsable endpoint reads invalid
// and a host mismatch compares against the lowercased form the registry data carries.
const httpsUrlOf = (endpoint: string): URL | undefined => {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

// A-43: an identityDir must be absolute wherever the account's CLI may run — a POSIX path, a
// Windows drive path with either separator (drive letter case-insensitive), or a UNC share. The
// application layer has no path module, so this is a pure prefix check on the stored form: no
// normalisation, no existence probe.
const isAbsolutePath = (path: string): boolean =>
  path.startsWith('/') || /^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]/.test(path);

// A-45: a reserve share is a finite number in 0..RESERVE_MAX; NaN and Infinity fail the range test.
const isReserveShare = (value: number | undefined): boolean =>
  value === undefined || (Number.isFinite(value) && value >= 0 && value <= RESERVE_MAX);

const isValidReserve = (reserve: QuotaReserve | undefined): boolean =>
  reserve === undefined || (isReserveShare(reserve.short) && isReserveShare(reserve.long));

export async function saveAccount(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets' | 'capabilities'>,
  input: { readonly record: AccountRecord; readonly secret?: string; readonly actor: Actor },
): Promise<
  Result<void, 'secret_without_ref' | 'invalid_endpoint' | 'endpoint_mismatch' | 'identity_dir_not_allowed' | 'invalid_reserve'>
> {
  const secret = input.secret;
  const secretRef = input.record.secretRef;
  // Everything is validated before anything is written: A-13's ref rule first, then A-43's route
  // fields in the order the contract lists them.
  if (secret !== undefined && secretRef === undefined) return err('secret_without_ref');

  if (input.record.endpoint !== undefined) {
    const url = httpsUrlOf(input.record.endpoint);
    if (url === undefined) return err('invalid_endpoint');
    const routeId = deps.capabilities.routeKindOf({
      provider: input.record.provider,
      authMode: input.record.authMode,
      routeKind: input.record.routeKind,
    });
    const kind = routeId === undefined ? undefined : deps.capabilities.routeKind(routeId);
    const fixedHost = kind?.endpointHost;
    if (fixedHost !== undefined && url.host !== fixedHost.toLowerCase()) return err('endpoint_mismatch');
  }
  if (
    input.record.identityDir !== undefined &&
    (!isAbsolutePath(input.record.identityDir) || input.record.authMode !== 'subscription')
  ) {
    return err('identity_dir_not_allowed');
  }
  if (!isValidReserve(input.record.reserve)) return err('invalid_reserve');

  // The second conjunct is provably true after the guard above; it is what lets the compiler see it.
  if (secret !== undefined && secretRef !== undefined) {
    await deps.secrets.put(secretRef, secret);
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
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets' | 'bindings'>,
  input: { readonly id: AccountId; readonly actor: Actor },
): Promise<Result<void, 'not_found' | BindingExists>> {
  const record = await deps.accounts.get(input.id);
  if (record === undefined) return err('not_found');

  // A binding routing to a removed account would send runs into a dead chain, so the removal is
  // refused while any binding still references the account. The roles name what must be rebound.
  const referencing: RoleSlug[] = [];
  for (const { binding } of await deps.bindings.listAll()) {
    if (!binding.accounts.some((route) => route.accountId === input.id)) continue;
    if (!referencing.includes(binding.role)) referencing.push(binding.role);
  }
  if (referencing.length > 0) return err({ code: 'binding_exists', roles: referencing });

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
