// resolver/autonomy — R-151/R-155/R-156 of docs/v2/domain.md (chain-widening addendum #1225,
// D-10): the widened chain walk over AUTONOMY_CHAIN_ORDER, the guard that nothing widens the
// user-only carve-out, and the confirm's auto-level check over the pinned flow.
import { describe, expect, it } from 'vitest';

import { checkAutoLevel } from '../definitions/index';
import type { AutonomyLevel, FlowSlug, StageSlug } from '../shared';
import { AUTONOMY_LEVELS, USER_ONLY_GATES } from '../shared';
import {
  AUTONOMY_CHAIN_ORDER,
  AUTONOMY_RANK,
  clampAutonomy,
  resolveAutonomy,
} from './autonomy';
import type { AutonomyLayer, AutonomySource } from './autonomy';

const layer = (source: AutonomySource, value: AutonomyLevel | undefined): AutonomyLayer => ({
  source,
  value,
});

describe('resolveAutonomy', () => {
  it('R-151: answers the first defined level by AUTONOMY_CHAIN_ORDER, not array position', () => {
    expect(
      resolveAutonomy([
        layer('global', 'auto'),
        layer('repo', 'manual'),
        layer('workOrder', undefined),
        layer('project', 'balanced'),
      ]),
    ).toEqual({ level: 'manual', source: 'repo' });
  });

  it('R-151: the order is workOrder > stage > flow > repo > project > global > builtin', () => {
    expect(AUTONOMY_CHAIN_ORDER).toEqual([
      'workOrder',
      'stage',
      'flow',
      'repo',
      'project',
      'global',
      'builtin',
    ]);
    expect(
      resolveAutonomy([
        layer('repo', 'auto'),
        layer('flow', 'manual'),
        layer('stage', 'balanced'),
        layer('workOrder', undefined),
      ]),
    ).toEqual({ level: 'manual', source: 'stage' });
    expect(
      resolveAutonomy([layer('repo', 'auto'), layer('flow', 'manual'), layer('stage', undefined)]),
    ).toEqual({ level: 'manual', source: 'flow' });
  });

  it('R-151: a stage-less decision passes no stage layer and the flow answers before the repo', () => {
    expect(resolveAutonomy([layer('flow', 'manual'), layer('repo', 'auto')])).toEqual({
      level: 'manual',
      source: 'flow',
    });
  });

  it('R-151: undefined values are ignored wherever they sit', () => {
    expect(
      resolveAutonomy([
        layer('workOrder', undefined),
        layer('stage', undefined),
        layer('flow', undefined),
        layer('repo', undefined),
        layer('project', undefined),
        layer('global', undefined),
      ]),
    ).toEqual({ level: 'manual', source: 'builtin' });
  });

  it('R-151: a defined auto passes through with the layer that set it as the source', () => {
    expect(resolveAutonomy([layer('global', 'auto'), layer('repo', undefined)])).toEqual({
      level: 'auto',
      source: 'global',
    });
  });

  it('R-151: nothing defined anywhere answers the builtin manual', () => {
    expect(resolveAutonomy([])).toEqual({ level: 'manual', source: 'builtin' });
  });

  it('R-151: a defined balanced demotes to manual until the risk-rule table lands, keeping its layer as the source', () => {
    expect(resolveAutonomy([layer('repo', 'balanced'), layer('global', 'manual')])).toEqual({
      level: 'manual',
      source: 'repo',
    });
    // The demotion holds at the definition-origin layers too: they may restrict, never loosen.
    expect(resolveAutonomy([layer('stage', 'balanced'), layer('repo', 'auto')])).toEqual({
      level: 'manual',
      source: 'stage',
    });
  });

  it('R-151: the same layers always answer the same value and the inputs are never mutated', () => {
    const layers: readonly AutonomyLayer[] = [
      Object.freeze(layer('project', 'auto')),
      Object.freeze(layer('global', 'manual')),
    ];
    const first = resolveAutonomy(layers);
    const second = resolveAutonomy(layers);
    expect(second).toEqual(first);
    expect(layers).toEqual([
      { source: 'project', value: 'auto' },
      { source: 'global', value: 'manual' },
    ]);
  });
});

describe('USER_ONLY_GATES guard', () => {
  it('R-155: the chain widening widens nothing — the carve-out stays exactly the closed four', () => {
    // The single named contract every check reads (R-168); pinning its members here is the guard
    // the addendum itself demands: no layer, ceiling, suggestion or import licenses a decision
    // class beyond these, and no step of the chain may widen the list.
    expect(USER_ONLY_GATES).toEqual(['deploy', 'merge', 'delete', 'page_approval']);
  });
});

describe('checkAutoLevel over the pinned flow', () => {
  const stageOf = (id: string): StageSlug => id as StageSlug;
  const flowOf = (id: string): FlowSlug => id as FlowSlug;
  const stage = (id: string, onFail: boolean) => ({
    id: stageOf(id),
    name: id,
    role: null,
    exit: [],
    ...(onFail ? { onFail: { goto: stageOf('review'), maxAttempts: 2 } } : {}),
  });
  const cap = { amountUsd: 5, warnPercent: 80 };

  it('R-156: the confirm judges the pinned flow — a missing cap or an unbounded stage refuses, cap and bounds pass', () => {
    // The confirm reconstructs its FlowDef from the work order's pin (the stages the pin copied),
    // so the check reads the version the order runs — never the live definition. A suggestion
    // alone runs nothing: it is this check, at the confirm, that speaks.
    const pinned = { id: flowOf('ship'), name: 'ship', stages: [stage('build', true), stage('review', false)] };
    expect(checkAutoLevel({ cap, flow: pinned })).toEqual({ ok: false, error: 'auto_requires_max_attempts' });
    expect(checkAutoLevel({ cap: undefined, flow: pinned })).toEqual({
      ok: false,
      error: 'auto_requires_spend_cap',
    });
    const bounded = { id: flowOf('ship'), name: 'ship', stages: [stage('build', true), stage('review', true)] };
    expect(checkAutoLevel({ cap, flow: bounded })).toEqual({ ok: true, value: undefined });
  });
});

describe('clampAutonomy', () => {
  it('answers the resolved value unchanged when no ceiling is defined', () => {
    const resolved = { level: 'auto' as const, source: 'workOrder' as const };
    expect(clampAutonomy(resolved, [undefined, undefined])).toEqual(resolved);
    expect(clampAutonomy(resolved, [])).toEqual(resolved);
  });

  it('clamps to the tightest defined ceiling and names the ceiling as the source', () => {
    expect(clampAutonomy({ level: 'auto', source: 'workOrder' }, ['manual', 'balanced'])).toEqual({
      level: 'manual',
      source: 'ceiling',
    });
    expect(clampAutonomy({ level: 'auto', source: 'global' }, [undefined, 'balanced'])).toEqual({
      level: 'manual', // a balanced ceiling is still not offered; R-167's clause applies after the clamp
      source: 'ceiling',
    });
  });

  it('leaves a level at or below the ceiling alone', () => {
    expect(clampAutonomy({ level: 'manual', source: 'repo' }, ['auto'])).toEqual({
      level: 'manual',
      source: 'repo',
    });
    expect(clampAutonomy({ level: 'auto', source: 'workOrder' }, ['auto'])).toEqual({
      level: 'auto',
      source: 'workOrder',
    });
  });

  it('ranks manual < balanced < auto', () => {
    expect(AUTONOMY_RANK.manual).toBeLessThan(AUTONOMY_RANK.balanced);
    expect(AUTONOMY_RANK.balanced).toBeLessThan(AUTONOMY_RANK.auto);
    expect(Object.keys(AUTONOMY_RANK).sort()).toEqual([...AUTONOMY_LEVELS].sort());
  });
});
