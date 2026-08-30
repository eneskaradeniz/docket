import { describe, expect, it } from 'vitest';
import { foldSessionEvent, initialSessionState, openAgentTasks, seedLiveState } from '../runner';
import type { LiveSessionState, RunnerEvent } from '../runner';
import type { TranscriptLine } from '../types';

// WO-0055 — the agent-task lifecycle events, their fold, and the derived open-task view.
// Probe t1 (docs/probes/cc-surface/raw/t1-task.log) is the wild basis: task_started /
// task_notification carry task_id + tool_use_id (=== the delegation call's callId); a task can
// RESTART after its end (the SendMessage re-open) — the fold's guards key on OPEN tasks.

const start = (over: Partial<Extract<RunnerEvent, { kind: 'agent_task' }>> = {}): RunnerEvent => ({
  kind: 'agent_task',
  phase: 'started',
  taskId: over.taskId ?? 't1',
  ...(over.callId !== undefined ? { callId: over.callId } : {}),
  ...(over.description !== undefined ? { description: over.description } : {}),
  ...(over.subagentType !== undefined ? { subagentType: over.subagentType } : {}),
  ...(over.at !== undefined ? { at: over.at } : {}),
});
const end = (over: Partial<Extract<RunnerEvent, { kind: 'agent_task' }>> = {}): RunnerEvent => ({
  kind: 'agent_task',
  phase: 'ended',
  taskId: over.taskId ?? 't1',
  ...(over.status !== undefined ? { status: over.status } : {}),
  ...(over.summary !== undefined ? { summary: over.summary } : {}),
  ...(over.at !== undefined ? { at: over.at } : {}),
});
const run = (state: LiveSessionState, ...events: RunnerEvent[]): LiveSessionState =>
  events.reduce(foldSessionEvent, state);

describe('foldSessionEvent — the agent task fold (WO-0055)', () => {
  it('started appends exactly one row carrying its facts and refreshes lastLifeAt from at', () => {
    const s = run(initialSessionState, start({ callId: 'call_1', description: 'Tara', subagentType: 'general-purpose', at: '2026-08-30T10:00:00Z' }));
    expect(s.entries).toEqual([
      { speaker: 'agent_task', phase: 'started', taskId: 't1', callId: 'call_1', description: 'Tara', subagentType: 'general-purpose', at: '2026-08-30T10:00:00Z' },
    ]);
    expect(s.lastLifeAt).toBe('2026-08-30T10:00:00Z');
  });

  it('absent optional keys stay absent — never empty strings, never nulls', () => {
    const s = run(initialSessionState, start({}));
    expect(s.entries).toEqual([{ speaker: 'agent_task', phase: 'started', taskId: 't1' }]);
  });

  it('a start while the same task is OPEN returns the SAME state (replay never double-opens)', () => {
    const s = run(initialSessionState, start({ callId: 'call_1' }));
    expect(run(s, start({ callId: 'call_1' }))).toBe(s);
  });

  it('a start AFTER an end opens a NEW block (the t1 SendMessage restart)', () => {
    const s = run(initialSessionState, start({ callId: 'call_1' }), end({ status: 'completed' }), start({ callId: 'call_2' }));
    expect(s.entries).toHaveLength(3);
    expect(s.entries.at(-1)).toEqual({ speaker: 'agent_task', phase: 'started', taskId: 't1', callId: 'call_2' });
  });

  it('ended appends status + summary and refreshes lastLifeAt', () => {
    const s = run(initialSessionState, start({}), end({ status: 'failed', summary: 'yol yok', at: '2026-08-30T10:01:00Z' }));
    expect(s.entries).toEqual([
      { speaker: 'agent_task', phase: 'started', taskId: 't1' },
      { speaker: 'agent_task', phase: 'ended', taskId: 't1', status: 'failed', summary: 'yol yok', at: '2026-08-30T10:01:00Z' },
    ]);
    expect(s.lastLifeAt).toBe('2026-08-30T10:01:00Z');
  });

  it('a duplicate end returns the SAME state — first end wins', () => {
    const s = run(initialSessionState, start({}), end({ status: 'completed' }));
    expect(run(s, end({ status: 'completed', summary: 'again' }))).toBe(s);
  });

  it('an end with no OPEN task behind it is dropped — unknown taskId', () => {
    const s = run(initialSessionState, start({}));
    expect(run(s, end({ taskId: 'other' }))).toBe(s);
  });

  it('an end after the task already ended is dropped (no open task)', () => {
    const s = run(initialSessionState, start({}), end({}));
    expect(run(s, end({}))).toBe(s);
  });

  it('an end without at leaves lastLifeAt untouched', () => {
    const anchored = run(initialSessionState, start({ at: '2026-08-30T10:00:00Z' }));
    const s = run(anchored, end({}));
    expect(s.lastLifeAt).toBe('2026-08-30T10:00:00Z');
  });

  it('agent events never change status, cost, asks or notes — the turn_usage discipline', () => {
    const base = run(initialSessionState, start({}), end({}));
    expect(base.status).toBe(initialSessionState.status);
    expect(base.cost).toEqual(initialSessionState.cost);
    expect(base.pendingAsks).toEqual([]);
    expect(base.pendingNotes).toEqual([]);
  });
});

describe('openAgentTasks — the derived running-agent view (WO-0055)', () => {
  it('one started, no end → the open task with its facts', () => {
    const entries = foldSessionEvent(initialSessionState, start({ callId: 'call_1', description: 'Tara' })).entries;
    expect(openAgentTasks(entries)).toEqual([{ taskId: 't1', callId: 'call_1', description: 'Tara' }]);
  });

  it('started → ended → none', () => {
    const entries = run(initialSessionState, start({}), end({})).entries;
    expect(openAgentTasks(entries)).toEqual([]);
  });

  it('two started, one ended → the open one remains', () => {
    const entries = run(initialSessionState, start({ taskId: 'a' }), start({ taskId: 'b' }), end({ taskId: 'a' })).entries;
    expect(openAgentTasks(entries)).toEqual([{ taskId: 'b' }]);
  });

  it('a stray end for an unknown id contributes nothing', () => {
    const entries = run(initialSessionState, end({ taskId: 'ghost' })).entries;
    expect(openAgentTasks(entries)).toEqual([]);
  });

  it('non-agent or empty entries → []', () => {
    const entries: TranscriptLine[] = [
      { speaker: 'assistant', text: 'merhaba' },
      { speaker: 'note', kind: 'session_started' },
    ];
    expect(openAgentTasks(entries)).toEqual([]);
    expect(openAgentTasks([])).toEqual([]);
  });
});

describe('seedLiveState — the agent seed (WO-0055)', () => {
  it('a persisted transcript with open + ended agent rows re-seeds verbatim; the open task re-derives', () => {
    const transcript: TranscriptLine[] = [
      { speaker: 'note', kind: 'session_started', detail: '2026-08-30T10:00:00Z' },
      { speaker: 'agent_task', phase: 'started', taskId: 't1', callId: 'call_1', description: 'Tara' },
      { speaker: 'agent_task', phase: 'ended', taskId: 't1', status: 'completed', summary: 'bitti' },
      { speaker: 'agent_task', phase: 'started', taskId: 't2' },
    ];
    const s = seedLiveState({
      transcript,
      cost: { tokensIn: 1, tokensOut: 2, usd: 3 },
      providerSessionId: 'ps1',
      status: 'idle',
    });
    expect(s.entries).toEqual(transcript);
    expect(openAgentTasks(s.entries)).toEqual([{ taskId: 't2' }]);
  });

  it('agent rows survive a stopped row — the rows are content, not status', () => {
    const transcript: TranscriptLine[] = [{ speaker: 'agent_task', phase: 'started', taskId: 't1' }];
    const s = seedLiveState({ transcript, cost: undefined, providerSessionId: 'ps1', status: 'stopped' });
    expect(s.status).toBe('stopped');
    expect(openAgentTasks(s.entries)).toEqual([{ taskId: 't1' }]);
  });
});
