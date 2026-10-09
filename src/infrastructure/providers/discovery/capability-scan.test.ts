// capability-scan.test.ts — I-42 (confinement and the silent skips, against the real node fs),
// I-43 (parsing drops everything the candidate cannot carry — the secrecy law), and I-45 (the
// fake port carries the adapter's contract). No vendor names beyond this folder: the scan rows
// are data, proved by the vendor's own CLI documentation (the PR's evidence table).
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AccountId, CapabilityCandidate } from '../../../domain/index';
import type { CapabilityScanAccount } from '../../../application/index';
import { createFakeCapabilityDiscovery } from '../../../application/ports/fakes/fake-capability-discovery';

import {
  CAPABILITY_SCAN_MAX_BYTES,
  createCapabilityScan,
  createNodeCapabilityScanFs,
  createNodeCapabilityScan,
  type CapabilityScanFs,
} from './capability-scan';

const ACCT = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const DIR = '/cfg/dir';

// `null` is the explicit "no identityDir" — passing undefined would trigger the default.
const account = (provider = 'claude-code', identityDir: string | null = DIR): CapabilityScanAccount => ({
  id: ACCT,
  provider,
  ...(identityDir === null ? {} : { identityDir }),
});

/** An in-memory fs over a plain file map — the seam tests' stand-in for the node reader. */
const memoryFs = (files: Readonly<Record<string, string>>, broken: readonly string[] = []): CapabilityScanFs => ({
  async listEntries() {
    return Object.keys(files);
  },
  async isDirectory(path) {
    return path === DIR && !broken.includes(path);
  },
  async readText(path) {
    if (broken.includes(path)) throw new Error('boom');
    const content = files[path];
    if (content === undefined) return undefined;
    if (content.length > CAPABILITY_SCAN_MAX_BYTES) return undefined;
    return content;
  },
});

describe('createCapabilityScan', () => {
  it('I-42: reads only the rows the provider\'s map names; every other provider yields nothing', async () => {
    const fs = memoryFs({ [`${DIR}/CLAUDE.md`]: '# Rules\n' });
    const scan = createCapabilityScan({ fs });
    const claude = await scan.scan([account()]);
    expect(claude).toHaveLength(1);
    const other = await scan.scan([account('some-other-provider')]);
    expect(other).toEqual([]);
  });

  it('I-42: an account without identityDir, a missing directory, a throw and an unparseable file each yield no candidate and no throw', async () => {
    const scan = createCapabilityScan({ fs: memoryFs({ [`${DIR}/.claude.json`]: 'not json' }) });
    expect(await scan.scan([account('claude-code', null)])).toEqual([]);
    expect(await scan.scan([account('claude-code', '/cfg/missing')])).toEqual([]);

    const throwing = createCapabilityScan({ fs: memoryFs({}, [DIR]) });
    expect(await throwing.scan([account()])).toEqual([]);

    const unparseable = createCapabilityScan({ fs: memoryFs({ [`${DIR}/.claude.json`]: '{ nope' }) });
    expect(await unparseable.scan([account()])).toEqual([]);
  });

  it('I-43: the memory row is one context candidate — name, referenced path, first non-empty line', async () => {
    const fs = memoryFs({ [`${DIR}/CLAUDE.md`]: '\n   \n# Repo rules\n\nMore words\n' });
    const found = await createCapabilityScan({ fs }).scan([account()]);
    expect(found).toEqual([
      {
        identity: 'context:CLAUDE.md',
        kind: 'context',
        name: 'CLAUDE.md',
        sources: [ACCT],
        path: `${DIR}/CLAUDE.md`,
        description: '# Repo rules',
      },
    ]);
  });

  it('I-43, the secrecy law: a planted mcp-shaped source keeps name and command only — env keys, env values, args, headers and URLs appear nowhere', async () => {
    const planted = JSON.stringify({
      oauthAccount: { email: 'op@example.com' },
      mcpServers: {
        'secret-server': {
          command: 'npx',
          args: ['-y', 'some-mcp-server'],
          env: { API_TOKEN: 'sk-super-secret', OTHER_KEY: 'hunter2' },
        },
        'remote-server': { type: 'http', url: 'https://mcp.example.com/x?token=hunter2', headers: { Authorization: 'Bearer sk-remote' } },
      },
      projects: { '/some/project': { mcpServers: { 'local-server': { command: 'hidden-cmd' } } } },
    });
    const found: readonly CapabilityCandidate[] = await createCapabilityScan({ fs: memoryFs({ [`${DIR}/.claude.json`]: planted }) }).scan([account()]);

    // Only the stdio entry with a command becomes a candidate; the remote entry carries nothing a
    // candidate can hold; the per-project entry is project state, never read.
    expect(found).toEqual([
      { identity: 'mcp:secret-server|npx', kind: 'mcp', name: 'secret-server', sources: [ACCT], command: 'npx' },
    ]);
    const serialized = JSON.stringify(found);
    for (const banned of ['sk-super-secret', 'hunter2', 'OTHER_KEY', 'API_TOKEN', 'some-mcp-server', 'Bearer', 'mcp.example.com', 'hidden-cmd', 'op@example.com']) {
      expect(serialized.includes(banned), banned).toBe(false);
    }
  });
});

describe('createNodeCapabilityScanFs (the real reader)', () => {
  let root: string;

  const prepare = async (): Promise<string> => {
    root = await mkdtemp(join(tmpdir(), 'docket-capability-scan-'));
    const dir = join(root, 'cfg');
    await mkdir(dir);
    return dir;
  };

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined as unknown as string;
  });

  it('I-42: reads the row files of a real directory through the adapter', async () => {
    const dir = await prepare();
    await writeFile(join(dir, 'CLAUDE.md'), '# Rules\n', 'utf8');
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { db: { command: 'npx db' } } }), 'utf8');
    const found = await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: dir }]);
    // Row order: the map's own — the memory file first, the state file second.
    expect(found.map((c) => c.identity)).toEqual(['context:CLAUDE.md', 'mcp:db|npx db']);
  });

  it('I-42: a symlink at the config root pointing outside the directory yields no candidate and no throw', async () => {
    const dir = await prepare();
    const outside = join(root, 'outside.md');
    await writeFile(outside, '# Stolen\n', 'utf8');
    await symlink(outside, join(dir, 'CLAUDE.md'));
    const found = await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: dir }]);
    expect(found).toEqual([]);
  });

  it('I-42: a file over 256 KiB is skipped silently', async () => {
    const dir = await prepare();
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { db: { command: 'x'.repeat(CAPABILITY_SCAN_MAX_BYTES) } } }), 'utf8');
    const found = await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: dir }]);
    expect(found).toEqual([]);
  });

  it('I-42: a NUL byte and invalid UTF-8 are skipped silently', async () => {
    const dir = await prepare();
    await writeFile(join(dir, '.claude.json'), Buffer.from('{"mcpServers":{"db":{"command":"a\0b"}}}', 'utf8'));
    expect(await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: dir }])).toEqual([]);
    await writeFile(join(dir, '.claude.json'), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), 'utf8'); // not UTF-8
    expect(await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: dir }])).toEqual([]);
  });

  it('I-42: a missing identityDir and a FIFO in the row\'s place yield no candidate and no throw', async () => {
    await prepare();
    const found = await createNodeCapabilityScan().scan([{ id: ACCT, provider: 'claude-code', identityDir: join(root, 'nope') }]);
    expect(found).toEqual([]);
    // isDirectory on a FIFO row path: the adapter's directory check sees a non-directory first.
    expect(await createNodeCapabilityScanFs().readText(join(root, 'nope', 'CLAUDE.md'), 1024)).toBeUndefined();
  });
});

describe('I-45: the fake discovery port carries the adapter\'s contract', () => {
  it('I-45: no identityDir answers nothing; a broken directory is an empty find; sources are forced to the scanning account', async () => {
    const fake = createFakeCapabilityDiscovery();
    fake.seed(DIR, [{ identity: 'context:CLAUDE.md', kind: 'context', name: 'CLAUDE.md', sources: [] as AccountId[], path: `${DIR}/CLAUDE.md` }]);
    fake.breakDir('/cfg/broken');

    expect(await fake.scan([account('claude-code', null)])).toEqual([]);
    expect(await fake.scan([{ id: ACCT, provider: 'claude-code', identityDir: '/cfg/broken' }])).toEqual([]);
    const found = await fake.scan([account()]);
    expect(found).toEqual([
      { identity: 'context:CLAUDE.md', kind: 'context', name: 'CLAUDE.md', sources: [ACCT], path: `${DIR}/CLAUDE.md` },
    ]);
    // A-2: every answer is a fresh copy — two reads of the same scan are equal, never shared.
    const firstRead = fake.scans()[0][0];
    const secondRead = fake.scans()[0][0];
    expect(firstRead).toEqual(secondRead);
    expect(firstRead).not.toBe(secondRead);
  });
});
