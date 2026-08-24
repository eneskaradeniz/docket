import { describe, expect, it } from 'vitest';
import { askOperatorPolicy, autoAllowPolicy, createPipeline, prepareDriveInput } from '../pipeline';
import { PLAN_EXIT_WITHOUT_RESULT } from '../runner';
import type { SessionStore } from '../session-store';
import type { DriveInput, PermissionDecision, RunnerEvent, SessionRunner } from '../runner';
import type { CostSummary, WorkOrderId } from '../types';

// WO-0023 — the drive loop, tested with a FakeRunner + FakeStore (the codebase's first port fakes). No SDK,
// no SQLite, no agent. This is the testability the loop never had while it lived inline in electron/main.ts.

const WO = 'WO-T' as WorkOrderId;
const ZERO_COST: CostSummary = { tokensIn: 0, tokensOut: 0, usd: 0 };

// --- event script helpers (mirror the inline arrow-const style of runner.test.ts) ---
const started = (id = 's1'): RunnerEvent => ({ kind: 'started', sessionId: id });
const txt = (t: string): RunnerEvent => ({ kind: 'assistant_text', text: t });
const plan = (p: string): RunnerEvent => ({ kind: 'plan_ready', planText: p });
const done = (result?: string): RunnerEvent => ({ kind: 'turn_complete', stopReason: 'end_turn', cost: ZERO_COST, result });
const perm = (requestId = 'r1'): RunnerEvent => ({ kind: 'permission_request', requestId, tool: 'Write', input: {} });
const err = (message: string): RunnerEvent => ({ kind: 'error', message });

// --- drive-input shapes (the three origins: plan / step / review) ---
const planDrive = (over: Partial<DriveInput> = {}): DriveInput => ({ role: 'architect', workOrderId: WO, mode: 'plan', prompt: '', ...over });
const stepDrive = (over: Partial<DriveInput> = {}): DriveInput => ({ role: 'implementer', workOrderId: WO, mode: 'direct', prompt: '', stepIndex: 1, ...over });
const reviewDrive = (over: Partial<DriveInput> = {}): DriveInput => ({ role: 'architect', workOrderId: WO, mode: 'direct', prompt: '', reviewStepIndex: 2, ...over });

/** A scripted runner. On a `permission_request` it creates the decide-latch in the Promise executor BEFORE the
 *  yield (mirroring the real adapter's `pending.set` before `queue.push`), so a prompt decide resolves it. */
function fakeRunner(script: RunnerEvent[]) {
  const decideCalls: Array<[string, PermissionDecision]> = [];
  const drivenInputs: DriveInput[] = [];
  const pending = new Map<string, () => void>();
  const resolved: string[] = []; // WO-0027: ask_resolved is emitted back into the stream, like the real adapter
  const drive = async function* (input: DriveInput): AsyncIterable<RunnerEvent> {
    drivenInputs.push(input);
    const seen = new Set<string>();
    for (const ev of script) {
      if (ev.kind === 'permission_request') {
        if (seen.has(ev.requestId)) continue; // resume replay dedupe
        seen.add(ev.requestId);
        const latch = new Promise<void>((resolve) => pending.set(ev.requestId, resolve));
        yield ev;
        await latch;
        yield { kind: 'ask_resolved', requestId: ev.requestId };
      } else {
        yield ev;
      }
    }
  };
  const runner = {
    drive,
    async decide(requestId: string, decision: PermissionDecision) {
      decideCalls.push([requestId, decision]);
      pending.get(requestId)?.();
      resolved.push(requestId);
    },
    pendingAsks: async () => [],
    async interrupt() {},
    async abort() {},
  } as SessionRunner;
  return { runner, decideCalls, drivenInputs };
}

/** A runner whose drive throws — for the catch-path test. */
function throwingRunner(message: string): { runner: SessionRunner; drivenInputs: DriveInput[] } {
  const drivenInputs: DriveInput[] = [];
  const runner = {
    drive: async function* (input: DriveInput): AsyncIterable<RunnerEvent> {
      drivenInputs.push(input);
      throw new Error(message);
    },
    async decide() {},
    pendingAsks: async () => [],
    async interrupt() {},
    async abort() {},
  } as SessionRunner;
  return { runner, drivenInputs };
}

interface FakeStoreCalls { method: string; args: unknown[] }

/** Records every call; returns scripted prompts. `planApproved` scripts the approval gate (WO-0038). */
function fakeStore(prompts: { architect?: string; step?: { prompt: string; scope?: string }; review?: string }, planApproved = true) {
  const calls: FakeStoreCalls[] = [];
  const store = {
    recordSession: (i: unknown) => calls.push({ method: 'recordSession', args: [i] }),
    recordStep: (id: unknown, idx: unknown, patch: unknown) => calls.push({ method: 'recordStep', args: [id, idx, patch] }),
    recordStepReport: (id: unknown, idx: unknown, role: unknown, body: unknown) => calls.push({ method: 'recordStepReport', args: [id, idx, role, body] }),
    recordStepVerdict: (id: unknown, idx: unknown, verdict: unknown, body: unknown) => calls.push({ method: 'recordStepVerdict', args: [id, idx, verdict, body] }),
    savePendingPlan: (id: unknown, planText: unknown) => calls.push({ method: 'savePendingPlan', args: [id, planText] }),
    architectPromptFor: () => prompts.architect,
    stepPromptFor: () => prompts.step,
    stepReviewPromptFor: () => prompts.review,
    planApprovedFor: () => planApproved,
  } as unknown as SessionStore;
  return { store, calls };
}

async function collect(p: ReturnType<typeof createPipeline>, input: DriveInput): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  for await (const ev of p.drive(input)) out.push(ev);
  return out;
}

const methods = (calls: FakeStoreCalls[]) => calls.map((c) => c.method);
const findCall = (calls: FakeStoreCalls[], m: string) => calls.find((c) => c.method === m);

// ===== prepareDriveInput — prompt/scope selection (the P1-1 fix lives here) =====

describe('prepareDriveInput — prompt selection', () => {
  it('plan drive → architectPromptFor', () => {
    const { store } = fakeStore({ architect: 'plan it' });
    expect(prepareDriveInput(planDrive(), store).prompt).toBe('plan it');
  });
  it('step drive → stepPromptFor (prompt + scope)', () => {
    const { store } = fakeStore({ step: { prompt: 'do step 1', scope: 'app' } });
    const out = prepareDriveInput(stepDrive(), store);
    expect(out.prompt).toBe('do step 1');
    expect(out.scope).toBe('app' as never);
  });
  it('REVIEW drive → stepReviewPromptFor, NOT architectPromptFor (P1-1)', () => {
    const { store } = fakeStore({ architect: 'PLAN (wrong)', review: 'review step 2' });
    expect(prepareDriveInput(reviewDrive(), store).prompt).toBe('review step 2');
  });
  it('a resume/approve drive preserves the provided prompt (never clobbered)', () => {
    const { store } = fakeStore({ architect: 'PLAN (wrong)' });
    expect(prepareDriveInput(planDrive({ resume: 'sess-1', prompt: 'continue' }), store).prompt).toBe('continue');
  });
});

// ===== the plan-approval gate (WO-0038 incident, 2026-08-22) =====
// getWorkOrderSteps deliberately parses plan.md's fence into 'pending' rows BEFORE approval, so a
// host that reaches the pipeline with a step/review drive (a GUI pane's mount auto-drive, the CLI's
// `drive --step`) must be refused HERE — one error event, no runner spawn, no session/step rows.

describe('plan-approval gate — step/review drives refused before approval', () => {
  it('step drive: one error event, the runner never spawns, nothing is recorded', async () => {
    const fr = fakeRunner([started(), txt('should never run'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, false);
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    expect((events[0] as { message: string }).message).toMatch(/plan not approved/);
    expect(fr.drivenInputs).toHaveLength(0);
    expect(methods(fs.calls)).not.toContain('recordStep');
    expect(methods(fs.calls)).not.toContain('recordSession');
  });

  it('review drive: refused the same way', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ review: 'review step 2' }, false);
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, reviewDrive());
    expect(events.map((e) => e.kind)).toEqual(['error']);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('plan and free drives pass with the gate closed (the gate governs step/review only)', async () => {
    const fr = fakeRunner([started(), txt('thinking'), done()]);
    const fs = fakeStore({ architect: 'plan it' }, false);
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, planDrive());
    expect(events.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'turn_complete']);
  });

  it('a step drive passes once the gate is open (the approval moment)', async () => {
    const fr = fakeRunner([started(), txt('working'), done('done body')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, true);
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'turn_complete']);
    expect(methods(fs.calls)).toContain('recordStep');
  });
});

// ===== createPipeline — the drive loop =====

describe('createPipeline — ended_at honesty (2026-08-23 süre şişmesi: the idle wait is not billed)', () => {
  /** A plan-mode drive that HANGS after plan_ready — the real-world shape: the SDK stream awaits an
   *  in-session plan approval Docket never gives (approval is a host action), so the generator stays
   *  open until the operator stops it. The stop used to stamp ended_at = NOW, billing the idle wait
   *  (WO-0001 pilot: 4dk of work, 34dk displayed). ended_at must be the LAST ACTIVITY moment. */
  function hangingPlanRunner() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const runner = {
      drive: async function* (): AsyncIterable<RunnerEvent> {
        yield started('s1');
        yield plan('# P\n\n```steps\n[]\n```');
        await gate; // the plan-mode wait — no further events, ever
      },
      async decide() {},
      pendingAsks: async () => [],
      async interrupt() {},
      async abort() {},
    } as SessionRunner;
    return { runner, release };
  }

  it('a drive interrupted long after its last event records ended_at at the LAST activity, not the stop', async () => {
    const { runner, release } = hangingPlanRunner();
    const { store, calls } = fakeStore({ architect: 'a' });
    const pipe = createPipeline({ runner, store, permission: askOperatorPolicy() });
    const drive = pipe.drive(planDrive()) as AsyncGenerator<RunnerEvent>;
    await drive.next(); // started
    await drive.next(); // plan_ready — the last activity
    await new Promise((r) => setTimeout(r, 40)); // the idle wait (would be billed by the old NOW stamp)
    release(); // the generator ends — the completion guarantee's cleanup record fires
    await drive.next(); // drain: the for-await completes, the finally runs
    const rows = calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { startedAt?: string; endedAt?: string });
    const last = rows.at(-1);
    expect(last?.endedAt).toBeTruthy();
    expect(last?.startedAt).toBeTruthy();
    // The span is the work (~0ms here), NOT the 40ms+ wait: the stamp is the last event's moment.
    expect(Date.parse(last!.endedAt!) - Date.parse(last!.startedAt!)).toBeLessThan(30);
  });

  it('a thrown drive records ended_at at the last activity too (the catch path)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const runner = {
      drive: async function* (): AsyncIterable<RunnerEvent> {
        yield started('s1');
        yield txt('working');
        await gate;
        throw new Error('late blow-up');
      },
      async decide() {},
      pendingAsks: async () => [],
      async interrupt() {},
      async abort() {},
    } as SessionRunner;
    const { store, calls } = fakeStore({ architect: 'a' });
    const pipe = createPipeline({ runner, store, permission: askOperatorPolicy() });
    const drive = pipe.drive(planDrive()) as AsyncGenerator<RunnerEvent>;
    await drive.next();
    await drive.next();
    await new Promise((r) => setTimeout(r, 40));
    release();
    await drive.next(); // the error event; the catch/finally records on the way out
    const rows = calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { startedAt?: string; endedAt?: string });
    const last = rows.at(-1);
    expect(Date.parse(last!.endedAt!) - Date.parse(last!.startedAt!)).toBeLessThan(30);
  });
});

describe('createPipeline — transcript checkpoints (2026-08-23 döküm kaybı: the running fold must live in the ROW)', () => {
  it('every tool_result checkpoints a running row carrying the fold so far — a restart or stop cannot lose it', async () => {
    // The incident: a plan drive that never asks and never completes had ONE record (the empty
    // 'started') — 4dk of tool lines lived only in the pane's memory and vanished on restart/stop.
    const script: RunnerEvent[] = [
      started('s1'),
      txt('referansları okuyorum'),
      { kind: 'tool_use', callId: 'c1', tool: 'Read', input: {} },
      { kind: 'tool_result', callId: 'c1', summary: 'okundu', isError: false },
      plan('# P\n\n```steps\n[]\n```'),
    ];
    const { runner } = fakeRunner(script);
    const { store, calls } = fakeStore({ architect: 'a' });
    await collect(createPipeline({ runner, store, permission: askOperatorPolicy() }), planDrive());
    const rows = calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { status: string; transcript: unknown[] });
    // started (running, empty) → tool_result checkpoint (running, carrying the fold) — BEFORE any
    // terminal record; the row tracked the session mid-drive, not only at its boundaries.
    const checkpoint = rows[1];
    expect(checkpoint?.status).toBe('running');
    expect((checkpoint?.transcript ?? []).length).toBeGreaterThanOrEqual(3); // text + tool_use + tool_result
  });
});

describe('createPipeline — the synthesized plan-exit close records carried cost (2026-08-23 maliyet kaybı)', () => {
  it('a PLAN_EXIT_WITHOUT_RESULT close with a REAL cost records it (the $0 plan bug)', async () => {
    // The adapter now captures cost incrementally; its synthesized close carries the last known
    // cost. The pipeline used to record NO cost for the synthesized stopReason (the honest
    // no-claim rule) — which turned a $1.5 plan into $0.00 when the grace abort beat the result.
    const script: RunnerEvent[] = [
      started('s1'),
      plan('# P\n\n```steps\n[]\n```'),
      { kind: 'turn_complete', stopReason: PLAN_EXIT_WITHOUT_RESULT, cost: { usd: 1.5, tokensIn: 900, tokensOut: 400 } },
    ];
    const { runner } = fakeRunner(script);
    const { store, calls } = fakeStore({ architect: 'a' });
    await collect(createPipeline({ runner, store, permission: askOperatorPolicy() }), planDrive());
    const rows = calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { cost?: CostSummary });
    expect(rows.at(-1)?.cost).toEqual({ usd: 1.5, tokensIn: 900, tokensOut: 400 });
  });

  it('a zero-cost synthesized close still records NO cost (the honest no-claim stands)', async () => {
    const script: RunnerEvent[] = [
      started('s1'),
      plan('# P\n\n```steps\n[]\n```'),
      { kind: 'turn_complete', stopReason: PLAN_EXIT_WITHOUT_RESULT, cost: { usd: 0, tokensIn: 0, tokensOut: 0 } },
    ];
    const { runner } = fakeRunner(script);
    const { store, calls } = fakeStore({ architect: 'a' });
    await collect(createPipeline({ runner, store, permission: askOperatorPolicy() }), planDrive());
    const rows = calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { cost?: CostSummary });
    expect(rows.at(-1)?.cost).toBeUndefined();
  });
});

describe('createPipeline — characterization', () => {
  it('step drive records the step active then the report at turn_complete', async () => {
    const fr = fakeRunner([started(), txt('working'), done('done body')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'turn_complete']);
    expect(fr.drivenInputs[0]!.prompt).toBe('do step 1');
    expect(methods(fs.calls)).toContain('recordStep');
    expect(findCall(fs.calls, 'recordStep')!.args).toEqual([WO, 1, { status: 'active' }]);
    expect(findCall(fs.calls, 'recordStepReport')!.args).toEqual([WO, 1, 'implementer', 'done body']);
  });

  it('plan drive saves the pending plan on plan_ready', async () => {
    const fr = fakeRunner([started(), plan('THE PLAN'), done()]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, planDrive());
    expect(fr.drivenInputs[0]!.prompt).toBe('plan it');
    expect(findCall(fs.calls, 'savePendingPlan')!.args).toEqual([WO, 'THE PLAN']);
  });

  it('turn_complete result preferred over accumulated assistant text for the report body', async () => {
    const fr = fakeRunner([started(), txt('partial'), done('final body')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    expect(findCall(fs.calls, 'recordStepReport')!.args[3]).toBe('final body');
  });

  it('review drive captures a proceed verdict at turn_complete', async () => {
    const fr = fakeRunner([started(), done('review\n\nVERDICT: proceed')]);
    const fs = fakeStore({ review: 'review step 2' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, reviewDrive());
    expect(findCall(fs.calls, 'recordStepVerdict')!.args).toEqual([WO, 2, 'proceed', 'review\n\nVERDICT: proceed']);
  });

  it('an unknown verdict falls back to revise (safe side) and annotates the body', async () => {
    const fr = fakeRunner([started(), done('no verdict line here')]);
    const fs = fakeStore({ review: 'review step 2' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, reviewDrive());
    const c = findCall(fs.calls, 'recordStepVerdict')!;
    expect(c.args[2]).toBe('revise');
    expect(String(c.args[3])).toContain('did not give a clear VERDICT');
  });

  it('a runner-emitted error event is forwarded', async () => {
    const fr = fakeRunner([started(), err('boom')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events.some((e) => e.kind === 'error' && e.message === 'boom')).toBe(true);
  });

  it('a thrown drive yields a synthetic error and records idle', async () => {
    const tr = throwingRunner('sdk died');
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: tr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    // started never fired, so record() is a no-op (no providerSessionId); the error is still yielded.
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('error');
  });
});

describe('createPipeline — P1-1 regression (review does not corrupt plan.md)', () => {
  it('a review drive uses the review prompt and does NOT save a pending plan', async () => {
    const fr = fakeRunner([started(), done('review\n\nVERDICT: proceed')]);
    const fs = fakeStore({ architect: 'PLAN (wrong)', review: 'review step 2' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, reviewDrive());
    expect(fr.drivenInputs[0]!.prompt).toBe('review step 2');
    expect(methods(fs.calls)).not.toContain('savePendingPlan');
    expect(methods(fs.calls)).toContain('recordStepVerdict');
  });
});

describe('createPipeline — permission policy', () => {
  it('autoAllowPolicy resolves internally: runner.decide called, no permission_request yielded', async () => {
    const fr = fakeRunner([started(), perm('r1'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    // no permission_request surfaced (resolved internally) — but the resolution signal still flows (WO-0027)
    expect(events.map((e) => e.kind)).toEqual(['started', 'ask_resolved', 'turn_complete']);
    expect(fr.decideCalls).toEqual([['r1', { allow: true }]]);
  });

  it('askOperatorPolicy defers: the event is yielded, pipeline.decide resolves the hold', async () => {
    const fr = fakeRunner([started(), perm('r1'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: askOperatorPolicy() });
    const events: RunnerEvent[] = [];
    for await (const ev of p.drive(stepDrive())) {
      events.push(ev);
      if (ev.kind === 'permission_request') await p.decide(ev.requestId, { allow: true });
    }
    expect(events.map((e) => e.kind)).toEqual(['started', 'permission_request', 'ask_resolved', 'turn_complete']);
    expect(fr.decideCalls).toEqual([['r1', { allow: true }]]);
  });
});

describe('createPipeline — per-work-order permission rule (WO-0031c)', () => {
  const riskyAsk: RunnerEvent = {
    kind: 'permission_request',
    requestId: 'r-risky',
    tool: 'Write',
    input: { file_path: '.github/workflows/check.yml' },
  };
  const benignAsk: RunnerEvent = {
    kind: 'permission_request',
    requestId: 'r-ok',
    tool: 'Write',
    input: { file_path: 'src/app.ts' },
  };

  it('risky_excluded: a risky ask is DEFERRED (surfaced to the operator)', async () => {
    const fr = fakeRunner([started(), riskyAsk, done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events: RunnerEvent[] = [];
    for await (const ev of p.drive(stepDrive({ permissionRule: 'risky_excluded' }))) {
      events.push(ev);
      if (ev.kind === 'permission_request') await p.decide(ev.requestId, { allow: true });
    }
    expect(events.map((e) => e.kind)).toEqual(['started', 'permission_request', 'ask_resolved', 'turn_complete']);
    expect(fr.decideCalls).toEqual([['r-risky', { allow: true }]]); // the OPERATOR answered, not the policy
  });

  it('risky_excluded: an ordinary in-scope write auto-approves — nothing surfaces', async () => {
    const fr = fakeRunner([started(), benignAsk, done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: askOperatorPolicy() });
    const events = await collect(p, stepDrive({ permissionRule: 'risky_excluded' }));
    expect(events.map((e) => e.kind)).toEqual(['started', 'ask_resolved', 'turn_complete']);
    expect(fr.decideCalls).toEqual([['r-ok', { allow: true }]]);
  });

  it('full_auto resolves every ask internally even under an ask-operator injection', async () => {
    const fr = fakeRunner([started(), riskyAsk, done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: askOperatorPolicy() });
    const events = await collect(p, stepDrive({ permissionRule: 'full_auto' }));
    expect(events.map((e) => e.kind)).toEqual(['started', 'ask_resolved', 'turn_complete']);
  });

  it('ask_every defers even the ordinary write (Her seferinde sor)', async () => {
    const fr = fakeRunner([started(), benignAsk, done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events: RunnerEvent[] = [];
    for await (const ev of p.drive(stepDrive({ permissionRule: 'ask_every' }))) {
      events.push(ev);
      if (ev.kind === 'permission_request') await p.decide(ev.requestId, { allow: false, reason: 'no' });
    }
    expect(events.map((e) => e.kind)).toEqual(['started', 'permission_request', 'ask_resolved', 'turn_complete']);
    expect(fr.decideCalls).toEqual([['r-ok', { allow: false, reason: 'no' }]]);
  });

  it('no rule on the drive → the injected policy governs (tests/scripted runners)', async () => {
    const fr = fakeRunner([started(), benignAsk, done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: askOperatorPolicy() });
    const events: RunnerEvent[] = [];
    for await (const ev of p.drive(stepDrive())) {
      events.push(ev);
      if (ev.kind === 'permission_request') await p.decide(ev.requestId, { allow: true });
    }
    expect(events.map((e) => e.kind)).toEqual(['started', 'permission_request', 'ask_resolved', 'turn_complete']);
  });
});

describe('createPipeline — WO-0026 hardening', () => {
  it('a stream ending WITHOUT turn_complete still records idle (the finally guarantee)', async () => {
    const fr = fakeRunner([started(), txt('yarida kaldi')]); // no turn_complete — the interrupt/crash shape
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const session = fs.calls.filter((c) => c.method === 'recordSession').at(-1)!.args[0] as { status: string };
    expect(session.status).toBe('idle');
  });

  it('threads the folded transcript into every record (persisted checkpoint)', async () => {
    const fr = fakeRunner([started(), txt('merhaba'), done('rapor')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const last = fs.calls.filter((c) => c.method === 'recordSession').at(-1)!.args[0] as { transcript: unknown[] };
    // 2026-08-24: the transcript opens/closes with the session's lifecycle notes (started/done).
    expect(last.transcript).toEqual([
      { speaker: 'note', kind: 'session_started' },
      { speaker: 'assistant', text: 'merhaba' },
      { speaker: 'note', kind: 'session_done' },
    ]);
  });

  it('the synthesized plan-exit turn_complete records NO cost (honest NULL, TD-030)', async () => {
    const synthetic: RunnerEvent = { kind: 'turn_complete', stopReason: PLAN_EXIT_WITHOUT_RESULT, cost: { tokensIn: 0, tokensOut: 0, usd: 0 } };
    const fr = fakeRunner([started(), plan('THE PLAN'), synthetic]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, planDrive());
    const last = fs.calls.filter((c) => c.method === 'recordSession').at(-1)!.args[0] as { cost?: unknown };
    expect(last.cost).toBeUndefined();
  });
});

// WO-0039 stabilization (2026-08-23, "Durdur must never say Oturum çöktü"): the runner's
// `interrupted` event is a terminal, calm close. A stopped STEP stays 'active' (Sürdür resumes
// it — "Rapor kısmi kalır"), so NO report is captured; the session records idle with whatever
// cost the runner could observe.
describe('createPipeline — the interrupted close (WO-0039 stabilization)', () => {
  it('records the session STOPPED (the durable fact the WO-level derivations read), captures NO step report, and forwards the event for the fold', async () => {
    const fr = fakeRunner([started(), txt('yarıda kaldı'), { kind: 'interrupted' }]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const out = await collect(p, stepDrive());
    const session = fs.calls.filter((c) => c.method === 'recordSession').at(-1)!.args[0] as { status: string };
    expect(session.status).toBe('stopped');
    expect(methods(fs.calls)).not.toContain('recordStepReport');
    expect(out.at(-1)).toEqual({ kind: 'interrupted' });
  });

  it('a review drive captures NO verdict on an interrupted close', async () => {
    const fr = fakeRunner([started(), txt('inceleme yarıda kaldı'), { kind: 'interrupted' }]);
    const fs = fakeStore({ review: 'review step 2' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, reviewDrive());
    expect(methods(fs.calls)).not.toContain('recordStepVerdict');
  });

  it('carries an observed cost into the idle record (a scripted runner can observe one)', async () => {
    const fr = fakeRunner([started(), { kind: 'interrupted', cost: { tokensIn: 120, tokensOut: 24, usd: 0.02 } }]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, planDrive());
    const last = fs.calls.filter((c) => c.method === 'recordSession').at(-1)!.args[0] as { cost?: unknown };
    expect(last.cost).toEqual({ tokensIn: 120, tokensOut: 24, usd: 0.02 });
  });
});
