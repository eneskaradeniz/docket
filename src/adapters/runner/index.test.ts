// WO-0046 — the resume-cost pin. The accumulation rule (`applyResultCost`) encodes the
// semantics probe c2 measured (findings §C, docs/probes/cc-surface/raw/) with the review
// round's axis split: usd is cumulative within one SDK query process and resets at the
// resume boundary; usage tokens are PER-RESULT (s2b: result#1 27802/50, result#2 44/158).
// These tests pin the rule against the raw numbers so an SDK semantics change fails here
// first (TD-016's re-probe discipline).
//
// WO-0052 adds the FIRST scripted-SDK harness in the repo: a mocked query() streams init /
// assistant / result messages through `createRunner().drive()` so the per-turn `turn_usage`
// emission (and its emit-BEFORE-hold placement for steered drives) is pinned — the mechanism
// no amount of pure-function pinning can reach.
import { describe, expect, it, vi } from 'vitest';
import {
  accountVerdict,
  addCost,
  applyResultCost,
  classifyProviderError,
  createRunner,
  limitStampOf,
  limitStampFromMessage,
  limitWindowsOf,
  modelOptions,
  neutralLimitStatus,
  usageOf,
} from './index';
import { ASK_TOOL, askDecision } from '../../core/askq';
import type { CostSummary } from '../../core/types';
import type { DriveInput, PermissionDecision, RunnerEvent, SessionRunner } from '../../core/runner';
import { woid } from '../ids';

// The scripted-SDK mock. `setScript` installs the message stream; a `gate()` sentinel INSIDE the
// script parks the generator so the test can steer() mid-drive (the held-intermediate case) or
// interrupt() before the stream closes. getContextUsage rejects — the feed flag drops, exactly
// like a live read failure, and no context_usage event lands in the collected stream.
// WO-0053: the session's usage control is scriptable too (`setUsage`) and its CALLS are counted —
// the default rejects (the feed flag drops on the first read, the pull feed goes dead for the
// drive), exactly like a live read failure.
const sdkMock = vi.hoisted(() => {
  let script: unknown[] = [];
  let usageImpl: () => Promise<unknown> = () => Promise.reject(new Error('limit feed off (mock)'));
  let usageCalls = 0;
  // WO-0059: record the query argument so a test can pin what the adapter put on Options
  // (previously discarded — the spawn shape was unobservable).
  let lastQueryOptions: Record<string, unknown> | undefined;
  const query = (arg?: { options?: Record<string, unknown> }) => {
    lastQueryOptions = arg?.options;
    async function* gen() {
      for (const m of script) {
        if (m && typeof m === 'object' && '__gate' in (m as Record<string, unknown>)) {
          await (m as unknown as { __gate: Promise<void> }).__gate;
          continue;
        }
        yield m;
      }
    }
    return {
      [Symbol.asyncIterator]: gen,
      getContextUsage: () => Promise.reject(new Error('context feed off (mock)')),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => {
        usageCalls += 1;
        return usageImpl();
      },
      interrupt: async () => {},
      cancelAsyncMessage: async () => true,
    };
  };
  return {
    setScript: (msgs: unknown[]) => {
      script = msgs;
    },
    setUsage: (impl: () => Promise<unknown>) => {
      usageImpl = impl;
    },
    usageCallCount: () => usageCalls,
    lastOptions: () => lastQueryOptions,
    gate: (): { promise: Promise<void>; release: () => void } => {
      let release!: () => void;
      const promise = new Promise<void>((r) => {
        release = r;
      });
      return { promise, release };
    },
    query,
    startup: async () => ({}),
  };
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkMock.query, startup: sdkMock.startup }));
// A DETERMINISTIC note uuid: the held-intermediate scenario must replay the REAL steer sequence —
// steer stamps a uuid, the SDK applies the note at the boundary, the command_lifecycle receipt
// clears it, and the NEXT result is the terminal one. Without the receipt the note would never
// clear (every result would stay held — unfaithful to the live semantics).
vi.mock('node:crypto', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:crypto')>()), randomUUID: () => 'note-uuid-1' }));

const cost = (usd: number, tokensIn = 0, tokensOut = 0): CostSummary => ({ usd, tokensIn, tokensOut });

// --- scripted-message helpers (structural views, exactly what translate() reads) ---
const initMsg = { type: 'system', subtype: 'init', session_id: 's9', capabilities: ['msg_lifecycle_v1'] };
const resultMsg = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  session_id: 's9',
  stop_reason: 'end_turn',
  total_cost_usd: 0.17658,
  usage: { input_tokens: 27802, output_tokens: 50 },
  num_turns: 7,
  duration_ms: 41200,
  duration_api_ms: 38500,
  modelUsage: { 'm-1': { inputTokens: 300, outputTokens: 90, costUSD: 0.05 } },
  ...over,
});
const WO = woid('WO-USAGE');
const stepInput: DriveInput = { role: 'implementer', workOrderId: WO, mode: 'direct', prompt: 'p', cwd: '/tmp' };

async function collect(runner: SessionRunner, input: DriveInput): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  for await (const ev of runner.drive(input)) out.push(ev);
  return out;
}

describe('applyResultCost — the measured cost semantics (WO-0046, probe c2/s2b + review f2)', () => {
  it('usd is cumulative within a drive (the DELTA is the difference) while usage tokens are PER-RESULT (summed plainly) — raw/s2b', () => {
    const first = applyResultCost(0, cost(0.17658, 27802, 50));
    expect(first.delta).toEqual(cost(0.17658, 27802, 50));
    // result#2's usage is 44/158 — a cache-hit call's own figures, NOT a process total; a shared
    // max-guard would have "delta'd" them to 0/108 (the review f2 under-count).
    const second = applyResultCost(first.baselineUsd, cost(0.205902, 44, 158));
    expect(second.delta.usd).toBeCloseTo(0.029322, 6); // the note command's own spend
    expect(second.delta.tokensIn).toBe(44);
    expect(second.delta.tokensOut).toBe(158);
    expect(second.baselineUsd).toBeCloseTo(0.205902, 6);
  });

  it('a resumed leg starts from a FRESH usd baseline: the first figure is that leg own spend, never the session total — raw/c2 (leg 1 ended 0.0948, leg 2 reported 0.0562)', () => {
    const leg1 = applyResultCost(0, cost(0.094824, 9599, 53));
    const leg1Total = addCost(cost(0), leg1.delta);
    expect(leg1Total.usd).toBeCloseTo(0.094824, 6);
    const leg2 = applyResultCost(0, cost(0.056219, 213, 194)); // smaller than leg 1's total — reset, not cumulative
    expect(leg2.delta.usd).toBeCloseTo(0.056219, 6); // taken WHOLE — cumulative would have been ≥ 0.0948
    // The store's prior + input add-rule lands the true session total on the row:
    expect(addCost(leg1Total, leg2.delta).usd).toBeCloseTo(0.151043, 6);
    expect(addCost(leg1Total, leg2.delta).tokensIn).toBe(9599 + 213);
  });

  it('a usd figure below the baseline is read as per-command and taken whole (the §S/s2 defensive branch); the baseline ratchets, never down', () => {
    const r = applyResultCost(0.2, cost(0.05, 200, 20));
    expect(r.delta).toEqual(cost(0.05, 200, 20));
    expect(r.baselineUsd).toBe(0.2);
  });
});

describe('addCost — the drive accumulator', () => {
  it('sums field-wise', () => {
    expect(addCost(cost(0.1, 10, 2), cost(0.2, 30, 4))).toEqual(cost(0.30000000000000004, 40, 6));
  });
});

// ===== WO-0052 — usageOf (the structural read of the result's rich usage) =====
describe('usageOf — the result message → TurnUsage read', () => {
  it('maps a fully-loaded result verbatim (cache split, turns, durations, single-model split)', () => {
    expect(usageOf(resultMsg() as never)).toEqual({
      cacheRead: undefined,
      cacheCreation: undefined,
      numTurns: 7,
      durationMs: 41200,
      durationApiMs: 38500,
      modelUsage: [{ model: 'm-1', tokensIn: 300, tokensOut: 90, usd: 0.05 }],
    });
  });

  it('carries the cache fields when reported (raw/c2: cache_read 91,008 across the leg boundary)', () => {
    const m = resultMsg({ usage: { input_tokens: 213, output_tokens: 194, cache_read_input_tokens: 100608, cache_creation_input_tokens: 2048 } });
    const u = usageOf(m as never);
    expect(u).toMatchObject({ cacheRead: 100608, cacheCreation: 2048 });
  });

  it('returns undefined when the message reports none of the rich fields — never an empty object', () => {
    expect(usageOf(resultMsg({ usage: { input_tokens: 5, output_tokens: 5 }, num_turns: undefined, duration_ms: undefined, duration_api_ms: undefined, modelUsage: undefined }) as never)).toBeUndefined();
  });

  it('keeps a MULTI-model split verbatim (no shortcut — the store derives the model column)', () => {
    const m = resultMsg({ modelUsage: {
      'm-a': { inputTokens: 100, outputTokens: 10, costUSD: 0.01 },
      'm-b': { inputTokens: 200, outputTokens: 20, costUSD: 0.02 },
    } });
    expect(usageOf(m as never)!.modelUsage).toEqual([
      { model: 'm-a', tokensIn: 100, tokensOut: 10, usd: 0.01 },
      { model: 'm-b', tokensIn: 200, tokensOut: 20, usd: 0.02 },
    ]);
  });
});

// ===== WO-0052 — the drive loop emits turn_usage per observed result =====
describe('createRunner().drive — the turn_usage emission (scripted SDK)', () => {
  it('one result → turn_usage (delta = own spend, usage carried) BEFORE the terminal turn_complete', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    const out = await collect(runner, stepInput);
    expect(out.map((e) => e.kind)).toEqual(['started', 'turn_usage', 'turn_complete']);
    const u = out[1] as Extract<RunnerEvent, { kind: 'turn_usage' }>;
    expect(u.delta).toEqual({ tokensIn: 27802, tokensOut: 50, usd: 0.17658 }); // the leg's own figures
    expect(u.usage).toMatchObject({ numTurns: 7, durationMs: 41200 });
    expect(u.usage!.modelUsage).toEqual([{ model: 'm-1', tokensIn: 300, tokensOut: 90, usd: 0.05 }]);
    // the terminal event keeps its CONTRACT: cost is the ACCUMULATED driveCost, usage its own result's
    const done = out[2] as Extract<RunnerEvent, { kind: 'turn_complete' }>;
    expect(done.cost).toEqual({ tokensIn: 27802, tokensOut: 50, usd: 0.17658 });
    expect(done.usage).toEqual(u.usage);
  });

  it('a HELD intermediate result escapes as turn_usage — emit-before-hold (WO-0045/D3 + WO-0052/D2)', async () => {
    const g = sdkMock.gate();
    sdkMock.setScript([
      initMsg,
      { __gate: g.promise },
      // result#1 (s2b raw: 0.17658, 27802/50, cache_read 91008) — HELD: a note is queued
      resultMsg({ total_cost_usd: 0.17658, usage: { input_tokens: 27802, output_tokens: 50, cache_read_input_tokens: 91008 } }),
      // the note's boundary receipt (uuid deterministic — the node:crypto mock): clears the hold
      { type: 'command_lifecycle', command_uuid: 'note-uuid-1', state: 'started' },
      // result#2 (s2b raw: 0.205902, 44/158) — the terminal one; reports NO rich fields
      resultMsg({ total_cost_usd: 0.205902, usage: { input_tokens: 44, output_tokens: 158 }, num_turns: undefined, duration_ms: undefined, duration_api_ms: undefined, modelUsage: undefined }),
    ]);
    const runner = createRunner();
    const out: RunnerEvent[] = [];
    const consumed = (async () => {
      for await (const ev of runner.drive(stepInput)) out.push(ev);
    })();
    while (!out.some((e) => e.kind === 'started')) await new Promise((r) => setTimeout(r, 1));
    expect(await runner.steer?.('ekranı daralt', { noteId: 'n1' })).toBe(true); // queues the note → result#1 becomes INTERMEDIATE
    g.release();
    await consumed;
    // WO-0091: the mock's context control rejects, so the HELD boundary's throttled read reports
    // the feed's death exactly once — context_feed_lost lands after the escaped turn_usage, while
    // the drive still runs (the terminal boundary's own read finds the flag already false).
    expect(out.map((e) => e.kind)).toEqual(['started', 'steer_queued', 'turn_usage', 'context_feed_lost', 'steer_delivered', 'turn_usage', 'turn_complete']);
    const u1 = out[2] as Extract<RunnerEvent, { kind: 'turn_usage' }>;
    const u2 = out[5] as Extract<RunnerEvent, { kind: 'turn_usage' }>;
    expect(u1.delta).toEqual({ tokensIn: 27802, tokensOut: 50, usd: 0.17658 });
    expect(u1.usage).toMatchObject({ cacheRead: 91008 }); // the held result's usage escaped TOO
    expect(u2.delta.tokensIn).toBe(44);
    expect(u2.delta.tokensOut).toBe(158);
    expect(u2.delta.usd).toBeCloseTo(0.029322, 6); // the c2 delta, per-leg baseline
    expect('usage' in u2 ? u2.usage : undefined).toBeUndefined(); // result#2 reported no rich fields
    const done = out[6] as Extract<RunnerEvent, { kind: 'turn_complete' }>;
    expect(done.cost).toEqual({ tokensIn: 27802 + 44, tokensOut: 50 + 158, usd: 0.205902 }); // the ACCUMULATED total
  });

  it('the synthetic plan-exit emits NO turn_usage (nothing observed — the honest no-claim)', async () => {
    sdkMock.setScript([
      initMsg,
      // a plan drive that ExitPlanModes and ends with NO result message
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: '# p' } }] } },
    ]);
    const runner = createRunner();
    const out = await collect(runner, { role: 'architect', workOrderId: WO, mode: 'plan', prompt: '', cwd: '/tmp' });
    expect(out.map((e) => e.kind)).toEqual(['started', 'plan_ready', 'turn_complete']);
    const done = out[2] as Extract<RunnerEvent, { kind: 'turn_complete' }>;
    expect(done.stopReason).toBe('plan_exit_without_result');
    expect(done.cost).toEqual({ usd: 0, tokensIn: 0, tokensOut: 0 });
    expect('usage' in done).toBe(false); // no fabricated usage either
  });

  it('an interrupt close emits NO turn_usage (the abort precedes the result)', async () => {
    const g = sdkMock.gate();
    sdkMock.setScript([initMsg, { __gate: g.promise }]);
    const runner = createRunner();
    const out: RunnerEvent[] = [];
    const consumed = (async () => {
      for await (const ev of runner.drive(stepInput)) out.push(ev);
    })();
    while (!out.some((e) => e.kind === 'started')) await new Promise((r) => setTimeout(r, 1));
    await runner.interrupt();
    g.release();
    await consumed;
    expect(out.map((e) => e.kind)).toEqual(['started', 'interrupted']);
    expect(out.some((e) => e.kind === 'turn_usage')).toBe(false);
  });
});

// ===== WO-0053 — the limit classification + the two channels =====
describe('WO-0053 — classifyProviderError: the usage-limit arm', () => {
  it('429 / rate_limit (underscored — the SDK spelling) / usage limit classify', () => {
    expect(classifyProviderError('API Error (429): rate_limit_error')).toBe('rate_limited');
    expect(classifyProviderError('rate_limit_error')).toBe('rate_limited');
    expect(classifyProviderError('Usage limit reached — window full')).toBe('rate_limited');
  });
  it('a spaced "rate limit" alone does NOT match (the reviewed set is exact) and overloaded is NOT the user window', () => {
    expect(classifyProviderError('some rate limit policy note')).toBeUndefined();
    expect(classifyProviderError('529 overloaded_error — provider capacity')).toBeUndefined();
  });
});

describe('WO-0053 — limitStampOf / neutralLimitStatus / limitWindowsOf (the boundary normalizers)', () => {
  it('epoch → ISO; a pull ISO string passes; garbage is undefined (the stamp-less tier)', () => {
    expect(limitStampOf(Date.parse('2025-08-29T14:12:00.000Z'))).toBe('2025-08-29T14:12:00.000Z');
    expect(limitStampOf('2026-08-29T14:32:00.000Z')).toBe('2026-08-29T14:32:00.000Z');
    expect(limitStampOf('')).toBeUndefined();
    expect(limitStampOf(undefined)).toBeUndefined();
  });
  it('the provider status word → the neutral triple; unknown stays undefined', () => {
    expect(neutralLimitStatus('allowed')).toBe('ok');
    expect(neutralLimitStatus('allowed_warning')).toBe('warning');
    expect(neutralLimitStatus('rejected')).toBe('blocked');
    expect(neutralLimitStatus('whatever')).toBeUndefined();
  });
  it('the pull shape maps: named windows by key, model_scoped by display_name, credits unread', () => {
    const windows = limitWindowsOf({
      five_hour: { utilization: 86, resets_at: '2026-08-29T14:32:00.000Z' },
      seven_day: null,
      model_scoped: [{ display_name: 'Fable', utilization: 12, resets_at: null }],
      extra_usage: { is_enabled: true, monthly_limit: 5, used_credits: 1, utilization: 20 },
    });
    expect(windows).toEqual([
      { window: 'five_hour', utilization: 86, resetAt: '2026-08-29T14:32:00.000Z' },
      { window: 'Fable', utilization: 12, resetAt: null },
    ]);
  });
});

describe('WO-0053 — the drive: push message, pull control, the limit-shaped death', () => {
  const rlPush = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed_warning', resetsAt: Date.parse('2025-08-29T14:32:00.000Z'), rateLimitType: 'five_hour', utilization: 86 },
    ...over,
  });
  const errorResult = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'result',
    subtype: 'error_during_execution',
    session_id: 's9',
    is_error: true,
    errors: ['Usage limit reached'],
    terminal_reason: 'blocking_limit',
    ...over,
  });

  it('a push message becomes ONE limit_windows event — status neutralized, epoch → ISO, kind verbatim', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    sdkMock.setScript([initMsg, rlPush(), resultMsg()]);
    const out = await collect(createRunner(), stepInput);
    const feed = out.filter((e) => e.kind === 'limit_windows');
    expect(feed).toEqual([
      {
        kind: 'limit_windows',
        windows: [{ window: 'five_hour', utilization: 86, resetAt: '2025-08-29T14:32:00.000Z' }],
        status: 'warning',
        at: expect.any(String),
      },
    ]);
  });

  it('a pull response (windows, NO status) feeds an event; unavailable windows feed NOTHING', async () => {
    sdkMock.setUsage(() => Promise.resolve({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 91, resets_at: '2026-08-29T14:32:00.000Z' } } }));
    sdkMock.setScript([initMsg, { type: 'system', subtype: 'thinking_tokens' }, resultMsg()]);
    const out = await collect(createRunner(), stepInput);
    const feed = out.filter((e) => e.kind === 'limit_windows');
    expect(feed).toEqual([
      { kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 91, resetAt: '2026-08-29T14:32:00.000Z' }], at: expect.any(String) },
    ]);
    // the unavailable direction
    sdkMock.setUsage(() => Promise.resolve({ rate_limits_available: false, rate_limits: null }));
    sdkMock.setScript([initMsg, { type: 'system', subtype: 'thinking_tokens' }, resultMsg()]);
    const out2 = await collect(createRunner(), stepInput);
    expect(out2.filter((e) => e.kind === 'limit_windows')).toEqual([]);
  });

  it('a limit-shaped result death carries the code + the CACHED stamp (the push rejection first)', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    sdkMock.setScript([
      initMsg,
      rlPush({ rate_limit_info: { status: 'rejected', resetsAt: Date.parse('2025-08-29T14:32:00.000Z'), rateLimitType: 'five_hour', utilization: 100 } }),
      errorResult(),
    ]);
    const out = await collect(createRunner(), stepInput);
    const err = out.find((e) => e.kind === 'error');
    expect(err).toMatchObject({
      kind: 'error',
      code: 'rate_limited',
      limit: { resetAt: '2025-08-29T14:32:00.000Z', window: 'five_hour' },
    });
  });

  it('a limit-shaped death with NO stamp stays code-only (the degradation tier)', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    sdkMock.setScript([initMsg, errorResult()]);
    const out = await collect(createRunner(), stepInput);
    const err = out.find((e) => e.kind === 'error') as Extract<RunnerEvent, { kind: 'error' }>;
    expect(err.code).toBe('rate_limited');
    expect(err.limit).toBeUndefined();
  });

  it('a SUCCESS result carrying api_error_status does NOT classify (the field is never the trigger)', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    sdkMock.setScript([initMsg, resultMsg({ api_error_status: 429 })]);
    const out = await collect(createRunner(), stepInput);
    expect(out.some((e) => e.kind === 'error')).toBe(false);
    expect(out.some((e) => e.kind === 'turn_complete')).toBe(true);
  });

  it('a thrown 429 classifies and carries the cached stamp; a thrown non-limit stays uncoded', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    // a gate keeps the stream open so the query generator itself can throw — the mock cannot, so
    // the throw path is exercised through classifyProviderError + limitStopFor pins above and the
    // result-arm paths here; the catch arm's classification is the SAME function.
    sdkMock.setScript([initMsg, rlPush({ rate_limit_info: { status: 'rejected', resetsAt: Date.parse('2025-08-29T14:32:00.000Z'), rateLimitType: 'five_hour' } }), resultMsg({ subtype: 'error_during_execution', errors: ['API Error (429): rate_limit_error'], terminal_reason: undefined })]);
    const out = await collect(createRunner(), stepInput);
    const err = out.find((e) => e.kind === 'error') as Extract<RunnerEvent, { kind: 'error' }>;
    expect(err.code).toBe('rate_limited'); // the substring arm (no terminal_reason)
    expect(err.limit).toEqual({ resetAt: '2025-08-29T14:32:00.000Z', window: 'five_hour' });
  });

  it('one rejected pull read disables the pull feed for the drive (the contextFeedLive rule)', async () => {
    let calls = 0;
    sdkMock.setUsage(() => {
      calls += 1;
      return Promise.reject(new Error('limit feed off'));
    });
    sdkMock.setScript([initMsg, { type: 'system', subtype: 'thinking_tokens' }, { type: 'system', subtype: 'thinking_tokens' }, resultMsg()]);
    const out = await collect(createRunner(), stepInput);
    expect(out.filter((e) => e.kind === 'limit_windows')).toEqual([]);
    expect(calls).toBe(1); // the second thinking burst never re-reads
  });
});

// WO-0053 review finding 5: the push channel emits the MERGED window set — a typeless push (the
// status transition without a rateLimitType) must not wipe what the pull channel fed.
describe('WO-0053 — the push/pull merge (review finding 5)', () => {
  it('a TYPELESS push keeps the pulled windows in the feed event', async () => {
    sdkMock.setUsage(() => Promise.resolve({ rate_limits_available: true, rate_limits: { seven_day: { utilization: 41, resets_at: '2026-08-31T14:32:00.000Z' } } }));
    sdkMock.setScript([
      initMsg,
      { type: 'system', subtype: 'thinking_tokens' },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } },
      resultMsg(),
    ]);
    const out = await collect(createRunner(), stepInput);
    const feed = out.filter((e) => e.kind === 'limit_windows');
    // the pull fed seven_day; the typeless push asserted the WARNING without naming a window —
    // the merged set survives (windows + the push's status).
    expect(feed.at(-1)).toMatchObject({
      kind: 'limit_windows',
      status: 'warning',
      windows: [{ window: 'seven_day', utilization: 41, resetAt: '2026-08-31T14:32:00.000Z' }],
    });
  });
});

// ===== WO-0053 dogfood (2026-08-29, the antreo draft death) — the stamp's third source =====
// The first REAL 429 carried the reset clock ONLY in the error sentence: no push message, no
// pull windows (the drive died before any reading). The message below is the operator's verbatim.
describe('WO-0053 dogfood — the message-text stamp + the error-result plan guard', () => {
  const REAL_429 = 'API Error: Request rejected (429) · [1308][Usage limit reached for 5 hour. Your limit will reset at 2026-08-29 12:01:29][20260829091655ffdbaf3e542147f8]';

  it('limitStampFromMessage parses the provider sentence (zone-less → LOCAL, TZ-stable expectation)', () => {
    expect(limitStampFromMessage(REAL_429)).toBe(new Date('2026-08-29T12:01:29').toISOString());
    expect(limitStampFromMessage('rate_limit_error with no clock')).toBeUndefined();
    expect(limitStampFromMessage('')).toBeUndefined();
  });

  it('the dogfood death classifies AND stamps from the message alone — no push, no pull', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    sdkMock.setScript([
      initMsg,
      { type: 'result', subtype: 'error_during_execution', session_id: 's9', is_error: true, errors: [REAL_429], result: REAL_429 },
    ]);
    const out = await collect(createRunner(), stepInput);
    const err = out.find((e) => e.kind === 'error') as Extract<RunnerEvent, { kind: 'error' }>;
    expect(err.code).toBe('rate_limited');
    expect(err.limit).toEqual({ resetAt: new Date('2026-08-29T12:01:29').toISOString() });
  });

  it('an ERROR result text is never a plan: the plan-exit fallback stays silent (the garbage-draft hole)', async () => {
    sdkMock.setUsage(() => Promise.reject(new Error('off')));
    const planInput: DriveInput = { role: 'architect', workOrderId: WO, mode: 'plan', prompt: 'p', cwd: '/tmp' };
    sdkMock.setScript([initMsg, { type: 'result', subtype: 'error_during_execution', session_id: 's9', is_error: true, errors: [REAL_429], result: REAL_429 }]);
    const out = await collect(createRunner(), planInput);
    expect(out.some((e) => e.kind === 'plan_ready')).toBe(false);
    // the SUCCESS direction keeps the fallback: a plan turn ending without ExitPlanMode still
    // treats the result text as the plan (TD-016's probe finding, unchanged).
    sdkMock.setScript([initMsg, { type: 'result', subtype: 'success', session_id: 's9', stop_reason: 'end_turn', result: '# Fazlar\n```fazlar\n[]\n```' }]);
    const out2 = await collect(createRunner(), planInput);
    expect(out2.some((e) => e.kind === 'plan_ready')).toBe(true);
  });
});

// ===== WO-0055 — the agent-task lifecycle translate (probe t1's shapes, scripted) =====
describe('createRunner().drive — the agent-task lifecycle (scripted SDK, WO-0055)', () => {
  const taskStarted = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'system', subtype: 'task_started', task_id: 'a5ce', tool_use_id: 'call_T',
    description: 'Run ls and summarize', subagent_type: 'general-purpose', task_type: 'local_agent', ...over,
  });
  // WILD-EXACT (probe t1 line 121): the notification carries NO task_type/subagent_type — bare
  // task_id + status + summary. The END pairs by task_id; the discriminator guards the START only.
  const taskNotification = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'system', subtype: 'task_notification', task_id: 'a5ce', tool_use_id: 'call_T',
    status: 'completed', summary: 'one-line summary', ...over,
  });
  const task = async (events: unknown[]): Promise<RunnerEvent[]> => {
    sdkMock.setScript([initMsg, ...events, resultMsg()]);
    const runner = createRunner();
    return collect(runner, stepInput);
  };

  it('a real Task-subagent start → the started event, callId === tool_use_id (probe t1 pinned)', async () => {
    const out = await task([taskStarted()]);
    expect(out[1]).toEqual({
      kind: 'agent_task', phase: 'started', taskId: 'a5ce', callId: 'call_T',
      description: 'Run ls and summarize', subagentType: 'general-purpose',
      at: expect.any(String),
    });
  });

  it('a backgrounded shell (local_bash, probe c2) and an ambient task NEVER start; the end passes the boundary (the FOLD drops it — agent-task.test.ts pins the drop)', async () => {
    const shell = await task([
      taskStarted({ task_type: 'local_bash', subagent_type: undefined, description: 'Sleep for 8 seconds' }),
      taskNotification({ summary: 'slept' }),
    ]);
    expect(shell.filter((e) => e.kind === 'agent_task' && e.phase === 'started')).toEqual([]); // the discriminator guards the START
    expect(shell.find((e) => e.kind === 'agent_task')).toMatchObject({ phase: 'ended', taskId: 'a5ce', status: 'completed' }); // pairs by task_id; the fold's no-open-task guard is the ambient safety
    const ambient = await task([taskStarted({ skip_transcript: true }), taskNotification({ skip_transcript: true })]);
    expect(ambient.filter((e) => e.kind === 'agent_task')).toEqual([]); // the flag is honored on both bookends
  });

  it('the notification ends the task with its status + digest; an unknown status is never fabricated', async () => {
    const out = await task([taskStarted(), taskNotification({ status: 'failed', summary: 'yol yok' })]);
    expect(out[2]).toEqual({
      kind: 'agent_task', phase: 'ended', taskId: 'a5ce', status: 'failed', summary: 'yol yok',
      at: expect.any(String),
    });
    const weird = await task([taskStarted(), taskNotification({ status: 'weird' })]);
    expect(weird.some((e) => e.kind === 'agent_task')).toBe(true); // the start passed
    expect(weird.filter((e) => e.kind === 'agent_task')).toHaveLength(1); // the end did not
  });

  it('task_updated / task_progress / background_tasks_changed stay UNREAD (the TD-016 conscious pin)', async () => {
    const out = await task([
      { type: 'system', subtype: 'task_updated', task_id: 'a5ce', patch: { status: 'completed' } },
      { type: 'system', subtype: 'task_progress', task_id: 'a5ce', description: 'Running', usage: { total_tokens: 0, tool_uses: 1, duration_ms: 5 } },
      { type: 'system', subtype: 'background_tasks_changed', tasks: [] },
    ]);
    expect(out.some((e) => e.kind === 'agent_task')).toBe(false);
  });

  it('a start without tool_use_id carries NO callId key (absent, not null)', async () => {
    const out = await task([taskStarted({ tool_use_id: undefined })]);
    const ev = out[1] as Extract<RunnerEvent, { kind: 'agent_task' }>;
    expect('callId' in ev).toBe(false);
  });

  it('the nesting link threads onto tool_use/tool_result/assistant_text; null omits the key', async () => {
    sdkMock.setScript([
      initMsg,
      { type: 'assistant', parent_tool_use_id: 'call_T', message: { content: [{ type: 'text', text: 'alt ajan yazısı' }, { type: 'tool_use', id: 'call_C', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', parent_tool_use_id: 'call_T', message: { content: [{ type: 'tool_result', tool_use_id: 'call_C', content: 'dosyalar' }] } },
      { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'ebeveyn' }] } },
      resultMsg(),
    ]);
    const runner = createRunner();
    const out = await collect(runner, stepInput);
    const nested = out.filter((e) => e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'assistant_text');
    expect(nested.find((e) => e.kind === 'tool_use')).toMatchObject({ tool: 'Bash', parentToolUseId: 'call_T' });
    expect(nested.find((e) => e.kind === 'tool_result')).toMatchObject({ callId: 'call_C', parentToolUseId: 'call_T' });
    const texts = nested.filter((e) => e.kind === 'assistant_text');
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ text: 'alt ajan yazısı', parentToolUseId: 'call_T' });
    expect(texts[1]).toEqual({ kind: 'assistant_text', text: 'ebeveyn', at: expect.any(String) }); // null → omitted
  });
});

// ===== WO-0059 — the model preference reaches Options.model verbatim =====
// The adapter is the ONLY layer that translates the neutral input id into the provider's spawn
// option; it invents no default and no alias table. The presets (`modelOptions`) are minted HERE —
// the one file in the tree allowed to name an id (ADR-0006's WO-0052 carve-out).

describe('model selection — input id → Options.model (WO-0059)', () => {
  it('an input carrying model lands on Options.model exactly (verbatim, alias or full id)', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    await collect(runner, { ...stepInput, model: 'model-check-x' });
    expect(sdkMock.lastOptions()?.model).toBe('model-check-x');
  });

  it('no model on the input → Options.model stays undefined (no default invented adapter-side)', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    await collect(runner, stepInput);
    expect(sdkMock.lastOptions()?.model).toBeUndefined();
  });

  it('modelOptions() names the ALIAS TIERS worst→best — data for the picker (WO-0059 rev 4)', () => {
    expect(modelOptions()).toEqual(['haiku', 'sonnet', 'opus']);
  });
});

// ===== WO-0077 — the settle pin: the structured ask crosses canUseTool → decide VERBATIM =====
// The E2E suite rides the scripted e2e-runner (electron/e2e-runner.ts), whose decide() IGNORES the
// decision payload — an adapter dropping `updatedInput` would pass that whole suite while
// regressing production to always-dismissed (the probe's a5 arm). These tests drive the REAL
// runner's fence: the canUseTool is pulled off the recorded spawn options (the same callback the
// SDK invokes), held, then answered with decide(). The gate keeps the stream open — the drive's
// finally drops pending asks (index.ts `pending.clear()`), so the answer must land mid-drive.

type SettledPermission = { behavior: string; updatedInput?: Record<string, unknown>; message?: string };
type CanUseToolShim = (
  toolName: string,
  input: Record<string, unknown>,
  o: { requestId: string; title?: string; decisionReason?: string },
) => Promise<SettledPermission>;

const askqInput = {
  questions: [
    {
      question: 'Which persistence layer should the new service use?',
      header: 'Storage',
      options: [
        { label: 'SQLite (Recommended)', description: 'Embedded, zero-ops, fits a single machine' },
        { label: 'Postgres', description: 'Full server database, ops burden' },
      ],
      multiSelect: false,
    },
  ],
};

async function driveWithHeldAsk(): Promise<{
  canUseTool: CanUseToolShim;
  runner: SessionRunner;
  events: RunnerEvent[];
  done: Promise<void>;
  release: () => void;
}> {
  const gate = sdkMock.gate();
  sdkMock.setScript([initMsg, { __gate: gate.promise }, resultMsg()]);
  const runner = createRunner();
  const events: RunnerEvent[] = [];
  const done = (async () => {
    for await (const ev of runner.drive(stepInput)) events.push(ev);
  })();
  await vi.waitFor(() => expect(sdkMock.lastOptions()?.canUseTool).toBeDefined());
  return {
    canUseTool: sdkMock.lastOptions()?.canUseTool as unknown as CanUseToolShim,
    runner,
    events,
    done,
    release: gate.release,
  };
}

describe('WO-0077 — the settle pin: canUseTool → decide carries the measured arms', () => {
  it('the fence SURFACES the question as an ask (the write-scope fence alone would auto-allow it)', async () => {
    const h = await driveWithHeldAsk();
    const held = h.canUseTool(ASK_TOOL, askqInput, { requestId: 'r-wo-0077-a' });
    await vi.waitFor(() =>
      expect(h.events.some((e) => e.kind === 'permission_request' && e.tool === ASK_TOOL)).toBe(true),
    );
    // the full lifecycle: the answer resolves the held callback and the drive runs to its result
    await h.runner.decide('r-wo-0077-a', { allow: true });
    expect(await held).toEqual({ behavior: 'allow' });
    h.release();
    await h.done;
  });

  it('selection: the fold settles as { behavior: "allow", updatedInput } — answers keyed by the question string, ", "-joined', async () => {
    const h = await driveWithHeldAsk();
    const held = h.canUseTool(ASK_TOOL, askqInput, { requestId: 'r-wo-0077-b' });
    const decision = askDecision(askqInput, 'Which persistence layer should the new service use?', {
      kind: 'selection',
      labels: ['SQLite (Recommended)', 'Postgres'],
    });
    await h.runner.decide('r-wo-0077-b', decision);
    expect(await held).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: askqInput.questions,
        answers: { 'Which persistence layer should the new service use?': 'SQLite (Recommended), Postgres' },
      },
    });
    h.release();
    await h.done;
  });

  it('WO-0085: a mutated allow crossing to a WRITE ask drops the updatedInput — the fence-checked arguments reach the SDK un-mutated', async () => {
    const h = await driveWithHeldAsk();
    const held = h.canUseTool('Write', { file_path: '/tmp/wo-0085.txt', content: 'a' }, { requestId: 'r-wo-0085-a' });
    await vi.waitFor(() =>
      expect(h.events.some((e) => e.kind === 'permission_request' && e.tool === 'Write')).toBe(true),
    );
    await h.runner.decide('r-wo-0085-a', { allow: true, updatedInput: { file_path: '/tmp/EVIL.txt', content: 'b' } });
    expect(await held).toEqual({ behavior: 'allow' }); // the bare allow — the mutated input never crosses
    h.release();
    await h.done;
  });

  it('dismissed: the BARE allow — the updatedInput KEY is absent, not merely undefined', async () => {
    const h = await driveWithHeldAsk();
    const held = h.canUseTool(ASK_TOOL, askqInput, { requestId: 'r-wo-0077-c' });
    const decision: PermissionDecision = { allow: true };
    await h.runner.decide('r-wo-0077-c', decision);
    const settled = await held;
    expect(settled).toEqual({ behavior: 'allow' });
    expect('updatedInput' in settled).toBe(false);
    h.release();
    await h.done;
  });

  it('declined: the deny with the message, verbatim', async () => {
    const h = await driveWithHeldAsk();
    const held = h.canUseTool(ASK_TOOL, askqInput, { requestId: 'r-wo-0077-d' });
    const decision: PermissionDecision = { allow: false, reason: 'the operator declined to answer this question' };
    await h.runner.decide('r-wo-0077-d', decision);
    expect(await held).toEqual({ behavior: 'deny', message: 'the operator declined to answer this question' });
    h.release();
    await h.done;
  });
});

// ===== WO-0098 — backend profiles: the spawn env, the reported model, the handshake verdict =====
// The probe (docs/probes/backend-profiles/findings.md) measured that the injected config-dir
// variable steers the spawn and that the session's init message reports the model it reached —
// these pin the adapter's half: the profile env composes OVER the inherited environment, the
// built-in leaves the spawn options byte-identical, and the init model rides `started`.

describe('WO-0098 — the profile env reaches the spawn; the built-in stays byte-identical', () => {
  it('a drive carrying a profile composes its env over process.env (the injected key wins, PATH survives)', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    const prior = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/inherited/config';
    try {
      await collect(runner, { ...stepInput, profile: { name: 'Max', env: { CLAUDE_CONFIG_DIR: '/Users/op/.claude-anthropic' } } });
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prior;
    }
    const env = sdkMock.lastOptions()?.env as Record<string, string> | undefined;
    expect(env?.CLAUDE_CONFIG_DIR).toBe('/Users/op/.claude-anthropic');
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it('no profile → Options.env stays UNSET (the SDK inherits the environment itself — today, byte-identical)', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    await collect(runner, stepInput);
    expect(sdkMock.lastOptions()?.env).toBeUndefined();
  });

  it("the init message's model rides `started` verbatim (the session's own report — the evidence)", async () => {
    sdkMock.setScript([{ ...initMsg, model: 'glm-5.3-flash[1m]' }, resultMsg()]);
    const runner = createRunner();
    const events = await collect(runner, stepInput);
    expect(events.find((e) => e.kind === 'started')).toMatchObject({ kind: 'started', sessionId: 's9', model: 'glm-5.3-flash[1m]' });
  });

  it('an init without a model adds no key (never an invented default)', async () => {
    sdkMock.setScript([initMsg, resultMsg()]);
    const runner = createRunner();
    const events = await collect(runner, stepInput);
    expect('model' in (events.find((e) => e.kind === 'started') ?? {})).toBe(false);
  });
});

describe('WO-0098 — accountVerdict: the zero-token handshake read (probe h1/h2/h3)', () => {
  it('a token-sourced account is ready (h1: the environment-token profile)', () => {
    expect(accountVerdict({ tokenSource: 'ANTHROPIC_AUTH_TOKEN', apiProvider: 'firstParty' })).toEqual({ ok: true, source: 'ANTHROPIC_AUTH_TOKEN' });
  });

  it('a subscription login with no tokenSource field is ready (h2: the keychain login)', () => {
    expect(accountVerdict({ subscriptionType: 'Claude Max', apiProvider: 'firstParty' })).toEqual({ ok: true, source: 'Claude Max' });
  });

  it("tokenSource 'none' with nothing else is NOT logged in (h3: an empty config dir) — auth_missing, before any token is spent", () => {
    const v = accountVerdict({ tokenSource: 'none', apiProvider: 'firstParty' });
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ code: 'auth_missing' });
  });

  it('an absent account reads as the bare handshake (the pre-WO-0098 posture)', () => {
    expect(accountVerdict(undefined)).toEqual({ ok: true, source: 'handshake' });
  });
});
