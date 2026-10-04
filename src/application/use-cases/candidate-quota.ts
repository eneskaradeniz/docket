// previewCandidateQuota — the quota a discovered account would show, read before it is adopted
// (A-82, P-50). Nothing is stored: the readings become pools and meters with synthetic ids that
// exist only in the answer. Results are cached per source path so reopening the list does not
// poll the CLI again within a minute.
import type { EpochMs, Meter, Pool, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps, QuotaProbeError, QuotaProbeResolver } from '../ports';

import type { AccountCandidateList } from './account-adoption';

export const CANDIDATE_QUOTA_CACHE_MS = 60_000;

export type CandidateQuotaError = QuotaProbeError | 'needs_account' | 'not_found';

export interface CandidateQuota {
  readonly pools: readonly Pool[];
  readonly meters: readonly Meter[];
}

export interface CandidateQuotaPreview {
  preview(sourcePath: string): Promise<Result<CandidateQuota, CandidateQuotaError>>;
}

export function createCandidateQuotaPreview(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'capabilities'>,
  candidates: Pick<AccountCandidateList, 'get'>,
  probes: QuotaProbeResolver,
): CandidateQuotaPreview {
  const cache = new Map<string, { readonly at: EpochMs; readonly result: Result<CandidateQuota, CandidateQuotaError> }>();

  const read = async (sourcePath: string): Promise<Result<CandidateQuota, CandidateQuotaError>> => {
    const candidate = (await candidates.get()).find((entry) => entry.sourcePath === sourcePath);
    if (candidate === undefined) return err('not_found');
    // A compatible endpoint is read with its key, which a candidate does not have.
    if (candidate.kind === 'compatible_endpoint') return err('needs_account');

    const providerId = deps.capabilities.routeKind(candidate.routeKind)?.providerId;
    if (providerId === undefined) return err('not_found');
    const probe = probes.forProvider(providerId);
    if (probe === undefined) return err('unknown_provider');

    // A config-directory candidate is the login itself; any other candidate reads the machine login.
    const identityDir = candidate.kind === 'subscription' ? candidate.sourcePath : null;
    const polled = await probe.poll(providerId, null, { accountId: null, identityDir });
    if (!polled.ok) return polled;

    const accountId = deps.ids.next<'account'>();
    const pools = new Map<string, Pool>();
    const meters: Meter[] = [];
    for (const reading of polled.value) {
      const pool: Pool = pools.get(reading.pool.label) ?? {
        id: deps.ids.next<'pool'>(),
        accountId,
        label: reading.pool.label,
        kind: reading.pool.kind,
        appliesTo: reading.pool.appliesTo,
      };
      pools.set(pool.label, pool);
      meters.push({ ...reading.meter, id: deps.ids.next<'meter'>(), poolId: pool.id });
    }
    return ok({ pools: [...pools.values()], meters });
  };

  return {
    preview: async (sourcePath) => {
      const cached = cache.get(sourcePath);
      if (cached !== undefined && deps.clock.now() - cached.at < CANDIDATE_QUOTA_CACHE_MS) return cached.result;
      let result: Result<CandidateQuota, CandidateQuotaError>;
      try {
        result = await read(sourcePath);
      } catch {
        // A scan or probe that throws is a failed read, never a thrown query.
        result = err('probe_failed');
      }
      // An unknown path is not worth remembering: the list may simply be stale.
      if (!(!result.ok && result.error === 'not_found')) cache.set(sourcePath, { at: deps.clock.now(), result });
      return result;
    },
  };
}
