// scenarios/advance-phases.test.ts — unattended phase advance headless over the in-memory fakes:
// one phase with tasks a → b and an independent c, followed by a second phase. The operator starts
// the phase once; everything after that is advancePhases.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type Slug,
  type TaskSlug,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord } from '../ports/index';
import { createFakeDefinitionStore, createFakeDeps } from '../ports/fakes/index';
import { advancePhases, runPhase } from '../services/index';
import { blockWorkOrder, closeWorkOrder } from '../use-cases/index';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const PROJECT = slugOf<'project'>('atolye');
const REPO = slugOf<'repo'>('api');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const task = (id: string, dependsOn: readonly string[] = []) => ({ id, title: id, dependsOn, acceptance: [], targets: [] });

const ROADMAP = JSON.stringify({
  phases: [
    { id: 'foundation', name: 'Foundation', blockedBy: [], tasks: [task('a'), task('b', ['a']), task('c')] },
    { id: 'launch', name: 'Launch', blockedBy: ['foundation'], tasks: [task('announce')] },
  ],
});

describe('unattended phase advance scenario', () => {
  it('opens B once A is done, flags a failed C without stopping B, closes the record when all is done and never starts the next phase', async () => {
    const definitions = createFakeDefinitionStore();
    const deps = createFakeDeps({ definitions });
    const project = { id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] };
    definitions.setProject(project);
    await deps.projects.save(project);
    definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({
        roles: BUILTIN_ROLES,
        flows: BUILTIN_FLOWS.filter((flow) => flow.id === 'standard'),
        capabilities: [],
        repo: { id: 'api', name: 'api', flows: ['standard'], defaultFlow: 'standard', commandSets: { tests: ['npm test'] }, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
      }),
    );
    definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', ROADMAP);
    const account: AccountRecord = { id: ACCOUNT, provider: 'provider-x', label: 'account', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] };
    await deps.accounts.save(account);
    for (const role of ['planner', 'developer', 'reviewer']) {
      await deps.bindings.save({ level: 'global' }, { role: slugOf<'role'>(role), accounts: [{ accountId: ACCOUNT }] });
    }

    const phase = slugOf<'phase'>('foundation');
    const opened = async (): Promise<readonly (TaskSlug | undefined)[]> => (await deps.workOrders.list({ project: PROJECT })).map((order) => order.task).sort();
    const orderOf = async (name: string) => {
      const found = (await deps.workOrders.list({ project: PROJECT })).find((order) => order.task === name);
      if (found === undefined) throw new Error(`no work order for ${name}`);
      return found;
    };
    const record = () => deps.phaseAutoRuns.get(PROJECT, phase);

    const started = await runPhase(deps, { project: PROJECT, phase, actor: ACTOR });
    expect(started.ok && started.value.opened.map((entry) => entry.task)).toEqual(['a', 'c']);
    expect((await record())?.state).toBe('running');

    // A finishes: B opens and is queued, no click.
    expect((await closeWorkOrder(deps, { id: (await orderOf('a')).id, actor: ACTOR })).ok).toBe(true);
    await advancePhases(deps);
    expect(await opened()).toEqual(['a', 'b', 'c']);
    const orderB = await orderOf('b');
    expect((await deps.queue.list()).some((item) => item.workOrderId === orderB.id)).toBe(true);

    // C fails: it is flagged, B is not touched, the phase keeps running.
    const orderC = await orderOf('c');
    expect((await blockWorkOrder(deps, { id: orderC.id, reason: 'failed', actor: ACTOR })).ok).toBe(true);
    await advancePhases(deps);
    expect((await record())?.attention).toEqual([orderC.id]);
    expect((await record())?.state).toBe('running');
    expect(await opened()).toEqual(['a', 'b', 'c']);

    // Everything finishes: the record is done and the next phase stays closed.
    expect((await closeWorkOrder(deps, { id: (await orderOf('b')).id, actor: ACTOR })).ok).toBe(true);
    expect((await closeWorkOrder(deps, { id: orderC.id, actor: ACTOR })).ok).toBe(true);
    await advancePhases(deps);
    expect((await record())?.state).toBe('done');
    expect(await opened()).toEqual(['a', 'b', 'c']);
    expect(await deps.phaseAutoRuns.get(PROJECT, slugOf('launch'))).toBeUndefined();

    await advancePhases(deps);
    expect(await opened()).toEqual(['a', 'b', 'c']);
  });
});
