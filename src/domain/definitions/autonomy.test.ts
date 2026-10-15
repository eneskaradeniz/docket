// checkAutoLevel — R-169 of docs/v2/domain.md (autonomy addendum, D-10): the typed preconditions
// for starting or escalating to `auto`, in a fixed order, pure.
import { describe, expect, it } from 'vitest';

import type { SpendCap } from '../budget';
import type { FlowSlug, StageSlug } from '../shared';
import { checkAutoLevel } from './autonomy';
import type { FlowDef, StageDef } from './types';

const stageOf = (id: string): StageSlug => id as StageSlug;
const flowSlugOf = (id: string): FlowSlug => id as FlowSlug;

const stage = (over: { readonly onFail?: StageDef['onFail'] } = {}): StageDef => ({
  id: stageOf('work'),
  name: 'Work',
  role: null,
  exit: [],
  ...(over.onFail !== undefined ? { onFail: over.onFail } : {}),
});

const flowOf = (stages: readonly StageDef[]): FlowDef => ({ id: flowSlugOf('main'), name: 'Main', stages });

const CAP: SpendCap = { amountUsd: 25, warnPercent: 80 };

describe('checkAutoLevel', () => {
  it('R-169: no cap is the first refusal, whatever the stages say', () => {
    const checked = checkAutoLevel({ cap: undefined, flow: flowOf([stage({ onFail: { goto: stageOf('work'), maxAttempts: 2 } })]) });
    expect(checked).toEqual({ ok: false, error: 'auto_requires_spend_cap' });
  });

  it('R-169: the cap refusal wins over a stage without onFail — the checks run in this fixed order', () => {
    const checked = checkAutoLevel({ cap: undefined, flow: flowOf([stage()]) });
    expect(checked).toEqual({ ok: false, error: 'auto_requires_spend_cap' });
  });

  it('R-169: a cap over a flow with any stage missing onFail is the max-attempts refusal', () => {
    const checked = checkAutoLevel({ cap: CAP, flow: flowOf([stage({ onFail: { goto: stageOf('work'), maxAttempts: 1 } }), stage()]) });
    expect(checked).toEqual({ ok: false, error: 'auto_requires_max_attempts' });
  });

  it('R-169: a cap and a written onFail on every stage is ok', () => {
    const checked = checkAutoLevel({
      cap: CAP,
      flow: flowOf([
        stage({ onFail: { goto: stageOf('work'), maxAttempts: 1 } }),
        stage({ onFail: { goto: stageOf('work'), maxAttempts: 2 } }),
      ]),
    });
    expect(checked).toEqual({ ok: true, value: undefined });
  });

  it('R-169: an empty flow with a cap is ok — no stage means no unbounded stage', () => {
    expect(checkAutoLevel({ cap: CAP, flow: flowOf([]) })).toEqual({ ok: true, value: undefined });
  });

  it('R-169: the check is pure — the same inputs answer the same value and are never mutated', () => {
    const flow = flowOf([stage({ onFail: { goto: stageOf('work'), maxAttempts: 3 } })]);
    const frozen = Object.freeze(flow);
    const first = checkAutoLevel({ cap: CAP, flow: frozen });
    const second = checkAutoLevel({ cap: CAP, flow: frozen });
    expect(second).toEqual(first);
    expect(frozen).toEqual(flow);
  });
});
