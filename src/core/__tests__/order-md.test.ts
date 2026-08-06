import { describe, expect, it } from 'vitest';
import { architectPrompt, architectReviewPrompt, implementerPrompt, parseOrderMd, verifierPrompt } from '../order-md';
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
