import { describe, expect, it } from 'vitest';
import { canClose } from '../derive';

const step = (status: 'pending' | 'active' | 'done' | 'blocked', verdict?: 'proceed' | 'revise') => ({ status, verdict });
const done = (verdict?: 'proceed' | 'revise') => step('done', verdict);

describe('canClose — the closure precondition (WO-0025 / P1-2)', () => {
  it('ok: plan approved + every step done and reviewed', () => {
    expect(canClose({ planApproved: true, steps: [done('proceed'), done('proceed')] })).toEqual({ ok: true });
  });
  it('plan not approved → plan_not_approved', () => {
    expect(canClose({ planApproved: false, steps: [done('proceed')] })).toEqual({ ok: false, reason: 'plan_not_approved' });
  });
  it('no steps → no_steps (a prose-only plan is not closeable)', () => {
    expect(canClose({ planApproved: true, steps: [] })).toEqual({ ok: false, reason: 'no_steps' });
  });
  it('a step not done → step_not_done', () => {
    expect(canClose({ planApproved: true, steps: [done('proceed'), step('active')] })).toEqual({ ok: false, reason: 'step_not_done' });
  });
  it('a done step without a verdict → step_not_reviewed', () => {
    expect(canClose({ planApproved: true, steps: [done('proceed'), done()] })).toEqual({ ok: false, reason: 'step_not_reviewed' });
  });
  it('a REVISE verdict unaddressed → step_not_resolved (WO-0029 / B19: override or re-run first)', () => {
    expect(canClose({ planApproved: true, steps: [done('proceed'), done('revise')] })).toEqual({ ok: false, reason: 'step_not_resolved' });
  });
  it('ok again once every verdict is proceed', () => {
    expect(canClose({ planApproved: true, steps: [done('proceed'), done('proceed')] })).toEqual({ ok: true });
  });
});
