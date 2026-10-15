// resolveAutonomy — R-167 of docs/v2/domain.md (autonomy addendum, D-10): the chain read over the
// autonomy levels, with the balanced→manual demotion until the risk-rule table lands (D-10 4/5).
import { describe, expect, it } from 'vitest';

import type { AutonomyLevel } from '../shared';
import { resolveAutonomy } from './autonomy';
import type { Layer } from './resolve';

const layer = (level: Layer<AutonomyLevel>['level'], value: AutonomyLevel | undefined): Layer<AutonomyLevel> => ({
  level,
  value,
});

describe('resolveAutonomy', () => {
  it('R-167: answers the first defined level by LEVEL_ORDER, not array position', () => {
    expect(
      resolveAutonomy([
        layer('global', 'auto'),
        layer('repo', 'manual'),
        layer('workOrder', undefined),
        layer('project', 'balanced'),
      ]),
    ).toEqual({ level: 'manual', source: 'repo' });
  });

  it('R-167: the work order layer outranks repo, project and global', () => {
    expect(
      resolveAutonomy([
        layer('repo', 'auto'),
        layer('project', 'auto'),
        layer('global', 'auto'),
        layer('workOrder', 'manual'),
      ]),
    ).toEqual({ level: 'manual', source: 'workOrder' });
  });

  it('R-167: a defined auto passes through with the layer that set it as the source', () => {
    expect(resolveAutonomy([layer('global', 'auto'), layer('repo', undefined)])).toEqual({
      level: 'auto',
      source: 'global',
    });
  });

  it('R-167: nothing defined anywhere answers the builtin manual', () => {
    expect(
      resolveAutonomy([layer('workOrder', undefined), layer('repo', undefined), layer('global', undefined)]),
    ).toEqual({ level: 'manual', source: 'builtin' });
  });

  it('R-167: an empty layer list answers the builtin manual', () => {
    expect(resolveAutonomy([])).toEqual({ level: 'manual', source: 'builtin' });
  });

  it('R-167: a defined balanced demotes to manual until the risk-rule table lands, keeping its layer as the source', () => {
    expect(resolveAutonomy([layer('repo', 'balanced'), layer('global', 'manual')])).toEqual({
      level: 'manual',
      source: 'repo',
    });
  });

  it('R-167: a balanced work-order layer outranks a manual repo layer, so the demoted level still reports the work order', () => {
    expect(resolveAutonomy([layer('workOrder', 'balanced'), layer('repo', 'manual')])).toEqual({
      level: 'manual',
      source: 'workOrder',
    });
  });

  it('R-167: the same layers always answer the same value and the inputs are never mutated', () => {
    const layers: readonly Layer<AutonomyLevel>[] = [
      Object.freeze(layer('project', 'auto')),
      Object.freeze(layer('global', 'manual')),
    ];
    const first = resolveAutonomy(layers);
    const second = resolveAutonomy(layers);
    expect(second).toEqual(first);
    expect(layers).toEqual([
      { level: 'project', value: 'auto' },
      { level: 'global', value: 'manual' },
    ]);
  });
});
