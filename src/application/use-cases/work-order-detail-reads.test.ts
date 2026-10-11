// A-310 … A-315: per-run summaries on the work-order detail, and the read-only changes query.
import { describe, expect, it } from 'vitest';

import type { Actor, CatalogModel, FlowSlug, RepoSlug, RunId, Slug, Ulid, WorkOrderId } from '../../domain/index';
import { parseSlug, parseUlid } from '../../domain/index';

import type { RunRecord } from '../ports/run-repo';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeCheckpointCommitter,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeProjectRepo,
  createFakeRunRepo,
  createFakeWorkOrderRepo,
  createFakeWorktrees,
} from '../ports/fakes';

import { openWorkOrder, workOrderChanges, workOrderRunSummaries } from './index';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const SECRET_TOKEN = `sk-${'a'.repeat(40)}`;
const SECRET_ASSIGNED = 'token = "abcdefghijklmnopqr"';
const SECRET_KEY = 'AKIAIOSFODNN7EXAMPLE';

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

const REPO: RepoSlug = slugOf<'repo'>('acme');
const PROJECT = slugOf<'project'>('atolye');
const FLOW: FlowSlug = slugOf<'flow'>('flow-a');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const GONE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB0');
const METERED = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const CATALOGUED = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const RUN_A = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_B = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const RUN_C = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const RUN_D = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');

const DEFINITIONS = JSON.stringify({
  roles: [{ id: 'worker', name: 'Worker', instructions: 'Do the work.', writeScope: { kind: 'repo' }, capabilities: [], active: true }],
  flows: [
    {
      id: 'flow-a',
      name: 'Flow A',
      stages: [{ id: 'plan', name: 'Plan', role: 'worker', exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan approval' }] }],
    },
  ],
  capabilities: [],
  repo: {
    id: 'acme',
    name: 'Acme',
    repos: [],
    flows: ['flow-a'],
    defaultFlow: 'flow-a',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

const routeDefault = (): CatalogModel => ({
  id: 'route-default',
  source: 'bundled',
  thinking: 'unknown',
  billing: 'included',
  contextWindow: null,
  isDefault: true,
});

const harness = async () => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('detail-reads');
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  const accounts = createFakeAccountRepo();
  const capabilities = createFakeCapabilityCatalog([
    { id: 'metered-route', provider: 'meter-prov', authMode: 'api_key', defaultBilling: 'metered' },
  ]);
  const modelCatalog = createFakeModelCatalog({ [CATALOGUED]: [routeDefault()] });
  const worktrees = createFakeWorktrees();
  const checkpoints = createFakeCheckpointCommitter();
  definitions.setProject({ id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] });
  await projects.save({ id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] });
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFINITIONS);
  await accounts.save({ id: ACCOUNT, provider: 'plan-prov', label: 'Plan', authMode: 'subscription', limitPolicy: 'ask', caps: [] });
  await accounts.save({
    id: METERED,
    provider: 'meter-prov',
    label: 'Meter',
    authMode: 'api_key',
    routeKind: 'metered-route',
    limitPolicy: 'ask',
    caps: [],
  });
  await accounts.save({ id: CATALOGUED, provider: 'key-prov', label: 'Keyed', authMode: 'api_key', limitPolicy: 'ask', caps: [] });
  const opened = await openWorkOrder(
    { clock, ids, log, workOrders, definitions, projects },
    { project: PROJECT, repo: REPO, title: 'Detail', flow: FLOW, actor: ACTOR },
  );
  if (!opened.ok) throw new Error(opened.error);
  return {
    id: opened.value,
    log,
    workOrders,
    runs,
    accounts,
    worktrees,
    checkpoints,
    summaryDeps: { runs, accounts, capabilities, modelCatalog },
    changeDeps: { workOrders, worktrees, checkpoints },
  };
};

const runOf = (id: RunId, workOrderId: WorkOrderId, startedAt: number, account: Ulid<'account'>, model?: string): RunRecord => ({
  id,
  workOrderId,
  stage: slugOf<'stage'>('plan'),
  attempt: startedAt === 20 ? 2 : 1,
  role: slugOf<'role'>('worker'),
  route: model === undefined ? { accountId: account } : { accountId: account, model },
  startedAt,
  autoResumesUsed: 0,
});

const textPatch = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const secretPatch = [
  'diff --git a/src/note.ts b/src/note.ts',
  '--- a/src/note.ts',
  '+++ b/src/note.ts',
  '@@ -1,2 +1,2 @@',
  ` ${SECRET_TOKEN}`,
  `-${SECRET_KEY}`,
  `+${SECRET_ASSIGNED}`,
  'diff --git a/blob.bin b/blob.bin',
  'GIT binary patch',
  'literal 8',
  `+${SECRET_TOKEN}`,
].join('\n');

const manyFiles = (count: number): string => {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(`diff --git a/f${i}.ts b/f${i}.ts`, `--- a/f${i}.ts`, `+++ b/f${i}.ts`, '@@ -0,0 +1 @@', '+line');
  }
  return lines.join('\n');
};

describe('work order detail reads', () => {
  it('A-310: runSummaries has one entry per run in order, with account, model and folded usage; a run without usage has none', async () => {
    const h = await harness();
    await h.runs.create(runOf(RUN_B, h.id, 20, ACCOUNT));
    await h.runs.create(runOf(RUN_A, h.id, 10, ACCOUNT, 'fast-1'));
    await h.runs.appendEvents(RUN_A, [
      { type: 'usage', at: 11, inputTokens: 10, outputTokens: 4, cachedInputTokens: 3, costUsd: 0.5, costKind: 'reported' },
      { type: 'usage', at: 12, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costUsd: 0.25, costKind: 'reported' },
    ]);

    const rows = await workOrderRunSummaries(h.summaryDeps, await h.runs.listForWorkOrder(h.id));

    expect(rows.map((row) => row.runId)).toEqual([RUN_A, RUN_B]);
    expect(rows[0]).toEqual({
      runId: RUN_A,
      stage: slugOf<'stage'>('plan'),
      attempt: 1,
      role: slugOf<'role'>('worker'),
      account: { id: ACCOUNT, label: 'Plan', provider: 'plan-prov' },
      model: 'fast-1',
      billing: 'included',
      usage: { inputTokens: 11, outputTokens: 5, cachedInputTokens: 3, costByKind: { reported: 0.75 } },
    });
    expect(rows[1]).not.toHaveProperty('usage');
    expect(rows[1]).not.toHaveProperty('model');
  });

  it('A-311: billing follows the account route the settings row uses, and an included route keeps equivalent cost', async () => {
    const h = await harness();
    await h.runs.create(runOf(RUN_A, h.id, 10, ACCOUNT, 'fast-1'));
    await h.runs.create(runOf(RUN_B, h.id, 20, METERED));
    await h.runs.create(runOf(RUN_C, h.id, 30, CATALOGUED));
    await h.runs.appendEvents(RUN_A, [
      { type: 'usage', at: 11, inputTokens: 2, outputTokens: 2, cachedInputTokens: 0, costUsd: 0.4, costKind: 'equivalent' },
    ]);

    const [included, metered, catalogued] = await workOrderRunSummaries(h.summaryDeps, await h.runs.listForWorkOrder(h.id));
    expect(included?.billing).toBe('included');
    expect(included?.usage?.costByKind).toEqual({ equivalent: 0.4 });
    expect(metered?.billing).toBe('pay_per_use');
    // The catalog's default model settles this api-key route the same way the settings row does.
    expect(catalogued?.billing).toBe('included');
  });

  it('A-312: a deleted account still yields a row with the stored id as label and provider unknown', async () => {
    const h = await harness();
    await h.runs.create(runOf(RUN_D, h.id, 10, GONE, 'fast-1'));

    expect(await workOrderRunSummaries(h.summaryDeps, await h.runs.listForWorkOrder(h.id))).toEqual([
      {
        runId: RUN_D,
        stage: slugOf<'stage'>('plan'),
        attempt: 1,
        role: slugOf<'role'>('worker'),
        account: { id: GONE, label: GONE, provider: 'unknown' },
        model: 'fast-1',
        billing: 'unknown',
      },
    ]);
  });

  it('A-313: changes lists counted files for a worktree, no_worktree without one, and caps at 200', async () => {
    const h = await harness();
    const missing = await workOrderChanges(h.changeDeps, h.id);
    expect(missing).toEqual({ ok: true, value: { state: 'no_worktree', files: [], truncated: false } });

    h.worktrees.markExisting(REPO, h.id);
    h.checkpoints.setBase(h.id, 'base-sha');
    h.checkpoints.setDiff('base-sha', { files: ['src/a.ts'], patch: textPatch });
    const ready = await workOrderChanges(h.changeDeps, h.id);
    expect(ready).toEqual({
      ok: true,
      value: {
        state: 'ready',
        truncated: false,
        files: [{ path: 'src/a.ts', added: 1, removed: 1, binary: false }],
      },
    });

    h.checkpoints.setDiff('base-sha', { files: [], patch: manyFiles(201) });
    const capped = await workOrderChanges(h.changeDeps, h.id);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.value.state).toBe('ready');
    expect(capped.value.truncated).toBe(true);
    expect(capped.value.files).toHaveLength(200);
    expect(capped.value.files[0]?.path).toBe('f0.ts');
    expect(capped.value.files[199]?.path).toBe('f199.ts');
    expect(capped.value.files.some((file) => file.path === 'f200.ts')).toBe(false);

    const unknown = await workOrderChanges(h.changeDeps, ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB4'));
    expect(unknown).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-314: the changes answer never contains the patch or a secret-looking line from it', async () => {
    const h = await harness();
    h.worktrees.markExisting(REPO, h.id);
    h.checkpoints.setBase(h.id, 'base-sha');
    h.checkpoints.setDiff('base-sha', { files: ['src/note.ts', 'blob.bin'], patch: secretPatch });

    const result = await workOrderChanges(h.changeDeps, h.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const encoded = JSON.stringify(result.value);
    expect(encoded).not.toContain(SECRET_TOKEN);
    expect(encoded).not.toContain(SECRET_ASSIGNED);
    expect(encoded).not.toContain(SECRET_KEY);
    expect(encoded).not.toContain('diff --git');
    expect(encoded).not.toContain('GIT binary patch');
    expect(encoded).not.toContain('literal 8');
    expect(result.value).toEqual({
      state: 'ready',
      truncated: false,
      files: [
        { path: 'src/note.ts', added: 1, removed: 1, binary: false },
        { path: 'blob.bin', added: 0, removed: 0, binary: true },
      ],
    });
    expect(result.value).not.toHaveProperty('patch');
  });

  it('A-321: a git failure of base or diffSince is unavailable, not an empty ready list', async () => {
    const h = await harness();
    h.worktrees.markExisting(REPO, h.id);
    h.checkpoints.failNext();

    const baseFailed = await workOrderChanges(h.changeDeps, h.id);
    expect(baseFailed).toEqual({ ok: true, value: { state: 'unavailable', files: [], truncated: false } });

    h.checkpoints.setBase(h.id, 'base-sha');
    const diffFailed = await workOrderChanges(
      {
        ...h.changeDeps,
        checkpoints: {
          ...h.checkpoints,
          diffSince: async () => ({ ok: false, error: 'git_failed' }),
        },
      },
      h.id,
    );
    expect(diffFailed).toEqual({ ok: true, value: { state: 'unavailable', files: [], truncated: false } });
  });

  it('A-315: both reads write nothing and still answer while a run is in flight', async () => {
    const h = await harness();
    await h.runs.create(runOf(RUN_A, h.id, 10, ACCOUNT, 'fast-1'));
    await h.runs.appendEvents(RUN_A, [{ type: 'usage', at: 11, inputTokens: 3, outputTokens: 1, cachedInputTokens: 0 }]);
    h.worktrees.markExisting(REPO, h.id);
    h.checkpoints.setBase(h.id, 'base-sha');
    h.checkpoints.setDiff('base-sha', { files: ['src/a.ts'], patch: textPatch });
    const eventsBefore = await h.workOrders.events(h.id);
    const logBefore = h.log.entries().map((entry) => entry.action);

    const rows = await workOrderRunSummaries(h.summaryDeps, await h.runs.listForWorkOrder(h.id));
    const changes = await workOrderChanges(h.changeDeps, h.id);

    expect(rows.map((row) => row.runId)).toEqual([RUN_A]);
    expect((await h.runs.listForWorkOrder(h.id))[0]).not.toHaveProperty('endedAt');
    expect(changes).toEqual({
      ok: true,
      value: { state: 'ready', truncated: false, files: [{ path: 'src/a.ts', added: 1, removed: 1, binary: false }] },
    });
    expect(await h.workOrders.events(h.id)).toEqual(eventsBefore);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(logBefore);
    expect(h.checkpoints.commitCalls()).toEqual([]);
    expect(h.worktrees.ensureCalls()).toBe(0);
    const stored = await h.runs.get(RUN_A);
    expect(stored).not.toHaveProperty('endedAt');
    expect(stored).not.toHaveProperty('outcome');
  });
});
