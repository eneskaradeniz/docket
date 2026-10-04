// use-cases/account-adoption.ts — turns a discovered candidate into an account (P-33). The command
// names a source path and a label only; the candidate is re-found by a fresh scan so no client
// claim about its kind is ever trusted. A token travels one way, from the importer into the vault,
// and only for a compatible-endpoint candidate when the caller asked for the import.
import { err, ok, type AccountId, type Actor, type Result } from '../../domain/index';

import type { AccountCandidate, AccountDiscovery, AccountRecord, AppDeps, CredentialImporter } from '../ports';

import { saveAccount } from './accounts';

export type AdoptError =
  | 'not_found'
  | 'already_added'
  | 'secret_without_ref'
  | 'invalid_endpoint'
  | 'endpoint_mismatch'
  | 'identity_dir_not_allowed'
  | 'invalid_reserve';

export type AdoptDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets' | 'capabilities' | 'accountTests'> & {
  readonly discovery: AccountDiscovery;
  readonly importer: CredentialImporter;
};

/** Session cache over the scan: the candidates list is read often and the scan touches the disk. */
export interface AccountCandidateList {
  get(options?: { readonly refresh?: boolean }): Promise<readonly AccountCandidate[]>;
  invalidate(): void;
}

export function createAccountCandidateList(discovery: AccountDiscovery): AccountCandidateList {
  let cached: Promise<readonly AccountCandidate[]> | undefined;
  return {
    get: (options) => {
      if (cached === undefined || options?.refresh === true) cached = discovery.scan();
      const pending = cached;
      // A failed scan must not stick for the whole session.
      pending.catch(() => {
        if (cached === pending) cached = undefined;
      });
      return pending;
    },
    invalidate: () => {
      cached = undefined;
    },
  };
}

export async function adoptAccountCandidate(
  deps: AdoptDeps,
  input: { readonly sourcePath: string; readonly label: string; readonly importToken?: boolean; readonly actor: Actor },
): Promise<Result<AccountId, AdoptError>> {
  const candidate = (await deps.discovery.scan()).find((entry) => entry.sourcePath === input.sourcePath);
  if (candidate === undefined) return err('not_found');
  if (candidate.alreadyAdded) return err('already_added');

  // A candidate names its provider; the route kind must still exist in the registry.
  if (deps.capabilities.routeKind(candidate.routeKind) === undefined) return err('not_found');
  const providerId = candidate.provider;

  const id = deps.ids.next<'account'>();
  const isMachineLogin = candidate.kind === 'machine_login';
  const isEndpoint = candidate.kind === 'compatible_endpoint' && candidate.endpointHost !== undefined;
  const record: AccountRecord = isMachineLogin
    ? {
        // The CLI's own login on this machine: no identityDir, endpoint or secret.
        id,
        provider: providerId,
        label: input.label,
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [],
        routeKind: candidate.routeKind,
      }
    : isEndpoint
    ? {
        id,
        provider: providerId,
        label: input.label,
        authMode: 'api_key',
        limitPolicy: 'wait_resume',
        caps: [],
        routeKind: candidate.routeKind,
        endpoint: `https://${candidate.endpointHost}`,
        secretRef: `account/${id}/api-key`,
      }
    : {
        id,
        provider: providerId,
        label: input.label,
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [],
        routeKind: candidate.routeKind,
        // The login stays in the user's directory; the account only points at it.
        identityDir: candidate.sourcePath,
      };

  let token: string | undefined;
  if (isEndpoint && input.importToken === true) {
    try {
      token = await deps.importer.readEndpointToken(candidate.sourcePath);
    } catch {
      // The failure text is dropped on purpose: the account is created without a secret and
      // reports not_logged_in until the user supplies one.
      token = undefined;
    }
  }

  const saved = await saveAccount(deps, { record, ...(token !== undefined ? { secret: token } : {}), actor: input.actor });
  if (!saved.ok) return err(saved.error);

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'account.adopted',
    subject: { kind: 'account', id },
    detail: { displayPath: candidate.displayPath },
  });
  return ok(id);
}
