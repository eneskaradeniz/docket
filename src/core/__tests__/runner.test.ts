import { describe, expect, it } from 'vitest';
import {
  fenceDecision,
  foldSessionEvent,
  initialSessionState,
  isUnder,
  summarizeToolInput,
  writeScopeFor,
} from '../runner';
import type { RunnerEvent, WriteAttempt } from '../runner';

const ROOTS = { repoRoot: '/repo', decisionStore: '/repo/docs' };
const architect = writeScopeFor('architect', ROOTS);
const implementer = writeScopeFor('implementer', ROOTS);
const verifier = writeScopeFor('verifier', ROOTS);

const read = (over: Partial<WriteAttempt> = {}): WriteAttempt => ({ isWrite: false, ...over });
const write = (targetPath: string): WriteAttempt => ({ isWrite: true, targetPath });
const bashWrite = (command: string, targetPath?: string): WriteAttempt => ({
  isWrite: true,
  command,
  targetPath,
});

describe('writeScopeFor — ADR-0002 role → write scope', () => {
  it('architect is fenced to the decision store', () => {
    expect(writeScopeFor('architect', ROOTS)).toEqual({ kind: 'decision_store', root: '/repo/docs' });
  });
  it('implementer may write the track repo', () => {
    expect(writeScopeFor('implementer', ROOTS)).toEqual({ kind: 'repo', root: '/repo' });
  });
  it('verifier is read-only', () => {
    expect(writeScopeFor('verifier', ROOTS)).toEqual({ kind: 'read_only' });
  });
});

describe('isUnder — path containment (string-normalised)', () => {
  it('matches the root exactly and descendants, not siblings', () => {
    expect(isUnder('/repo/docs', '/repo/docs')).toBe(true);
    expect(isUnder('/repo/docs', '/repo/docs/order.md')).toBe(true);
    expect(isUnder('/repo/docs', '/repo/docs2/x')).toBe(false); // prefix is not containment
    expect(isUnder('/repo/docs', '/repo/src/x')).toBe(false);
  });
  it('ignores trailing slashes', () => {
    expect(isUnder('/repo/docs/', '/repo/docs/x')).toBe(true);
  });
});

describe('fenceDecision — the write fence (TD-001)', () => {
  it('allows reads for every role (the fence is asymmetric)', () => {
    expect(fenceDecision(architect, read())).toBe('allow');
    expect(fenceDecision(implementer, read())).toBe('allow');
    expect(fenceDecision(verifier, read())).toBe('allow');
  });

  it('architect: in-scope (docs/) write asks; out-of-scope write is denied without prompting', () => {
    expect(fenceDecision(architect, write('/repo/docs/order.md'))).toBe('ask');
    expect(fenceDecision(architect, write('/repo/src/index.ts'))).toBe('deny');
  });

  it('implementer: in-repo write asks; out-of-repo write is denied', () => {
    expect(fenceDecision(implementer, write('/repo/src/index.ts'))).toBe('ask');
    expect(fenceDecision(implementer, write('/etc/passwd'))).toBe('deny');
  });

  it('verifier: every write is denied (read-only role)', () => {
    expect(fenceDecision(verifier, write('/repo/docs/order.md'))).toBe('deny');
    expect(fenceDecision(verifier, write('/repo/src/x'))).toBe('deny');
  });

  it('a Bash write redirected at a protected path is denied (the declarative-rule gap, TD-001)', () => {
    // The adapter pre-classifies the shell command as a write with its target path;
    // the fence then treats it like any other write.
    expect(fenceDecision(architect, bashWrite('printf > /repo/src/x', '/repo/src/x'))).toBe('deny');
    expect(fenceDecision(implementer, bashWrite('echo >> /repo/out.txt', '/repo/out.txt'))).toBe('ask');
  });

  it('a write with no resolvable target asks the operator (fail-open is unsafe, fail-closed blocks work)', () => {
    expect(fenceDecision(implementer, { isWrite: true })).toBe('ask');
    expect(fenceDecision(architect, bashWrite('some opaque command'))).toBe('ask');
  });
});

describe('summarizeToolInput', () => {
  it('prefers file_path / path / command', () => {
    expect(summarizeToolInput({ file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeToolInput({ command: 'npm test' })).toBe('npm test');
    expect(summarizeToolInput({ path: '/x' })).toBe('/x');
    expect(summarizeToolInput({ foo: 'bar' })).toBe('');
  });
});

describe('foldSessionEvent — live session state', () => {
  const ev = (e: RunnerEvent) => foldSessionEvent(initialSessionState, e);

  it('started → running with the session id', () => {
    expect(ev({ kind: 'started', sessionId: 's1' })).toMatchObject({ status: 'running', sessionId: 's1' });
  });

  it('assistant_text appends an assistant line and lifts idle → running', () => {
    const s = ev({ kind: 'assistant_text', text: 'hello' });
    expect(s.status).toBe('running');
    expect(s.entries).toEqual([{ speaker: 'assistant', text: 'hello' }]);
  });

  it('tool_use / tool_result append tool lines', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'tool_use', callId: 'c1', tool: 'Write', input: { file_path: '/a' } });
    s = foldSessionEvent(s, { kind: 'tool_result', callId: 'c1', summary: 'wrote 1 line', isError: false });
    expect(s.entries).toEqual([
      { speaker: 'tool', label: 'Write', detail: '/a', isError: false },
      { speaker: 'tool', label: 'result', detail: 'wrote 1 line', isError: false },
    ]);
  });

  it('permission_request stops at the gate; a later event resolves it back to running', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    expect(s.status).toBe('stopped_asking');
    expect(s.pendingAsk?.requestId).toBe('r1');
    // the operator allowed it → the tool runs → a tool_result arrives and clears the ask
    s = foldSessionEvent(s, { kind: 'tool_result', callId: 'c1', summary: 'ok', isError: false });
    expect(s.status).toBe('running');
    expect(s.pendingAsk).toBeUndefined();
  });

  it('plan_ready holds the plan for approval', () => {
    const s = ev({ kind: 'plan_ready', planText: 'do the thing' });
    expect(s.status).toBe('plan_ready');
    expect(s.pendingPlan).toBe('do the thing');
  });

  it('turn_complete sets done and records cost', () => {
    const s = ev({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 100, tokensOut: 20, usd: 0.42 } });
    expect(s.status).toBe('done');
    expect(s.cost).toEqual({ tokensIn: 100, tokensOut: 20, usd: 0.42 });
  });

  it('error sets the error state with the message', () => {
    const s = ev({ kind: 'error', message: 'boom' });
    expect(s.status).toBe('error');
    expect(s.lastError).toBe('boom');
  });

  it('a multi-event session folds in order', () => {
    let s = initialSessionState;
    s = foldSessionEvent(s, { kind: 'started', sessionId: 's' });
    s = foldSessionEvent(s, { kind: 'assistant_text', text: 'planning…' });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r', tool: 'Write', input: {} });
    expect(s.status).toBe('stopped_asking');
    s = foldSessionEvent(s, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } });
    expect(s.status).toBe('done');
    expect(s.entries).toHaveLength(1);
    expect(s.pendingAsk).toBeUndefined();
  });
});
