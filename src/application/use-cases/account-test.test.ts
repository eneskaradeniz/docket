// The account test ("Test et") — docs/v2/application.md A-68 … A-74, driven over the port fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AccountId,
  type AgentEvent,
  type EpochMs,
  type ProjectSlug,
  type RepoSlug,
  type Result,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import type { AccountRecord, AgentTransport, AppDeps, RunHandle, RunRepo, TransportError } from '../ports';
import {
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeScratchDirs,
  createFakeTransport,
  createFakeTransportResolver,
  type FakeEventLog,
  type FakeScratchDirs,
  type FakeTransportResolver,
} from '../ports/fakes';

import { ACCOUNT_TEST_ROLE, ACCOUNT_TEST_TIMEOUT_MS, testAccount } from './account-test';
import { removeAccount, saveAccount } from './accounts';

// --- fixtures ---------------------------------------------------------------------------------------

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const T0: EpochMs = 1_760_000_000_000;

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-a',
  label: 'Work account',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const DAY_CAP: AccountRecord['caps'][number] = { scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } };

const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit' = 'completed'): AgentEvent => ({ type: 'finished', at: T0, reason });
const usage = (costUsd?: number): AgentEvent => ({
  type: 'usage', at: T0, inputTokens: 5, outputTokens: 2, ...(costUsd === undefined ? {} : { costUsd }),
});

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
  readonly scratch: FakeScratchDirs;
  readonly resolver: FakeTransportResolver;
  readonly runCalls: string[];
}

const makeHarness = (overrides: Partial<AppDeps> = {}): Harness => {
  const log = createFakeEventLog();
  const scratch = createFakeScratchDirs();
  const resolver = createFakeTransportResolver();
  const runCalls: string[] = [];
  // Any touch of the run repository is a bug: a test is not a run.
  const runs = new Proxy({} as RunRepo, {
    get: (_target, name) => () => {
      runCalls.push(String(name));
      throw new Error(`RunRepo.${String(name)} must not be called by the account test`);
    },
  });
  const deps = createFakeDeps({ clock: createFakeClock(T0), log, scratch, transports: resolver, runs, ...overrides });
  return { deps, log, scratch, resolver, runCalls };
};

const seed = async (h: Harness, record: AccountRecord = accountRecord(), script: readonly AgentEvent[] = [finished()]) => {
  await h.deps.accounts.save(record);
  const transport = createFakeTransport(script);
  h.resolver.register(record.id, transport);
  return transport;
};

const FIELD = <T,>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
};

afterEach(() => {
  vi.useRealTimers();
});

// --- A-68 -------------------------------------------------------------------------------------------

describe('testAccount refusals', () => {
  const expectUntouched = async (h: Harness, transport?: ReturnType<typeof createFakeTransport>): Promise<void> => {
    expect(await h.deps.accountTests.get(ACCOUNT)).toBeUndefined();
    expect(h.log.entries()).toEqual([]);
    expect(h.scratch.created()).toEqual([]);
    expect(await h.deps.accounts.spend({ from: 0, to: Number.MAX_SAFE_INTEGER })).toBe(0);
    if (transport !== undefined) expect(transport.requests()).toEqual([]);
  };

  it('A-68: an unknown account is not_found and nothing is written', async () => {
    const h = makeHarness();
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'not_found' });
    await expectUntouched(h);
  });

  it('A-68: a stored running record is busy, the record stays as it was and nothing is audited', async () => {
    const h = makeHarness();
    const transport = await seed(h);
    await h.deps.accountTests.save({ accountId: ACCOUNT, model: null, state: 'running', startedAt: T0 });
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'busy' });
    expect(await h.deps.accountTests.get(ACCOUNT)).toEqual({ accountId: ACCOUNT, model: null, state: 'running', startedAt: T0 });
    expect(h.log.entries()).toEqual([]);
    expect(h.scratch.created()).toEqual([]);
    expect(transport.requests()).toEqual([]);
  });

  it('A-68: an account without a transport is unsupported', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(accountRecord());
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'unsupported' });
    await expectUntouched(h);
  });

  it('A-68: a metered default model without consent is needs_spend_consent (P-40)', async () => {
    const h = makeHarness();
    const transport = await seed(h, accountRecord({ authMode: 'api_key', caps: [DAY_CAP] }));
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'needs_spend_consent' });
    await expectUntouched(h, transport);
  });

  it('A-68: a consented metered model without a cap is still needs_spend_consent', async () => {
    const h = makeHarness();
    const transport = await seed(h, accountRecord({ authMode: 'api_key', consentedModels: ['*'] }));
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'needs_spend_consent' });
    await expectUntouched(h, transport);
  });

  it('A-68: a consented metered model with a cap runs', async () => {
    const h = makeHarness();
    await seed(h, accountRecord({ authMode: 'api_key', consentedModels: ['*'], caps: [DAY_CAP] }));
    expect((await testAccount(h.deps, { id: ACCOUNT })).ok).toBe(true);
  });

  it('A-68: spend at the account cap inside the A-20 window is spend_cap_reached', async () => {
    const h = makeHarness();
    const transport = await seed(h, accountRecord({ caps: [DAY_CAP] }));
    await h.deps.accounts.recordSpend({ kind: 'account_test', accountId: ACCOUNT, at: T0, usd: 5 });
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'spend_cap_reached' });
    expect(await h.deps.accountTests.get(ACCOUNT)).toBeUndefined();
    expect(h.log.entries()).toEqual([]);
    expect(h.scratch.created()).toEqual([]);
    expect(transport.requests()).toEqual([]);
  });

  it('A-68: spend from before the day window does not block', async () => {
    const h = makeHarness();
    await seed(h, accountRecord({ caps: [DAY_CAP] }));
    await h.deps.accounts.recordSpend({ kind: 'account_test', accountId: ACCOUNT, at: T0 - 3 * 86_400_000, usd: 50 });
    expect((await testAccount(h.deps, { id: ACCOUNT })).ok).toBe(true);
  });

  it('A-68: the checks run in order — not_found, busy, unsupported, consent, cap', async () => {
    const h = makeHarness();
    // Everything wrong at once: busy wins over unsupported, consent and cap.
    await h.deps.accounts.save(accountRecord({ authMode: 'api_key', caps: [DAY_CAP] }));
    await h.deps.accountTests.save({ accountId: ACCOUNT, model: null, state: 'running', startedAt: T0 });
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'busy' });
    await h.deps.accountTests.clear(ACCOUNT);
    // No transport: unsupported wins over consent.
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'unsupported' });
    h.resolver.register(ACCOUNT, createFakeTransport([finished()]));
    // Not consented: consent wins over the cap.
    await h.deps.accounts.recordSpend({ kind: 'account_test', accountId: ACCOUNT, at: T0, usd: 99 });
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'needs_spend_consent' });
  });
});

// --- A-69 -------------------------------------------------------------------------------------------

describe('testAccount run', () => {
  it('A-69: the request is the fixed prompt in a scratch dir with no tools, no effort, and a running record exists while it runs', async () => {
    const h = makeHarness();
    let seenWhileRunning: unknown;
    const inner = createFakeTransport([finished()]);
    const spying: AgentTransport = {
      start: async (request) => {
        seenWhileRunning = await h.deps.accountTests.get(ACCOUNT);
        return inner.start(request);
      },
    };
    // A pinned model the catalog does not list is unverified: consent and a cap let it through (P-40).
    await h.deps.accounts.save(accountRecord({ consentedModels: ['model-x'], caps: [DAY_CAP] }));
    h.resolver.register(ACCOUNT, spying);

    await testAccount(h.deps, { id: ACCOUNT, model: 'model-x' });

    expect(seenWhileRunning).toEqual({ accountId: ACCOUNT, model: 'model-x', state: 'running', startedAt: T0 });
    const [request] = inner.requests();
    expect(request).toMatchObject({
      cwd: '/scratch/account-test-1',
      role: ACCOUNT_TEST_ROLE,
      route: { accountId: ACCOUNT, model: 'model-x' },
      prompt: 'Reply with the single word OK. Do not use any tools.',
      capabilities: [],
    });
    expect(request).not.toHaveProperty('effort');
    expect(request).not.toHaveProperty('resume');
    expect(ACCOUNT_TEST_ROLE).toMatchObject({ id: 'account-test', name: 'Account test', writeScope: { kind: 'none' }, capabilities: [], active: true });
  });

  it('A-69: without a model the route carries none and the record says null', async () => {
    const h = makeHarness();
    const transport = await seed(h);
    await testAccount(h.deps, { id: ACCOUNT });
    expect(transport.requests()[0]?.route).toEqual({ accountId: ACCOUNT });
    expect((await h.deps.accountTests.get(ACCOUNT))?.model).toBeNull();
  });

  it('A-69: every permission ask is answered deny, and no run-repo call is made', async () => {
    const h = makeHarness();
    const transport = await seed(h, accountRecord(), [
      { type: 'permission_ask', at: T0, id: 'ask-1', tool: 'Bash', options: ['allow', 'deny'] },
      { type: 'permission_ask', at: T0, id: 'ask-2', tool: 'Write', options: ['allow', 'deny'] },
      finished(),
    ]);
    const result = await testAccount(h.deps, { id: ACCOUNT });
    expect(result.ok).toBe(true);
    expect(transport.answers()).toEqual([
      { askId: 'ask-1', decision: 'deny' },
      { askId: 'ask-2', decision: 'deny' },
    ]);
    expect(h.runCalls).toEqual([]);
  });

  it('A-69: the deadline stops the run and the outcome is a network timeout', async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    let stops = 0;
    const hanging: AgentTransport = {
      start: async (): Promise<Result<RunHandle, TransportError>> => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          ok: true,
          value: {
            events: (async function* (): AsyncGenerator<AgentEvent, void> {
              await gate;
            })(),
            answerPermission: () => undefined,
            steer: () => undefined,
            stop: async () => {
              stops += 1;
              release();
            },
          },
        };
      },
    };
    await h.deps.accounts.save(accountRecord());
    h.resolver.register(ACCOUNT, hanging);

    const pending = testAccount(h.deps, { id: ACCOUNT });
    await vi.advanceTimersByTimeAsync(ACCOUNT_TEST_TIMEOUT_MS - 1);
    expect((await h.deps.accountTests.get(ACCOUNT))?.state).toBe('running');
    expect(stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(stops).toBe(1);
    expect(FIELD(result)).toMatchObject({ state: 'failed', class: 'network', detail: 'timeout' });
    expect(h.scratch.disposed()).toEqual(h.scratch.created());
  });

  it('A-69: the scratch dir is disposed after a success', async () => {
    const h = makeHarness();
    await seed(h);
    await testAccount(h.deps, { id: ACCOUNT });
    expect(h.scratch.created()).toEqual(['/scratch/account-test-1']);
    expect(h.scratch.disposed()).toEqual(['/scratch/account-test-1']);
  });

  it('A-69: the scratch dir is disposed after a start failure', async () => {
    const h = makeHarness();
    const transport = await seed(h);
    transport.failStart({ code: 'not_installed', message: 'cli missing' });
    const result = await testAccount(h.deps, { id: ACCOUNT });
    expect(FIELD(result)).toMatchObject({ state: 'failed', class: 'install', detail: 'cli missing' });
    expect(h.scratch.disposed()).toEqual(['/scratch/account-test-1']);
  });

  it('A-69: a thrown error saves a failed/unknown record, disposes the scratch dir and propagates', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(accountRecord());
    h.resolver.register(ACCOUNT, {
      start: async () => {
        throw new Error('transport exploded');
      },
    });
    await expect(testAccount(h.deps, { id: ACCOUNT })).rejects.toThrow('transport exploded');
    expect(await h.deps.accountTests.get(ACCOUNT)).toMatchObject({ state: 'failed', class: 'unknown' });
    expect(h.scratch.disposed()).toEqual(['/scratch/account-test-1']);
  });
});

// --- A-70 -------------------------------------------------------------------------------------------

describe('testAccount outcome', () => {
  it('A-70: a completed run saves ok with endedAt, audits account.tested and returns the saved view', async () => {
    const h = makeHarness();
    await seed(h, accountRecord({ consentedModels: ['model-x'], caps: [DAY_CAP] }));
    const result = await testAccount(h.deps, { id: ACCOUNT, model: 'model-x' });
    expect(result).toEqual({ ok: true, value: { state: 'ok', class: null, model: 'model-x', at: T0, detail: null } });
    expect(await h.deps.accountTests.get(ACCOUNT)).toEqual({ accountId: ACCOUNT, model: 'model-x', state: 'ok', startedAt: T0, endedAt: T0 });
    const [entry] = h.log.entries();
    expect(entry).toMatchObject({
      action: 'account.tested',
      subject: { kind: 'account', id: ACCOUNT },
      detail: { model: 'model-x', result: 'ok' },
    });
  });

  it('A-70: a failure is saved with its class and detail; the audit names the class, never the detail', async () => {
    const h = makeHarness();
    await seed(h, accountRecord(), [{ type: 'error', at: T0, class: 'auth', message: 'invalid x-api-key sk-secret-detail' }, finished('failed')]);
    const result = await testAccount(h.deps, { id: ACCOUNT });
    expect(FIELD(result)).toEqual({ state: 'failed', class: 'auth', model: null, at: T0, detail: 'invalid x-api-key sk-secret-detail' });
    const [entry] = h.log.entries();
    expect(entry?.detail).toEqual({ model: '*', result: 'auth' });
    expect(JSON.stringify(entry)).not.toContain('sk-secret-detail');
  });

  it('A-70: a limit hit is class limit with an empty detail', async () => {
    const h = makeHarness();
    await seed(h, accountRecord(), [{ type: 'limit_hit', at: T0, hit: { class: 'window_exhausted', remedies: ['wait'] } }, finished('limit')]);
    expect(FIELD(await testAccount(h.deps, { id: ACCOUNT }))).toMatchObject({ state: 'failed', class: 'limit', detail: '' });
  });

  it('A-70: the endedAt is read after the run, the view time is endedAt', async () => {
    const clock = createFakeClock(T0);
    const h = makeHarness({ clock });
    const inner = createFakeTransport([finished()]);
    await h.deps.accounts.save(accountRecord());
    h.resolver.register(ACCOUNT, { start: async (request) => { clock.advance(1_500); return inner.start(request); } });
    const view = FIELD(await testAccount(h.deps, { id: ACCOUNT }));
    expect(view.at).toBe(T0 + 1_500);
    expect((await h.deps.accountTests.get(ACCOUNT))?.startedAt).toBe(T0);
  });
});

// --- A-71 -------------------------------------------------------------------------------------------

describe('testAccount spend', () => {
  it('A-71: usage with a cost is recorded as account spend; usage without one is not', async () => {
    const h = makeHarness();
    await seed(h, accountRecord(), [usage(0.25), usage(), usage(0.5), finished()]);
    await testAccount(h.deps, { id: ACCOUNT });
    expect(await h.deps.accounts.spend({ accountId: ACCOUNT, from: T0, to: T0 })).toBeCloseTo(0.75);
  });

  it('A-71: an account-filtered spend counts the entry; repo, project and work-order filters do not', async () => {
    const h = makeHarness();
    await seed(h, accountRecord(), [usage(1), finished()]);
    await testAccount(h.deps, { id: ACCOUNT });
    const window = { from: T0 - 1, to: T0 + 1 };
    expect(await h.deps.accounts.spend({ accountId: ACCOUNT, ...window })).toBe(1);
    expect(await h.deps.accounts.spend({ ...window })).toBe(1);
    expect(await h.deps.accounts.spend({ repo: slugOf<'repo'>('docket') as RepoSlug, ...window })).toBe(0);
    expect(await h.deps.accounts.spend({ project: slugOf<'project'>('docket') as ProjectSlug, ...window })).toBe(0);
    expect(await h.deps.accounts.spend({ workOrderId: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV') as WorkOrderId, ...window })).toBe(0);
  });

  it('A-71: the recorded spend counts against the next test through the account cap', async () => {
    const h = makeHarness();
    await seed(h, accountRecord({ caps: [DAY_CAP] }), [usage(5), finished()]);
    expect((await testAccount(h.deps, { id: ACCOUNT })).ok).toBe(true);
    await h.deps.accountTests.clear(ACCOUNT);
    expect(await testAccount(h.deps, { id: ACCOUNT })).toEqual({ ok: false, error: 'spend_cap_reached' });
  });
});

// --- A-73 -------------------------------------------------------------------------------------------

describe('result reset', () => {
  const stored = { accountId: ACCOUNT, model: null, state: 'ok', startedAt: T0, endedAt: T0 } as const;

  const edit = async (h: Harness, change: Partial<AccountRecord>, secret?: string): Promise<void> => {
    const base = accountRecord({ secretRef: 'ref-1' });
    await h.deps.accounts.save(base);
    await h.deps.accountTests.save(stored);
    await saveAccount(h.deps, { record: { ...base, ...change }, ...(secret === undefined ? {} : { secret }), actor: { kind: 'user', id: 'u' } });
  };

  it('A-73: changing routeKind, endpoint, identityDir, tierModels or the secret clears the stored result', async () => {
    const changes: readonly [Partial<AccountRecord>, string?][] = [
      [{ routeKind: 'other-kind' }],
      [{ endpoint: 'https://example.com' }],
      [{ identityDir: '/home/user/.cfg' }],
      [{ tierModels: { strong: 'a', balanced: 'b', fast: 'c' } }],
      [{}, 'new-secret'],
    ];
    for (const [change, secret] of changes) {
      const h = makeHarness();
      await edit(h, change, secret);
      expect(await h.deps.accountTests.get(ACCOUNT)).toBeUndefined();
    }
  });

  it('A-73: a save that changes none of them keeps the result', async () => {
    const h = makeHarness();
    await edit(h, { label: 'Renamed', plan: 'pro' });
    expect(await h.deps.accountTests.get(ACCOUNT)).toEqual(stored);
  });

  it('A-73: removing the account clears the result', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(accountRecord());
    await h.deps.accountTests.save(stored);
    expect((await removeAccount(h.deps, { id: ACCOUNT, actor: { kind: 'user', id: 'u' } })).ok).toBe(true);
    expect(await h.deps.accountTests.get(ACCOUNT)).toBeUndefined();
  });

  it('A-73: a refused removal keeps the result', async () => {
    const h = makeHarness();
    await h.deps.accountTests.save(stored);
    expect(await removeAccount(h.deps, { id: ACCOUNT, actor: { kind: 'user', id: 'u' } })).toEqual({ ok: false, error: 'not_found' });
    expect(await h.deps.accountTests.get(ACCOUNT)).toEqual(stored);
  });
});
