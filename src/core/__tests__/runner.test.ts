import { describe, expect, it } from 'vitest';
import {
  classifyCommandLine,
  fenceDecision,
  foldSessionEvent,
  initialSessionState,
  isDraftDrive,
  isPlanDrive,
  isUnder,
  seedLiveState,
  shouldSynthesiseTurnComplete,
  staleMinutes,
  STALE_AFTER_MIN,
  summarizeToolInput,
  writeScopeFor,
} from '../runner';
import type { DraftDriveInput, DriveInput, RunnerEvent, WoDriveInput, WriteAttempt } from '../runner';
import type { WorkOrderId, WorkspaceId } from '../types';

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

describe('isPlanDrive — only the pure architect plan drive (WO-0023 / P1-1)', () => {
  const di = (over: Partial<WoDriveInput>): DriveInput =>
    ({ role: 'architect', workOrderId: 'WO-T' as WorkOrderId, mode: 'plan', prompt: '', ...over });
  it('pure architect plan drive → true', () => {
    expect(isPlanDrive(di({}))).toBe(true);
  });
  it('architect REVIEW drive → false (the P1-1 case)', () => {
    expect(isPlanDrive(di({ reviewStepIndex: 2 }))).toBe(false);
  });
  it('architect STEP drive → false', () => {
    expect(isPlanDrive(di({ stepIndex: 1 }))).toBe(false);
  });
  it('architect approve-resume → false', () => {
    expect(isPlanDrive(di({ approve: true }))).toBe(false);
  });
  it('implementer / verifier → false', () => {
    expect(isPlanDrive(di({ role: 'implementer' }))).toBe(false);
    expect(isPlanDrive(di({ role: 'verifier' }))).toBe(false);
  });
});

describe('isDraftDrive — the WO-less roadmap draft (WO-0050 / D1)', () => {
  const draft = (over: Partial<DraftDriveInput>): DraftDriveInput =>
    ({ role: 'architect', workspaceId: 'ws-t' as WorkspaceId, mode: 'plan', prompt: '', goalNote: 'note', docPaths: [], ...over });
  const wo = (over: Partial<WoDriveInput>): DriveInput =>
    ({ role: 'implementer', workOrderId: 'WO-T' as WorkOrderId, mode: 'direct', prompt: '', ...over });
  it('a workspace-keyed drive narrows to the draft arm', () => {
    expect(isDraftDrive(draft({}))).toBe(true);
  });
  it('a WO-keyed drive narrows to the WO arm', () => {
    expect(isDraftDrive(wo({}))).toBe(false);
  });
  it('the draft IS a plan drive — the provider plan-mode + ExitPlanMode contract applies unchanged', () => {
    expect(isPlanDrive(draft({}))).toBe(true);
  });
  it('an objection resume stays a draft and stays a plan drive', () => {
    expect(isDraftDrive(draft({ prompt: 'not: bağımlılıkları unutmuşsun', resume: 'sess-1' }))).toBe(true);
    expect(isPlanDrive(draft({ prompt: 'not: bağımlılıkları unutmuşsun', resume: 'sess-1' }))).toBe(true);
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

  it('a docs_root-OVERRIDDEN decision-store root fences exactly the workspace structure root (WO-0051 / D9, TD-056)', () => {
    // The cwd at the decision-store repo root with a `.docket` structure root: the OLD fence
    // would allow `<repo>/docs/**` (a wider window than the root); the aligned root fences
    // `.docket` only. Reads stay free under every alignment.
    const aligned = writeScopeFor('architect', { repoRoot: '/repo', decisionStore: '/repo/.docket' });
    expect(fenceDecision(aligned, write('/repo/.docket/roadmap.md'))).toBe('ask');
    expect(fenceDecision(aligned, write('/repo/docs/order.md'))).toBe('deny');
    expect(fenceDecision(aligned, read())).toBe('allow');
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
      { speaker: 'tool_use', tool: 'Write', detail: '/a', callId: 'c1' },
      { speaker: 'tool_result', summary: 'wrote 1 line', isError: false, callId: 'c1' },
    ]);
  });

  // 2026-08-23 (canlı panel revizyonu, §5): the fold KEEPS callId — the transcript's grouping pairs
  // a result to ITS call (parallel calls broke adjacency pairing; orphan headerless result walls
  // were the symptom). Optional: pre-callId persisted rows still pair by adjacency fallback.
  it('parallel calls keep distinct callIds through the fold', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'tool_use', callId: 'c1', tool: 'Bash', input: { command: 'ls' } });
    s = foldSessionEvent(s, { kind: 'tool_use', callId: 'c2', tool: 'Read', input: { file_path: '/b' } });
    s = foldSessionEvent(s, { kind: 'tool_result', callId: 'c2', summary: 'b ok', isError: false });
    s = foldSessionEvent(s, { kind: 'tool_result', callId: 'c1', summary: 'ls ok', isError: false });
    expect(s.entries.map((e) => (e as { callId?: string }).callId)).toEqual(['c1', 'c2', 'c2', 'c1']);
  });

  it('permission_request stops at the gate; ask_resolved (not tool_result) clears it back to running', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    expect(s.status).toBe('stopped_asking');
    expect(s.pendingAsks.map((a) => a.requestId)).toEqual(['r1']);
    // a tool_result does NOT clear the ask (WO-0027): with parallel asks it cannot say WHICH ask it answers
    s = foldSessionEvent(s, { kind: 'tool_result', callId: 'c1', summary: 'ok', isError: false });
    expect(s.pendingAsks).toHaveLength(1);
    // the runner's explicit resolution signal does
    s = foldSessionEvent(s, { kind: 'ask_resolved', requestId: 'r1' });
    expect(s.status).toBe('running');
    expect(s.pendingAsks).toHaveLength(0);
  });

  it('PARALLEL asks all survive (WO-0027 / Bulgu 10) and resolve one by one', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r2', tool: 'Edit', input: {} });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r3', tool: 'Write', input: {} });
    expect(s.pendingAsks.map((a) => a.requestId)).toEqual(['r1', 'r2', 'r3']);
    expect(s.status).toBe('stopped_asking');
    // an interleaved event no longer wipes the batch (the old single-pendingAsk bug)
    s = foldSessionEvent(s, { kind: 'tool_use', callId: 'c9', tool: 'Read', input: {} });
    expect(s.pendingAsks).toHaveLength(3);
    // answering the middle one keeps the others held
    s = foldSessionEvent(s, { kind: 'ask_resolved', requestId: 'r2' });
    expect(s.pendingAsks.map((a) => a.requestId)).toEqual(['r1', 'r3']);
    expect(s.status).toBe('stopped_asking');
    s = foldSessionEvent(s, { kind: 'ask_resolved', requestId: 'r1' });
    s = foldSessionEvent(s, { kind: 'ask_resolved', requestId: 'r3' });
    expect(s.status).toBe('running');
    expect(s.pendingAsks).toHaveLength(0);
  });

  it('a duplicate ask id (resume replay) does not double-card', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    expect(s.pendingAsks).toHaveLength(1);
  });

  it('turn_complete and error clear any held asks', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    s = foldSessionEvent(s, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 0, tokensOut: 0, usd: 0 } });
    expect(s.pendingAsks).toHaveLength(0);
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r2', tool: 'Write', input: {} });
    s = foldSessionEvent(s, { kind: 'error', message: 'x' });
    expect(s.pendingAsks).toHaveLength(0);
  });

  it('seedLiveState re-seeds persisted asks as stopped_asking (WO-0027 / Bulgu 9)', () => {
    const s = seedLiveState(
      { transcript: [], cost: undefined, providerSessionId: 'sess-1', status: 'idle' as const },
      [{ requestId: 'r1', tool: 'Write', input: { file_path: '/a' } }],
    );
    expect(s.status).toBe('stopped_asking');
    expect(s.pendingAsks[0]!.requestId).toBe('r1');
    expect(s.sessionId).toBe('sess-1');
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

  it('a budget refusal error folds its facts beside the message (WO-0047)', () => {
    const s = ev({ kind: 'error', message: 'drive refused: WO-0001 budget cap met', refusal: { observedUsd: 12.5, capUsd: 10 } });
    expect(s.status).toBe('error');
    expect(s.lastRefusal).toEqual({ observedUsd: 12.5, capUsd: 10 });
  });

  it('started clears a prior refusal — the raise-and-re-run supersedes it (WO-0047)', () => {
    const refused = ev({ kind: 'error', message: 'drive refused', refusal: { observedUsd: 1, capUsd: 1 } });
    const s = foldSessionEvent(refused, { kind: 'started', sessionId: 's1' });
    expect(s.lastRefusal).toBeUndefined();
    expect(s.status).toBe('running');
  });

  it('an uncoded, unrefused error leaves lastRefusal absent (the generic fail card path)', () => {
    const s = ev({ kind: 'error', message: 'boom' });
    expect(s.lastRefusal).toBeUndefined();
  });

  it('a multi-event session folds in order', () => {
    let s = initialSessionState;
    s = foldSessionEvent(s, { kind: 'started', sessionId: 's' });
    s = foldSessionEvent(s, { kind: 'assistant_text', text: 'planning…' });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r', tool: 'Write', input: {} });
    expect(s.status).toBe('stopped_asking');
    s = foldSessionEvent(s, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } });
    expect(s.status).toBe('done');
    // 2026-08-24: the transcript opens and closes with the session's own lifecycle notes.
    expect(s.entries).toEqual([
      { speaker: 'note', kind: 'session_started' },
      { speaker: 'assistant', text: 'planning…' },
      { speaker: 'note', kind: 'session_done' },
    ]);
    expect(s.pendingAsks).toHaveLength(0);
  });

  // 2026-08-24 (operator: "hangi saniye… onun dışında olmuş gibi duruyor"): the lifecycle events
  // carry an ISO stamp and the fold copies it into the note's detail — the döküm's timeline.
  it('the lifecycle notes carry the event stamps (started / done / interrupted)', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 's', at: '2026-08-24T02:22:01.000Z' });
    expect(s.entries.at(-1)).toEqual({ speaker: 'note', kind: 'session_started', detail: '2026-08-24T02:22:01.000Z' });
    s = foldSessionEvent(s, { kind: 'interrupted', at: '2026-08-24T02:23:07.000Z' });
    expect(s.entries.at(-1)).toEqual({ speaker: 'note', kind: 'interrupted', detail: '2026-08-24T02:23:07.000Z' });
    s = foldSessionEvent(s, { kind: 'started', sessionId: 's2', at: '2026-08-24T02:23:40.000Z' });
    s = foldSessionEvent(s, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 }, at: '2026-08-24T02:24:15.000Z' });
    // a resumed session accumulates one start/stop pair per run — the multi-run timeline
    expect(s.entries.filter((e) => e.speaker === 'note').map((e) => (e as { kind: string }).kind)).toEqual([
      'session_started', 'interrupted', 'session_started', 'session_done',
    ]);
  });

  // WO-0039 stabilization (2026-08-23, "Durdur must never say Oturum çöktü"): an intentional
  // interrupt folds to 'stopped' — terminal and calm, never 'error' (the fail card) and never a
  // stale-'running' fold (the glow that would not land).
  it('interrupted → stopped: terminal, calm, asks cleared (WO-0039 stabilization)', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 's' });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r1', tool: 'Write', input: {} });
    s = foldSessionEvent(s, { kind: 'interrupted' });
    expect(s.status).toBe('stopped');
    expect(s.pendingAsks).toHaveLength(0);
    // The session's own fact line rides the transcript — the pipeline records after folding, so
    // the LEDGER card carries the stop too (the archived döküm must not end at the last checkpoint).
    expect(s.entries.at(-1)).toEqual({ speaker: 'note', kind: 'interrupted' });
  });

  it('interrupted carries an observed cost when the runner has one (a scripted fake can)', () => {
    const s = ev({ kind: 'interrupted', cost: { tokensIn: 120, tokensOut: 24, usd: 0.02 } });
    expect(s.status).toBe('stopped');
    expect(s.cost).toEqual({ tokensIn: 120, tokensOut: 24, usd: 0.02 });
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

describe('shouldSynthesiseTurnComplete (WO-0021)', () => {
  it('plan_ready emitted, no turn_complete → true (synthesise so cost is captured)', () => {
    expect(shouldSynthesiseTurnComplete(true, false)).toBe(true);
  });
  it('turn_complete already emitted → false (no double-emit)', () => {
    expect(shouldSynthesiseTurnComplete(true, true)).toBe(false);
  });
  it('no plan_ready, no turn_complete → false (non-plan drive — the catch handles it)', () => {
    expect(shouldSynthesiseTurnComplete(false, false)).toBe(false);
  });
  it('no plan_ready but turn_complete → false', () => {
    expect(shouldSynthesiseTurnComplete(false, true)).toBe(false);
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

describe('foldSessionEvent — error code (WO-0025 / B1)', () => {
  it('carries the provider error code onto the state', () => {
    const s = foldSessionEvent(initialSessionState, { kind: 'error', message: 'raw provider string', code: 'auth_missing' });
    expect(s.status).toBe('error');
    expect(s.lastError).toBe('raw provider string');
    expect(s.lastErrorCode).toBe('auth_missing');
  });
  it('an unclassified error leaves lastErrorCode unset', () => {
    const s = foldSessionEvent(initialSessionState, { kind: 'error', message: 'mystery' });
    expect(s.lastErrorCode).toBeUndefined();
  });
});

describe('seedLiveState — resume seeding from a persisted session (WO-0026 / F14)', () => {
  it('seeds entries, cost and the session id', () => {
    const s = seedLiveState({
      transcript: [
        { speaker: 'assistant', text: 'once yapildi' },
        { speaker: 'tool_use', tool: 'Write', detail: '/a' },
      ],
      cost: { tokensIn: 10, tokensOut: 2, usd: 0.5 },
      providerSessionId: 'sess-9',
      status: 'idle' as const,
    });
    expect(s.entries).toHaveLength(2);
    expect(s.cost).toEqual({ tokensIn: 10, tokensOut: 2, usd: 0.5 });
    expect(s.sessionId).toBe('sess-9');
    expect(s.status).toBe('idle');
  });
  it('an empty session seeds the initial state', () => {
    const s = seedLiveState({ transcript: [], cost: undefined, providerSessionId: undefined, status: 'none' as const });
    expect(s).toEqual(initialSessionState);
  });
  it('a STOPPED row seeds the fold stopped — the Sürdür offer and the Durduruldu turn line derive after an app restart (2026-08-24)', () => {
    const s = seedLiveState({ transcript: [{ speaker: 'assistant', text: 'yarıda' }], cost: undefined, providerSessionId: 'sess-s', status: 'stopped' as const });
    expect(s.status).toBe('stopped');
    expect(s.sessionId).toBe('sess-s');
  });
});

describe('foldSessionEvent — steer notes (WO-0045)', () => {
  const queued = (noteId: string, note: string): RunnerEvent => ({ kind: 'steer_queued', noteId, note });
  it('a queued note grows pendingNotes and adds NO transcript line — the chip count is the only visible change mid-turn (AC2)', () => {
    const s = foldSessionEvent(initialSessionState, queued('n1', 'şunu atla'));
    expect(s.pendingNotes).toEqual([{ id: 'n1', text: 'şunu atla' }]);
    expect(s.entries).toEqual([]);
  });
  it('two queued notes accumulate in order', () => {
    let s = foldSessionEvent(initialSessionState, queued('n1', 'bir'));
    s = foldSessionEvent(s, queued('n2', 'iki'));
    expect(s.pendingNotes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });
  it('a delivered note appends the OPERATOR line and drops from pending (AC3)', () => {
    let s = foldSessionEvent(initialSessionState, queued('n1', 'şunu atla'));
    s = foldSessionEvent(s, { kind: 'steer_delivered', noteId: 'n1', text: 'şunu atla' });
    expect(s.pendingNotes).toEqual([]);
    expect(s.entries).toEqual([{ speaker: 'operator', text: 'şunu atla', noteId: 'n1' }]);
  });
  it('delivery of an unknown noteId still appends the operator line — the delivery event is authoritative', () => {
    const s = foldSessionEvent(initialSessionState, { kind: 'steer_delivered', noteId: 'ghost', text: 'geç not' });
    expect(s.entries).toEqual([{ speaker: 'operator', text: 'geç not', noteId: 'ghost' }]);
  });
  it('a retracted note drops from pending without a transcript line (AC5)', () => {
    let s = foldSessionEvent(initialSessionState, queued('n1', 'bir'));
    s = foldSessionEvent(s, queued('n2', 'iki'));
    s = foldSessionEvent(s, { kind: 'steer_retracted', noteId: 'n1' });
    expect(s.pendingNotes.map((n) => n.id)).toEqual(['n2']);
    expect(s.entries).toEqual([]);
  });
  it('an interrupted drive KEEPS its pending notes — Durdur persists the queue for Sürdür (AC4)', () => {
    let s = foldSessionEvent(initialSessionState, queued('n1', 'bir'));
    s = foldSessionEvent(s, { kind: 'interrupted', at: '2026-08-26T10:00:00Z' });
    expect(s.status).toBe('stopped');
    expect(s.pendingNotes.map((n) => n.id)).toEqual(['n1']);
  });
  it('seedLiveState re-seeds pending notes from the row (the asks pattern)', () => {
    const s = seedLiveState({
      transcript: [],
      cost: undefined,
      providerSessionId: 'sess-s',
      status: 'stopped' as const,
      pendingNotes: [{ id: 'n1', text: 'bir' }],
    });
    expect(s.status).toBe('stopped');
    expect(s.pendingNotes).toEqual([{ id: 'n1', text: 'bir' }]);
  });
});

describe('foldSessionEvent — context readout (WO-0046)', () => {
  it('a context report sets the reading and adds NO transcript line — the pane state is the only change', () => {
    const s = foldSessionEvent(initialSessionState, { kind: 'context_usage', usedTokens: 50438, maxTokens: 1000000, percentage: 5 });
    expect(s.context).toEqual({ usedTokens: 50438, maxTokens: 1000000, percentage: 5 });
    expect(s.entries).toEqual([]);
  });
  it('a report carrying cost updates state.cost — the ONLY mid-drive token source (D3 folds one terminal turn_complete)', () => {
    const s = foldSessionEvent(initialSessionState, { kind: 'context_usage', usedTokens: 1, maxTokens: 2, percentage: 1, cost: { tokensIn: 68, tokensOut: 2, usd: 0.41 } });
    expect(s.cost).toEqual({ tokensIn: 68, tokensOut: 2, usd: 0.41 });
  });
  it('a report without cost leaves state.cost untouched (absent, not zero)', () => {
    const seeded = { ...initialSessionState, cost: { tokensIn: 10, tokensOut: 1, usd: 0.2 } };
    const s = foldSessionEvent(seeded, { kind: 'context_usage', usedTokens: 1, maxTokens: 2, percentage: 1 });
    expect(s.cost).toEqual({ tokensIn: 10, tokensOut: 1, usd: 0.2 });
  });
  it('a report stamped `at` refreshes the staleness anchor — a fresh reading is a liveness proof (probe c1: thinking bursts)', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 'x', at: '2026-08-26T10:00:00Z' });
    s = foldSessionEvent(s, { kind: 'context_usage', usedTokens: 1, maxTokens: 2, percentage: 1, at: '2026-08-26T10:05:00Z' });
    expect(s.lastLifeAt).toBe('2026-08-26T10:05:00Z');
  });
});

describe('foldSessionEvent — liveness anchor (WO-0046)', () => {
  it('a stamped entry moves lastLifeAt; an unstamped one leaves the prior anchor alone (a scripted fake may omit stamps)', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 'x', at: '2026-08-26T10:00:00Z' });
    s = foldSessionEvent(s, { kind: 'tool_use', callId: 'c1', tool: 'Read', input: {}, at: '2026-08-26T10:01:00Z' });
    expect(s.lastLifeAt).toBe('2026-08-26T10:01:00Z');
    s = foldSessionEvent(s, { kind: 'assistant_text', text: 'stampesiz' });
    expect(s.lastLifeAt).toBe('2026-08-26T10:01:00Z');
  });
  it('a stamped ask_resolved refreshes the anchor — answering a held ask must not flash the staleness line (WO-0046 review f1)', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 'x', at: '2026-08-26T10:00:00Z' });
    s = foldSessionEvent(s, { kind: 'permission_request', requestId: 'r1', tool: 'Bash', input: {} });
    expect(s.status).toBe('stopped_asking');
    s = foldSessionEvent(s, { kind: 'ask_resolved', requestId: 'r1', at: '2026-08-26T10:09:00Z' });
    expect(s.status).toBe('running');
    expect(s.lastLifeAt).toBe('2026-08-26T10:09:00Z'); // the wait was the OPERATOR's, not the drive's
  });
  it('terminal events stamp the anchor too (turn_complete / interrupted), but the status gate makes them moot', () => {
    let s = foldSessionEvent(initialSessionState, { kind: 'started', sessionId: 'x', at: '2026-08-26T10:00:00Z' });
    s = foldSessionEvent(s, { kind: 'turn_complete', stopReason: 'end', cost: { tokensIn: 0, tokensOut: 0, usd: 0 }, at: '2026-08-26T10:02:00Z' });
    expect(s.status).toBe('done');
    expect(s.lastLifeAt).toBe('2026-08-26T10:02:00Z');
  });
});

describe('staleMinutes (WO-0046)', () => {
  const anchor = '2026-08-26T10:00:00Z';
  const at = (min: number) => Date.parse(anchor) + min * 60000;
  it('is undefined unless the fold is running — a stopped drive keeps its frozen words, an asking drive says why it waits', () => {
    const running = { status: 'running' as const, lastLifeAt: anchor };
    expect(staleMinutes({ ...running, status: 'stopped' as const }, at(10))).toBeUndefined();
    expect(staleMinutes({ ...running, status: 'stopped_asking' as const }, at(10))).toBeUndefined();
    expect(staleMinutes({ ...running, status: 'error' as const }, at(10))).toBeUndefined();
  });
  it('is undefined with no liveness proof ever — the boot window has nothing to count from', () => {
    expect(staleMinutes({ status: 'running', lastLifeAt: undefined }, at(10))).toBeUndefined();
  });
  it('counts whole minutes from the last proof and crosses the threshold', () => {
    const s = { status: 'running' as const, lastLifeAt: anchor };
    expect(staleMinutes(s, at(0))).toBe(0);
    expect(staleMinutes(s, at(2.9))).toBe(2);
    expect(staleMinutes(s, at(STALE_AFTER_MIN))).toBe(STALE_AFTER_MIN);
    expect(staleMinutes(s, at(10))).toBe(10);
  });
  it('an unparseable stamp is undefined, never NaN', () => {
    expect(staleMinutes({ status: 'running', lastLifeAt: 'not-a-date' }, at(10))).toBeUndefined();
  });
});
