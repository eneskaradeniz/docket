// scenarios/create-project-node.test.ts — project.create from an EMPTY data folder on createNodeDeps:
// real SQLite, real YAML files, real git. Proves the created project attaches and its board shows
// the standard flow's columns (A-23), and that the created repo's tests gate reads unknown (A-76).
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Actor, GateDef } from '../../domain/index';
import { BUILTIN_FLOWS, evaluateGate, parseSlug } from '../../domain/index';

import { createApi } from '../../api/index';
import type { BoardView } from '../../api/queries';
import { createFakeNotifier, createFakeTransportResolver } from '../../application/ports/fakes/index';
import { createNodeDeps, type NodeDeps, type NodeDepsConfig } from '../compose/index';
import { runGit } from '../vcs/index';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const ENV_KEYS = ['PATH', 'HOME'] as const;

const testCipher = (): NodeDepsConfig['cipher'] => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain: string): Uint8Array => new TextEncoder().encode(plain),
  decryptString: (blob: Uint8Array): string => new TextDecoder().decode(blob),
});

let scratch = '';
let dataDir = '';
let savedEnv: Map<string, string | undefined>;
let opened: NodeDeps | undefined;

const openNode = (): NodeDeps => {
  const result = createNodeDeps({
    dataDir,
    cipher: testCipher(),
    transports: createFakeTransportResolver(),
    notifier: createFakeNotifier(),
    commandEnv: { PATH: process.env.PATH ?? '' },
  });
  if (!result.ok) throw new Error('createNodeDeps must open');
  opened = result.value;
  return result.value;
};

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-create-'));
  dataDir = join(scratch, 'data');
  await mkdir(join(scratch, 'home'), { recursive: true });
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = join(scratch, 'home');
});

afterEach(async () => {
  opened?.close();
  opened = undefined;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
});

const repoSlug = (input: string) => {
  const parsed = parseSlug<'repo'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const standardColumns =(): readonly string[] => {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('the library must carry the standard flow');
  return standard.stages.map((stage) => stage.id);
};

const boardOf = async (node: NodeDeps, repo: string) => {
  const view = await createApi(node.deps).query({ type: 'repo.board', repo });
  if (typeof view !== 'object' || view === null || !('columns' in view)) {
    throw new Error(`board must answer: ${JSON.stringify(view)}`);
  }
  return view as BoardView;
};

describe('project.create on real Node storage', () => {
  it('I-36: an existing git folder becomes a project from an empty data dir; the board shows the standard columns', async () => {
    const folder = join(scratch, 'Atölye');
    await mkdir(folder);
    expect((await runGit(folder, ['init', '--initial-branch=main'])).exitCode).toBe(0);
    const node = openNode();

    const created = await createApi(node.deps).command(USER, { type: 'project.create', mode: 'existing', path: folder, name: 'Atölye' });

    expect(created).toEqual({ ok: true, id: 'atolye' });
    expect(await node.repos.path(repoSlug('atolye'))).toBe(folder);
    expect((await readdir(join(folder, '.docket'))).sort()).toEqual(['project.yaml', 'repo.yaml']);
    const board = await boardOf(node, 'atolye');
    expect(board.flow).toBe('standard');
    expect(board.columns.map((column) => column.stage)).toEqual(standardColumns());
  });

  it('I-36: a blank project creates the folder, initialises git, and survives a reopen', async () => {
    const parent = join(scratch, 'projects');
    await mkdir(parent);
    const node = openNode();

    const created = await createApi(node.deps).command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Yeni İş' });

    expect(created).toEqual({ ok: true, id: 'yeni-is' });
    expect((await readdir(join(parent, 'yeni-is'))).sort()).toEqual(['.docket', '.git']);
    node.close();
    opened = undefined;

    const reopened = openNode();
    const board = await boardOf(reopened, 'yeni-is');
    expect(board.columns.map((column) => column.stage)).toEqual(standardColumns());
  });

  it('A-76: the tests gate of a created repo reads unknown — an empty command set never passes', async () => {
    const parent = join(scratch, 'projects');
    await mkdir(parent);
    const node = openNode();
    await createApi(node.deps).command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Gate Probe' });

    const loaded = await node.deps.definitions.load(repoSlug('gate-probe'));

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value.repo === undefined) return;
    const standard = loaded.value.flows.find((flow) => flow.id === 'standard');
    const gate: GateDef | undefined = standard?.stages.flatMap((stage) => stage.exit).find((candidate) => candidate.id === 'tests');
    expect(gate).toBeDefined();
    if (gate === undefined) return;
    expect(loaded.value.repo.commandSets['tests']).toEqual([]);
    expect(evaluateGate(gate, { commands: {} }, { commandSets: loaded.value.repo.commandSets }).status).toBe('unknown');
  });

  it('I-36: creating over an existing project leaves its files alone and reports project_exists', async () => {
    const parent = join(scratch, 'projects');
    await mkdir(parent);
    const node = openNode();
    const api = createApi(node.deps);
    await api.command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Atölye' });
    const folder = join(parent, 'atolye');

    const again = await api.command(USER, { type: 'project.create', mode: 'existing', path: folder, name: 'Atölye' });

    expect(again).toEqual({ ok: false, code: 'project_exists' });
    expect(await api.command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Atölye' })).toEqual({ ok: true, id: 'atolye-2' });
  });
});
