import { describe, expect, it } from 'vitest';
import { architectPrompt, architectReviewPrompt, implementerPrompt, parseOrderMd, stripUnfilledSections, verifierPrompt } from '../order-md';
import type { StepSpec } from '../types';

// Mirrors the document WO-0015's buildOrderMd produces (front matter + Objective section).
const sample = `---
id: WO-0016
title: Avatar upload crash
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0016 — Avatar upload crash

## Objective

Fix the crash when a user uploads an avatar.

## Context

- /tmp/log.txt

## Scope

In scope:
-

Out of scope:
-
`;

describe('parseOrderMd', () => {
  it('extracts the gates review mode', () => {
    expect(parseOrderMd(sample).reviewMode).toBe('gates');
  });

  it('extracts the every-step review mode', () => {
    const md = sample.replace('review_mode: gates', 'review_mode: every-step');
    expect(parseOrderMd(md).reviewMode).toBe('every-step');
  });

  it('defaults to gates when review_mode is absent', () => {
    const md = sample.replace('review_mode: gates\n', '');
    expect(parseOrderMd(md).reviewMode).toBe('gates');
  });

  it('extracts the title', () => {
    expect(parseOrderMd(sample).title).toBe('Avatar upload crash');
  });

  it('extracts the Objective section body', () => {
    expect(parseOrderMd(sample).objective).toBe('Fix the crash when a user uploads an avatar.');
  });

  it('returns an empty objective when the section is empty', () => {
    const md = sample.replace('Fix the crash when a user uploads an avatar.\n', '');
    expect(parseOrderMd(md).objective).toBe('');
  });

  it('is robust to missing front matter (whole doc is body)', () => {
    const r = parseOrderMd('# Plain\n\n## Objective\n\nDo the thing.\n');
    expect(r.reviewMode).toBe('gates');
    expect(r.title).toBe('');
    expect(r.objective).toBe('Do the thing.');
  });
});

// 2026-08-23 (operator ruling: "görünümde sök") — the creation template emits skeleton sections
// (Context's _(added during planning)_ placeholder, Scope's bare lists, Acceptance's bare "1.")
// that no flow fills; the DOCUMENT VIEW shows filled sections only. The file itself is untouched.
describe('stripUnfilledSections', () => {
  const MD = [
    '---', 'id: WO-1', '---', '', '# WO-1 — T', '',
    '## Objective', '', 'Gerçek hedef.', '',
    '## Context', '', '- _(added during planning)_', '',
    '## Scope', '', 'In scope:', '', '-', '', 'Out of scope:', '', '-', '',
    '## Acceptance criteria', '', '1.', '',
    '## Evidence required', '', '- plan_approval: architect verdict', '',
    '## Notes', '', 'Created via Docket.', '',
  ].join('\n');

  it('drops skeleton-only sections; keeps every filled one', () => {
    const out = stripUnfilledSections(MD);
    expect(out).toContain('## Objective');
    expect(out).toContain('Gerçek hedef.');
    expect(out).toContain('## Evidence required');
    expect(out).toContain('## Notes');
    expect(out).not.toContain('## Context');
    expect(out).not.toContain('## Scope');
    expect(out).not.toContain('## Acceptance criteria');
  });

  it('one real line saves a section (a filled scope list survives)', () => {
    const filled = MD.replace('In scope:\n\n-', 'In scope:\n\n- gerçek madde');
    const out = stripUnfilledSections(filled);
    expect(out).toContain('## Scope');
    expect(out).toContain('gerçek madde');
  });

  it('content before the first ## (frontmatter, title) passes through untouched', () => {
    const out = stripUnfilledSections(MD);
    expect(out).toContain('id: WO-1');
    expect(out).toContain('# WO-1 — T');
  });

  it('no ## sections → unchanged', () => {
    expect(stripUnfilledSections('# Sadece başlık\n\nParagraf.\n')).toBe('# Sadece başlık\n\nParagraf.\n');
  });
});

describe('architectPrompt', () => {
  it('references the order.md path so the architect reads the full work order', () => {
    const p = architectPrompt({ objective: 'Fix the crash.', reviewMode: 'gates', orderMdPath: '/r/docs/work-orders/WO-0016-x/order.md' });
    expect(p).toContain('/r/docs/work-orders/WO-0016-x/order.md');
  });

  it('names the gates review cadence', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p.toLowerCase()).toContain('gates');
  });

  it('names the every-step review cadence', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'every-step', orderMdPath: '/p/order.md' });
    expect(p.toLowerCase()).toContain('every-step');
  });

  it('carries the objective into the prompt', () => {
    const p = architectPrompt({ objective: 'Make the avatar upload not crash.', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p).toContain('Make the avatar upload not crash.');
  });
});

// WO-0017: the architect must PRODUCE the ```steps block — otherwise parsePlanSteps always returns [].
describe('architectPrompt — steps fence producer', () => {
  it('instructs the architect to end the plan with a ```steps block', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p).toContain('```steps');
  });
});

// WO-0039 (post-submission STOP): a soft denial made the architect read Docket's SQLite and
// RESUBMIT the plan three times in the wild (3x plan_saved, tripled cost). The prompt now carries
// a hard stop rule; the gate's deny message is its twin.
describe('architectPrompt — the post-submission STOP rule (2026-08-23)', () => {
  it('tells the architect to end its turn after the stop notice and never investigate/resubmit', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p).toContain('end your turn immediately');
    expect(p).toContain('NEVER investigate approval status');
  });
});

// WO-0039 stabilization (2026-08-23, the overwrite incident): a detail RE-ENTRY resumed the session
// AFTER the stop notice and the agent called ExitPlanMode again — submitting "bekliyorum" as the
// plan, which clobbered plan.md. A post-stop resume must answer, never resubmit.
describe('architectPrompt — the resume-after-stop rule (2026-08-23 stabilization)', () => {
  it('forbids a second ExitPlanMode when the session resumes after the stop notice', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p).toContain('resumes AFTER the plan-submission stop notice');
    expect(p).toContain('do NOT call ExitPlanMode again');
    expect(p).toContain('answer in one short sentence and end your turn');
  });
});

// WO-0039: the aim renders VERBATIM in the operator's UI (plan rows, the step spine, session card
// names) — it is display text, not agent notes. The prompt asks for short Turkish labels.
describe('architectPrompt — aim language (WO-0039)', () => {
  it('asks for short Turkish aim labels the operator reads at a glance', () => {
    const p = architectPrompt({ objective: 'x', reviewMode: 'gates', orderMdPath: '/p/order.md' });
    expect(p).toContain('<short Turkish label>');
    expect(p).toContain('SHORT TURKISH label');
  });
});

const implStep: StepSpec = { idx: 2, role: 'implementer', aim: 'core parser', scope: { kind: 'track', ref: 'app' } };

describe('implementerPrompt', () => {
  it('references the order.md path', () => {
    const p = implementerPrompt({ objective: 'Fix the crash.', step: implStep, planText: '# Plan\nbody', orderMdPath: '/r/o.md' });
    expect(p).toContain('/r/o.md');
  });

  it('carries the objective into the prompt', () => {
    const p = implementerPrompt({ objective: 'Fix the crash.', step: implStep, planText: '', orderMdPath: '/r/o.md' });
    expect(p).toContain('Fix the crash.');
  });

  it('names the step index, aim and scope', () => {
    const p = implementerPrompt({ objective: 'x', step: implStep, planText: '', orderMdPath: '/r/o.md' });
    expect(p).toContain('step 2');
    expect(p).toContain('core parser');
    expect(p).toContain('app');
  });

  it('includes the approved plan text verbatim', () => {
    const p = implementerPrompt({ objective: 'x', step: implStep, planText: '# THE PLAN', orderMdPath: '/r/o.md' });
    expect(p).toContain('# THE PLAN');
  });

  it('asks the implementer to end with a report', () => {
    const p = implementerPrompt({ objective: 'x', step: implStep, planText: '', orderMdPath: '/r/o.md' });
    expect(p.toLowerCase()).toContain('report');
  });
});

describe('verifierPrompt', () => {
  const vStep: StepSpec = { idx: 3, role: 'verifier', aim: 'security', scope: { kind: 'all' } };

  it('names the verification focus and read-only constraint', () => {
    const p = verifierPrompt({ objective: 'x', step: vStep, planText: '', orderMdPath: '/r/o.md' });
    expect(p).toContain('security');
    expect(p.toLowerCase()).toContain('read-only');
  });

  it('asks the verifier to end with a report', () => {
    const p = verifierPrompt({ objective: 'x', step: vStep, planText: '', orderMdPath: '/r/o.md' });
    expect(p.toLowerCase()).toContain('report');
  });
});

describe('architectReviewPrompt (WO-0020)', () => {
  const step: StepSpec = { idx: 1, role: 'implementer', aim: 'add the thing', scope: { kind: 'track', ref: 'app' } };
  const base = { objective: 'x', step, reportBody: '', planText: '', orderMdPath: '/r/o.md', reportPath: 'reports/step-01-implementer.md' };

  it('references the report path so the architect reads the report', () => {
    expect(architectReviewPrompt(base)).toContain('reports/step-01-implementer.md');
  });

  it('names the step aim and the VERDICT instruction', () => {
    const p = architectReviewPrompt(base);
    expect(p).toContain('add the thing');
    expect(p).toContain('VERDICT:');
    expect(p).toContain('proceed');
    expect(p).toContain('revise');
  });
});
