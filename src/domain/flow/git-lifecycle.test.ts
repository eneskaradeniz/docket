// flow/git-lifecycle.test.ts — the git lifecycle fold (R-160 … R-164): the branch, pull request
// and release marks derive from the four git ledger events the way skippedStages derive from the
// R-133 pair — the machine fold stays untouched and an event in an order the rules forbid is
// silently ignored, never an invented state.
import { describe, expect, it } from 'vitest';
import type { FlowDef } from '../definitions';
import type { Actor, EpochMs, FlowSlug, RoleSlug, StageSlug, WorkOrderId } from '../shared';

import { deriveWorkOrderState } from './derive';
import { deriveGitLifecycle, workOrderBranch } from './git-lifecycle';
import type { WorkOrderEvent } from './events';

const USER: Actor = { kind: 'user', id: 'u-1' };

const FLOW: FlowSlug = 'fixture' as FlowSlug;
const PLAN: StageSlug = 'plan' as StageSlug;

const created = (at: EpochMs = 0): WorkOrderEvent => ({ type: 'created', at, by: USER, flow: FLOW });

const pushed = (branch: string, head: string, at: EpochMs = 1): WorkOrderEvent => ({
  type: 'branch_pushed',
  at,
  branch,
  head,
});

const opened = (
  over: { readonly number?: number; readonly head?: string; readonly base?: string } = {},
  at: EpochMs = 2,
): WorkOrderEvent => ({
  type: 'pr_opened',
  at,
  number: over.number ?? 7,
  url: `https://forge.fake/ws/pull/${over.number ?? 7}`,
  head: over.head ?? 'docket/wo-1',
  base: over.base ?? 'main',
});

const merged = (number: number, at: EpochMs = 3): WorkOrderEvent => ({ type: 'pr_merged', at, number });

const released = (at: EpochMs = 4): WorkOrderEvent => ({ type: 'branch_released', at });

const PUSHED = pushed('docket/wo-1', 'a1', 1);
const OPENED = opened({ head: 'docket/wo-1' }, 2);

describe('deriveGitLifecycle', () => {
  it('R-160: pr_opened needs a prior branch_pushed with the same branch as head', () => {
    // No push at all: the PR never folds in.
    expect(deriveGitLifecycle([created(), OPENED])).toEqual({});
    // A pushed branch under another name is not this PR's head.
    expect(deriveGitLifecycle([created(), pushed('docket/wo-other', 'a1'), OPENED])).toEqual({
      branch: { name: 'docket/wo-other', head: 'a1', pushedAt: 1 },
    });
    // The pushed branch and the PR head name each other: the PR folds in.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: false },
    });
  });

  it('R-161: a second pr_opened while one is open (not merged) is ignored', () => {
    const second = opened({ number: 8 }, 5);
    // Still open: the second PR never replaces the first.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, second])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: false },
    });
    // Once merged, a later pr_opened opens the next cycle instead of being swallowed.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, merged(7), pushed('docket/wo-1', 'a2', 5), second])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a2', pushedAt: 5 },
      pr: { number: 8, url: 'https://forge.fake/ws/pull/8', head: 'docket/wo-1', base: 'main', merged: false },
    });
  });

  it('R-162: pr_merged.number must equal the open pull request number', () => {
    // No PR was ever opened: a merge event is a fact about nothing.
    expect(deriveGitLifecycle([created(), PUSHED, merged(7)])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
    });
    // A number the state does not hold — a stale or foreign PR — never merges.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, merged(8)])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: false },
    });
    // The open PR's own number merges; a second merge event finds no open PR anymore.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, merged(7), merged(7)])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: true },
    });
  });

  it('R-163: branch_released is valid only after pr_merged', () => {
    // Nothing was merged: release before merge never lands, whatever else folded in.
    expect(deriveGitLifecycle([created(), PUSHED, released()])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
    });
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, released()])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: false },
    });
    // After the merge the release lands and keeps the history it closed over.
    expect(deriveGitLifecycle([created(), PUSHED, OPENED, merged(7), released()])).toEqual({
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: true },
      released: true,
    });
  });

  it('R-164: git events after branch_released are invalid', () => {
    const before = [created(), PUSHED, OPENED, merged(7), released()];
    const after: readonly WorkOrderEvent[] = [
      pushed('docket/wo-1', 'a2'),
      opened({ number: 9 }, 9),
      merged(9),
      released(),
    ];
    // Every one of the four kinds after the release leaves the state exactly as the release froze it.
    for (const event of after) {
      expect(deriveGitLifecycle([...before, event])).toEqual(deriveGitLifecycle(before));
    }
  });

  it('R-165: deriveWorkOrderState merges the git lifecycle beside the machine fold', () => {
    const flow: FlowDef = {
      id: FLOW,
      name: 'Fixture',
      stages: [{ id: PLAN, name: 'Plan', role: 'planner' as RoleSlug, exit: [] }],
    };
    const events: readonly WorkOrderEvent[] = [created()];
    expect(deriveWorkOrderState(flow, events)).toEqual({
      status: 'ready',
      stage: PLAN,
      attempt: 1,
      pendingGates: [],
      skippedStages: [],
    });
    // A full git cycle derives beside the machine state without moving it one status.
    expect(deriveWorkOrderState(flow, [...events, PUSHED, OPENED, merged(7), released()])).toEqual({
      status: 'ready',
      stage: PLAN,
      attempt: 1,
      pendingGates: [],
      skippedStages: [],
      branch: { name: 'docket/wo-1', head: 'a1', pushedAt: 1 },
      pr: { number: 7, url: 'https://forge.fake/ws/pull/7', head: 'docket/wo-1', base: 'main', merged: true },
      released: true,
    });
  });

  it('R-165: workOrderBranch is the one naming rule, lower-cased after its prefix', () => {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as WorkOrderId;
    expect(workOrderBranch(id)).toBe(`docket/wo-${id.toLowerCase()}`);
  });
});
