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
  } as SessionRunner;
  return { runner, drivenInputs };
}

interface FakeStoreCalls { method: string; args: unknown[] }

/** Records every call; returns scripted prompts. */
function fakeStore(prompts: { architect?: string; step?: { prompt: string; scope?: string }; review?: string }) {
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

// ===== createPipeline — the drive loop =====

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
    expect(last.transcript).toEqual([
      { speaker: 'assistant', text: 'merhaba' },
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
