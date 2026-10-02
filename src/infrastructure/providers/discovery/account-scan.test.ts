// Account scan tests: an in-memory file-system reader only — the real home directory is never touched.
import { describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';
import { createAccountScan, MAX_READ_BYTES, type AccountScanFs } from './account-scan';

const HOME = '/home/tester';
const SENTINEL = 'sk-SENTINEL-do-not-leak-0123456789';

interface Fixture {
  readonly dirs: readonly string[]; // names of directories directly under HOME
  readonly files?: readonly string[]; // names of plain files directly under HOME
  readonly contents: Readonly<Record<string, string>>; // absolute path -> text
  readonly unreadable?: readonly string[]; // absolute paths whose read throws
  readonly unlistable?: boolean;
}

function memoryFs(fixture: Fixture): AccountScanFs & { readonly reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async listEntries(dir) {
      if (dir !== HOME || fixture.unlistable === true) throw new Error('cannot list');
      return [...fixture.dirs, ...(fixture.files ?? [])];
    },
    async isDirectory(path) {
      return fixture.dirs.some((name) => `${HOME}/${name}` === path);
    },
    async readText(path, maxBytes) {
      reads.push(path);
      if (fixture.unreadable?.includes(path) === true) throw new Error('EACCES');
      const text = fixture.contents[path];
      if (text === undefined) return undefined;
      if (Buffer.byteLength(text) > maxBytes) throw new Error('too large');
      return text;
    },
  };
}

const settings = (env: Record<string, unknown>): string => JSON.stringify({ env, hooks: { x: SENTINEL } });
const identity = (oauth: boolean): string =>
  JSON.stringify(oauth ? { oauthAccount: { emailAddress: SENTINEL, accountUuid: SENTINEL } } : { userID: SENTINEL });

const idOf = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const record = (patch: Partial<AccountRecord>): AccountRecord => ({
  id: idOf('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  provider: 'claude-code',
  label: 'existing',
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
  ...patch,
});

const scan = (fixture: Fixture, accounts: readonly AccountRecord[] = []) =>
  createAccountScan({ fs: memoryFs(fixture), homeDir: HOME, accounts: { list: async () => accounts } }).scan();

describe('account scan', () => {
  it('proposes a subscription directory with an OAuth login and no overrides', async () => {
    const found = await scan({
      dirs: ['.claude-work'],
      contents: {
        [`${HOME}/.claude-work/.claude.json`]: identity(true),
        [`${HOME}/.claude-work/settings.json`]: settings({ FOO: 'bar' }),
      },
    });
    expect(found).toEqual([
      {
        sourcePath: `${HOME}/.claude-work`,
        displayPath: '~/.claude-work',
        kind: 'subscription',
        routeKind: 'anthropic-subscription',
        hasOauthLogin: true,
        envOverrides: [],
        warnings: [],
        alreadyAdded: false,
      },
    ]);
  });

  it('proposes a compatible-endpoint directory by its endpoint host', async () => {
    const found = await scan({
      dirs: ['.claude-glm'],
      contents: {
        [`${HOME}/.claude-glm/settings.json`]: settings({
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          ANTHROPIC_AUTH_TOKEN: SENTINEL,
        }),
      },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'compatible_endpoint',
      routeKind: 'zai-glm',
      endpointHost: 'api.z.ai',
      hasOauthLogin: false,
      envOverrides: ['endpoint', 'token'],
      warnings: [],
    });
  });

  it('classifies a mixed directory by its overrides and warns that they override the login', async () => {
    const found = await scan({
      dirs: ['.claude-mixed'],
      contents: {
        [`${HOME}/.claude-mixed/.claude.json`]: identity(true),
        [`${HOME}/.claude-mixed/settings.json`]: settings({
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          ANTHROPIC_MODEL: 'glm-5.3',
        }),
      },
    });
    expect(found[0]).toMatchObject({
      kind: 'compatible_endpoint',
      routeKind: 'zai-glm',
      hasOauthLogin: true,
      envOverrides: ['endpoint', 'model'],
      warnings: ['env_overrides_login'],
    });
  });

  it('reads the home-root identity file for the default directory only', async () => {
    const found = await scan({
      dirs: ['.claude', '.claude-other'],
      contents: { [`${HOME}/.claude.json`]: identity(true) },
    });
    expect(found.map((c) => c.sourcePath)).toEqual([`${HOME}/.claude`]);
  });

  it('skips a tool-only directory that has hooks and nothing else', async () => {
    const found = await scan({
      dirs: ['.claude-tools'],
      contents: {
        [`${HOME}/.claude-tools/settings.json`]: JSON.stringify({ hooks: { a: 'b' } }),
        [`${HOME}/.claude-tools/.claude.json`]: identity(false),
      },
    });
    expect(found).toEqual([]);
  });

  it('keeps a model-only override on a subscription as an override without a warning', async () => {
    const found = await scan({
      dirs: ['.claude-m'],
      contents: {
        [`${HOME}/.claude-m/.claude.json`]: identity(true),
        [`${HOME}/.claude-m/settings.json`]: settings({ ANTHROPIC_MODEL: 'x' }),
      },
    });
    expect(found[0]).toMatchObject({ kind: 'subscription', envOverrides: ['model'], warnings: [] });
  });

  it('never proposes a clean subscription when an unknown endpoint overrides the login', async () => {
    const found = await scan({
      dirs: ['.claude-odd'],
      contents: {
        [`${HOME}/.claude-odd/.claude.json`]: identity(true),
        [`${HOME}/.claude-odd/settings.json`]: settings({ ANTHROPIC_BASE_URL: 'https://example.invalid/v1' }),
      },
    });
    expect(found).toEqual([]);
  });

  it('marks a directory unreadable when one file fails but the other gives evidence', async () => {
    const found = await scan({
      dirs: ['.claude-a', '.claude-b'],
      contents: {
        [`${HOME}/.claude-a/.claude.json`]: identity(true),
        [`${HOME}/.claude-a/settings.json`]: '{ not json',
        [`${HOME}/.claude-b/settings.json`]: settings({ ANTHROPIC_BASE_URL: 'https://api.z.ai/x' }),
      },
      unreadable: [`${HOME}/.claude-b/.claude.json`],
    });
    expect(found.map((c) => [c.sourcePath, c.warnings])).toEqual([
      [`${HOME}/.claude-a`, ['unreadable']],
      [`${HOME}/.claude-b`, ['unreadable']],
    ]);
  });

  it('skips a directory whose files are all unreadable or malformed, and never throws', async () => {
    const found = await scan({
      dirs: ['.claude-x', '.claude-y'],
      contents: { [`${HOME}/.claude-y/settings.json`]: 'oops' },
      unreadable: [`${HOME}/.claude-x/settings.json`, `${HOME}/.claude-x/.claude.json`],
    });
    expect(found).toEqual([]);
  });

  it('treats a file over the read cap as unreadable', async () => {
    const huge = JSON.stringify({ oauthAccount: {}, pad: 'x'.repeat(MAX_READ_BYTES) });
    const found = await scan({
      dirs: ['.claude-big'],
      contents: {
        [`${HOME}/.claude-big/.claude.json`]: huge,
        [`${HOME}/.claude-big/settings.json`]: settings({ ANTHROPIC_BASE_URL: 'https://api.z.ai/x' }),
      },
    });
    expect(found[0]).toMatchObject({ kind: 'compatible_endpoint', warnings: ['unreadable'] });
  });

  it('returns nothing when the home directory cannot be listed', async () => {
    expect(await scan({ dirs: [], contents: {}, unlistable: true })).toEqual([]);
  });

  it('never carries a secret value into the serialised candidates', async () => {
    const found = await scan({
      dirs: ['.claude', '.claude-glm', '.claude-w'],
      contents: {
        [`${HOME}/.claude.json`]: identity(true),
        [`${HOME}/.claude-glm/settings.json`]: settings({
          ANTHROPIC_BASE_URL: `https://user:${SENTINEL}@api.z.ai/api/anthropic?key=${SENTINEL}`,
          ANTHROPIC_AUTH_TOKEN: SENTINEL,
          ANTHROPIC_API_KEY: SENTINEL,
          [`CUSTOM_${SENTINEL}`]: SENTINEL,
        }),
        [`${HOME}/.claude-w/.claude.json`]: identity(true),
        [`${HOME}/.claude-w/settings.json`]: settings({ OTHER: SENTINEL, ANTHROPIC_MODEL: SENTINEL }),
      },
    });
    expect(found).toHaveLength(3);
    const json = JSON.stringify(found);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain('SENTINEL');
    expect(found.find((c) => c.endpointHost !== undefined)?.endpointHost).toBe('api.z.ai');
  });

  it('detects an already-added account by identity directory or by route kind and host', async () => {
    const fixture: Fixture = {
      dirs: ['.claude-work', '.claude-glm', '.claude-new'],
      contents: {
        [`${HOME}/.claude-work/.claude.json`]: identity(true),
        [`${HOME}/.claude-glm/settings.json`]: settings({ ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic' }),
        [`${HOME}/.claude-new/.claude.json`]: identity(true),
      },
    };
    const found = await scan(fixture, [
      record({ identityDir: `${HOME}/.claude-work` }),
      record({
        id: idOf('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
        authMode: 'api_key',
        routeKind: 'zai-glm',
        endpoint: 'https://api.z.ai/api/anthropic',
      }),
    ]);
    expect(found.map((c) => [c.displayPath, c.alreadyAdded])).toEqual([
      ['~/.claude-glm', true],
      ['~/.claude-new', false],
      ['~/.claude-work', true],
    ]);
  });

  it('matches only directories named like a Claude config directory', async () => {
    const fs = memoryFs({
      dirs: ['.claude', '.claude-a_b-1', '.claudex', '.claude-', '.config', '.claude-é', 'claude-x'],
      files: ['.claude-file'],
      contents: Object.fromEntries(
        ['.claude', '.claude-a_b-1', '.claudex', '.claude-', '.config', '.claude-é', 'claude-x', '.claude-file'].map(
          (name) => [`${HOME}/${name}/.claude.json`, identity(true)],
        ),
      ),
    });
    const found = await createAccountScan({ fs, homeDir: HOME, accounts: { list: async () => [] } }).scan();
    expect(found.map((c) => c.displayPath)).toEqual(['~/.claude', '~/.claude-a_b-1']);
    expect(fs.reads.every((path) => !path.includes('.config') && !path.includes('claudex'))).toBe(true);
  });

  it('still scans when the account list cannot be read', async () => {
    const found = await createAccountScan({
      fs: memoryFs({ dirs: ['.claude-a'], contents: { [`${HOME}/.claude-a/.claude.json`]: identity(true) } }),
      homeDir: HOME,
      accounts: {
        list: async () => {
          throw new Error('db closed');
        },
      },
    }).scan();
    expect(found).toHaveLength(1);
    expect(found[0]?.alreadyAdded).toBe(false);
  });
});
