// previewCandidateQuota tests — rules A-82 and P-50 (docs/v2/application.md, docs/v2/providers.md).
// Probes and the candidate list are scripted; nothing reaches a store.
import { describe, expect, it } from 'vitest';

import { err, ok, type Result } from '../../domain/index';

import type { AccountCandidate, MeterReading, QuotaProbe, QuotaProbeContext, QuotaProbeError, QuotaProbeResolver } from '../ports';
import { createFakeCapabilityCatalog, createFakeClock, createFakeDeps } from '../ports/fakes';

import { CANDIDATE_QUOTA_CACHE_MS, createCandidateQuotaPreview } from './candidate-quota';

const candidate = (overrides: Partial<AccountCandidate>): AccountCandidate => ({
  sourcePath: '/home/u/.claude-a',
  displayPath: '~/.claude-a',
  kind: 'subscription',
  routeKind: 'acme-subscription',
  provider: 'acme',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
  ...overrides,
});

const READING: MeterReading = {
  pool: { label: 'Plan', kind: 'allowance', appliesTo: 'all' },
  meter: { label: '5h', cadence: 'rolling_from_first_use', unit: 'fraction', remaining: 0.4, resetPrecision: 'exact', observedAt: 1_000, source: 'polled' },
};

const TWO_METERS: Result<readonly MeterReading[], QuotaProbeError> = ok([READING, { ...READING, meter: { ...READING.meter, label: 'week' } }]);

const setup = (candidates: readonly AccountCandidate[], answer: Result<readonly MeterReading[], QuotaProbeError> = TWO_METERS) => {
  const contexts: { defId: string; context: QuotaProbeContext }[] = [];
  const probe: QuotaProbe = {
    poll: async (defId, _binPath, context) => {
      contexts.push({ defId, context });
      return answer;
    },
  };
  const probes: QuotaProbeResolver = { forProvider: (defId, routeKind) => (routeKind === undefined && defId === 'acme' ? probe : undefined) };
  const clock = createFakeClock(10_000);
  const deps = createFakeDeps({
    clock,
    capabilities: createFakeCapabilityCatalog([
      { id: 'acme-subscription', provider: 'acme', authMode: 'subscription' },
      { id: 'acme-endpoint', provider: 'acme', authMode: 'api_key', endpointHost: 'api.example.test' },
    ]),
  });
  const scans = { count: 0 };
  const preview = createCandidateQuotaPreview(deps, {
    get: async () => {
      scans.count += 1;
      return candidates;
    },
  }, probes);
  return { preview, contexts, clock, deps, scans };
};

describe('createCandidateQuotaPreview', () => {
  it('A-82: a directory candidate is polled with accountId null and its sourcePath, and nothing is stored', async () => {
    const h = setup([candidate({})]);

    const result = await h.preview.preview('/home/u/.claude-a');

    expect(h.contexts).toEqual([{ defId: 'acme', context: { accountId: null, identityDir: '/home/u/.claude-a' } }]);
    if (!result.ok) throw new Error('the preview must succeed');
    expect(result.value.pools).toHaveLength(1);
    expect(result.value.meters.map((meter) => meter.label)).toEqual(['5h', 'week']);
    // Synthetic ids tie every meter to the one pool, and no store saw a write.
    expect(new Set(result.value.meters.map((meter) => meter.poolId))).toEqual(new Set([result.value.pools[0]?.id]));
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(await h.deps.accounts.pools()).toEqual([]);
    expect(await h.deps.accounts.meters()).toEqual([]);
  });

  it('P-50: a compatible-endpoint candidate needs its key and is not previewed', async () => {
    const h = setup([candidate({ kind: 'compatible_endpoint', routeKind: 'acme-endpoint', endpointHost: 'api.example.test' })]);

    expect(await h.preview.preview('/home/u/.claude-a')).toEqual(err('needs_account'));
    expect(h.contexts).toEqual([]);
  });

  it('A-82: a machine-login candidate is polled with identityDir null, not its opaque key', async () => {
    const h = setup([candidate({ kind: 'machine_login', sourcePath: 'machine-login:acme' })]);

    const result = await h.preview.preview('machine-login:acme');

    expect(result.ok).toBe(true);
    expect(h.contexts).toEqual([{ defId: 'acme', context: { accountId: null, identityDir: null } }]);
  });

  it('A-82: an unknown sourcePath answers not_found and polls nothing', async () => {
    const h = setup([candidate({})]);

    expect(await h.preview.preview('/nowhere')).toEqual(err('not_found'));
    expect(h.contexts).toEqual([]);
  });

  it('A-82: a probe error is returned as its code', async () => {
    const h = setup([candidate({})], err('not_logged_in'));

    expect(await h.preview.preview('/home/u/.claude-a')).toEqual(err('not_logged_in'));
  });

  it('A-82: a result is cached per sourcePath for 60 s, then read again', async () => {
    const h = setup([candidate({}), candidate({ sourcePath: '/home/u/.claude-b' })]);

    await h.preview.preview('/home/u/.claude-a');
    h.clock.advance(CANDIDATE_QUOTA_CACHE_MS - 1);
    await h.preview.preview('/home/u/.claude-a');
    expect(h.contexts).toHaveLength(1);

    await h.preview.preview('/home/u/.claude-b'); // another path has its own entry
    expect(h.contexts).toHaveLength(2);

    h.clock.advance(1);
    await h.preview.preview('/home/u/.claude-a');
    expect(h.contexts).toHaveLength(3);
    expect(CANDIDATE_QUOTA_CACHE_MS).toBe(60_000);
  });
});
