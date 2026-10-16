// use-cases/autonomy.test.ts — A-403 (the set-level commands) and A-407's repo read of the
// chain-widening addendum (D-10 chain a): user actor only, the typed validation order,
// `null` clearing a layer, the repo.yaml round trip, and R-170's no-event law on a level change.
import { describe, expect, it } from 'vitest';

import type { Actor, AutonomyLevel, RepoSlug, Slug, Ulid, WorkOrderId } from '../../domain/index';
import { parseSlug, parseUlid } from '../../domain/index';

import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  createFakeRepoRegistry,
  createFakeWorkOrderRepo,
  createFakeAppSettingsRepo,
  createFakeProjectRepo,
  repoFlowOf,
} from '../ports/fakes';

import { AUTONOMY_KEY } from './settings';
import {
  repoAutonomyView,
  setGlobalAutonomy,
  setProjectAutonomy,
  setRepoAutonomy,
  setWorkOrderAutonomy,
} from './autonomy';
import { effectiveAutonomy, openWorkOrder } from './work-orders';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: 'later' as Ulid<'run'>, role: 'worker' as Slug<'role'> };
const POLICY: Actor = { kind: 'policy', policy: 'gate-auto' as never, level: 'auto' };
const SYSTEM: Actor = { kind: 'system', component: 'test' };

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

const REPO: RepoSlug = slugOf<'repo'>('web');
const PROJECT = slugOf<'project'>('atolye');

/** A flow whose every stage carries an onFail — what `auto` demands (R-169). */
const BOUNDED_STAGES = [
  {
    id: 'implement',
    name: 'Implement',
    role: 'worker',
    exit: [],
    onFail: { goto: 'implement', maxAttempts: 2 },
  },
  {
    id: 'review',
    name: 'Review',
    role: null,
    exit: [{ kind: 'human', id: 'sign-off', label: 'Sign-off' }],
    onFail: { goto: 'implement', maxAttempts: 1 },
  },
];
const UNBOUNDED_STAGES = [
  { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
  { id: 'review', name: 'Review', role: null, exit: [{ kind: 'human', id: 'sign-off', label: 'Sign-off' }] },
];

const defsJson = (input: {
  readonly bounded: boolean;
  readonly budget?: { readonly amountUsd: number; readonly warnPercent: number };
  readonly repoAutonomy?: string;
}): string =>
  JSON.stringify({
    roles: [
      { id: 'worker', name: 'Worker', instructions: 'Ship it.', writeScope: { kind: 'repo' }, capabilities: [], active: true },
    ],
    flows: [
      {
        id: 'standard',
        name: 'Standard',
        stages: input.bounded ? BOUNDED_STAGES : UNBOUNDED_STAGES,
      },
    ],
    capabilities: [],
    repo: {
      id: 'web',
      name: 'Web',
      flow: repoFlowOf({
        id: 'standard',
        stages: (input.bounded ? BOUNDED_STAGES : UNBOUNDED_STAGES) as readonly { id: string; role: string | null }[],
      }),
      defaultLimitPolicy: 'wait_resume',
      commandSets: {},
      docsRoot: 'docs',
      testGlobs: [],
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.repoAutonomy !== undefined ? { autonomy: input.repoAutonomy } : {}),
    },
  });

const harness = (defs: string) => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('autonomy-test');
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  const settings = createFakeAppSettingsRepo();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', defs);
  // project.yaml seeded as the file itself, so the write path (readFile → writeFile) and the
  // load's project arm read the same body and a written level shows on the next load.
  definitions.seed(`projects/${PROJECT}/project.yaml`, JSON.stringify({ id: PROJECT, name: 'Atölye', repos: [REPO] }));
  void projects.save({ id: PROJECT, name: 'Atölye', repos: [REPO] });
  const repos = createFakeRepoRegistry();
  void repos.register({ repoId: '01HZX0000000000000000000A1', slug: REPO, path: '/c/web', fingerprint: { rootCommit: 'aaa' } });
  return {
    clock,
    ids,
    log,
    workOrders,
    definitions,
    projects,
    settings,
    repos,
    openDeps: { clock, ids, log, workOrders, definitions, projects },
    woDeps: { clock, ids, log, workOrders, definitions },
    repoDeps: { clock, ids, log, repos, definitions },
    projectDeps: { clock, ids, log, definitions },
    globalDeps: { clock, ids, log, settings },
    readDeps: { definitions, settings },
    chainDeps: { workOrders, definitions, settings },
  };
};

const opened = async (h: ReturnType<typeof harness>): Promise<string> => {
  const result = await openWorkOrder(h.openDeps, {
    project: PROJECT,
    repo: REPO,
    title: 'Chain a',
    actor: ACTOR,
  });
  if (!result.ok) throw new Error(`fixture open failed: ${result.error}`);
  return result.value;
};

describe('setWorkOrderAutonomy', () => {
  it('A-403: only a user actor may set a layer — agent, system and policy all answer user_only and nothing is written', async () => {
    const h = harness(defsJson({ bounded: false }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
    for (const actor of [AGENT, SYSTEM, POLICY]) {
      expect(await setWorkOrderAutonomy(h.woDeps, { workOrder, level: 'manual', actor })).toEqual({
        ok: false,
        error: 'user_only',
      });
    }
    expect((await h.workOrders.get(workOrder))?.autonomy).toBeUndefined();
    // The fixture's own open entry is the only audit row — no refusal ever audits.
    expect(h.log.entries().filter((entry) => entry.action !== 'work_order.opened')).toEqual([]);
  });

  it('A-403: a non-member level answers invalid_autonomy_level before anything is read or written', async () => {
    const h = harness(defsJson({ bounded: false }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
    expect(
      await setWorkOrderAutonomy(h.woDeps, {
        workOrder: workOrder,
        level: 'turbo' as AutonomyLevel,
        actor: ACTOR,
      }),
    ).toEqual({ ok: false, error: 'invalid_autonomy_level' });
    expect((await h.workOrders.get(workOrder))?.autonomy).toBeUndefined();
  });

  it('A-403: the order is invalid_autonomy_level → auto_requires_* — a bad level never reaches the auto check', async () => {
    const h = harness(defsJson({ bounded: false }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
    // No cap and no onFail: the auto check would refuse with the spend-cap arm, but the member
    // parse refuses first.
    expect(
      await setWorkOrderAutonomy(h.woDeps, {
        workOrder: workOrder,
        level: 'turbo' as AutonomyLevel,
        actor: ACTOR,
      }),
    ).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });

  it('A-403: auto without a cap answers auto_requires_spend_cap; a cap over an unbounded pinned flow answers auto_requires_max_attempts', async () => {
    const noCap = harness(defsJson({ bounded: true }));
    const noCapId = await opened(noCap);
    expect(await setWorkOrderAutonomy(noCap.woDeps, { workOrder: noCapId as WorkOrderId, level: 'auto', actor: ACTOR })).toEqual({
      ok: false,
      error: 'auto_requires_spend_cap',
    });

    const unbounded = harness(defsJson({ bounded: false, budget: { amountUsd: 10, warnPercent: 80 } }));
    const unboundedId = await opened(unbounded);
    expect(
      await setWorkOrderAutonomy(unbounded.woDeps, { workOrder: unboundedId as WorkOrderId, level: 'auto', actor: ACTOR }),
    ).toEqual({ ok: false, error: 'auto_requires_max_attempts' });
    expect((await unbounded.workOrders.get(unboundedId as WorkOrderId))?.autonomy).toBeUndefined();
  });

  it('R-156/A-403: the auto check judges the pinned flow — a later library edit never changes the answer', async () => {
    // Opened against a bounded flow, then the live flow is rewritten unbounded: the pin the order
    // runs is bounded, so the confirm's check passes.
    const h = harness(defsJson({ bounded: true, budget: { amountUsd: 10, warnPercent: 80 } }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', defsJson({ bounded: false, budget: { amountUsd: 10, warnPercent: 80 } }));

    expect(await setWorkOrderAutonomy(h.woDeps, { workOrder, level: 'auto', actor: ACTOR })).toEqual({
      ok: true,
      value: undefined,
    });
    expect((await h.workOrders.get(workOrder))?.autonomy).toBe('auto');
  });

  it('A-403: null clears the layer so the chain inherits again, and one audit entry records each change', async () => {
    const h = harness(defsJson({ bounded: false }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
    
    expect(await setWorkOrderAutonomy(h.woDeps, { workOrder, level: 'manual', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    expect((await h.workOrders.get(workOrder))?.autonomy).toBe('manual');

    expect(await setWorkOrderAutonomy(h.woDeps, { workOrder, level: null, actor: ACTOR })).toEqual({ ok: true, value: undefined });
    expect((await h.workOrders.get(workOrder))?.autonomy).toBeUndefined();
    // The cleared layer inherits down to the builtin manual.
    const chain = await effectiveAutonomy(h.chainDeps, { workOrder });
    expect(chain).toEqual({ ok: true, value: { level: 'manual', source: 'builtin' } });

    expect(
      h.log
        .entries()
        .filter((entry) => entry.action === 'work_order.autonomy_changed')
        .map((entry) => [entry.action, entry.detail]),
    ).toEqual([
      ['work_order.autonomy_changed', { level: 'manual' }],
      ['work_order.autonomy_changed', { cleared: true }],
    ]);
  });

  it('A-403/R-170: a level change appends no work-order event and no past decision changes', async () => {
    const h = harness(defsJson({ bounded: true, budget: { amountUsd: 10, warnPercent: 80 } }));
    const id = await opened(h);
    const workOrder = id as WorkOrderId;
        const eventsBefore = await h.workOrders.events(workOrder);
    await h.workOrders.appendEvent(workOrder, {
      type: 'gate_evaluated',
      at: 2_000,
      stage: 'review' as Ulid<'stage'>,
      gate: 'sign-off' as Ulid<'gate'>,
      verdict: { status: 'passed' },
    });

    const changed = await setWorkOrderAutonomy(h.woDeps, { workOrder, level: 'auto', actor: ACTOR });
    expect(changed.ok).toBe(true);

    const events = await h.workOrders.events(workOrder);
    // Exactly the events that existed plus the fixture's gate decision — the level change itself
    // appended none (R-170), and the decision keeps its effect whatever the level now is.
    expect(events).toHaveLength(eventsBefore.length + 1);
    expect(events[events.length - 1]?.type).toBe('gate_evaluated');
  });

  it('A-403: an unknown work order answers not_found', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(
      await setWorkOrderAutonomy(h.woDeps, { workOrder: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), level: 'manual', actor: ACTOR }),
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('setRepoAutonomy', () => {
  it('A-403: a user actor sets and clears the repo layer through the definitions store, and the read answers the new standing', async () => {
    const h = harness(defsJson({ bounded: false }));

    expect(await setRepoAutonomy(h.repoDeps, { repo: REPO, level: 'manual', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    let view = await repoAutonomyView(h.readDeps, REPO);
    expect(view).toEqual({
      ok: true,
      value: { level: 'manual', source: 'repo', layerSet: true, autoUnavailable: 'auto_requires_spend_cap' },
    });

    expect(await setRepoAutonomy(h.repoDeps, { repo: REPO, level: null, actor: ACTOR })).toEqual({ ok: true, value: undefined });
    view = await repoAutonomyView(h.readDeps, REPO);
    expect(view).toEqual({
      ok: true,
      value: { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' },
    });

    expect(
      h.log.entries().filter((entry) => entry.action === 'repo.autonomy_changed').map((entry) => entry.action),
    ).toEqual(['repo.autonomy_changed', 'repo.autonomy_changed']);
  });

  it('A-403: a non-user actor answers user_only and repo.yaml is untouched', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(await setRepoAutonomy(h.repoDeps, { repo: REPO, level: 'auto', actor: POLICY })).toEqual({
      ok: false,
      error: 'user_only',
    });
    const afterPolicy = await repoAutonomyView(h.readDeps, REPO);
    expect(afterPolicy.ok && afterPolicy.value.layerSet).toBe(false);
  });

  it('A-403 amendment 3: a repo auto write is not refused at write time — no single order to check; the read carries the typed reason instead', async () => {
    // Whatever the repo's own flow and cap say, the layer write goes through; each order's read
    // fails closed on its own preconditions (R-158).
    const noCap = harness(defsJson({ bounded: true }));
    expect(await setRepoAutonomy(noCap.repoDeps, { repo: REPO, level: 'auto', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    let view = await repoAutonomyView(noCap.readDeps, REPO);
    expect(view.ok && view.value).toEqual({
      level: 'auto',
      source: 'repo',
      layerSet: true,
      autoUnavailable: 'auto_requires_spend_cap',
    });

    const unbounded = harness(defsJson({ bounded: false, budget: { amountUsd: 10, warnPercent: 80 } }));
    expect(
      await setRepoAutonomy(unbounded.repoDeps, { repo: REPO, level: 'auto', actor: ACTOR }),
    ).toEqual({ ok: true, value: undefined });
    view = await repoAutonomyView(unbounded.readDeps, REPO);
    expect(view.ok && view.value).toEqual({
      level: 'auto',
      source: 'repo',
      layerSet: true,
      autoUnavailable: 'auto_requires_max_attempts',
    });

    // Bounds and a cap present: the repo read names no reason — the level simply stands.
    const bounded = harness(defsJson({ bounded: true, budget: { amountUsd: 10, warnPercent: 80 } }));
    expect(await setRepoAutonomy(bounded.repoDeps, { repo: REPO, level: 'auto', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    view = await repoAutonomyView(bounded.readDeps, REPO);
    expect(view.ok && view.value).toEqual({ level: 'auto', source: 'repo', layerSet: true });
  });

  it('A-403: a maxLevel argument is accepted and refused with ceiling_not_available until chain (c), nothing written', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(await setRepoAutonomy(h.repoDeps, { repo: REPO, level: 'manual', maxLevel: 'balanced', actor: ACTOR })).toEqual({
      ok: false,
      error: 'ceiling_not_available',
    });
    const afterPolicy = await repoAutonomyView(h.readDeps, REPO);
    expect(afterPolicy.ok && afterPolicy.value.layerSet).toBe(false);
    // A null ceiling (no ceiling wanted) is simply a level-only write.
    expect(await setRepoAutonomy(h.repoDeps, { repo: REPO, level: null, maxLevel: null, actor: ACTOR })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('A-403: a repo the registry does not list answers not_found', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(await setRepoAutonomy(h.repoDeps, { repo: slugOf<'repo'>('ghost'), level: 'manual', actor: ACTOR })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('setGlobalAutonomy', () => {
  it('A-403: the global write stores the one settings key and null deletes it — absence stays absence', async () => {
    const h = harness(defsJson({ bounded: false }));

    expect(await setGlobalAutonomy(h.globalDeps, { level: 'manual', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    expect(await h.settings.get(AUTONOMY_KEY)).toBe('manual');

    expect(await setGlobalAutonomy(h.globalDeps, { level: null, actor: ACTOR })).toEqual({ ok: true, value: undefined });
    expect(await h.settings.get(AUTONOMY_KEY)).toBeUndefined();

    expect(
      h.log
        .entries()
        .filter((entry) => entry.action === 'settings.autonomy_changed')
        .map((entry) => [entry.action, entry.detail]),
    ).toEqual([
      ['settings.autonomy_changed', { level: 'manual' }],
      ['settings.autonomy_changed', { cleared: true }],
    ]);
  });

  it('A-403: a non-user actor answers user_only; a non-member level answers invalid_autonomy_level', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(await setGlobalAutonomy(h.globalDeps, { level: 'manual', actor: SYSTEM })).toEqual({ ok: false, error: 'user_only' });
    expect(await setGlobalAutonomy(h.globalDeps, { level: 'turbo' as AutonomyLevel, actor: ACTOR })).toEqual({
      ok: false,
      error: 'invalid_autonomy_level',
    });
    expect(await h.settings.get(AUTONOMY_KEY)).toBeUndefined();
  });

  it('A-403 amendment 3: a global auto write is not refused at write time — the settings key stores it; orders fail closed per read (R-158)', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(await setGlobalAutonomy(h.globalDeps, { level: 'auto', actor: ACTOR })).toEqual({ ok: true, value: undefined });
    expect(await h.settings.get(AUTONOMY_KEY)).toBe('auto');
  });
});

describe('setProjectAutonomy', () => {
  it('A-403 amendment 1: the project write sets and clears the project layer through the definitions store', async () => {
    const h = harness(defsJson({ bounded: false }));

    expect(await setProjectAutonomy(h.projectDeps, { project: PROJECT, level: 'auto', actor: ACTOR })).toEqual({
      ok: true,
      value: undefined,
    });
    const written = await h.definitions.readFile({ kind: 'project', project: PROJECT }, 'project.yaml');
    expect(written !== undefined && JSON.parse(written.content)).toMatchObject({ id: PROJECT, autonomy: 'auto' });

    expect(await setProjectAutonomy(h.projectDeps, { project: PROJECT, level: null, actor: ACTOR })).toEqual({
      ok: true,
      value: undefined,
    });
    const cleared = await h.definitions.readFile({ kind: 'project', project: PROJECT }, 'project.yaml');
    expect(cleared !== undefined && JSON.parse(cleared.content)).not.toHaveProperty('autonomy');

    expect(
      h.log
        .entries()
        .filter((entry) => entry.action === 'project.autonomy_changed')
        .map((entry) => [entry.action, entry.detail]),
    ).toEqual([
      ['project.autonomy_changed', { level: 'auto' }],
      ['project.autonomy_changed', { cleared: true }],
    ]);
  });

  it('A-403 amendment 1: a non-user actor answers user_only and project.yaml is untouched', async () => {
    const h = harness(defsJson({ bounded: false }));
    const before = await h.definitions.readFile({ kind: 'project', project: PROJECT }, 'project.yaml');
    expect(await setProjectAutonomy(h.projectDeps, { project: PROJECT, level: 'auto', actor: SYSTEM })).toEqual({
      ok: false,
      error: 'user_only',
    });
    const after = await h.definitions.readFile({ kind: 'project', project: PROJECT }, 'project.yaml');
    expect(after?.content).toBe(before?.content);
  });

  it('A-403 amendment 1: a project without project.yaml answers not_found; a non-member level answers invalid_autonomy_level', async () => {
    const h = harness(defsJson({ bounded: false }));
    expect(
      await setProjectAutonomy(h.projectDeps, { project: slugOf<'project'>('ghost'), level: 'manual', actor: ACTOR }),
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await setProjectAutonomy(h.projectDeps, { project: PROJECT, level: 'turbo' as AutonomyLevel, actor: ACTOR }),
    ).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });
});

describe('repoAutonomyView', () => {
  it('A-407: carries the effective level with its source, the layer’s own standing and the auto refusal', async () => {
    const h = harness(defsJson({ bounded: false, budget: { amountUsd: 10, warnPercent: 80 } }));
    const view = await repoAutonomyView(h.readDeps, REPO);
    expect(view).toEqual({
      ok: true,
      value: { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_max_attempts' },
    });

    await h.settings.set(AUTONOMY_KEY, 'auto');
    const inherited = await repoAutonomyView(h.readDeps, REPO);
    expect(inherited).toEqual({
      ok: true,
      value: { level: 'auto', source: 'global', layerSet: false, autoUnavailable: 'auto_requires_max_attempts' },
    });
  });

  it('A-407: a repo whose definitions do not load answers definitions_invalid', async () => {
    const h = harness(defsJson({ bounded: false }));
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', '{not json');
    expect(await repoAutonomyView(h.readDeps, REPO)).toEqual({ ok: false, error: 'definitions_invalid' });
  });
});
