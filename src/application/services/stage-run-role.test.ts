import { describe, expect, it } from 'vitest';

import type { Definitions, FlowPin, FlowSlug, RoleDef, RoleSlug, StageSlug } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { WorkOrderRecord } from '../ports/work-order-repo';

import { roleForStageRun } from './stage-run-role';

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const FLOW: FlowSlug = slugOf<'flow'>('flow-a');
const STAGE: StageSlug = slugOf<'stage'>('implement');
const WORKER: RoleSlug = slugOf<'role'>('worker');
const MANUAL_STAGE: StageSlug = slugOf<'stage'>('manual');

const WORKER_V1: RoleDef = {
  id: WORKER,
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};
const WORKER_V2: RoleDef = { ...WORKER_V1, instructions: 'Do the work, carefully.' };

const liveDefinitions = (roles: readonly RoleDef[]): Definitions => ({
  flows: [
    {
      id: FLOW,
      name: 'Flow A',
      stages: [
        { id: STAGE, name: 'Implement', role: WORKER, exit: [] },
        { id: MANUAL_STAGE, name: 'Manual', role: null, exit: [] },
      ],
    },
  ],
  roles: [...roles],
  capabilities: [],
});

const pinWithRole = (role: RoleDef | null, roleVersion: number | null): FlowPin => ({
  flowId: FLOW,
  flowVersion: 4,
  stages: [
    {
      stage: { id: STAGE, name: 'Implement', role: WORKER, exit: [] },
      role,
      roleVersion,
      accounts: [],
      limitPolicy: 'ask',
    },
  ],
});

const record = (pin?: FlowPin): Pick<WorkOrderRecord, 'flow' | 'pin'> => ({
  flow: FLOW,
  pin,
});

describe('roleForStageRun', () => {
  it('A-325: when the pin holds role v1 and live definitions hold role v2, the resolved role is v1', () => {
    const pinned = pinWithRole(WORKER_V1, 1);
    const resolved = roleForStageRun(record(pinned), liveDefinitions([WORKER_V2]), STAGE);

    expect(resolved).toEqual(WORKER_V1);
  });

  it('A-325: without a pin, the role resolves from live definitions', () => {
    const resolved = roleForStageRun(record(undefined), liveDefinitions([WORKER_V2]), STAGE);

    expect(resolved).toEqual(WORKER_V2);
  });

  it('A-325: an empty pin falls back to live definitions', () => {
    const emptyPin: FlowPin = { flowId: FLOW, flowVersion: 1, stages: [] };
    const resolved = roleForStageRun(record(emptyPin), liveDefinitions([WORKER_V2]), STAGE);

    expect(resolved).toEqual(WORKER_V2);
  });

  it('A-325: a pinned stage with a null role has no runnable role', () => {
    const pinned: FlowPin = {
      flowId: FLOW,
      flowVersion: 4,
      stages: [
        {
          stage: { id: MANUAL_STAGE, name: 'Manual', role: null, exit: [] },
          role: null,
          roleVersion: null,
          accounts: [],
          limitPolicy: 'ask',
        },
      ],
    };
    const resolved = roleForStageRun(record(pinned), liveDefinitions([WORKER_V2]), MANUAL_STAGE);

    expect(resolved).toBeUndefined();
  });
});
