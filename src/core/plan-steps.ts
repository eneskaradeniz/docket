// src/core/plan-steps.ts — pure parser for the ```steps fence at the end of plan.md (WO-0017).
//
// A plan is the architect's prose PLUS a machine-readable step list. The step list is a fenced block:
//   ```steps
//   [
//     {"role":"implementer","aim":"core","scope":"app"},
//     {"role":"verifier","aim":"test","scope":"all"}
//   ]
//   ```
// This file turns that block into a validated `StepSpec[]`. It is the CONSUMER half of the contract;
// the PRODUCER is `architectPrompt` (order-md.ts), which instructs the architect to end the plan with the
// fence. Pure text → struct, no I/O, no branded ids (scope is classified, not resolved — ADR-0003).
//
// Failure is honest, not silent: any malformation (missing fence, non-JSON, non-array, a bad element)
// collapses the whole result to `[]` — "no runnable steps" — rather than a misleading partial list. The
// operator sees a dead-end and re-plans. This is the WO-0017 degradation contract.
import type { StepRole, StepScope, StepSpec } from './types';

// Tokens the architect (or the operator) may use for a whole-repo scope. 'hepsi' = the mock's Turkish
// token ("all"); tolerate it so a plan authored against the mock runs unchanged.
const ALL_SCOPE_TOKENS = new Set(['all', 'hepsi', '*']);

/** Classify a raw scope string: empty/all/hepsi/* → 'all'; anything else → a track ref (untrimmed-of-case). */
export function classifyStepScope(raw: string): StepScope {
  const t = raw.trim().toLowerCase();
  if (t === '' || ALL_SCOPE_TOKENS.has(t)) return { kind: 'all' };
  return { kind: 'track', ref: raw.trim() };
}

function isStepRole(v: unknown): v is StepRole {
  return v === 'implementer' || v === 'verifier' || v === 'architect';
}

// Locate the LAST ```steps fence in the document and return its inner text, or null when there is none.
// "Last" wins so a stray earlier draft fence cannot override the architect's final, intended list.
function lastStepsFence(md: string): string | null {
  const re = /```steps\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(md));) last = m[1]!;
  return last;
}

// Locate the LAST ```steps fence's [start, end) range, or null — shared by the parser and the splitter.
function lastStepsFenceRange(md: string): [number, number] | null {
  const re = /```steps\s*\n[\s\S]*?```/g;
  let last: [number, number] | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(md));) last = [m.index, m.index + m[0].length];
  return last;
}

/**
 * Split plan.md into its two presentation halves (WO-0031d tur-2: the fence never renders raw —
 * Belgeler shows the prose plus a step-card summary). The fence BLOCK is stripped from the prose even
 * when its body is malformed (raw JSON is banned from the screen either way); `steps` then degrades
 * to `[]` exactly like `parsePlanSteps`.
 */
/** Reorder the editor's stage by ARRAY POSITION (drag-and-drop, 2026-08-23): splice the `from`
 *  element to `to`, then renumber the 1-based `idx` to the new order. Same index or out-of-bounds
 *  is a no-op that returns the SAME array reference (the caller's state bail-out). Generic so the
 *  caller's row identities (the editor's stable `uid`) ride the reorder untouched. */
export function moveStep<T extends StepSpec>(steps: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next.map((s, i) => ({ ...s, idx: i + 1 }));
}

export function splitStepsFence(md: string): { prose: string; steps: StepSpec[] } {
  const range = lastStepsFenceRange(md ?? '');
  if (range == null) return { prose: md ?? '', steps: parsePlanSteps(md ?? '') };
  // 2026-08-23 (operator ruling): after the fence leaves the prose, a trailing "## Steps" heading
  // whose ONLY content was that fence is a dangling stump (the steps render as the PLAN HAZIR
  // rows) — the document view ends at its last real paragraph. A heading with text after the
  // fence is a real section and the regex's $ anchor leaves it alone.
  const prose = (md.slice(0, range[0]) + md.slice(range[1]))
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .replace(/\n##\s+[Ss]teps\s*$/, '')
    .trimEnd();
  return { prose, steps: parsePlanSteps(md) };
}

/**
 * Parse plan.md's ```steps fence into a validated `StepSpec[]`.
 * Returns `[]` when there is no fence, the body is not valid JSON, the JSON is not an array, or ANY
 * element fails validation (role not in the enum, empty aim, empty scope). Never throws, never partial.
 */
export function parsePlanSteps(md: string): StepSpec[] {
  const body = lastStepsFence(md ?? '');
  if (body == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StepSpec[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const e = parsed[i] as Record<string, unknown> | null;
    const role = e?.role;
    const aim = typeof e?.aim === 'string' ? e.aim.trim() : '';
    const scopeRaw = typeof e?.scope === 'string' ? e.scope : '';
    // Any single bad element invalidates the whole list — no partial parse (a half-list would mislead the
    // step sequencer into running an incomplete plan).
    if (!isStepRole(role)) return [];
    if (!aim) return [];
    if (!scopeRaw.trim()) return [];
    out.push({ idx: i + 1, role, aim, scope: classifyStepScope(scopeRaw) });
  }
  return out;
}

/**
 * The EDIT half of the fence contract (WO-0031c): rewrite the LAST ```steps fence body with the given
 * steps, preserving every other line of the plan. No fence → the text is returned UNCHANGED (the caller
 * guards: editing requires a parsed plan, i.e. a fence). Serializes one compact object per line, keys in
 * the producer's role/aim/scope order, scope serialized back to its raw token form.
 */
export function applyStepEdits(planText: string, steps: StepSpec[]): string {
  const re = /```steps\s*\n[\s\S]*?```/g;
  let last: { start: number; end: number } | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(planText));) last = { start: m.index, end: m.index + m[0].length };
  if (!last) return planText;
  const body = ['[', steps.map((s) => `  ${JSON.stringify({ role: s.role, aim: s.aim, scope: s.scope.kind === 'all' ? 'all' : s.scope.ref })}`).join(',\n'), ']'].join('\n');
  return planText.slice(0, last.start) + '```steps\n' + body + '\n```' + planText.slice(last.end);
}
