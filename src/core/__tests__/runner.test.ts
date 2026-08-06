import { describe, expect, it } from 'vitest';
import {
  classifyCommandLine,
  fenceDecision,
  foldSessionEvent,
  initialSessionState,
  isUnder,
  simplePhaseFromState,
  summarizeToolInput,
  writeScopeFor,
} from '../runner';
import type { LiveSessionState, RunnerEvent, WriteAttempt } from '../runner';

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
      { speaker: 'tool_use', tool: 'Write', detail: '/a' },
      { speaker: 'tool_result', summary: 'wrote 1 line', isError: false },
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

  it('a started drive supersedes a pending plan (approval resumes cleanly)', () => {
    const s = foldSessionEvent(
      foldSessionEvent(initialSessionState, { kind: 'plan_ready', planText: 'do the thing' }),
      { kind: 'started', sessionId: 's2' },
    );
    expect(s.status).toBe('running');
    expect(s.pendingPlan).toBeUndefined();
  });

  it('turn_complete sets done and records cost', () => {
    const s = ev({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 100, tokensOut: 20, usd: 0.42 } });
    expect(s.status).toBe('done');
    expect(s.cost).toEqual({ tokensIn: 100, tokensOut: 20, usd: 0.42 });
  });

  it('turn_complete may carry a result (the step report text); the fold ignores it cleanly', () => {
    // `result` is consumed by the composition root (report capture), not the live-state fold.
    const s = ev({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0 }, result: 'changed src/x.ts' });
    expect(s.status).toBe('done');
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

describe('simplePhaseFromState — SADE mode phase from the live state', () => {
  const fold = (...events: RunnerEvent[]): LiveSessionState =>
    events.reduce((s, e) => foldSessionEvent(s, e), initialSessionState);
  const started: RunnerEvent = { kind: 'started', sessionId: 's1' };
  const txt = (t: string): RunnerEvent => ({ kind: 'assistant_text', text: t });
  const tool = (name: string): RunnerEvent => ({ kind: 'tool_use', callId: 'c', tool: name, input: {} });
  const result: RunnerEvent = { kind: 'tool_result', callId: 'c', summary: 'ok', isError: false };
  const plan = (p: string): RunnerEvent => ({ kind: 'plan_ready', planText: p });
  const done: RunnerEvent = { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 0, tokensOut: 0, usd: 0 } };

  it('idle with no entries → planning_started', () => {
    expect(simplePhaseFromState(initialSessionState)).toBe('planning_started');
  });
  it('Read/Grep/Glob → scanning', () => {
    expect(simplePhaseFromState(fold(started, tool('Read')))).toBe('scanning');
    expect(simplePhaseFromState(fold(started, tool('Grep')))).toBe('scanning');
  });
  it('Write/Edit → writing_decisions', () => {
    expect(simplePhaseFromState(fold(started, tool('Write')))).toBe('writing_decisions');
    expect(simplePhaseFromState(fold(started, tool('Edit')))).toBe('writing_decisions');
  });
  it('Bash → running_command; Task → delegating; WebFetch → fetching', () => {
    expect(simplePhaseFromState(fold(started, tool('Bash')))).toBe('running_command');
    expect(simplePhaseFromState(fold(started, tool('Task')))).toBe('delegating');
    expect(simplePhaseFromState(fold(started, tool('WebFetch')))).toBe('fetching');
  });
  it('assistant_text → thinking', () => {
    expect(simplePhaseFromState(fold(started, txt('düşünüyorum')))).toBe('thinking');
  });
  it('a trailing tool_result keeps the prior phase (no flicker back to thinking)', () => {
    expect(simplePhaseFromState(fold(started, tool('Read'), result))).toBe('scanning');
  });
  it('plan_ready → ready', () => {
    expect(simplePhaseFromState(fold(started, plan('the plan')))).toBe('ready');
  });
  it('turn_complete with a pending plan → ready', () => {
    expect(simplePhaseFromState(fold(started, plan('p'), done))).toBe('ready');
  });
  it('turn_complete with no plan (architect asked a question) → asking_input', () => {
    expect(simplePhaseFromState(fold(started, txt('soru?'), done))).toBe('asking_input');
  });
  it('error → errored', () => {
    expect(simplePhaseFromState(fold(started, { kind: 'error', message: 'boom' }))).toBe('errored');
  });
});

// ===== Command classification (WO-0019 / TD-026) =====

describe('classifyCommandLine — quote-aware redirect', () => {
  const cl = classifyCommandLine;
  it('cat file → read, no redirect', () => {
    const c = cl('cat file');
    expect(c.isWrite).toBe(false);
    expect(c.redirectTarget).toBeUndefined();
  });
  it('echo "a>b" → read (double-quoted > stripped)', () => {
    expect(cl('echo "a>b"').isWrite).toBe(false);
  });
  it('grep ">" file → read (single-quoted > stripped)', () => {
    expect(cl('grep ">" file').isWrite).toBe(false);
  });
  it("git log --format='>%h %s' → read", () => {
    expect(cl("git log --format='>%h %s'").isWrite).toBe(false);
  });
  it('printf x > /tmp/out → write, redirectTarget /tmp/out', () => {
    const c = cl('printf x > /tmp/out');
    expect(c.isWrite).toBe(true);
    expect(c.redirectTarget).toBe('/tmp/out');
  });
  it('cat f >> /repo/out → write (append)', () => {
    expect(cl('cat f >> /repo/out').redirectTarget).toBe('/repo/out');
  });
  it('git show HEAD:f > bar → write', () => {
    expect(cl('git show HEAD:f > bar').redirectTarget).toBe('bar');
  });
  it('cmd 2>file → write (fd-prefixed)', () => {
    expect(cl('cmd 2>file').isWrite).toBe(true);
  });
  it('cmd 2>&1 → read (fd-to-fd, not a file)', () => {
    expect(cl('cmd 2>&1').isWrite).toBe(false);
  });
});

describe('classifyCommandLine — write verbs (leading token only)', () => {
  const cl = classifyCommandLine;
  it('cp/mv/rm/mkdir/touch/chmod/rsync/install → write', () => {
    for (const cmd of ['cp a b', 'mv a b', 'rm a', 'mkdir d', 'touch f', 'chmod +x f', 'rsync a b', 'install src dst']) {
      expect(cl(cmd).isWrite).toBe(true);
    }
  });
  it('sed -i → write; sed -n → write (conservative)', () => {
    expect(cl("sed -i 's/a/b/' f").isWrite).toBe(true);
    expect(cl('sed -n 1,5p f').isWrite).toBe(true);
  });
  it('npm install → NOT a write (verb npm)', () => {
    expect(cl('npm install').isWrite).toBe(false);
  });
  it('npm run build → not a write', () => {
    expect(cl('npm run build').isWrite).toBe(false);
  });
  it('xinstall --foo → NOT a write (verb xinstall)', () => {
    expect(cl('xinstall --foo').isWrite).toBe(false);
  });
  it('sudo rm /x → write (prefix stripped)', () => {
    expect(cl('sudo rm /x').isWrite).toBe(true);
  });
  it('FOO=bar tee f → write (env-assignment stripped)', () => {
    expect(cl('FOO=bar tee f').isWrite).toBe(true);
  });
});

describe('classifyCommandLine — reads, git subcommands, ambiguous', () => {
  const cl = classifyCommandLine;
  it('known read verbs → read, not ambiguous', () => {
    for (const cmd of ['cat f', 'head f', 'tail f', 'od -c f', 'wc -l f', 'ls -la', 'find . -name x', 'grep x f', 'rg x', 'stat f', "jq '.x' f"]) {
      const c = cl(cmd);
      expect(c.isWrite).toBe(false);
      expect(c.ambiguous).toBeFalsy();
    }
  });
  it('git read subcommands (show/log/diff/blame/cat-file/ls-files/rev-parse/status) → read', () => {
    for (const cmd of ['git show HEAD', 'git log', 'git diff', 'git blame f', 'git cat-file -p X', 'git ls-files', 'git rev-parse HEAD', 'git status']) {
      const c = cl(cmd);
      expect(c.isWrite).toBe(false);
      expect(c.ambiguous).toBeFalsy();
    }
  });
  it('git -C /r show / git --git-dir=x log → read (global option skipped)', () => {
    expect(cl('git -C /r show').isWrite).toBe(false);
    expect(cl('git --git-dir=x log').isWrite).toBe(false);
  });
  it('git push/commit/merge/reset --hard/restore/clean -fd/switch -c → write', () => {
    for (const cmd of ['git push', 'git commit -m x', 'git merge feat', 'git reset --hard', 'git restore f', 'git clean -fd', 'git switch -c feat']) {
      expect(cl(cmd).isWrite).toBe(true);
    }
  });
  it('unmapped git frobnicate → ambiguous', () => {
    const c = cl('git frobnicate');
    expect(c.isWrite).toBe(false);
    expect(c.ambiguous).toBe(true);
  });
  it('unknown verbs → ambiguous (make, ./s.sh, node, python, cargo)', () => {
    for (const cmd of ['./script.sh', 'make target', 'python foo.py', 'node s.js', 'cargo build']) {
      const c = cl(cmd);
      expect(c.isWrite).toBe(false);
      expect(c.ambiguous).toBe(true);
    }
  });
});

describe('fenceDecision — ambiguous policy (WO-0019 / TD-026)', () => {
  const ev = (over: Partial<WriteAttempt> = {}): WriteAttempt => ({ isWrite: false, ...over });
  it('verifier + ambiguous → ask', () => {
    expect(fenceDecision(verifier, ev({ ambiguous: true }))).toBe('ask');
  });
  it('verifier + cat f (known read) → allow (the bug fix)', () => {
    expect(fenceDecision(verifier, ev({ command: 'cat f' }))).toBe('allow');
  });
  it('verifier + git show HEAD → allow', () => {
    expect(fenceDecision(verifier, ev({ command: 'git show HEAD' }))).toBe('allow');
  });
  it('implementer + ambiguous → allow (UX preserved)', () => {
    expect(fenceDecision(implementer, ev({ ambiguous: true }))).toBe('allow');
  });
  it('architect + ambiguous → allow', () => {
    expect(fenceDecision(architect, ev({ ambiguous: true }))).toBe('allow');
  });
});
