// compose/create-node-deps.test.ts — rule I-31: the Node composition root opens <dataDir>/docket.db
// and wires every AppDeps member to the real adapters. Every fixture lives in a throw-away folder
// under os.tmpdir(); HOME is redirected so no git fixture reads or writes the user's config.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type RunId, type WorkOrderId, type RepoSlug } from '../../domain/index';
import type { DiscoveredProvider } from '../../application/index';
import {
  createFakeClock,
  createFakeNotifier,
  createFakeTransportResolver,
  type FakeNotifier,
} from '../../application/ports/fakes/index';
import type { CipherFns } from '../storage/keychain/index';
import { MIGRATIONS } from '../storage/sqlite/index';
import type { RandomBytes } from '../system/index';
import { runGit } from '../vcs/index';
import { createNodeDeps, type NodeDeps, type NodeDepsConfig } from './create-node-deps';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf('demo');
const RUN: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const AUDIT = ulidOf<'audit'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const SUPPORTED_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

/** Reversible test cipher: a per-byte XOR with a nonzero key, so no ciphertext byte equals its
 *  plaintext byte and a stored blob can never contain the value verbatim. */
const CIPHER_KEY = 0x5a;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const testCipher = (): CipherFns => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain: string): Uint8Array => {
    const bytes = encoder.encode(plain);
    return Uint8Array.from(bytes, (byte) => (byte ^ CIPHER_KEY) & 0xff);
  },
  decryptString: (blob: Uint8Array): string => {
    const plain = Uint8Array.from(blob, (byte) => (byte ^ CIPHER_KEY) & 0xff);
    return decoder.decode(plain);
  },
});

const ROLE_YAML = [
  'id: planner',
  'name: Planlayıcı',
  'instructions: Plan the work.',
  'writeScope:',
  '  kind: docs',
  'capabilities: []',
  'active: true',
  '',
].join('\n');

const FLOW_YAML = [
  'id: standard',
  'name: Standart',
  'stages:',
  '  - id: plan',
  '    name: Planlama',
  '    role: planner',
  '    exit:',
  '      - kind: human',
  '        id: plan-approval',
  '        label: Plan onayı',
  '',
].join('\n');

const REPO_YAML = [
  'id: demo',
  'name: Demo',
  'flows:',
  '  - standard',
  'defaultFlow: standard',
  'commandSets:',
  '  tests:',
  '    - node -e "process.exit(0)"',
  'roleOverrides: []',
  'docsRoot: docs',
  'testGlobs: []',
  '',
].join('\n');

// Environment keys these tests overwrite; every test gets its original value back.
const ENV_KEYS = ['PATH', 'HOME'] as const;

let scratch = '';
let dataDir = '';
let repoDir = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;
let notifier: FakeNotifier;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-compose-'));
  dataDir = join(scratch, 'data');
  repoDir = join(scratch, 'repo');
  homeDir = join(scratch, 'home');
  await mkdir(homeDir, { recursive: true });
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = homeDir;
  notifier = createFakeNotifier();
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
});

const baseConfig = (): NodeDepsConfig => ({
  dataDir,
  cipher: testCipher(),
  transports: createFakeTransportResolver(),
  notifier,
  commandEnv: { PATH: process.env.PATH ?? '', FOO: 'zz' },
});

const makeNode = (overrides: Partial<NodeDepsConfig> = {}): NodeDeps => {
  const result = createNodeDeps({ ...baseConfig(), ...overrides });
  if (!result.ok) throw new Error(`createNodeDeps must open: ${JSON.stringify(result.error)}`);
  return result.value;
};

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(`fixture git failed (exit ${result.exitCode}): ${args.join(' ')}`);
  return result.stdout;
}

async function initRepoWithCommit(cwd: string): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await git(cwd, ['init', '-b', 'main']);
  await writeFile(join(cwd, 'src-main.ts'), 'l1\nl2\n', 'utf8');
  await git(cwd, ['add', 'src-main.ts']);
  await git(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);
}

// --- the composition root ----------------------------------------------------------------------------

describe('createNodeDeps', () => {
  it('I-31: exposes the adoption ports createApi takes, and the app entry hands them to createApi', async () => {
    const node = makeNode();

    expect(node.adoption.discovery).toBe(node.accountDiscovery);
    expect(node.adoption.importer).toBe(node.credentialImporter);
    // The entry point cannot run without Electron, so its createApi call is checked as text: a
    // call that drops the adoption ports would leave both adoption endpoints answering not_found.
    const main = await readFile(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const call = /createApi\(([^;]*)\);/.exec(main)?.[1] ?? '';
    expect(call).toContain('node.adoption');
  });

  it('I-35: wires the account-test adapters — a redacting in-memory repo and real scratch directories', async () => {
    const node = makeNode();
    const account = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
    await node.deps.accountTests.save({
      accountId: account, model: null, state: 'failed', class: 'auth', startedAt: 1, endedAt: 2,
      detail: 'rejected sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 today',
    });
    expect((await node.deps.accountTests.get(account))?.detail).not.toContain('sk-ant');

    const dir = await node.deps.scratch.create('account-test');
    expect((await stat(dir.path)).isDirectory()).toBe(true);
    await dir.dispose();
    await expect(stat(dir.path)).rejects.toThrow();
  });

  it('I-52: wires the page repository to docket.db and the page files to <dataDir>/pages', async () => {
    const node = makeNode();
    const page = ulidOf<'page'>('01ARZ3NDEKTSV4RRFFQ69G5FA9');
    await node.deps.pageFiles.write(page, 1, [{ path: 'index.html', bytes: encoder.encode('<p>x</p>') }]);
    expect(await readFile(join(dataDir, 'pages', page, 'v1', 'index.html'), 'utf8')).toBe('<p>x</p>');
    await node.deps.pages.save({
      id: page, title: 'T', kind: 'html', createdBy: USER, createdAt: 1, approval: 'none',
      versions: [{ n: 1, createdAt: 1, by: USER, entry: 'index.html', files: [{ path: 'index.html', bytes: 8, sha256: 'a'.repeat(64) }] }],
    });
    expect((await node.deps.pages.list({})).map((p) => p.id)).toEqual([page]);
  });

  it('I-76: wires the conversation repository to docket.db and the attachment files to <dataDir>/conversations', async () => {
    const node = makeNode();
    const conversation = ulidOf<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FC9');
    const attachment = ulidOf<'attachment'>('01ARZ3NDEKTSV4RRFFQ69G5FA9');
    await node.deps.attachmentFiles.write(conversation, attachment, encoder.encode('bytes'));
    expect(await readFile(join(dataDir, 'conversations', conversation, attachment), 'utf8')).toBe('bytes');
    await node.deps.conversations.save({
      id: conversation, scope: { kind: 'global' }, title: 'T', createdAt: 1, updatedAt: 1, pinned: false,
      messages: [{ id: ulidOf<'message'>('01ARZ3NDEKTSV4RRFFQ69G5FM9'), role: 'user', at: 1, text: 'hi', refs: [], attachments: [], artifacts: [], sources: [] }],
    });
    expect((await node.deps.conversations.list({})).map((c) => c.id)).toEqual([conversation]);
    await node.deps.conversations.delete(conversation);
    await node.deps.attachmentFiles.removeAll(conversation);
    expect(await node.deps.conversations.get(conversation)).toBeUndefined();
    await expect(stat(join(dataDir, 'conversations', conversation))).rejects.toThrow();
  });

  it('I-31: opens <dataDir>/docket.db, exposes the registry, and close() closes the database', async () => {
    const node = makeNode();

    expect((await stat(join(dataDir, 'docket.db'))).isFile()).toBe(true);

    await node.repos.register(REPO, repoDir);
    expect(await node.repos.list()).toEqual([{ slug: REPO, path: repoDir }]);

    node.close();
    await expect(node.repos.list()).rejects.toThrow();
  });

  it('I-31: a too-new database returns the openDatabase error', async () => {
    await mkdir(dataDir, { recursive: true });
    const setup = new DatabaseSync(join(dataDir, 'docket.db'));
    setup.exec('PRAGMA user_version = 99');
    setup.close();

    const result = createNodeDeps(baseConfig());

    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'too_new', found: 99, supported: SUPPORTED_VERSION },
    });
  });

  it('I-31: uses <dataDir> as the global definitions root over the registry-backed YAML store', async () => {
    await mkdir(join(repoDir, '.docket'), { recursive: true });
    await writeFile(join(repoDir, '.docket', 'repo.yaml'), REPO_YAML, 'utf8');
    await mkdir(join(dataDir, 'roles'), { recursive: true });
    await mkdir(join(dataDir, 'flows'), { recursive: true });
    await writeFile(join(dataDir, 'roles', 'planner.yaml'), ROLE_YAML, 'utf8');
    await writeFile(join(dataDir, 'flows', 'standard.yaml'), FLOW_YAML, 'utf8');
    const node = makeNode();
    await node.repos.register(REPO, repoDir);

    const loaded = await node.deps.definitions.load(REPO);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.roles.map((role) => role.id)).toEqual([slugOf<'role'>('planner')]);
    expect(loaded.value.flows.map((flow) => flow.id)).toEqual([slugOf<'flow'>('standard')]);
    expect(loaded.value.repo?.commandSets).toEqual({ tests: ['node -e "process.exit(0)"'] });
    const globalFile = await node.deps.definitions.readFile({ kind: 'global' }, 'roles/planner.yaml');
    expect(globalFile?.content).toBe(ROLE_YAML);
  });

  it('I-31: wires the SQLite repositories and the event log', async () => {
    const node = makeNode();

    await node.deps.workOrders.create({
      id: WO,
      project: slugOf<'project'>('proj'),
      repo: REPO,
      flow: slugOf<'flow'>('standard'),
      title: 'wire the repos',
      createdAt: 5,
      createdBy: USER,
    });
    expect((await node.deps.workOrders.get(WO))?.title).toBe('wire the repos');
    expect(await node.deps.workOrders.list({ repo: REPO })).toHaveLength(1);

    await node.deps.workOrders.appendEvent(WO, {
      type: 'created',
      at: 5,
      by: USER,
      flow: slugOf<'flow'>('standard'),
    });
    expect((await node.deps.workOrders.events(WO)).map((event) => event.type)).toEqual(['created']);

    await node.deps.log.append({
      id: AUDIT,
      at: 6,
      actor: USER,
      action: 'work_order.opened',
      subject: { kind: 'work_order', id: WO },
      detail: { gate: 'plan-approval', decision: 'approved' },
    });
    const entries = await node.deps.log.list({ kind: 'work_order', id: WO }, 10);
    expect(entries.map((entry) => entry.action)).toEqual(['work_order.opened']);
    expect(entries[0]?.detail).toEqual({ gate: 'plan-approval', decision: 'approved' });
  });

  it('I-31: wires the keychain vault over the same database; the plaintext never reaches the file', async () => {
    const node = makeNode();
    const secret = 'AKIA' + 'X'.repeat(16);

    await node.deps.secrets.put('ref-1', secret);

    expect(await node.deps.secrets.get('ref-1')).toBe(secret);
    expect(await node.deps.secrets.get('ref-unknown')).toBeUndefined();
    node.close();
    const stored = await readFile(join(dataDir, 'docket.db'));
    expect(stored.includes(encoder.encode(secret))).toBe(false);
  });

  it('I-31: wires worktrees with <dataDir>/worktrees as the root', async () => {
    await initRepoWithCommit(repoDir);
    const node = makeNode();
    await node.repos.register(REPO, repoDir);

    const ensured = await node.deps.worktrees.ensure(REPO, WO);

    expect(ensured).toEqual({ ok: true, value: { path: join(dataDir, 'worktrees', 'demo', WO) } });
    expect((await stat(join(dataDir, 'worktrees', 'demo', WO))).isDirectory()).toBe(true);
  });

  it('I-31: wires the command runner with commandEnv as the exact child environment', async () => {
    const node = makeNode();
    const cwd = await mkdtemp(join(tmpdir(), 'docket-compose-cwd-'));

    try {
      const withFoo = await node.deps.commands.run(
        cwd,
        'node -e "process.exit(process.env.FOO === \'zz\' ? 0 : 3)"',
        30_000,
      );
      expect(withFoo.exitCode).toBe(0);

      // Nothing is inherited from process.env: HOME (always set in the test runner) is absent.
      const withoutHome = await node.deps.commands.run(
        cwd,
        'node -e "process.exit(process.env.HOME === undefined ? 0 : 3)"',
        30_000,
      );
      expect(withoutHome.exitCode).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('I-31: wires the secret scanner', async () => {
    await initRepoWithCommit(repoDir);
    const secret = 'AKIA' + 'X'.repeat(16);
    await writeFile(join(repoDir, 'creds.txt'), `key = ${secret}\n`, 'utf8');
    await git(repoDir, ['add', 'creds.txt']);
    await git(repoDir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'creds']);
    const node = makeNode();

    const scanned = await node.deps.secretScanner.scan(repoDir);

    expect(scanned.findings).toBeGreaterThan(0);
  });

  it('I-31: wires the evidence checker', async () => {
    const node = makeNode();
    const cwd = await mkdtemp(join(tmpdir(), 'docket-compose-ev-'));
    try {
      await writeFile(join(cwd, 'a.txt'), 'l1\nl2\nl3\n', 'utf8');

      expect(await node.deps.evidence.resolvePointers(cwd, ['a.txt:2'])).toBe(true);
      expect(await node.deps.evidence.resolvePointers(cwd, ['a.txt:4'])).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('I-31: ids come from createUlidGen over the injected clock and random', () => {
    const clock = createFakeClock(1_700_000_000_000);
    const random: RandomBytes = (length: number) => new Uint8Array(length);
    const node = makeNode({ clock, random });

    expect(node.deps.clock).toBe(clock);

    const ids = [node.deps.ids.next(), node.deps.ids.next(), node.deps.ids.next()];
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual(ids); // strictly increasing as strings, like the contract says
  });

  it('I-31: defaults the clock to the system clock when none is injected', () => {
    const node = makeNode();

    expect(Math.abs(node.deps.clock.now() - Date.now())).toBeLessThan(60_000);
  });

  it('I-31: passes the injected transports and notifier through', async () => {
    const transports = createFakeTransportResolver();
    const node = makeNode({ transports });

    expect(node.deps.transports).toBe(transports);
    expect(node.deps.notifier).toBe(notifier);

    node.deps.notifier.notify('title', 'body');
    expect(notifier.notifications()).toEqual([{ title: 'title', body: 'body' }]);
  });

  // The composed deps carry the real InstructionFiles adapter, not a stopgap: it reads the named
  // files from disk at the worktree root.
  it('compose: the composed deps carry the real instruction-files adapter', async () => {
    const node = makeNode();
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, 'AGENTS.md'), 'guide', 'utf8');

    const files = await node.deps.instructionFiles.read(repoDir, ['AGENTS.md', 'MISSING.md']);

    expect(files).toEqual([{ name: 'AGENTS.md', content: 'guide' }]);
  });

  // The composed deps carry the real checkpoints adapter, not a stopgap: a commit lands in a real
  // repo authored by the Docket identity, a clean tree answers { changed: false }, and the patch
  // is redacted with the scanner's real patterns (the vcs module's own test runs with an injected
  // redactor — the module map keeps vcs off gates, so this is where the real one is proven).
  it('compose: the composed deps carry the real checkpoints adapter', async () => {
    const node = makeNode();
    await initRepoWithCommit(repoDir);
    const base = (await git(repoDir, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(repoDir, 'token.txt'), `token: ghp_${'a'.repeat(36)}\n`, 'utf8');

    const committed = await node.deps.checkpoints.commit({ cwd: repoDir, runId: RUN, seq: 1 });
    expect(committed).toEqual({
      ok: true,
      value: { sha: expect.stringMatching(/^[0-9a-f]{40,64}$/), changed: true },
    });
    expect((await git(repoDir, ['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Docket <checkpoints@docket.local>',
    );

    const again = await node.deps.checkpoints.commit({ cwd: repoDir, runId: RUN, seq: 2 });
    expect(again).toEqual({ ok: true, value: { sha: '', changed: false } });

    const diff = await node.deps.checkpoints.diffSince({ cwd: repoDir, since: base });
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.value.files).toEqual(['token.txt']);
      expect(diff.value.patch).toContain('[redacted]');
      expect(diff.value.patch).not.toContain('ghp_');
    }
  });

  it('P-53: with a discovery reporting codex installed, the account discovery lists a codex machine-login candidate and reads nothing under its home', async () => {
    const sentinel = 'sk-codex-home-sentinel-123456';
    await mkdir(join(homeDir, '.codex'), { recursive: true });
    await writeFile(join(homeDir, '.codex', 'auth.json'), sentinel);
    const providerDiscovery = {
      discover: async (onResult: (r: DiscoveredProvider) => void): Promise<void> => {
        onResult({ defId: 'codex', name: 'Codex', installUrl: null, binPath: '/usr/local/bin/codex', version: '1', loggedIn: true, optionalFlags: [] });
      },
    };
    const node = makeNode({ providerDiscovery });
    const candidates = await node.accountDiscovery.scan();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'machine_login',
      provider: 'codex',
      sourcePath: 'machine-login:codex',
      routeKind: 'codex-subscription',
      hasOauthLogin: true,
    });
    expect(JSON.stringify(candidates)).not.toContain(sentinel);
    node.close();
  });
});
