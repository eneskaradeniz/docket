import { describe, expect, it } from 'vitest';
import { askOperatorPolicy, autoAllowPolicy, createPipeline, prepareDriveInput } from '../pipeline';
import { PLAN_EXIT_WITHOUT_RESULT } from '../runner';
import type { SessionStore } from '../session-store';
import type { DraftDriveInput, DriveInput, PermissionDecision, RunnerEvent, SessionRunner, WoDriveInput } from '../runner';
import type { CostSummary, WorkOrderId, WorkspaceId } from '../types';

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

// --- drive-input shapes (the three origins: plan / step / review). WO-0050/D1: the input is a
// union now — the helpers stay WoDriveInput-typed (the draft arm gets its own builder in S4). ---
const planDrive = (over: Partial<WoDriveInput> = {}): DriveInput => ({ role: 'architect', workOrderId: WO, mode: 'plan', prompt: '', ...over });
const stepDrive = (over: Partial<WoDriveInput> = {}): DriveInput => ({ role: 'implementer', workOrderId: WO, mode: 'direct', prompt: '', stepIndex: 1, ...over });
const reviewDrive = (over: Partial<WoDriveInput> = {}): DriveInput => ({ role: 'architect', workOrderId: WO, mode: 'direct', prompt: '', reviewStepIndex: 2, ...over });
const WS = 'ws-t' as WorkspaceId;
const draftDrive = (over: Partial<DraftDriveInput> = {}): DriveInput =>
  ({ role: 'architect', workspaceId: WS, mode: 'plan', prompt: '', goalNote: 'hedef notu', docPaths: [], ...over });

/** A scripted runner. On a `permission_request` it creates the decide-latch in the Promise executor BEFORE the
 *  yield (mirroring the real adapter's `pending.set` before `queue.push`), so a prompt decide resolves it. */
function fakeRunner(script: RunnerEvent[]) {
  const decideCalls: Array<[string, PermissionDecision]> = [];
  const drivenInputs: DriveInput[] = [];
  const steerCalls: Array<[string, { noteId: string; emit?: boolean } | undefined]> = [];
  const retractCalls: string[] = [];
  const pending = new Map<string, () => void>();
  const resolved: string[] = []; // WO-0027: ask_resolved is emitted back into the stream, like the real adapter
  const drive = async function* (input: DriveInput): AsyncIterable<RunnerEvent> {
    drivenInputs.push(input);
    const seen = new Set<string>();
    let noteDelivered = false;
    for (const ev of script) {
      if (ev.kind === 'permission_request') {
        if (seen.has(ev.requestId)) continue; // resume replay dedupe
        seen.add(ev.requestId);
        const latch = new Promise<void>((resolve) => pending.set(ev.requestId, resolve));
        yield ev;
        await latch;
        yield { kind: 'ask_resolved', requestId: ev.requestId };
        continue;
      }
      yield ev;
      // WO-0045 D5: the real adapter emits the synthetic steer_delivered right after `started` when the
      // pipeline carried a deliveringNote — mirror it so the resume-carry path is observable.
      if (ev.kind === 'started' && input.deliveringNote && !noteDelivered) {
        noteDelivered = true;
        yield { kind: 'steer_delivered', noteId: input.deliveringNote.id, text: input.deliveringNote.text };
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
    // WO-0045: records the transport calls; the scripted events (steer_queued etc.) drive the fold.
    async steer(note: string, opts?: { noteId: string; emit?: boolean }) {
      steerCalls.push([note, opts]);
      return true;
    },
    async retractSteer(noteId: string) {
      retractCalls.push(noteId);
      return true;
    },
  } as SessionRunner;
  return { runner, decideCalls, drivenInputs, steerCalls, retractCalls };
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

/** Records every call; returns scripted prompts. `planApproved` scripts the approval gate (WO-0038);
 *  `opts` scripts the WO-0045 surfaces (flowMode the tempo gate, pendingNotes Sürdür's carry) and the
 *  WO-0047 budget gate (budgetBlock — a payload refuses every drive; undefined passes). WO-0050: the
 *  DRAFT surfaces ride the same opts (draftPrompt the assembly, draftBudgetBlock the draft-arm gate) —
 *  every fake implements BOTH budget reads (the port's unconditional clause, D3/D4). */
function fakeStore(
  prompts: { architect?: string; step?: { prompt: string; scope?: string }; review?: string },
  planApproved = true,
  opts: {
    flowMode?: 'auto' | 'manual';
    pendingNotes?: { id: string; text: string }[];
    budgetBlock?: { observedUsd: number; capUsd: number };
    draftPrompt?: string;
    draftBudgetBlock?: { observedUsd: number; capUsd: number };
  } = {},
) {
  const calls: FakeStoreCalls[] = [];
  const store = {
    recordSession: (i: unknown) => calls.push({ method: 'recordSession', args: [i] }),
    // WO-0052: the per-turn usage append — a fake left behind is caught at RUNTIME by the
    // turn_usage-scripted tests below (TypeError), not by this file's `as unknown as SessionStore`
    // cast (which suppresses compile-time checking of the port's shape).
    recordTurnUsage: (owner: unknown, sid: unknown, row: unknown) => calls.push({ method: 'recordTurnUsage', args: [owner, sid, row] }),
    recordStep: (id: unknown, idx: unknown, patch: unknown) => calls.push({ method: 'recordStep', args: [id, idx, patch] }),
    recordStepReport: (id: unknown, idx: unknown, role: unknown, body: unknown) => calls.push({ method: 'recordStepReport', args: [id, idx, role, body] }),
    recordStepVerdict: (id: unknown, idx: unknown, verdict: unknown, body: unknown) => calls.push({ method: 'recordStepVerdict', args: [id, idx, verdict, body] }),
    savePendingPlan: (id: unknown, planText: unknown) => calls.push({ method: 'savePendingPlan', args: [id, planText] }),
    architectPromptFor: () => prompts.architect,
    stepPromptFor: () => prompts.step,
    stepReviewPromptFor: () => prompts.review,
    planApprovedFor: () => planApproved,
    flowModeFor: () => opts.flowMode ?? 'auto',
    budgetBlockFor: () => opts.budgetBlock,
    budgetBlockForDraft: () => opts.draftBudgetBlock,
    roadmapDraftPromptFor: (wsId: unknown, goalNote: unknown, docPaths: unknown, freeExplore?: unknown) => {
      calls.push({ method: 'roadmapDraftPromptFor', args: [wsId, goalNote, docPaths, freeExplore] });
      return opts.draftPrompt;
    },
    saveRoadmapDraft: (wsId: unknown, md: unknown, o: unknown) => calls.push({ method: 'saveRoadmapDraft', args: [wsId, md, o] }),
    clearRoadmapDraft: (wsId: unknown) => calls.push({ method: 'clearRoadmapDraft', args: [wsId] }),
    pendingNotesFor: () => opts.pendingNotes ?? [],
    recordAuditEvent: (id: unknown, kind: unknown, detail: unknown) => calls.push({ method: 'recordAuditEvent', args: [id, kind, detail] }),
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

// ===== the workspace budget gate (WO-0047) =====
// The FIRST gate and the only one that sees EVERY drive — plan, step, review, resume alike: each
// spawns a runner that bills. The refusal is the plan gate's shape plus its FACTS (observed, cap)
// so GUI and CLI compose the same sentence; unconfigured (undefined) fails open.

describe('budget gate — every drive refused when the month spend meets the cap', () => {
  const block = { observedUsd: 12.5, capUsd: 10 };

  it('step drive: one error event carrying the refusal facts, the runner never spawns, nothing recorded', async () => {
    const fr = fakeRunner([started(), txt('should never run'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, true, { budgetBlock: block });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    const ev = events[0] as { message: string; refusal?: { observedUsd: number; capUsd: number } };
    expect(ev.refusal).toEqual(block);
    expect(ev.message).toMatch(/budget cap met/);
    expect(ev.message).toContain('12.50');
    expect(ev.message).toContain('10.00');
    expect(fr.drivenInputs).toHaveLength(0);
    expect(methods(fs.calls)).not.toContain('recordSession');
    expect(methods(fs.calls)).not.toContain('recordStep');
  });

  it('a PLAN drive is refused alike (the every-drive contract — the plan/flow gates scope to step/review)', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ architect: 'plan it' }, true, { budgetBlock: block });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, planDrive());
    expect(events.map((e) => e.kind)).toEqual(['error']);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('a RESUME drive is refused alike (a resume spawns a runner that bills)', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ architect: 'plan it' }, true, { budgetBlock: block });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, planDrive({ resume: 'sess-1', prompt: 'continue' }));
    expect(events.map((e) => e.kind)).toEqual(['error']);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('the budget gate outranks the plan gate (a blocked WO never reaches the plan refusal)', async () => {
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, false, { budgetBlock: block });
    const p = createPipeline({ runner: fakeRunner([]).runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect((events[0] as { message: string }).message).toMatch(/budget cap met/); // not "plan not approved"
  });

  it('unconfigured (undefined) fails open — the drive runs untouched', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, planDrive());
    expect(fr.drivenInputs).toHaveLength(1);
    expect(events.map((e) => e.kind)).toContain('started');
  });
});

// ===== the WO-LESS draft drive (WO-0050 — D4/D5/D6/D15) =====
// ONE mechanism: the ✦ dialog's goalNote + docPaths assemble through the SAME server-side port,
// the draft-arm budget gate sees the drive, plan_ready lands in the pending roadmap_draft row,
// and steer stays WO-only (İtiraz is the draft's note path).

describe('draft drive — prompt assembly, gate, plan_ready, supersede (WO-0050)', () => {
  it('prepareDriveInput: the DRAFT arm routes to roadmapDraftPromptFor (never architectPromptFor)', () => {
    const { store, calls } = fakeStore({ architect: 'PLAN (wrong)' }, true, { draftPrompt: 'taslak promptu' });
    const out = prepareDriveInput(draftDrive(), store);
    expect(out.prompt).toBe('taslak promptu');
    expect(methods(calls)).toContain('roadmapDraftPromptFor');
    expect(methods(calls)).not.toContain('architectPromptFor');
  });

  it("prepareDriveInput: a draft resume with NO prompt is filled too — the unreadable draft's no-note Sürdür (dogfood 2026-08-29)", () => {
    const { store } = fakeStore({ architect: 'PLAN (wrong)' }, true, { draftPrompt: 'taslak promptu' });
    const resumed = prepareDriveInput(draftDrive({ resume: 'sess-9' }), store);
    expect(resumed.prompt).toBe('taslak promptu'); // the standing draft instruction IS the continue message
  });

  it('prepareDriveInput: a draft resume WITH a note keeps the note (the İtiraz path untouched)', () => {
    const { store } = fakeStore({}, true, { draftPrompt: 'taslak promptu' });
    const out = prepareDriveInput(draftDrive({ resume: 'sess-9', prompt: 'itirazım' }), store);
    expect(out.prompt).toBe('itirazım');
  });

  it('a draft at the cap is refused by the DRAFT-arm gate — roadmap draft names the subject, no runner spawns', async () => {
    const block = { observedUsd: 12.5, capUsd: 10 };
    const fr = fakeRunner([started(), txt('never'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak', draftBudgetBlock: block });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, draftDrive());
    expect(events).toHaveLength(1);
    const ev = events[0] as { kind: string; message: string; refusal?: unknown };
    expect(ev.kind).toBe('error');
    expect(ev.message).toContain('roadmap draft');
    expect(ev.message).toMatch(/budget cap met/);
    expect(ev.refusal).toEqual(block);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('a draft whose prompt did not assemble is refused pre-spawn — no empty-prompt provider run', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({}, true, { draftPrompt: undefined });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, draftDrive());
    expect(events.map((e) => e.kind)).toEqual(['error']);
    expect((events[0] as { message: string }).message).toMatch(/no prompt assembled/);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('a FRESH draft supersedes the pending row before the runner spawns; a resume never clears', async () => {
    const fr = fakeRunner([started(), plan('# taslak'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    const clearIdx = fs.calls.findIndex((c) => c.method === 'clearRoadmapDraft');
    const spawnIdx = fs.calls.findIndex((c) => c.method === 'recordSession');
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeLessThan(spawnIdx); // gates passed, THEN the row cleared, THEN the runner ran

    const fs2 = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p2 = createPipeline({ runner: fr.runner, store: fs2.store, permission: autoAllowPolicy() });
    await collect(p2, draftDrive({ resume: 'draft-sess-1', prompt: 'itiraz: bağımlılıkları koru' }));
    expect(methods(fs2.calls)).not.toContain('clearRoadmapDraft');
  });

  it('plan_ready writes the workspace draft row with the provider session id (İtiraz resume handle)', async () => {
    const fr = fakeRunner([started('draft-sess-9'), plan('# yeni taslak'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    const call = findCall(fs.calls, 'saveRoadmapDraft');
    expect(call?.args).toEqual([WS, '# yeni taslak', { providerSessionId: 'draft-sess-9' }]);
    expect(methods(fs.calls)).not.toContain('savePendingPlan'); // the WO side-effect never fires
  });

  // WO-0051 / D1+D2: the composition rides the SAME write — counts + the flag, IFF the input
  // carried the counts (the dialog always does). A counts-less drive (the CLI, an İtiraz
  // resume) writes NO summary rather than fabricating zeros for paths it may still have
  // carried — review f2 — and the store's keep-prior holds the original figures.
  it('plan_ready persists sourceSummary iff the draft carries docSource (WO-0051)', async () => {
    const fr = fakeRunner([started('draft-sess-12'), plan('# kompozisyon'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive({ docSource: { store: 11, external: 1 }, freeExplore: true }));
    const call = findCall(fs.calls, 'saveRoadmapDraft');
    expect(call?.args[2]).toEqual({
      providerSessionId: 'draft-sess-12',
      sourceSummary: { store: 11, external: 1, freeExplore: true },
    });

    const fs2 = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p2 = createPipeline({ runner: fr.runner, store: fs2.store, permission: autoAllowPolicy() });
    await collect(p2, draftDrive({ docSource: { store: 0, external: 0 } })); // zero-doc floor: counts, no flag
    expect((findCall(fs2.calls, 'saveRoadmapDraft')?.args[2] as { sourceSummary: unknown }).sourceSummary).toEqual({
      store: 0,
      external: 0,
      freeExplore: false,
    });

    // --explore WITHOUT counts (the CLI's arm): the flag threads to the prompt, but no summary
    // is fabricated — the row keeps whatever it had (honest omission, review f2).
    const fs3 = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p3 = createPipeline({ runner: fr.runner, store: fs3.store, permission: autoAllowPolicy() });
    await collect(p3, draftDrive({ docPaths: ['/tmp/a.md'], freeExplore: true }));
    expect(findCall(fs3.calls, 'saveRoadmapDraft')?.args[2]).toEqual({ providerSessionId: 'draft-sess-12' });
  });

  it('prepareDriveInput threads freeExplore to roadmapDraftPromptFor — undefined when off (WO-0051)', () => {
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    prepareDriveInput(draftDrive({ freeExplore: true }), fs.store);
    expect(findCall(fs.calls, 'roadmapDraftPromptFor')?.args[3]).toBe(true);

    const fs2 = fakeStore({}, true, { draftPrompt: 'taslak' });
    prepareDriveInput(draftDrive(), fs2.store);
    expect(findCall(fs2.calls, 'roadmapDraftPromptFor')?.args[3]).toBeUndefined();
  });

  it('the session records under the DRAFT owner — workspace-keyed, work_order_id NULL by shape', async () => {
    const fr = fakeRunner([started('draft-sess-10'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    const rec = findCall(fs.calls, 'recordSession');
    expect((rec?.args[0] as { owner: unknown }).owner).toEqual({ kind: 'draft', workspaceId: WS });
  });

  it('steer refuses a live draft — the note path is İtiraz (D15)', async () => {
    const fr = fakeRunner([started('draft-sess-11'), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    expect(await p.steer('ara not')).toBeUndefined();
    expect(fs.calls.find((c) => c.method === 'steer_queued')).toBeUndefined();
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

describe('flow-mode gate — origin auto refused while manual (WO-0045)', () => {
  it('auto step drive + manual: one error event, the runner never spawns, nothing is recorded', async () => {
    const fr = fakeRunner([started(), txt('never'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, true, { flowMode: 'manual' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive({ origin: 'auto' }));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    expect((events[0] as { message: string }).message).toMatch(/flow mode manual/);
    expect(fr.drivenInputs).toHaveLength(0);
    expect(methods(fs.calls)).not.toContain('recordSession');
  });

  it('auto review drive + manual: refused the same way', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ review: 'review 2' }, true, { flowMode: 'manual' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, reviewDrive({ origin: 'auto' }));
    expect(events).toHaveLength(1);
    expect((events[0] as { message: string }).message).toMatch(/flow mode manual/);
    expect(fr.drivenInputs).toHaveLength(0);
  });

  it('origin ABSENT (the operator click) + manual: runs — manual gates only self-starts', async () => {
    const fr = fakeRunner([started(), txt('operator started me'), done('report')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, true, { flowMode: 'manual' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events.map((e) => e.kind)).toContain('turn_complete');
    expect(fr.drivenInputs).toHaveLength(1);
  });

  it('origin auto + AUTO mode: runs — today behavior unchanged (AC7)', async () => {
    const fr = fakeRunner([started(), txt('auto advance'), done('report')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } }, true, { flowMode: 'auto' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive({ origin: 'auto' }));
    expect(events.map((e) => e.kind)).toContain('turn_complete');
  });

  it('a PLAN drive is never flow-gated (the plan leg is operator-clicked by nature)', async () => {
    const fr = fakeRunner([started(), plan('the plan'), done()]);
    const fs = fakeStore({ architect: 'plan the work' }, true, { flowMode: 'manual' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, planDrive({ origin: 'auto' }));
    expect(fr.drivenInputs).toHaveLength(1);
    expect(events.map((e) => e.kind)).toContain('plan_ready');
  });
});

describe('steer mirror + lifecycle (WO-0045)', () => {
  const steerQ = (noteId: string, note: string): RunnerEvent => ({ kind: 'steer_queued', noteId, note });
  const steerD = (noteId: string, text: string): RunnerEvent => ({ kind: 'steer_delivered', noteId, text });

  const recordSessionArgs = (calls: FakeStoreCalls[]) =>
    calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { status: string; pendingNotes?: { id: string; text: string }[]; transcript?: unknown[] });

  it('queued → row carries the note; delivered → operator line in the transcript row + the note leaves the mirror; both audited', async () => {
    const fr = fakeRunner([started(), steerQ('n1', 'şunu atla'), steerD('n1', 'şunu atla'), txt('oldu'), done('report')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    // events flow through to the host fold (the UI count + operator line)
    expect(events.filter((e) => e.kind === 'steer_queued' || e.kind === 'steer_delivered')).toHaveLength(2);
    const records = recordSessionArgs(fs.calls);
    const withNote = records.filter((r) => r.pendingNotes?.some((n) => n.id === 'n1'));
    expect(withNote.length).toBeGreaterThan(0); // the queued checkpoint persisted the mirror
    const final = records[records.length - 1]!;
    expect(final.pendingNotes).toEqual([]); // delivery shrank the mirror
    // the delivered operator line rides the transcript checkpoint
    const withLine = records.filter((r) => JSON.stringify(r.transcript).includes('"operator"'));
    expect(withLine.length).toBeGreaterThan(0);
    const audits = fs.calls.filter((c) => c.method === 'recordAuditEvent').map((c) => c.args[1]);
    expect(audits).toContain('steer_delivered'); // delivery is event-driven; the queued audit rides pipeline.steer (covered below)
  });

  it('interrupted carries pendingNotes on the stopped row — Durdur persists the queue for Sürdür (AC4)', async () => {
    const fr = fakeRunner([started(), steerQ('n1', 'bir'), steerQ('n2', 'iki'), { kind: 'interrupted' }]);
    const fs = fakeStore({});
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const records = recordSessionArgs(fs.calls);
    const stopped = records.filter((r) => r.status === 'stopped');
    expect(stopped[stopped.length - 1]!.pendingNotes?.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('pipeline.steer: optimistically mirrors, forwards to the runner, and un-mirrors on refusal; retract filters the mirror', async () => {
    const fr = fakeRunner([started(), perm('r1'), txt('end'), done('report')]);
    const fs = fakeStore({});
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: askOperatorPolicy() });
    const collectPromise = collect(p, stepDrive());
    await new Promise((r) => setTimeout(r, 10)); // let the drive reach the held ask
    const noteId1 = await p.steer('bir not');
    expect(noteId1).toBeTruthy();
    expect(fr.steerCalls.some(([note, o]) => note === 'bir not' && o?.noteId === noteId1 && o?.emit !== false)).toBe(true);
    await p.steer('ikinci not');
    expect(await p.retractSteer(noteId1!)).toBe(true);
    expect(fr.retractCalls).toContain(noteId1);
    await p.decide('r1', { allow: true });
    const events = await collectPromise;
    expect(events[events.length - 1]?.kind).toBe('turn_complete');
    // the final row carries ONLY the un-retracted note — the retracted one left the mirror
    const records = recordSessionArgs(fs.calls);
    const final = records[records.length - 1]!;
    expect(final.pendingNotes?.map((n) => n.text)).toEqual(['ikinci not']);
    const audits = fs.calls.filter((c) => c.method === 'recordAuditEvent').map((c) => c.args);
    expect(audits.some((a) => a[1] === 'steer_queued')).toBe(true);
    expect(audits.some((a) => a[1] === 'steer_retracted')).toBe(true);
  });

  it('steer with no live drive resolves undefined and never reaches the runner', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({});
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    expect(await p.steer('erken')).toBeUndefined();
    await collect(p, stepDrive());
    expect(await p.steer('geç')).toBeUndefined();
    expect(fr.steerCalls).toHaveLength(0);
  });

  it('Sürdür carry: the first note folds into the PROMPT as deliveringNote, the rest re-queue emit:false (no double application)', async () => {
    const fr = fakeRunner([started(), txt('devam'), done('report')]);
    const fs = fakeStore(
      {},
      true,
      { pendingNotes: [{ id: 'n1', text: 'birinci not' }, { id: 'n2', text: 'ikinci not' }, { id: 'n3', text: 'üçüncü not' }] },
    );
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive({ resume: 's9', prompt: '' }));
    const di = fr.drivenInputs[0]!;
    expect(di.prompt).toContain('birinci not'); // delivered via the prompt channel — never the SDK queue
    expect(di.deliveringNote).toEqual({ id: 'n1', text: 'birinci not' });
    expect(fr.steerCalls.filter(([, o]) => o?.emit === false).map(([note]) => note)).toEqual(['ikinci not', 'üçüncü not']);
    expect(fr.steerCalls.some(([note]) => note === 'birinci not')).toBe(false); // no double application
    expect(events.some((e) => e.kind === 'steer_delivered')).toBe(true); // the synthetic receipt surfaced
  });

  it('a resume with EXPLICIT prompt (the ask answer path) keeps the prompt and re-queues the notes for the boundary after its turn', async () => {
    const fr = fakeRunner([started(), done('report')]);
    const fs = fakeStore({}, true, { pendingNotes: [{ id: 'n1', text: 'bekliyor' }] });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive({ resume: 's9', prompt: 'cevabım: evet' }));
    expect(fr.drivenInputs[0]!.prompt).toBe('cevabım: evet'); // the answer owns the prompt channel
    expect(fr.drivenInputs[0]!.deliveringNote).toBeUndefined();
    expect(fr.steerCalls.filter(([, o]) => o?.emit === false).map(([note]) => note)).toEqual(['bekliyor']);
  });
});

// ===== WO-0052 — the usage recording floor =====
// Every observed turn_usage appends ONE usage row (the held intermediates arrive here as plain
// events — a scripted runner emits them verbatim); the latest context reading and the last
// observed usage checkpoint onto the session row at each record(); interrupted drives stay
// honest (cost absent, ctx still checkpoints, NO usage rows — nothing was observed).
describe('createPipeline — the usage recording floor (WO-0052)', () => {
  const usage = {
    cacheRead: 91008,
    numTurns: 7,
    durationMs: 41200,
    modelUsage: [{ model: 'm-1', tokensIn: 300, tokensOut: 90, usd: 0.05 }],
  };
  const usageRows = (calls: FakeStoreCalls[]) => calls.filter((c) => c.method === 'recordTurnUsage').map((c) => c.args[2] as Record<string, unknown>);
  const sessionRows = (calls: FakeStoreCalls[]) =>
    calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { status: string; cost?: CostSummary; ctx?: unknown; finalUsage?: unknown });

  it('every turn_usage appends exactly one usage row, in order, verbatim (AC2)', async () => {
    const fr = fakeRunner([
      started(),
      { kind: 'turn_usage', delta: { tokensIn: 27802, tokensOut: 50, usd: 0.17658 }, usage, at: '2026-08-28T10:00:00.000Z' },
      { kind: 'turn_usage', delta: { tokensIn: 44, tokensOut: 158, usd: 0.029322 }, at: '2026-08-28T10:00:10.000Z' }, // a held intermediate's row
      done('report'),
    ]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const rows = usageRows(fs.calls);
    expect(rows).toHaveLength(2);
    expect(fs.calls.filter((c) => c.method === 'recordTurnUsage').map((c) => c.args[1])).toEqual(['s1', 's1']); // the provider session id
    expect(rows[0]).toEqual({ at: '2026-08-28T10:00:00.000Z', delta: { tokensIn: 27802, tokensOut: 50, usd: 0.17658 }, usage });
    expect(rows[1]).toEqual({ at: '2026-08-28T10:00:10.000Z', delta: { tokensIn: 44, tokensOut: 158, usd: 0.029322 }, usage: undefined });
    // the terminal record still carries the ACCUMULATED cost — the floor adds rows, it never
    // changes the session aggregate's meaning
    const last = sessionRows(fs.calls).at(-1)!;
    expect(last.cost).toEqual({ tokensIn: 0, tokensOut: 0, usd: 0 });
  });

  it('a context_usage reading checkpoints onto the NEXT record and every later one (AC3)', async () => {
    const fr = fakeRunner([
      started(),
      { kind: 'context_usage', usedTokens: 46000, maxTokens: 200000, percentage: 23 },
      { kind: 'tool_result', callId: 'c1', summary: 'ok', isError: false },
      done(),
    ]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const rows = sessionRows(fs.calls);
    expect('ctx' in rows[0]!).toBe(false); // the started record: no reading yet
    for (const r of rows.slice(1)) expect(r.ctx).toEqual({ usedTokens: 46000, maxTokens: 200000 });
  });

  it('a drive with NO context_usage leaves ctx ABSENT on every record — never zeros (AC3, absent direction)', async () => {
    const fr = fakeRunner([started(), txt('hello'), done()]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, planDrive());
    for (const r of sessionRows(fs.calls)) {
      expect('ctx' in r).toBe(false);
      expect('finalUsage' in r).toBe(false);
    }
  });

  it('the last observed usage lands as finalUsage (latest-wins across legs is the store keep-prior rule)', async () => {
    const fr = fakeRunner([
      started(),
      { kind: 'turn_usage', delta: { tokensIn: 1, tokensOut: 1, usd: 0.001 }, usage, at: '2026-08-28T10:00:00.000Z' },
      done('report'),
    ]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const last = sessionRows(fs.calls).at(-1)!;
    expect(last.finalUsage).toEqual(usage);
  });

  it('interrupted: cost stays honest-absent, the observed ctx still checkpoints, NO usage rows (AC3)', async () => {
    const fr = fakeRunner([
      started(),
      { kind: 'context_usage', usedTokens: 51000, maxTokens: 200000, percentage: 25 },
      { kind: 'interrupted' },
    ]);
    const fs = fakeStore({ architect: 'plan it' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, planDrive());
    expect(usageRows(fs.calls)).toEqual([]); // an abort precedes the result — nothing observed
    const last = sessionRows(fs.calls).at(-1)!;
    expect(last.status).toBe('stopped');
    expect(last.cost).toBeUndefined();
    expect(last.ctx).toEqual({ usedTokens: 51000, maxTokens: 200000 });
  });

  it('a draft drive records its usage rows under the DRAFT owner', async () => {
    const fr = fakeRunner([
      started('draft-s1'),
      { kind: 'turn_usage', delta: { tokensIn: 9, tokensOut: 9, usd: 0.009 }, usage, at: '2026-08-28T10:00:00.000Z' },
      plan('# taslak'),
      done(),
    ]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak promptu' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    const owner = fs.calls.find((c) => c.method === 'recordTurnUsage')!.args[0];
    expect(owner).toEqual({ kind: 'draft', workspaceId: WS });
  });
});

// ===== WO-0053 — the limit stamp's routing table (D5) =====
// A real limit death arrives as a RESULT message: the adapter pushes error THEN turn_complete,
// the turn_complete case records (terminated=true — the finally's record is SKIPPED), so the
// turn terminal is the stamp's home. The table is fixed, not derived — the fold cannot know
// whether the ROW was stamped (initialSessionState + started-clears), hence null-on-clean and
// undefined-on-keep are literals at the call sites.

describe('WO-0053 — the limit stamp routing', () => {
  const STAMP = '2026-08-29T14:32:00.000Z';
  const limitError = (): RunnerEvent => ({
    kind: 'error',
    message: 'Usage limit reached',
    code: 'rate_limited',
    limit: { resetAt: STAMP, window: 'five_hour' },
  });
  const recordsOf = (calls: FakeStoreCalls[]): Array<Record<string, unknown>> =>
    calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as Record<string, unknown>);

  it('a limit RESULT death (error then turn_complete): the turn terminal record carries the stamp — the finally never records', async () => {
    const fr = fakeRunner([started(), limitError(), done()]);
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = recordsOf(fs.calls);
    expect(recs).toHaveLength(2); // started + turn_complete — terminated skips the finally
    expect(recs[1]).toMatchObject({ status: 'idle', limitResetAt: STAMP });
  });

  it('a CLEAN turn_complete passes null — the stale stamp on the row clears (a clean leg)', async () => {
    const fr = fakeRunner([started(), done()]);
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = recordsOf(fs.calls);
    expect(recs[1]).toMatchObject({ status: 'idle', limitResetAt: null });
  });

  it('the stream ENDING after a limit error (the adapter catch shape — no turn_complete): the finally record carries the stamp', async () => {
    const fr = fakeRunner([started(), limitError()]);
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = recordsOf(fs.calls);
    expect(recs.at(-1)).toMatchObject({ status: 'idle', limitResetAt: STAMP });
  });

  it('a NON-limit throw keeps the prior stamp — the catch record passes NO key (never null)', async () => {
    // started first (a session exists), THEN the stream throws mid-drive — the catch's shape.
    const runner = {
      drive: async function* (): AsyncIterable<RunnerEvent> {
        yield started();
        throw new Error('boom');
      },
      async decide() {},
      pendingAsks: async () => [],
      async interrupt() {},
      async abort() {},
    } as SessionRunner;
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = recordsOf(fs.calls);
    expect(recs).toHaveLength(2); // the started record + the catch's terminal
    expect(recs.at(-1)).toMatchObject({ status: 'idle' });
    expect('limitResetAt' in recs.at(-1)!).toBe(false); // undefined — the store keeps the prior
  });

  it('an INTERRUPTED close keeps — the stopped record passes no key', async () => {
    const fr = fakeRunner([started(), { kind: 'interrupted', at: '2026-08-29T13:47:00.000Z' }]);
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = recordsOf(fs.calls);
    expect(recs.at(-1)).toMatchObject({ status: 'stopped' });
    expect('limitResetAt' in recs.at(-1)!).toBe(false);
  });

  it('limit_windows feed events forward to the host fold and write NOTHING — pane state, not a record', async () => {
    const fr = fakeRunner([
      started(),
      { kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 86, resetAt: STAMP }], status: 'warning' },
      done(),
    ]);
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    const events = await collect(p, stepDrive());
    expect(events.some((e) => e.kind === 'limit_windows')).toBe(true);
    expect(recordsOf(fs.calls)).toHaveLength(2); // started + turn terminal — the feed wrote nothing
  });

  it('the DRAFT arm stamps under the draft owner (the taslak drive dies on the limit like any other)', async () => {
    const fr = fakeRunner([started('s-d'), limitError(), done()]);
    const fs = fakeStore({}, true, { draftPrompt: 'taslak promptu' });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, draftDrive());
    const recs = recordsOf(fs.calls);
    expect(recs.at(-1)).toMatchObject({ limitResetAt: STAMP });
    expect(recs.at(-1)).toMatchObject({ owner: { kind: 'draft', workspaceId: WS } });
  });
});

// WO-0053 review finding 4: the two stamp-LESS closes agree — a limit throw with NO stamp CLEARS
// (the provider just disproved the old clock; a restart must not re-derive a lying card).
describe('WO-0053 — the stamp-less limit close (review finding 4)', () => {
  it('a stamp-LESS limit throw clears the prior stamp (null, never keep)', async () => {
    const runner = {
      drive: async function* (): AsyncIterable<RunnerEvent> {
        yield started();
        yield { kind: 'error', message: 'Usage limit reached', code: 'rate_limited' } as RunnerEvent;
        throw new Error('post-error throw');
      },
      async decide() {},
      pendingAsks: async () => [],
      async interrupt() {},
      async abort() {},
    } as SessionRunner;
    const fs = fakeStore({ step: { prompt: 'p' } });
    const p = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const recs = fs.calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as Record<string, unknown>);
    expect(recs.at(-1)).toMatchObject({ status: 'idle', limitResetAt: null });
  });
});

// ===== WO-0055 — the agent-task edges (the döküm kaybı rule at the subagent's rows) =====
describe('createPipeline — the agent-task edges (WO-0055)', () => {
  const taskStarted = (): RunnerEvent => ({ kind: 'agent_task', phase: 'started', taskId: 'a5ce', callId: 'call_T', description: 'Tara' });
  const taskEnded = (): RunnerEvent => ({ kind: 'agent_task', phase: 'ended', taskId: 'a5ce', status: 'completed', summary: 'bitti' });
  const transcripts = (calls: FakeStoreCalls[]) =>
    calls.filter((c) => c.method === 'recordSession').map((c) => c.args[0] as { status: string; transcript: unknown[] });

  it('every agent-task edge checkpoints the transcript — the row carries the subagent rows', async () => {
    const fr = fakeRunner([started(), taskStarted(), taskEnded(), done('report')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const withAgent = transcripts(fs.calls).filter((r) => JSON.stringify(r.transcript).includes('"agent_task"'));
    expect(withAgent.length).toBeGreaterThanOrEqual(2); // the start edge AND the end edge recorded
  });

  it('NO audit row for any agent-task event (the wo_event CHECK gains no kind — plan D2)', async () => {
    const fr = fakeRunner([started(), taskStarted(), taskEnded(), done('report')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    expect(fs.calls.filter((c) => c.method === 'recordAuditEvent')).toEqual([]);
  });

  it('an interrupt right after a task start persists the started row (döküm kaybı, replayed for agents)', async () => {
    const fr = fakeRunner([started(), taskStarted(), { kind: 'interrupted' }]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const p = createPipeline({ runner: fr.runner, store: fs.store, permission: autoAllowPolicy() });
    await collect(p, stepDrive());
    const last = transcripts(fs.calls).at(-1)!;
    expect(last.status).toBe('stopped');
    expect(last.transcript).toEqual(
      expect.arrayContaining([expect.objectContaining({ speaker: 'agent_task', phase: 'started', taskId: 'a5ce' })]),
    );
  });
});
