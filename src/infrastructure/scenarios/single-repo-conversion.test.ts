// scenarios/single-repo-conversion.test.ts — an installation written by the first schema version
// (workspaces, work orders keyed by workspace, bindings at level 'workspace') opens through
// createNodeDeps and reads through createApi as single-repo projects, with nothing lost.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { createApi } from '../../api/index';
import type { BoardView, CockpitView, ProjectTree } from '../../api/queries';
import { BUILTIN_FLOWS, BUILTIN_ROLES } from '../../domain/index';
import { createFakeNotifier, createFakeTransportResolver } from '../../application/ports/fakes/index';
import { createNodeDeps, type NodeDeps } from '../compose/index';
import { MIGRATIONS } from '../storage/sqlite/index';

const ACTOR = { kind: 'user', id: 'user-1', label: 'Operator' } as const;

const WO_ALPHA_PLAN = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
const WO_ALPHA_IMPLEMENT = '01ARZ3NDEKTSV4RRFFQ69G5FA2';
const WO_BETA_PLAN = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const RUN_A1 = '01ARZ3NDEKTSV4RRFFQ69G5FC1';
const RUN_A2 = '01ARZ3NDEKTSV4RRFFQ69G5FC2';
const RUN_B1 = '01ARZ3NDEKTSV4RRFFQ69G5FC3';
const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FCV';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const xor = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes, (byte) => (byte ^ 0x5a) & 0xff);

let scratch = '';
let dataDir = '';
let opened: NodeDeps | undefined;

const openNodeDeps = (): NodeDeps => {
  const result = createNodeDeps({
    dataDir,
    cipher: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => xor(encoder.encode(plain)),
      decryptString: (blob: Uint8Array) => decoder.decode(xor(blob)),
    },
    transports: createFakeTransportResolver(),
    notifier: createFakeNotifier(),
    commandEnv: { PATH: process.env.PATH ?? '' },
  });
  if (!result.ok) throw new Error(`createNodeDeps must open: ${JSON.stringify(result.error)}`);
  opened = result.value;
  return result.value;
};

/** A repo folder carrying only the repo definition the board reads; no git history is needed. */
const seedRepoFolder = async (slug: string): Promise<string> => {
  const path = join(scratch, slug);
  await mkdir(join(path, '.docket'), { recursive: true });
  await writeFile(
    join(path, '.docket', 'repo.yaml'),
    stringify({
      id: slug,
      name: slug,
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: ['node -e "process.exit(0)"'] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    }),
    'utf8',
  );
  return path;
};

const seedGlobalDefinitions = async (): Promise<void> => {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('expected a built-in flow "standard"');
  await mkdir(join(dataDir, 'roles'), { recursive: true });
  for (const role of BUILTIN_ROLES) {
    await writeFile(join(dataDir, 'roles', `${role.id}.yaml`), stringify(role), 'utf8');
  }
  await mkdir(join(dataDir, 'flows'), { recursive: true });
  await writeFile(join(dataDir, 'flows', 'standard.yaml'), stringify(standard), 'utf8');
};

/** Writes a database exactly as the first schema version left it: version-1 tables, the old
 *  workspace column and JSON key, and a binding at level 'workspace'. */
const seedVersionOneStore = (paths: Readonly<Record<string, string>>): void => {
  const db = new DatabaseSync(join(dataDir, 'docket.db'));
  const first = MIGRATIONS[0];
  if (first === undefined) throw new Error('expected a first migration');
  db.exec(first.sql);
  db.exec('PRAGMA user_version = 1');

  for (const [slug, path] of Object.entries(paths)) {
    db.prepare('INSERT INTO workspaces (slug, path) VALUES (?, ?)').run(slug, path);
  }

  const order = (id: string, workspace: string, title: string, createdAt: number): void => {
    const data = { id, workspace, flow: 'standard', title, createdAt, createdBy: ACTOR };
    db.prepare('INSERT INTO work_orders (id, workspace, created_at, data) VALUES (?, ?, ?, ?)').run(
      id,
      workspace,
      createdAt,
      JSON.stringify(data),
    );
  };
  const events = (id: string, list: readonly object[]): void => {
    list.forEach((event, index) => {
      db.prepare('INSERT INTO work_order_events (work_order_id, seq, data) VALUES (?, ?, ?)').run(
        id,
        index + 1,
        JSON.stringify(event),
      );
    });
  };
  const created = { type: 'created', at: 100, by: ACTOR, flow: 'standard' };
  const planRun = (runId: string) => [
    { type: 'run_started', at: 150, runId, stage: 'plan', attempt: 1 },
    { type: 'run_finished', at: 200, runId, outcome: 'succeeded' },
  ];

  // Alpha has one order waiting at the plan approval and one that has moved on to implement.
  order(WO_ALPHA_PLAN, 'alpha', 'Alpha plan', 100);
  events(WO_ALPHA_PLAN, [created, ...planRun(RUN_A1)]);
  order(WO_ALPHA_IMPLEMENT, 'alpha', 'Alpha implement', 110);
  events(WO_ALPHA_IMPLEMENT, [
    created,
    ...planRun(RUN_A2),
    { type: 'gate_evaluated', at: 250, stage: 'plan', gate: 'plan-approval', verdict: { status: 'passed' } },
  ]);
  order(WO_BETA_PLAN, 'beta', 'Beta plan', 120);
  events(WO_BETA_PLAN, [created, ...planRun(RUN_B1)]);

  const binding = { role: 'coder', accounts: [{ accountId: ACCOUNT }] };
  db.prepare('INSERT INTO bindings (level, scope_key, role, data) VALUES (?, ?, ?, ?)').run(
    'workspace',
    'alpha',
    'coder',
    JSON.stringify(binding),
  );
  db.close();
};

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-conversion-'));
  dataDir = join(scratch, 'data');
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  opened?.close();
  opened = undefined;
  await rm(scratch, { recursive: true, force: true });
});

const openConverted = async (): Promise<NodeDeps> => {
  await seedGlobalDefinitions();
  const paths = { alpha: await seedRepoFolder('alpha'), beta: await seedRepoFolder('beta') };
  seedVersionOneStore(paths);
  return openNodeDeps();
};

describe('a version-1 store opened by the current build', () => {
  it('shows every old workspace as a single-repo project whose main repo is itself', async () => {
    const deps = await openConverted();
    const tree = (await createApi(deps.deps).query({ type: 'project.tree' })) as ProjectTree;

    expect(tree.map((item) => item.project)).toEqual(['alpha', 'beta']);
    for (const item of tree) {
      expect(item.mainRepo).toBe(item.project);
      expect(item.repos.map((node) => node.repo)).toEqual([item.project]);
      expect(item.repos[0]?.main).toBe(true);
    }
    expect(tree[0]?.active).toBe(2);
    expect(tree[1]?.active).toBe(1);
  });

  it('keeps the old work orders on the cockpit, attributed to their project and repo', async () => {
    const deps = await openConverted();
    const view = (await createApi(deps.deps).query({ type: 'cockpit' })) as CockpitView;

    expect(view.projects.map((card) => card.project)).toEqual(['alpha', 'beta']);
    expect(view.attention.length).toBeGreaterThan(0);
    const waiting = view.attention.find((item) => item.workOrderId === WO_ALPHA_PLAN);
    expect(waiting).toMatchObject({ project: 'alpha', repo: 'alpha', kind: 'awaiting_human', stage: 'plan' });

    const scoped = (await createApi(deps.deps).query({ type: 'cockpit', project: 'beta' })) as CockpitView;
    expect(scoped.attention.map((item) => item.workOrderId)).toEqual([WO_BETA_PLAN]);
  });

  it('places the old work orders on their repo board by stage', async () => {
    const deps = await openConverted();
    const board = (await createApi(deps.deps).query({ type: 'repo.board', repo: 'alpha' })) as BoardView;

    const placed = board.columns.flatMap((column) =>
      column.workOrders.map((item) => [column.stage, item.id] as const),
    );
    expect(placed).toEqual([
      ['plan', WO_ALPHA_PLAN],
      ['implement', WO_ALPHA_IMPLEMENT],
    ]);
  });

  it('reads a binding saved at the workspace level back at the repo level', async () => {
    const deps = await openConverted();
    const all = await deps.deps.bindings.listAll();

    expect(all).toHaveLength(1);
    expect(all[0]?.scope).toEqual({ level: 'repo', repo: 'alpha' });
    expect(all[0]?.binding).toEqual({ role: 'coder', accounts: [{ accountId: ACCOUNT }] });
  });
});
