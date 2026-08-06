// src/core/order-md.ts — pure helpers for the work-order document (WO-0016).
//
// Front-matter + section parsing lives in core (not src/ui/) because it is text processing that must be
// testable without I/O, and because ADR-0007's UI rule bans `.replace(` in src/ui/ as a proxy for "no raw
// identifier rendered as display text" — the renderer never parses document text. The composition root
// (electron/main.ts) reads order.md from disk and fills the architect session's first prompt from these.
import type { ReviewMode } from './source';

export interface ParsedOrderMd {
  reviewMode: ReviewMode; // front-matter review_mode (default 'gates'); consumed by the architect runtime
  objective: string; // the ## Objective section body — the architect session's first prompt
  title: string; // front-matter title
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

export function parseOrderMd(md: string): ParsedOrderMd {
  const m = FRONT_MATTER_RE.exec(md);
  const front = m ? m[1] : '';
  const body = m ? m[2] : md;
  const reviewModeValue = frontValue(front, 'review_mode');
  const reviewMode: ReviewMode = reviewModeValue === 'every-step' ? 'every-step' : 'gates';
  return {
    reviewMode,
    title: frontValue(front, 'title'),
    objective: sectionBody(body, 'Objective'),
  };
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
    `Propose a plan: an ordered list of steps, each a role + aim + track scope. Call ExitPlanMode when the plan is ready for the operator to approve.`,
  ].join('\n');
}
