// resolver/autonomy — R-167 and R-151/R-155/R-156/R-157/R-158 of docs/v2/domain.md (D-10
// chain-widening addendum): the widened chain walk over AUTONOMY_CHAIN_ORDER, the guard that
// nothing widens the user-only carve-out, and the confirm's auto-level check over the pinned flow.
import { describe, expect, it } from 'vitest';

import { checkAutoLevel } from '../definitions/index';
import type { FlowDef, FlowPin } from '../definitions/index';
import type { AutonomyLevel, FlowSlug, StageSlug } from '../shared';
import { AUTONOMY_LEVELS, USER_ONLY_GATES } from '../shared';
import {
  AUTONOMY_CHAIN_ORDER,
  AUTONOMY_RANK,
  clampAutonomy,
  definitionAutonomyLayers,
  resolveAutonomy,
} from './autonomy';
import type { AutonomyLayer, AutonomySource } from './autonomy';


const layer = (source: AutonomySource, value: AutonomyLevel | undefined): AutonomyLayer => ({
  source,
  value,
});

describe('resolveAutonomy', () => {
  it('R-167: the work-order layer outranks repo, project and global, and nothing defined answers the builtin manual', () => {
    expect(
      resolveAutonomy([
        layer('repo', 'auto'),
        layer('project', 'auto'),
        layer('global', 'auto'),
        layer('workOrder', 'manual'),
      ]),
    ).toEqual({ level: 'manual', source: 'workOrder' });
    expect(
      resolveAutonomy([layer('workOrder', undefined), layer('repo', undefined), layer('global', undefined)]),
    ).toEqual({ level: 'manual', source: 'builtin' });
  });

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
    ).toEqual({ level: 'balanced', source: 'stage' });
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

  it('R-151: a defined balanced passes through as balanced — the demotion is the clamp\'s, not the walk\'s (R-157)', () => {
    expect(resolveAutonomy([layer('repo', 'balanced'), layer('global', 'manual')])).toEqual({
      level: 'balanced',
      source: 'repo',
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

describe('R-157 — definition-origin autos ignored; the balanced demotion once, after the clamp', () => {
  it('R-157: an auto arriving from flow or stage reads as absent — the walk goes on', () => {
    // Defence in depth: even a caller that bypasses definitionAutonomyLayers (R-153) cannot
    // resolve auto from a definition — the layer is skipped, not demoted.
    expect(resolveAutonomy([layer('flow', 'auto'), layer('repo', 'manual')])).toEqual({
      level: 'manual',
      source: 'repo',
    });
    expect(resolveAutonomy([layer('stage', 'auto'), layer('flow', 'manual')])).toEqual({
      level: 'manual',
      source: 'flow',
    });
    expect(resolveAutonomy([layer('workOrder', undefined), layer('stage', 'auto'), layer('flow', 'auto')])).toEqual({
      level: 'manual',
      source: 'builtin',
    });
    // The user-set sources keep their auto pass-through (R-151's narrowed clause).
    expect(resolveAutonomy([layer('stage', 'auto'), layer('repo', 'auto')])).toEqual({
      level: 'auto',
      source: 'repo',
    });
    // A definition-origin manual or balanced still passes through — a definition may restrict.
    expect(resolveAutonomy([layer('flow', 'balanced'), layer('repo', 'auto')])).toEqual({
      level: 'balanced',
      source: 'flow',
    });
  });

  it('R-157: the balanced demotion is applied once, after the clamp, with the source preserved', () => {
    // No ceiling: the demotion happens in the clamp, naming the layer that set balanced.
    expect(clampAutonomy(resolveAutonomy([layer('repo', 'balanced')]), [])).toEqual({
      level: 'manual',
      source: 'repo',
    });
    // A balanced clamped by a manual ceiling reads the ceiling as its source.
    expect(clampAutonomy(resolveAutonomy([layer('workOrder', 'balanced')]), ['manual'])).toEqual({
      level: 'manual',
      source: 'ceiling',
    });
    // A balanced level at a balanced ceiling: the clamp leaves it, the demotion still applies —
    // the layer that set balanced keeps the source, never a balanced level in force.
    expect(clampAutonomy(resolveAutonomy([layer('workOrder', 'balanced')]), ['balanced'])).toEqual({
      level: 'manual',
      source: 'workOrder',
    });
    // An auto clamped by a balanced ceiling: clamp to balanced, demote once, ceiling as source.
    expect(clampAutonomy(resolveAutonomy([layer('global', 'auto')]), ['balanced'])).toEqual({
      level: 'manual',
      source: 'ceiling',
    });
    // An untouched manual stays manual with its own source — demotion never invents one.
    expect(clampAutonomy(resolveAutonomy([layer('repo', 'manual')]), ['auto'])).toEqual({
      level: 'manual',
      source: 'repo',
    });
  });
});

describe('R-158 — the read fails closed when auto\'s preconditions are gone', () => {
  const stageOf = (id: string): StageSlug => id as StageSlug;
  const flowSlugOf = (id: string): FlowSlug => id as FlowSlug;
  const boundedFlow: FlowDef = {
    id: flowSlugOf('ship'),
    name: 'ship',
    stages: [
      { id: stageOf('build'), name: 'Build', role: null, exit: [], onFail: { goto: stageOf('build'), maxAttempts: 2 } },
    ],
  };
  const unboundedFlow: FlowDef = { id: flowSlugOf('ship'), name: 'ship', stages: [{ id: stageOf('build'), name: 'Build', role: null, exit: [] }] };
  const cap = { amountUsd: 5, warnPercent: 80 };

  it('R-158: an auto the check refuses answers manual on the read — never a silent auto', () => {
    // The composition the effectiveAutonomy read applies (A-404): resolve, clamp, then, when the
    // level still says auto, R-169's check against the nearest cap and the pinned flow.
    const effective = (layers: readonly AutonomyLayer[], capPresent: boolean, flow: typeof boundedFlow) => {
      const resolved = clampAutonomy(resolveAutonomy(layers), []);
      if (resolved.level !== 'auto') return resolved;
      const checked = checkAutoLevel({ cap: capPresent ? cap : undefined, flow });
      return checked.ok ? resolved : { level: 'manual' as const, source: resolved.source };
    };
    expect(effective([layer('repo', 'auto')], false, boundedFlow)).toEqual({ level: 'manual', source: 'repo' });
    expect(effective([layer('repo', 'auto')], true, unboundedFlow)).toEqual({ level: 'manual', source: 'repo' });
    expect(effective([layer('repo', 'auto')], true, boundedFlow)).toEqual({ level: 'auto', source: 'repo' });
    // A manual level never runs the check at all.
    expect(effective([layer('repo', 'manual')], false, unboundedFlow)).toEqual({ level: 'manual', source: 'repo' });
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

describe('definitionAutonomyLayers (R-153)', () => {
  it('R-153: definition-origin layers suggest auto but never resolve it (flow arm)', () => {
    const flowPin: FlowPin = {
      flowId: 'standard' as FlowSlug,
      flowVersion: 1,
      autonomy: 'auto',
      stages: [],
    };
    const layers = definitionAutonomyLayers({ flow: flowPin });
    expect(layers).toEqual({
      flow: undefined,
      stage: undefined,
      suggestsAuto: true,
    });
  });

  it('R-153: manual and balanced from a flow definition pass through with suggestsAuto false', () => {
    const manualPin: FlowPin = {
      flowId: 'standard' as FlowSlug,
      flowVersion: 1,
      autonomy: 'manual',
      stages: [],
    };
    expect(definitionAutonomyLayers({ flow: manualPin })).toEqual({
      flow: 'manual',
      stage: undefined,
      suggestsAuto: false,
    });

    const balancedPin: FlowPin = {
      flowId: 'standard' as FlowSlug,
      flowVersion: 1,
      autonomy: 'balanced',
      stages: [],
    };
    expect(definitionAutonomyLayers({ flow: balancedPin })).toEqual({
      flow: 'balanced',
      stage: undefined,
      suggestsAuto: false,
    });

    const absentPin: FlowPin = {
      flowId: 'standard' as FlowSlug,
      flowVersion: 1,
      stages: [],
    };
    expect(definitionAutonomyLayers({ flow: absentPin })).toEqual({
      flow: undefined,
      stage: undefined,
      suggestsAuto: false,
    });
  });
});

