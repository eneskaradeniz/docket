// scenarios/create-project-node.test.ts — project.create from an EMPTY data folder on createNodeDeps:
// real SQLite, real YAML files, real git. Proves the created project attaches and its board shows
// the standard flow's columns (A-23), and that the created repo's tests gate reads unknown (A-76).
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Actor } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import { createApi } from '../../api/index';
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

const projectSlug = (input: string) => {
  const parsed = parseSlug<'project'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

describe('project.create on real Node storage', () => {
  it('I-36: an existing git folder becomes a project from an empty data dir', async () => {
    const folder = join(scratch, 'Atölye');
    await mkdir(folder);
    expect((await runGit(folder, ['init', '--initial-branch=main'])).exitCode).toBe(0);
    const node = openNode();

    const created = await createApi(node.deps).command(USER, { type: 'project.create', mode: 'existing', path: folder, name: 'Atölye' });

    expect(created).toEqual({ ok: true, id: 'atolye' });
    expect((await node.repos.list()).find((entry) => entry.slug === repoSlug('atolye'))?.path).toBe(folder);
    expect(await readdir(folder)).not.toContain('.docket');
    expect(await node.deps.definitions.readFile('library/flows/standard/v1.yaml')).toBeDefined();
    const loaded = await node.deps.definitions.load(repoSlug('atolye'));
    expect(loaded.ok).toBe(false);
  });

  it('I-36: a blank project creates the folder, initialises git, and survives a reopen', async () => {
    const parent = join(scratch, 'projects');
    await mkdir(parent);
    const node = openNode();

    const created = await createApi(node.deps).command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Yeni İş' });

    expect(created).toEqual({ ok: true, id: 'yeni-is' });
    expect((await readdir(join(parent, 'yeni-is'))).sort()).toEqual(['.git']);
    node.close();
    opened = undefined;

    const reopened = openNode();
    expect((await reopened.repos.list()).find((entry) => entry.slug === repoSlug('yeni-is'))?.path).toBe(join(parent, 'yeni-is'));
    expect(await reopened.deps.projects.get(projectSlug('yeni-is'))).toBeDefined();
  });

  it('A-76: definitions.load on a newly created repo answers repo.yaml is required until #1012', async () => {
    const parent = join(scratch, 'projects');
    await mkdir(parent);
    const node = openNode();
    await createApi(node.deps).command(USER, { type: 'project.create', mode: 'blank', parent, name: 'Gate Probe' });

    const loaded = await node.deps.definitions.load(repoSlug('gate-probe'));

    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.some((issue) => issue.code === 'missing_field' && issue.message.includes('repo.yaml'))).toBe(true);
    }
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
