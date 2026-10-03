import { describe, expect, it } from 'vitest';
import type { EpochMs } from '../shared/index';
import type { AgentEvent } from './agent-event';
import {
  CHECKPOINT_MIN_INTERVAL_MS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  PACK_CHARS_PER_TOKEN,
  ROLLING_NOTE_MAX_CHARS,
  definitionsDigest,
  deriveTaskState,
  extendRollingNote,
  renderHandoffPrompt,
  sizeHandoffPack,
} from './handoff';
import type { HandoffPack, RollingNote, TaskState } from './handoff';
import type { InstructionPlan } from './instructions';

const AT: EpochMs = 1_760_000_000_000;
const at = (offset: number): EpochMs => AT + offset;

const toolCall = (over: { readonly at: EpochMs; readonly id: string; readonly name: string; readonly target?: string }): AgentEvent => ({ type: 'tool_call', ...over });
const toolResult = (over: { readonly at: EpochMs; readonly id: string; readonly ok: boolean }): AgentEvent => ({ type: 'tool_result', ...over });
const ask = (over: { readonly at: EpochMs; readonly id: string; readonly tool: string }): AgentEvent => ({ type: 'permission_ask', options: ['allow', 'deny'], ...over });

const plan = (inlinedContent: readonly { readonly name: string; readonly content: string }[]): InstructionPlan => ({
  native: ['AGENTS.md'],
  inlined: inlinedContent.map((f) => ({ ...f })),
  truncated: [],
});

const pack = (over: Partial<HandoffPack> = {}): HandoffPack => ({
  stagePrompt: 'Work order: Fix the login bug\nFlow: Standard flow\nStage: Implement',
  acceptance: ['Command set "check" passes (npm test)', 'Secret scan of the worktree reports no findings'],
  instructionPlan: plan([{ name: 'A.md', content: 'a'.repeat(50) }, { name: 'B.md', content: 'b'.repeat(30) }]),
  taskState: {
    lastCommand: { name: 'Bash', target: 'npm test', ok: true },
    toolCalls: 4,
    failedToolCalls: 1,
    openPermissionAsks: ['ask-2'],
    filesTouched: ['src/a.ts'],
  },
  codeState: { files: ['src/a.ts'], patch: 'diff --git a/src/a.ts b/src/a.ts\n+hello' },
  summary: { text: 'the run so far', capped: false },
  definitionsChanged: false,
  ...over,
});

describe('deriveTaskState', () => {
  it('R-55: reads only tool_call, tool_result and permission_ask events — nothing else moves the state', () => {
    const toolEvents: readonly AgentEvent[] = [
      toolCall({ at: at(1), id: 'c1', name: 'Bash', target: 'npm test' }),
      toolResult({ at: at(2), id: 'c1', ok: true }),
      ask({ at: at(3), id: 'a1', tool: 'Write' }),
    ];
    const noisy: readonly AgentEvent[] = [
      { type: 'session_started', at: at(0), sessionRef: 'sess-SECRET-REF' },
      ...toolEvents,
      { type: 'text', at: at(4), delta: 'progress text' },
      { type: 'thinking', at: at(5), delta: 'thinking text' },
      { type: 'usage', at: at(6), inputTokens: 10, outputTokens: 5 },
      { type: 'limit_hit', at: at(7), hit: { class: 'window_exhausted', remedies: [] } },
      { type: 'error', at: at(8), class: 'network', message: 'boom' },
      { type: 'finished', at: at(9), reason: 'limit' },
      { type: 'raw', at: at(10), line: 'raw line' },
    ];
    expect(deriveTaskState(noisy, [])).toEqual(deriveTaskState(toolEvents, []));
    // The session ref never enters the derived state (A-61).
    expect(JSON.stringify(deriveTaskState(noisy, []))).not.toContain('sess-SECRET-REF');
  });

  it('R-55: counts tool calls and failed tool results', () => {
    const events: readonly AgentEvent[] = [
      toolCall({ at: at(1), id: 'c1', name: 'Bash' }),
      toolCall({ at: at(2), id: 'c2', name: 'Read' }),
      toolResult({ at: at(3), id: 'c1', ok: false }),
      toolResult({ at: at(4), id: 'c2', ok: true }),
      toolCall({ at: at(5), id: 'c3', name: 'Grep' }),
    ];
    const state = deriveTaskState(events, []);
    expect(state.toolCalls).toBe(3);
    expect(state.failedToolCalls).toBe(1);
  });

  it('R-55: open permission asks are ask ids without a later tool result of the same id', () => {
    const events: readonly AgentEvent[] = [
      toolResult({ at: at(0), id: 'early', ok: true }), // a result before its ask matches nothing
      ask({ at: at(1), id: 'a1', tool: 'Write' }),
      ask({ at: at(2), id: 'a2', tool: 'Edit' }),
      toolResult({ at: at(3), id: 'a1', ok: true }),
    ];
    expect(deriveTaskState(events, []).openPermissionAsks).toEqual(['a2']);
  });

  it('R-55: lastCommand is the last tool call with a matching result — name, target, ok', () => {
    const events: readonly AgentEvent[] = [
      toolCall({ at: at(1), id: 'c1', name: 'Bash', target: 'npm test' }),
      toolResult({ at: at(2), id: 'c1', ok: true }),
      toolCall({ at: at(3), id: 'c2', name: 'Read', target: 'src/a.ts' }),
      toolResult({ at: at(4), id: 'c2', ok: false }),
    ];
    expect(deriveTaskState(events, []).lastCommand).toEqual({ name: 'Read', target: 'src/a.ts', ok: false });
  });

  it('R-55: a trailing tool call without a result falls back to the last command whose outcome is known', () => {
    const events: readonly AgentEvent[] = [
      toolCall({ at: at(1), id: 'c1', name: 'Bash', target: 'npm test' }),
      toolResult({ at: at(2), id: 'c1', ok: true }),
      toolCall({ at: at(3), id: 'c2', name: 'Write' }),
    ];
    expect(deriveTaskState(events, []).lastCommand).toEqual({ name: 'Bash', target: 'npm test', ok: true });
    expect(deriveTaskState([], []).lastCommand).toBeUndefined();
  });

  it('R-55: filesTouched comes from the checkpoint diff, not from event targets', () => {
    const events: readonly AgentEvent[] = [
      toolCall({ at: at(1), id: 'c1', name: 'Write', target: 'from-event.ts' }),
      toolResult({ at: at(2), id: 'c1', ok: true }),
    ];
    const state: TaskState = deriveTaskState(events, ['src/real-diff.ts']);
    expect(state.filesTouched).toEqual(['src/real-diff.ts']);
  });
});

describe('extendRollingNote', () => {
  it('R-55: appends only text and thinking deltas — no other event kind reaches the note', () => {
    const events: readonly AgentEvent[] = [
      { type: 'text', at: at(1), delta: 'alpha ' },
      { type: 'thinking', at: at(2), delta: 'beta' },
      { type: 'usage', at: at(3), inputTokens: 1, outputTokens: 1 },
      { type: 'raw', at: at(4), line: 'noise' },
    ];
    expect(extendRollingNote(undefined, events)).toEqual({ text: 'alpha beta', capped: false });
    const prior: RollingNote = { text: 'note: ', capped: false };
    expect(extendRollingNote(prior, events)).toEqual({ text: 'note: alpha beta', capped: false });
  });

  it('R-55: keeps the tail under the cap and flags capped once truncated', () => {
    const long = 'x'.repeat(ROLLING_NOTE_MAX_CHARS + 10);
    const first = extendRollingNote(undefined, [{ type: 'text', at: at(1), delta: long }]);
    expect(first.capped).toBe(true);
    expect(first.text).toBe(long.slice(10));
    expect(first.text.length).toBe(ROLLING_NOTE_MAX_CHARS);
    // A later batch with no text keeps the tail and the capped flag.
    const second = extendRollingNote(first, [{ type: 'usage', at: at(2), inputTokens: 1, outputTokens: 1 }]);
    expect(second).toEqual({ text: first.text, capped: true });
  });
});

describe('sizeHandoffPack', () => {
  const measure = (p: HandoffPack): number =>
    p.stagePrompt.length +
    p.acceptance.join('\n').length +
    p.instructionPlan.inlined.reduce((sum, f) => sum + f.content.length, 0) +
    p.codeState.patch.length +
    p.summary.text.length;

  it('R-56: a pack within the budget is returned unchanged', () => {
    const p = pack();
    expect(sizeHandoffPack(p, { maxChars: measure(p) })).toEqual(p);
    expect(sizeHandoffPack(p, { maxChars: measure(p) + 1 })).toEqual(p);
  });

  it('R-56: the summary is cut first — the tail is kept and capped is flagged', () => {
    const p = pack({ summary: { text: 'a'.repeat(200), capped: false } });
    const sized = sizeHandoffPack(p, { maxChars: measure(p) - 50 });
    expect(sized.summary).toEqual({ text: 'a'.repeat(150), capped: true });
    expect(sized.codeState).toEqual(p.codeState);
    expect(sized.instructionPlan).toEqual(p.instructionPlan);
    expect(sized.stagePrompt).toBe(p.stagePrompt);
    expect(sized.acceptance).toEqual(p.acceptance);
  });

  it('R-56: after the summary the patch body is cut with a marker in place of the cut — the file list is kept', () => {
    const p = pack({
      summary: { text: 'short', capped: false },
      codeState: { files: ['src/a.ts'], patch: 'p'.repeat(100) },
    });
    const sized = sizeHandoffPack(p, { maxChars: measure(p) - 65 });
    expect(sized.summary).toEqual({ text: '', capped: true });
    expect(sized.codeState.files).toEqual(['src/a.ts']);
    expect(sized.codeState.patch.startsWith('p'.repeat(40))).toBe(true);
    expect(sized.codeState.patch).toContain('truncated');
    expect(sized.codeState.patch).toContain('40 of 100');
    expect(sized.instructionPlan).toEqual(p.instructionPlan);
  });

  it('R-56: inlined files are cut in reverse candidate order — earlier candidates survive', () => {
    const p = pack({
      summary: { text: '', capped: false },
      codeState: { files: [], patch: '' },
      instructionPlan: plan([
        { name: 'A.md', content: 'a'.repeat(50) },
        { name: 'B.md', content: 'b'.repeat(30) },
        { name: 'C.md', content: 'c'.repeat(20) },
      ]),
    });
    // Cut deeper than summary and patch can absorb (both empty): C is dropped whole first…
    const dropC = sizeHandoffPack(p, { maxChars: measure(p) - 20 });
    expect(dropC.instructionPlan.inlined.map((f) => f.name)).toEqual(['A.md', 'B.md']);
    expect(dropC.instructionPlan.truncated).toEqual(['C.md']);
    // …then B, whole, before A loses anything.
    const dropB = sizeHandoffPack(p, { maxChars: measure(p) - 50 });
    expect(dropB.instructionPlan.inlined.map((f) => f.name)).toEqual(['A.md']);
    expect(dropB.instructionPlan.truncated).toEqual(['C.md', 'B.md']);
    expect(dropB.instructionPlan.inlined[0].content).toBe('a'.repeat(50));
  });

  it('R-56: a partial cut of an inlined file leaves a marker naming the file and the kept chars', () => {
    const p = pack({
      summary: { text: '', capped: false },
      codeState: { files: [], patch: '' },
      instructionPlan: plan([
        { name: 'A.md', content: 'a'.repeat(50) },
        { name: 'B.md', content: 'b'.repeat(30) },
      ]),
    });
    const sized = sizeHandoffPack(p, { maxChars: measure(p) - 40 });
    expect(sized.instructionPlan.inlined.map((f) => f.name)).toEqual(['A.md']);
    // 40 cut: B (30) goes whole, the remaining 10 come off A's tail with a marker.
    const a = sized.instructionPlan.inlined[0];
    expect(a.content.startsWith('a'.repeat(40))).toBe(true);
    expect(a.content).toContain('A.md');
    expect(a.content).toContain('truncated');
    expect(sized.instructionPlan.truncated).toEqual(['B.md', 'A.md']);
  });

  it('R-56: a budget below the untouchable core is a caller bug, not a smaller pack — the core survives', () => {
    const p = pack();
    const sized = sizeHandoffPack(p, { maxChars: 0 });
    expect(sized.stagePrompt).toBe(p.stagePrompt);
    expect(sized.acceptance).toEqual(p.acceptance);
    expect(sized.taskState).toEqual(p.taskState);
    expect(sized.codeState.files).toEqual(p.codeState.files);
    expect(sized.instructionPlan.inlined).toEqual([]);
    expect(sized.summary).toEqual({ text: '', capped: true });
  });
});

describe('renderHandoffPrompt', () => {
  it('R-57: the checks-first preamble is the first line', () => {
    const firstLine = renderHandoffPrompt(pack()).split('\n')[0];
    expect(firstLine.toLowerCase()).toContain("first run the stage's checks");
    expect(firstLine.toLowerCase()).toContain('then continue');
  });

  it('R-57: with definitionsChanged the note sits directly after the preamble — and only then', () => {
    const lines = renderHandoffPrompt(pack({ definitionsChanged: true })).split('\n');
    expect(lines[1].toLowerCase()).toContain('definition changed since the first leg');
    expect(renderHandoffPrompt(pack())).not.toContain('definition changed since the first leg');
  });

  it('R-57: fixed order — stage prompt, acceptance, instructions, task state, code state, summary', () => {
    const prompt = renderHandoffPrompt(pack());
    const positions = [
      prompt.indexOf('Stage: Implement'),
      prompt.indexOf('Command set "check" passes'),
      prompt.indexOf('A.md'),
      prompt.indexOf('Last command'),
      prompt.indexOf('src/a.ts'),
      prompt.indexOf('the run so far'),
    ];
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('R-57: never embeds a session ref or an account id — quoted pack data only', () => {
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: at(0), sessionRef: 'sess-LEAK-REF' },
      toolCall({ at: at(1), id: 'c1', name: 'Bash', target: 'npm test' }),
      toolResult({ at: at(2), id: 'c1', ok: true }),
    ];
    const state = deriveTaskState(events, ['src/a.ts']);
    const prompt = renderHandoffPrompt(pack({ taskState: state }));
    expect(prompt).not.toContain('sess-LEAK-REF');
  });

  it('renders no instruction section when the plan has nothing inlined', () => {
    const prompt = renderHandoffPrompt(pack({ instructionPlan: { native: ['AGENTS.md'], inlined: [], truncated: [] } }));
    expect(prompt.toLowerCase()).not.toContain('project context');
  });
});

describe('definitionsDigest', () => {
  it('R-57: deterministic — the same text yields the same 8 lower-case hex chars, different text a different digest', () => {
    const layers = 'Work order: Fix the login bug\nFlow: Standard flow\nStage: Implement';
    const first = definitionsDigest(layers);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(definitionsDigest(layers)).toBe(first);
    expect(definitionsDigest(`${layers}\nRole instructions: ship it`)).not.toBe(first);
    // The FNV-1a offset basis: the empty text's digest is the algorithm's starting state.
    expect(definitionsDigest('')).toBe('811c9dc5');
  });
});

describe('handoff constants', () => {
  it('carries the contract constants', () => {
    expect(ROLLING_NOTE_MAX_CHARS).toBe(8_000);
    expect(PACK_CHARS_PER_TOKEN).toBe(4);
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(32_768);
    expect(CHECKPOINT_MIN_INTERVAL_MS).toBe(30_000);
  });
});
