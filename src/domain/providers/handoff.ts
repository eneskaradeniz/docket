// providers/handoff.ts — the handoff pack core (P-38). Contract: docs/v2/domain.md section 11.
import type { AgentEvent } from './agent-event';
import type { InstructionPlan, RepoInstructionFile } from './instructions';
import { renderInstructionBlock } from './instructions';

export interface TaskState {
  readonly lastCommand?: { readonly name: string; readonly target?: string; readonly ok: boolean };
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[];
  readonly filesTouched: readonly string[]; // from the checkpoint diff — ground truth, not event targets
}

/** Deterministic extraction from run events (P-38 item 3). Raw transcripts never enter it. */
export function deriveTaskState(events: readonly AgentEvent[], filesTouched: readonly string[]): TaskState {
  let toolCalls = 0;
  let failedToolCalls = 0;
  let lastCommand: TaskState['lastCommand'];
  // Accumulators only — the input stream is never touched.
  const openAsks: string[] = [];
  const okById = new Map<string, boolean>();
  for (const event of events) {
    if (event.type === 'tool_result') {
      if (!event.ok) failedToolCalls += 1;
      okById.set(event.id, event.ok);
    }
  }

  // One ordered pass mirrors the stream: asks close only on a result that arrives after them.
  for (const event of events) {
    switch (event.type) {
      case 'tool_call': {
        toolCalls += 1;
        // Only a call whose outcome is known can be "the last command" — ok is not optional.
        const ok = okById.get(event.id);
        if (ok !== undefined) lastCommand = { name: event.name, target: event.target, ok };
        break;
      }
      case 'permission_ask':
        if (!openAsks.includes(event.id)) openAsks.push(event.id);
        break;
      case 'tool_result':
        closeAsk(openAsks, event.id);
        break;
      default:
        break;
    }
  }

  return { lastCommand, toolCalls, failedToolCalls, openPermissionAsks: openAsks, filesTouched };
}

/** Closes a still-open ask; results that arrive before their ask match nothing. */
const closeAsk = (open: string[], id: string): void => {
  const index = open.indexOf(id);
  if (index >= 0) open.splice(index, 1);
};

export interface RollingNote {
  readonly text: string;
  readonly capped: boolean;
}
export const ROLLING_NOTE_MAX_CHARS: number = 8_000;

/** Pure fold: appends new text/thinking deltas and keeps the tail; `capped: true` once truncated. */
export function extendRollingNote(note: RollingNote | undefined, events: readonly AgentEvent[]): RollingNote {
  let text = note?.text ?? '';
  for (const event of events) {
    if (event.type === 'text' || event.type === 'thinking') text += event.delta;
  }
  if (text.length <= ROLLING_NOTE_MAX_CHARS) return { text, capped: note?.capped ?? false };
  return { text: text.slice(text.length - ROLLING_NOTE_MAX_CHARS), capped: true };
}

export interface HandoffPack {
  readonly stagePrompt: string; // item 1 — stageBrief, recomputed (A-62)
  readonly acceptance: readonly string[]; // item 1
  readonly instructionPlan: InstructionPlan; // item 2 — for the TARGET provider (P-37)
  readonly taskState: TaskState; // item 3
  readonly codeState: { readonly files: readonly string[]; readonly patch: string }; // item 4
  readonly summary: RollingNote; // item 5
  readonly definitionsChanged: boolean; // the definitions changed since the first leg (A-62)
}
export interface PackBudget {
  readonly maxChars: number;
}
export const PACK_CHARS_PER_TOKEN: number = 4; // chars ↔ tokens estimate for sizing only
export const DEFAULT_CONTEXT_WINDOW_TOKENS: number = 32_768; // stand-in for an unknown window (A-63)
/** Throttles checkpoint commits; no timer exists — the cadence is event-boundary + terminal (A-57). */
export const CHECKPOINT_MIN_INTERVAL_MS: number = 30_000;

/** The char count the budget governs: the renderable text of every field the priority list names. */
const measurePack = (pack: HandoffPack): number =>
  pack.stagePrompt.length +
  pack.acceptance.join('\n').length +
  pack.instructionPlan.inlined.reduce((sum, file) => sum + file.content.length, 0) +
  pack.codeState.patch.length +
  pack.summary.text.length;

const patchMarker = (kept: number, total: number): string => `[... patch truncated — ${kept} of ${total} chars kept]`;

/** Deterministic truncation to the budget. Priority: stagePrompt and the Docket layers never
 *  truncate; then inlined files (reverse candidate order), then the patch body (file list kept,
 *  marker left in place of the cut), then the summary. */
export function sizeHandoffPack(pack: HandoffPack, budget: PackBudget): HandoffPack {
  let over = measurePack(pack) - budget.maxChars;
  if (over <= 0) return pack;

  // 1. Summary first — the tail is the most recent content, so the cut comes off the front.
  const summaryCut = Math.min(over, pack.summary.text.length);
  const summary: RollingNote =
    summaryCut === 0 ? pack.summary : { text: pack.summary.text.slice(summaryCut), capped: true };
  over -= summaryCut;

  // 2. Patch body — the head carries the file headers, so it stays; a marker replaces the cut.
  let codeState = pack.codeState;
  if (over > 0 && codeState.patch.length > 0) {
    const cut = Math.min(over, codeState.patch.length);
    const kept = codeState.patch.slice(0, codeState.patch.length - cut);
    codeState = { files: codeState.files, patch: `${kept}${patchMarker(kept.length, codeState.patch.length)}` };
    over -= cut;
  }

  // 3. Inlined files, reverse candidate order: the last candidate is cut first and whole, so
  //    earlier candidates survive longest. A partial cut leaves the marker naming file and kept chars.
  const inlined: RepoInstructionFile[] = [...pack.instructionPlan.inlined];
  const truncated: string[] = [...pack.instructionPlan.truncated];
  while (over > 0 && inlined.length > 0) {
    const file = inlined[inlined.length - 1];
    if (file.content.length <= over) {
      inlined.pop();
      truncated.push(file.name);
      over -= file.content.length;
      continue;
    }
    const kept = file.content.slice(0, file.content.length - over);
    inlined[inlined.length - 1] = {
      name: file.name,
      content: `${kept}\n[... ${file.name} truncated — ${kept.length} of ${file.content.length} chars kept]`,
    };
    truncated.push(file.name);
    over = 0; // the marker's own chars are tolerated — they name the cut, never replace the core
  }

  return {
    ...pack,
    instructionPlan: { ...pack.instructionPlan, inlined, truncated },
    codeState,
    summary,
  };
}

/** The continuation prompt: checks-first preamble, stage prompt, acceptance, effective
 *  instructions block, task state, code state, summary — fixed order, English. With
 *  `definitionsChanged` set, the note "definition changed since the first leg" follows the
 *  preamble; quoted repo material stays under its data heading (never Docket instructions). */
export function renderHandoffPrompt(pack: HandoffPack): string {
  const lines: string[] = ["First run the stage's checks, then continue."];
  if (pack.definitionsChanged) {
    lines.push('Definition changed since the first leg — the stage prompt below is recomputed from the current definitions.');
  }

  lines.push('', '# Stage prompt', pack.stagePrompt);

  lines.push('', '## Acceptance criteria');
  for (const criterion of pack.acceptance) lines.push(`- ${criterion}`);

  const instructionBlock = renderInstructionBlock(pack.instructionPlan);
  if (instructionBlock !== '') lines.push('', instructionBlock);

  const { taskState } = pack;
  lines.push('', '## Task state');
  if (taskState.lastCommand !== undefined) {
    const target = taskState.lastCommand.target === undefined ? '' : ` ${taskState.lastCommand.target}`;
    lines.push(`- Last command: ${taskState.lastCommand.name}${target} — ${taskState.lastCommand.ok ? 'succeeded' : 'failed'}`);
  } else {
    lines.push('- Last command: none yet');
  }
  lines.push(`- Tool calls: ${taskState.toolCalls} (${taskState.failedToolCalls} failed)`);
  lines.push(
    taskState.openPermissionAsks.length === 0
      ? '- Open permission asks: none'
      : `- Open permission asks: ${taskState.openPermissionAsks.join(', ')}`,
  );
  lines.push(
    taskState.filesTouched.length === 0
      ? '- Files touched: none'
      : `- Files touched: ${taskState.filesTouched.join(', ')}`,
  );

  lines.push('', '## Code state');
  lines.push(
    pack.codeState.files.length === 0
      ? 'Files: none'
      : `Files: ${pack.codeState.files.join(', ')}`,
  );
  // A four-backtick fence: diff text may itself quote a three-backtick block.
  lines.push('Patch:', '````', pack.codeState.patch, '````');

  lines.push('', '## Progress summary');
  lines.push(pack.summary.text === '' ? '(no summary yet)' : pack.summary.text);

  return lines.join('\n');
}

// FNV-1a's 32-bit offset basis and prime; Math.imul keeps the multiply a 32-bit one (Math.random
// is the banned Math member — this is the deterministic integer arithmetic the algorithm needs).
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Pure 32-bit FNV-1a over the text, rendered as 8 lower-case hex chars. Deterministic (R-57):
 *  the same text always yields the same digest, different text a different one. `executeRun`
 *  writes it as the run record's `definitionsRev` — the digest of the Docket layers the agent
 *  was given (`stageBrief`, then `role.instructions`); `buildHandoff` compares it to the digest
 *  of the current layers for `definitionsChanged` (A-62). */
export function definitionsDigest(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
