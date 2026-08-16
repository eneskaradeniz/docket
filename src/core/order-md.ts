// src/core/order-md.ts — pure helpers for the work-order document (WO-0016).
//
// Front-matter + section parsing lives in core (not src/ui/) because it is text processing that must be
// testable without I/O, and because ADR-0007's UI rule bans `.replace(` in src/ui/ as a proxy for "no raw
// identifier rendered as display text" — the renderer never parses document text. The composition root
// (electron/main.ts) reads order.md from disk and fills the architect session's first prompt from these.
import type { PermissionRule, ReviewMode } from './source';
import type { StepScope, StepSpec } from './types';

export interface ParsedOrderMd {
  reviewMode: ReviewMode; // front-matter review_mode (default 'gates'); consumed by the architect runtime
  objective: string; // the ## Objective section body — the architect session's first prompt
  title: string; // front-matter title
  permissionRule: PermissionRule; // front-matter permission_rule (default 'risky_excluded', WO-0031c)
}

// Split YAML front matter (---\n…\n---) from the body without a dependency. No front matter → whole doc
// is body, everything defaults.
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function frontValue(front: string, key: string): string {
  const line = front.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim() : '';
}

// The body of a `## Heading` section, up to the next `## ` heading or end of doc. Line-based so an
// empty section (heading immediately followed by the next heading) yields '', not the next section.
function sectionBody(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}` || l.startsWith(`## ${heading} `));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) out.push(lines[i]);
  return out.join('\n').trim();
}

/** Does this order.md carry an EXPLICIT permission_rule key? (WO-0031c) — distinguishes "the work order
 *  chose its rule" from "created before rules existed, fall back to the Settings default". */
export function orderMdCarriesRule(md: string): boolean {
  const m = FRONT_MATTER_RE.exec(md);
  return m !== null && frontValue(m[1]!, 'permission_rule') !== '';
}

export function parseOrderMd(md: string): ParsedOrderMd {
  const m = FRONT_MATTER_RE.exec(md);
  const front = m ? m[1] : '';
  const body = m ? m[2] : md;
  const reviewModeValue = frontValue(front, 'review_mode');
  const reviewMode: ReviewMode = reviewModeValue === 'every-step' ? 'every-step' : 'gates';
  const ruleValue = frontValue(front, 'permission_rule');
  const permissionRule: PermissionRule =
    ruleValue === 'ask_every' || ruleValue === 'full_auto' ? ruleValue : 'risky_excluded';
  return {
    reviewMode,
    title: frontValue(front, 'title'),
    objective: sectionBody(body, 'Objective'),
    permissionRule,
  };
}

/** The editable fields of a work order (WO-0031c): title/description live in order.md (title also in
 *  the DB); reviewMode + permissionRule live in the front-matter. All optional; absent = untouched. */
export interface OrderMdEdit {
  title?: string;
  description?: string; // → the ## Objective body (the architect's first prompt material)
  reviewMode?: ReviewMode;
  permissionRule?: PermissionRule;
}

/**
 * Apply an edit surgically to order.md (WO-0031c): rewrite the named front-matter keys (inserting a
 * missing one at the end of the front-matter block) and replace the ## Objective body. Everything else
 * — Scope, Context, the operator's Closure note — is preserved byte-for-byte. No front-matter → the
 * text is returned UNCHANGED (the guard; every Docket-authored order.md has front-matter).
 */
export function applyOrderMdEdits(orderMd: string, patch: OrderMdEdit): string {
  const m = FRONT_MATTER_RE.exec(orderMd);
  if (!m) return orderMd;
  const front = m[1]!;
  const body = m[2]!;

  const setKey = (text: string, key: string, value: string): string => {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
    return lines.join('\n');
  };

  let nextFront = front;
  if (patch.title !== undefined) nextFront = setKey(nextFront, 'title', patch.title);
  if (patch.reviewMode !== undefined) nextFront = setKey(nextFront, 'review_mode', patch.reviewMode);
  if (patch.permissionRule !== undefined) nextFront = setKey(nextFront, 'permission_rule', patch.permissionRule);

  let nextBody = body;
  if (patch.description !== undefined) {
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim() === '## Objective' || l.startsWith('## Objective '));
    if (start >= 0) {
      let rest = start + 1;
      while (rest < lines.length && !lines[rest]!.startsWith('## ')) rest++;
      const out: string[] = [...lines.slice(0, start + 1), '', patch.description, '', ...lines.slice(rest)];
      nextBody = out.join('\n');
    }
  }

  if (nextFront === front && nextBody === body) return orderMd;
  return `---\n${nextFront}\n---\n${nextBody}`;
}

export function architectPrompt(input: { objective: string; reviewMode: ReviewMode; orderMdPath: string }): string {
  const cadence =
    input.reviewMode === 'every-step'
      ? 'every-step review — surface your verdict to the operator after each step, who approves before the next'
      : 'gates review — proceed autonomously between steps; pull the operator at plan approval, any revision, and merge';
  return [
    `You are the architect for this work order.`,
    `Read the full work order (tracks, context, scope) at: ${input.orderMdPath}`,
    ``,
    `Objective: ${input.objective || '(see order.md)'}`,
    ``,
    `Review cadence: ${cadence}.`,
    ``,
    `If you need clarification, ask ONE concise question as plain text, then end your turn. The operator answers in Docket and your session resumes with their answer. Do NOT call a question or ask-user tool — ask as text and stop.`,
    ``,
    `Propose a SHORT plan (aim for under ~15 lines total). Two parts:`,
    ``,
    `1. A one-paragraph summary of the approach + any key decision. Do NOT write a full document — no Scope / Constraints / Acceptance-criteria / Verification sections; the operator already has the work order.`,
    ``,
    `2. The step list as a fenced block (the substantive part Docket runs):`,
    ``,
    '```steps',
    `[`,
    `  { "role": "implementer" | "verifier" | "architect", "aim": "<short label>", "scope": "<track repo slug, or 'all' for the whole work order>" }`,
    `]`,
    '```',
    ``,
    `One object per step, in run order — include only the minimum steps the work needs. Call ExitPlanMode when the plan — including the steps block — is ready for the operator to approve. Without a valid steps block the plan has no runnable steps.`,
  ].join('\n');
}

// A step session's first prompt (WO-0017). Like the architect's, it is assembled server-side (the renderer
// never parses document text — ADR-0007) from order.md (objective) + plan.md (planText + the step's spec).
// The body is agent-facing English (same precedent as architectPrompt); it is not UI chrome. Each step ends
// its turn with a report — that final text is captured at turn_complete and written to the decision store.
export interface StepPromptInput {
  objective: string;
  step: StepSpec;
  planText: string;
  orderMdPath: string;
}

function stepScopeText(scope: StepScope): string {
  return scope.kind === 'all' ? 'all' : scope.ref;
}

export function implementerPrompt(input: StepPromptInput): string {
  return [
    `You are the implementer for step ${input.step.idx} of this work order.`,
    `Read the full work order (objective, context, scope) at: ${input.orderMdPath}`,
    ``,
    `Objective: ${input.objective || '(see order.md)'}`,
    ``,
    `Your step: ${input.step.aim} (scope: ${stepScopeText(input.step.scope)}).`,
    ``,
    `The approved plan:`,
    input.planText || '(see plan.md)',
    ``,
    `Work autonomously to implement this step within your scope. When you are done, end your turn with a concise report in MARKDOWN (use ## headings and bullet lists): what you changed, the files you touched, and any concerns for the verifier. That report is saved as this step's outcome.`,
  ].join('\n');
}

export function verifierPrompt(input: StepPromptInput): string {
  return [
    `You are the verifier for step ${input.step.idx} of this work order.`,
    `Read the full work order at: ${input.orderMdPath}`,
    ``,
    `Objective: ${input.objective || '(see order.md)'}`,
    ``,
    `Your verification focus: ${input.step.aim} (scope: ${stepScopeText(input.step.scope)}).`,
    ``,
    `The approved plan:`,
    input.planText || '(see plan.md)',
    ``,
    `Verify the work for this step within your scope (read-only — you do not edit code). When you are done, end your turn with a concise report in MARKDOWN (## headings, bullet lists, and a table for checklists): what you checked, what passed, what failed or is uncertain, and any path:line evidence. That report is saved as this step's outcome.`,
  ].join('\n');
}

// The architect's REVIEW prompt (WO-0020). After a step's report is written, an architect session reviews it
// and ends with a single VERDICT line (proceed/revise). Docket captures the verdict from turn_complete and
// writes the verdict file — the architect never writes its own output (mirrors implementerPrompt). Read-only on
// code (its scope is decision_store); the report is read from the decision store.
export interface ReviewPromptInput {
  objective: string;
  step: StepSpec;
  reportBody: string;
  planText: string;
  orderMdPath: string;
  reportPath: string; // relative, for the "read it at" line
}

export function architectReviewPrompt(input: ReviewPromptInput): string {
  return [
    `You are the architect reviewing step ${input.step.idx}'s report.`,
    `Read the full work order at: ${input.orderMdPath}`,
    ``,
    `Objective: ${input.objective || '(see order.md)'}`,
    ``,
    `Your review focus — step ${input.step.idx} (${input.step.aim}, scope: ${stepScopeText(input.step.scope)}).`,
    `The step's report is at: ${input.reportPath}`,
    ``,
    `The approved plan:`,
    input.planText || '(see plan.md)',
    ``,
    `Assess whether the report demonstrates the step's aim was met — read the report, verify the claims, and note any gap or concern. You are reviewing only; do NOT edit code.`,
    ``,
    `End your turn with EXACTLY ONE verdict line, as the final line, and nothing after it:`,
    `- VERDICT: proceed   — the step's aim is met; the next step may run.`,
    `- VERDICT: revise    — the aim is not met; on the next line write REASON: then a short paragraph.`,
    `The marker is literal English — never translate or localise it (KARAR:/DECISION: are invalid and will be treated as no verdict).`,
  ].join('\n');
}
