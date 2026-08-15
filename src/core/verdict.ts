// src/core/verdict.ts — pure parser for the architect's review verdict (WO-0020).
//
// After a step's report, an architect session reviews it and ends its turn with a structured suffix:
//   …review prose…
//   VERDICT: proceed
// or
//   VERDICT: revise
//   REASON:
//   …why…
// This file turns that suffix into a `Verdict`. Pure text → struct, no I/O, never throws — mirrors
// `parsePlanSteps`. The verdict FILE (written by Docket, not the agent) holds the architect's full review
// text; the parsed OUTCOME drives the review loop. ADR-0001 applied to the verdict: an ABSENT verdict is not
// silently auto-proceed — `unknown` is treated by the caller as `revise` (surfaced to the operator).

export type Verdict =
  | { outcome: 'proceed' }
  | { outcome: 'revise'; reason: string }
  | { outcome: 'unknown' };

// The canonical marker is `VERDICT:`; `KARAR:` is a robustness alias (WO-0029 / B20 — a live architect
// translated the marker into the session's Turkish and its honest decision was coerced to the safe side).
// Outcomes accept the English pair plus the Turkish aliases the run actually produced.
const VERDICT_LINE_RE = /^\s*(?:VERDICT|KARAR):\s*(proceed|revise|devam(?:\s+et)?|revize|düzelt)\b/i;
const REASON_LINE_RE = /^\s*(?:REASON|GEREKÇE):\s*/i;
const CANONICAL_VERDICT_RE = /^\s*VERDICT:\s*(?:proceed|revise)\b/i;

const toOutcome = (raw: string): 'proceed' | 'revise' =>
  /^proceed$/i.test(raw) || /^devam/i.test(raw) ? 'proceed' : 'revise';

/**
 * Parse the LAST `VERDICT:` line in the text (a draft earlier one is superseded). `proceed` → proceed;
 * `revise` → revise with the `REASON:` block that follows (or `''`); no `VERDICT:` line → `unknown`.
 */
export function parseVerdict(text: string): Verdict {
  if (!text) return { outcome: 'unknown' };
  const lines = text.split(/\r?\n/);
  let vIdx = -1;
  let outcome: 'proceed' | 'revise' | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const m = VERDICT_LINE_RE.exec(line);
    // A canonical VERDICT: line anywhere beats aliases — the last canonical wins; if none exists, the
    // last alias (KARAR:) line is used.
    if (m) {
      if (CANONICAL_VERDICT_RE.test(line) || outcome === null) {
        vIdx = i;
        outcome = toOutcome(m[1]!);
        if (CANONICAL_VERDICT_RE.test(line)) break;
      }
    }
  }
  if (outcome === null) return { outcome: 'unknown' };
  if (outcome === 'proceed') return { outcome: 'proceed' };
  // revise: find a REASON: line after the VERDICT line; the reason is that line's remainder + everything
  // after it, trimmed. No REASON: → empty reason (still revise — the outcome is the load-bearing part).
  let rIdx = -1;
  for (let i = vIdx + 1; i < lines.length; i++) {
    if (REASON_LINE_RE.test(lines[i]!)) {
      rIdx = i;
      break;
    }
  }
  if (rIdx === -1) return { outcome: 'revise', reason: '' };
  const first = lines[rIdx]!.replace(REASON_LINE_RE, '');
  const reason = [first, ...lines.slice(rIdx + 1)].join('\n').trim();
  return { outcome: 'revise', reason };
}
