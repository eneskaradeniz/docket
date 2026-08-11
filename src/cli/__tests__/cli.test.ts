import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDriveInput, formatEvent, runDrive } from '../drive';
import { createFakeRunner } from '../fake-runner';
import { autoAllowPolicy, createPipeline } from '../../core/pipeline';
import type { SessionStore } from '../../core/session-store';
import type { WorkOrderSource } from '../../core/source';
import type { RunnerEvent } from '../../core/runner';
import type { CostSummary, StepView, TrackId, WorkOrderId } from '../../core/types';

// WO-0024 — the CLI's drive core, tested deterministically with the file-based FakeRunner + a fake store.
// These assert the CLI wiring over the (already-tested) pipeline: buildDriveInput shapes, runDrive's event
// forwarding + summary, and the P1-1 invariant through the CLI path (a review drive does not savePendingPlan).

const WO = 'WO-T' as WorkOrderId;
const ZERO_COST: CostSummary = { tokensIn: 0, tokensOut: 0, usd: 0 };

const started = (id = 's1'): RunnerEvent => ({ kind: 'started', sessionId: id });
const done = (result?: string): RunnerEvent => ({ kind: 'turn_complete', stopReason: 'end_turn', cost: ZERO_COST, result });
const plan = (p: string): RunnerEvent => ({ kind: 'plan_ready', planText: p });
const perm = (requestId = 'r1'): RunnerEvent => ({ kind: 'permission_request', requestId, tool: 'Write', input: {} });

/** Write a JSON RunnerEvent[] script to a temp file and build a FakeRunner from it. */
function scriptedRunner(events: RunnerEvent[]): { runner: ReturnType<typeof createFakeRunner>['runner']; decideCalls: Array<[string, unknown]> } {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  writeFileSync(join(dir, 'script.json'), JSON.stringify(events));
  const fr = createFakeRunner(join(dir, 'script.json'));
  return { runner: fr.runner, decideCalls: fr.decideCalls };
}

function fakeStore(prompts: { architect?: string; step?: { prompt: string; scope?: string }; review?: string }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const store = {
    recordSession: (i: unknown) => calls.push(['recordSession', i]),
    recordStep: (id: unknown, idx: unknown, patch: unknown) => calls.push(['recordStep', id, idx, patch]),
    recordStepReport: (id: unknown, idx: unknown, role: unknown, body: unknown) => calls.push(['recordStepReport', id, idx, role, body]),
    recordStepVerdict: (id: unknown, idx: unknown, verdict: unknown, body: unknown) => calls.push(['recordStepVerdict', id, idx, verdict, body]),
    savePendingPlan: (id: unknown, p: unknown) => calls.push(['savePendingPlan', id, p]),
    architectPromptFor: () => prompts.architect,
    stepPromptFor: () => prompts.step,
    stepReviewPromptFor: () => prompts.review,
  } as unknown as SessionStore;
  return { store, calls };
}

const stepSource = {
  getWorkOrderSteps: async (): Promise<StepView[]> => [
    { idx: 1, role: 'verifier', aim: 'test', scope: { kind: 'track', ref: 'app' as TrackId }, scopeTrackId: 'app' as TrackId, status: 'pending' },
  ],
} as unknown as WorkOrderSource;

describe('buildDriveInput — drive kind → DriveInput shape', () => {
  it('plan drive → architect / mode plan / empty prompt', async () => {
    const di = await buildDriveInput(WO, { cwd: '/r', plan: true }, stepSource);
    expect(di).toMatchObject({ role: 'architect', mode: 'plan', prompt: '', cwd: '/r' });
    expect(di.stepIndex).toBeUndefined();
    expect(di.reviewStepIndex).toBeUndefined();
  });
  it('step drive → role + scope from the step spec', async () => {
    const di = await buildDriveInput(WO, { cwd: '/r', step: 1 }, stepSource);
    expect(di).toMatchObject({ role: 'verifier', mode: 'direct', stepIndex: 1, scope: 'app' });
  });
  it('review drive → architect / direct / reviewStepIndex', async () => {
    const di = await buildDriveInput(WO, { cwd: '/r', review: 2 }, stepSource);
    expect(di).toMatchObject({ role: 'architect', mode: 'direct', reviewStepIndex: 2 });
  });
  it('free-form prompt is preserved', async () => {
    const di = await buildDriveInput(WO, { cwd: '/r', prompt: 'just do it' }, stepSource);
    expect(di).toMatchObject({ role: 'implementer', mode: 'direct', prompt: 'just do it' });
  });
});

describe('runDrive — event forwarding + summary + wiring', () => {
  it('captures planText + cost and forwards every event', async () => {
    const { runner } = scriptedRunner([started(), plan('THE PLAN'), done()]);
    const fs = fakeStore({ architect: 'plan it' });
    const pipeline = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    const input = await buildDriveInput(WO, { cwd: '/r', plan: true }, stepSource);
    const seen: RunnerEvent[] = [];
    const summary = await runDrive(input, pipeline, (ev) => seen.push(ev));
    expect(seen.map((e) => e.kind)).toEqual(['started', 'plan_ready', 'turn_complete']);
    expect(summary.planText).toBe('THE PLAN');
    expect(summary.cost).toEqual(ZERO_COST);
  });

  it('a step drive records the report at turn_complete (pipeline wiring through the CLI)', async () => {
    const { runner } = scriptedRunner([started(), done('the report body')]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const pipeline = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    const input = await buildDriveInput(WO, { cwd: '/r', step: 1 }, stepSource);
    await runDrive(input, pipeline, () => {});
    expect(fs.calls.find((c) => c[0] === 'recordStepReport')?.slice(1)).toEqual([WO, 1, 'verifier', 'the report body']);
  });

  it('a review drive captures the verdict and does NOT save a pending plan (P1-1, via the CLI path)', async () => {
    const { runner } = scriptedRunner([started(), done('review\n\nVERDICT: proceed')]);
    const fs = fakeStore({ architect: 'PLAN (wrong)', review: 'review step 2' });
    const pipeline = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    const input = await buildDriveInput(WO, { cwd: '/r', review: 2 }, stepSource);
    await runDrive(input, pipeline, () => {});
    expect(fs.calls.map((c) => c[0])).toContain('recordStepVerdict');
    expect(fs.calls.map((c) => c[0])).not.toContain('savePendingPlan');
  });

  it('autoAllowPolicy resolves a permission ask internally (not forwarded)', async () => {
    const { runner, decideCalls } = scriptedRunner([started(), perm('r1'), done()]);
    const fs = fakeStore({ step: { prompt: 'do step 1' } });
    const pipeline = createPipeline({ runner, store: fs.store, permission: autoAllowPolicy() });
    const input = await buildDriveInput(WO, { cwd: '/r', step: 1 }, stepSource);
    const seen: RunnerEvent[] = [];
    await runDrive(input, pipeline, (ev) => seen.push(ev));
    expect(seen.map((e) => e.kind)).toEqual(['started', 'turn_complete']); // no permission_request
    expect(decideCalls[0]?.[0]).toBe('r1');
  });
});

describe('formatEvent — output formatter', () => {
  it('quiet emits nothing', () => {
    for (const ev of [started(), plan('x'), done(), perm()]) expect(formatEvent(ev, 'quiet')).toBeUndefined();
  });
  it('jsonl is valid JSON carrying the kind', () => {
    const j = JSON.parse(formatEvent(done('body'), 'jsonl')!);
    expect(j.kind).toBe('turn_complete');
    expect(j.result).toBe('body');
  });
  it('stream returns a string per kind', () => {
    expect(typeof formatEvent(started(), 'stream')).toBe('string');
    expect(formatEvent(plan('hello'), 'stream')).toMatch(/plan ready/);
    expect(formatEvent(perm(), 'stream')).toMatch(/ask/);
  });
});
