// scenarios/run-phase.test.ts — "run phase" headless over the in-memory fakes: a two-phase roadmap
// whose first phase has one task targeting two repos and a dependent task. The run opens and queues
// one work order per repo, the dispatcher starts both, the dependent task and the next phase stay
// closed, and a second call opens nothing.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type DispatchLimits,
  type QueueItem,
  type Slug,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord } from '../ports/index';
import { createFakeDefinitionStore, createFakeDeps } from '../ports/fakes/index';
import { dispatcherTick, runPhase } from '../services/index';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

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
const API_REPO = slugOf<'repo'>('api');
const WEB_REPO = slugOf<'repo'>('web');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const repoDefinitions = (repo: string): string =>
  JSON.stringify({
    roles: BUILTIN_ROLES,
    flows: BUILTIN_FLOWS.filter((flow) => flow.id === 'standard'),
    capabilities: [],
    repo: {
      id: repo,
      name: repo,
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: ['npm test'] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    },
  });

const ROADMAP = JSON.stringify({
  phases: [
    {
      id: 'foundation',
      name: 'Foundation',
      blockedBy: [],
      tasks: [
        { id: 'login', title: 'Login', dependsOn: [], acceptance: [], targets: ['api', 'web'] },
        { id: 'sessions', title: 'Sessions', dependsOn: ['login'], acceptance: [], targets: ['api'] },
      ],
    },
    {
      id: 'launch',
      name: 'Launch',
      blockedBy: ['foundation'],
      tasks: [{ id: 'announce', title: 'Announce', dependsOn: [], acceptance: [], targets: ['web'] }],
    },
  ],
});

describe('run phase scenario', () => {
  it('opens one queued work order per target repo, starts both, and opens nothing the second time', async () => {
    const definitions = createFakeDefinitionStore();
    const deps = createFakeDeps({ definitions });
    const project = { id: PROJECT, name: 'Atölye', mainRepo: API_REPO, repos: [API_REPO, WEB_REPO] };
    definitions.setProject(project);
    await deps.projects.save(project);
    for (const repo of [API_REPO, WEB_REPO]) definitions.seed({ kind: 'repo', repo }, 'defs.json', repoDefinitions(repo));
    definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', ROADMAP);

    const account: AccountRecord = { id: ACCOUNT, provider: 'provider-x', label: 'account', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] };
    await deps.accounts.save(account);
    for (const role of ['planner', 'developer', 'reviewer']) {
      await deps.bindings.save({ level: 'global' }, { role: slugOf<'role'>(role), accounts: [{ accountId: ACCOUNT }] });
    }

    const phase = slugOf<'phase'>('foundation');
    const first = await runPhase(deps, { project: PROJECT, phase, actor: ACTOR });
    if (!first.ok) throw new Error(`run must succeed: ${first.error}`);
    expect(first.value.failed).toEqual([]);
    expect(first.value.opened.map((entry) => entry.task)).toEqual(['login']);

    const orders = await deps.workOrders.list({ project: PROJECT });
    expect(orders.map((order) => `${order.task}@${order.repo}`).sort()).toEqual(['login@api', 'login@web']);

    const started: QueueItem[] = [];
    const tick = await dispatcherTick(deps, { limits: LIMITS }, (item) => {
      started.push(item);
    });
    expect(tick.started).toHaveLength(2);
    expect(started.map((item) => item.workOrderId).sort()).toEqual(orders.map((order) => order.id).sort());

    // The dependent task waits for `login`, the next phase for this one: neither opens.
    const second = await runPhase(deps, { project: PROJECT, phase, actor: ACTOR });
    expect(second).toEqual({ ok: true, value: { opened: [], failed: [] } });
    expect(await deps.workOrders.list({ project: PROJECT })).toHaveLength(2);
    expect(await runPhase(deps, { project: PROJECT, phase: slugOf<'phase'>('launch'), actor: ACTOR })).toEqual({
      ok: false,
      error: 'phase_not_runnable',
    });
  });
});
