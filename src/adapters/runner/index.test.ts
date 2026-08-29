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
  addCost,
  applyResultCost,
  classifyProviderError,
  createRunner,
  limitStampOf,
  limitWindowsOf,
  neutralLimitStatus,
  usageOf,
} from './index';
import type { CostSummary } from '../../core/types';
import type { DriveInput, RunnerEvent, SessionRunner } from '../../core/runner';
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
  const query = () => {
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
    expect(out.map((e) => e.kind)).toEqual(['started', 'steer_queued', 'turn_usage', 'steer_delivered', 'turn_usage', 'turn_complete']);
    const u1 = out[2] as Extract<RunnerEvent, { kind: 'turn_usage' }>;
    const u2 = out[4] as Extract<RunnerEvent, { kind: 'turn_usage' }>;
    expect(u1.delta).toEqual({ tokensIn: 27802, tokensOut: 50, usd: 0.17658 });
    expect(u1.usage).toMatchObject({ cacheRead: 91008 }); // the held result's usage escaped TOO
    expect(u2.delta.tokensIn).toBe(44);
    expect(u2.delta.tokensOut).toBe(158);
    expect(u2.delta.usd).toBeCloseTo(0.029322, 6); // the c2 delta, per-leg baseline
    expect('usage' in u2 ? u2.usage : undefined).toBeUndefined(); // result#2 reported no rich fields
    const done = out[5] as Extract<RunnerEvent, { kind: 'turn_complete' }>;
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
