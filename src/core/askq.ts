// src/core/askq.ts — the structured ask (WO-0077): an agent's AskUserQuestion call rides the
// permission fence, and this module is its contract. Every load-bearing fact is MEASURED, not
// assumed — docs/work-orders/WO-0076-askq-probe/report.md is the source of truth (a1 single
// select, a2 multi join, a3 free text, a4 deny, a5 bare allow).
//
// Pure and vendor-neutral (ADR-0006): the tool name is a plain string literal Docket owns, the
// shapes carry no SDK type. The parse is STRICT — the fence input is Record<string, unknown>, so
// ANY malformed shape returns undefined (never a throw) and the card falls back to the binary
// form (the WO-0077 fail-open gate: a malformed payload must never break the permission flow).
import type { PermissionDecision } from './runner';

/** The tool whose fence call carries the questions array. A plain literal: the SDK has no typed
 *  tool-name union to test against (WO-0076 §d), and the name is not a vendor name (ADR-0006). */
export const ASK_TOOL = 'AskUserQuestion';

/** The recommendation marker: a label-suffix CONVENTION, never a field (there is no `recommended`
 *  in the payload — WO-0076 §Q2). The only parse Docket may do on labels; the stored/sent label
 *  keeps the suffix verbatim (the CLI does not strip it — WO-0076 a1). */
export const RECOMMENDED_SUFFIX = /\(Recommended\)\s*$/;

/** One option of a structured question, verbatim from the fence input. */
export interface AskOption {
  label: string; // the "(Recommended)" suffix INCLUDED — parse it off for display only
  description: string;
}

/** One question of a structured ask payload (1-4 per call). Docket v1 renders the FIRST question
 *  of a multi-question payload (honest + scoped — the WO-0077 order's implementer choice, pinned
 *  in the tests). */
export interface AskQuestion {
  question: string; // THE ANSWER KEY — the fold keys the answer under this exact string
  header: string; // the chip label (≤12 chars by convention — enforced by the model's schema, not re-checked here)
  options: AskOption[]; // ≥2
  multiSelect: boolean; // radio vs checkbox
}

/** The operator's resolution, as the card hands it to the fold (WO-0076 §e). */
export type AskAnswer =
  | { kind: 'selection'; labels: string[] } // 1 label, or N when multiSelect — sent ", "-joined
  | { kind: 'other'; text: string } // free text matching no label (a3's follow-what-they-say template)
  | { kind: 'dismissed' } // the bare allow — "did not answer" (a5)
  | { kind: 'declined'; message: string }; // the deny + message (a4)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * Parse the fence input into the card's question. Strict: `questions` ≥1, the first question's
 * `question` a non-empty string (THE ANSWER KEY), `header` a string, `options` ≥2 each with a
 * non-empty `label` string + a `description` string, `multiSelect` a boolean. Refuses every tool
 * but ASK_TOOL: the shape is not the point, the ask tool is.
 *
 * Fail-open END TO END: the whole body is one guard — a hostile getter ANYWHERE in the payload (a
 * Proxy over an array passes Array.isArray; a nested option getter throws during the walk) degrades
 * to undefined, never a throw past this file. The card renders the binary form instead (the
 * WO-0077 gate: a malformed payload must never break the permission flow — not even by crashing).
 */
export function parseAskRequest(tool: string, input: Record<string, unknown>): AskQuestion | undefined {
  if (tool !== ASK_TOOL) return undefined;
  try {
    const raw: unknown = input.questions;
    if (!Array.isArray(raw) || raw.length < 1) return undefined;
    const q = raw[0];
    if (!isRecord(q)) return undefined;
    const { question, header, options, multiSelect } = q;
    if (!str(question) || question === '' || !str(header) || !Array.isArray(options) || options.length < 2) return undefined;
    if (typeof multiSelect !== 'boolean') return undefined;
    const parsed: AskOption[] = [];
    for (const o of options) {
      if (!isRecord(o)) return undefined;
      const { label, description } = o;
      if (!str(label) || label === '' || !str(description)) return undefined;
      parsed.push({ label, description }); // field-picked: unknown extras (preview) are not Docket's to read
    }
    return { question, header, options: parsed, multiSelect };
  } catch {
    return undefined; // a hostile getter anywhere in the walk — undefined, never a throw
  }
}

/** Does the option label carry the recommendation marker? Display-only — never stored, never a field. */
export function askOptionIsRecommended(label: string): boolean {
  return RECOMMENDED_SUFFIX.test(label);
}

/** The label as DISPLAYED: the marker parsed off, the separator space with it. Lives in core
 *  because src/ui may not `.replace` (the check 6 proxy for ADR-0007). The label SENT keeps the
 *  suffix verbatim (WO-0076 a1) — only the display form is stripped. */
export function askOptionDisplayLabel(label: string): string {
  return label.replace(RECOMMENDED_SUFFIX, '').trimEnd();
}

/**
 * Build the permission decision the UI sends for a structured ask — the four measured arms
 * (WO-0076 Q3), carried on `PermissionDecision`:
 *   selection/other → allow + the fold `{ ...input, answers: { [question]: value } }` (multi-select
 *                     labels ", "-joined into ONE string — the CLI's comma-separated contract);
 *   dismissed       → the BARE allow (no updatedInput key at all — not an undefined-carrying one);
 *   declined        → the deny + message (the adapter maps `reason` → the deny message verbatim).
 */
export function askDecision(input: Record<string, unknown>, question: string, answer: AskAnswer): PermissionDecision {
  switch (answer.kind) {
    case 'selection':
      return { allow: true, updatedInput: { ...input, answers: { [question]: answer.labels.join(', ') } } };
    case 'other':
      return { allow: true, updatedInput: { ...input, answers: { [question]: answer.text } } };
    case 'dismissed':
      return { allow: true };
    case 'declined':
      return { allow: false, reason: answer.message };
  }
}
