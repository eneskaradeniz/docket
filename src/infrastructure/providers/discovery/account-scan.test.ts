// Account scan tests: an in-memory file-system reader only — the real home directory is never touched.
import { describe, expect, it } from 'vitest';

import type { AccountRecord, DiscoveredProvider, ProviderDiscovery } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
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
        provider: 'claude-code',
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

  it('keeps the configured endpoint path: endpointUrl is the origin plus pathname, nothing else', async () => {
    const at = (url: string): Promise<readonly { readonly endpointUrl?: string; readonly endpointHost?: string }[]> =>
      scan({
        dirs: ['.claude-glm'],
        contents: { [`${HOME}/.claude-glm/settings.json`]: settings({ ANTHROPIC_BASE_URL: url }) },
      });
    const withPath = await at('https://api.z.ai/api/anthropic');
    expect(withPath[0]?.endpointUrl).toBe('https://api.z.ai/api/anthropic');
    expect(withPath[0]?.endpointHost).toBe('api.z.ai');
    expect(await at('https://api.z.ai/api/anthropic/')).toMatchObject([{ endpointUrl: 'https://api.z.ai/api/anthropic' }]);
    expect(await at('https://api.z.ai/')).toMatchObject([{ endpointUrl: 'https://api.z.ai' }]);
    expect(await at('https://api.z.ai/api/anthropic?key=abc#section')).toMatchObject([
      { endpointUrl: 'https://api.z.ai/api/anthropic' },
    ]);
  });

  it('treats an endpoint URL with userinfo as unparsed, so no candidate carries credentials', async () => {
    const found = await scan({
      dirs: ['.claude-glm'],
      contents: {
        [`${HOME}/.claude-glm/.claude.json`]: identity(true),
        [`${HOME}/.claude-glm/settings.json`]: settings({ ANTHROPIC_BASE_URL: `https://user:${SENTINEL}@api.z.ai/api/anthropic` }),
      },
    });
    expect(found).toEqual([]);
    expect(JSON.stringify(found)).not.toContain(SENTINEL);
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

  it('P-33: never carries a secret value into the serialised candidates', async () => {
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
    // The userinfo URL is unparsed, so its directory proposes nothing at all.
    expect(found).toHaveLength(2);
    const json = JSON.stringify(found);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain('SENTINEL');
    expect(found.every((c) => c.endpointHost === undefined && c.endpointUrl === undefined)).toBe(true);
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

const found = (defId: string, patch: Partial<DiscoveredProvider> = {}): DiscoveredProvider => ({
  defId,
  name: defId,
  installUrl: null,
  binPath: `/usr/local/bin/${defId}`,
  version: '1.0.0',
  loggedIn: true,
  optionalFlags: [],
  ...patch,
});

const discoveryOf = (results: readonly DiscoveredProvider[]): ProviderDiscovery => ({
  discover: async (onResult) => {
    for (const result of results) onResult(result);
  },
});

const machineScan = (
  results: readonly DiscoveredProvider[],
  options: { readonly accounts?: readonly AccountRecord[]; readonly env?: Record<string, string>; readonly fs?: AccountScanFs } = {},
) => {
  const fs = options.fs ?? memoryFs({ dirs: [], contents: {} });
  return createAccountScan({
    fs,
    homeDir: HOME,
    accounts: { list: async () => options.accounts ?? [] },
    providers: discoveryOf(results),
    ...(options.env === undefined ? {} : { env: options.env }),
  }).scan();
};

describe('machine-login candidates', () => {
  it('P-53: an installed provider without a scanner yields exactly one machine-login candidate', async () => {
    const candidates = await machineScan([found('codex')]);
    expect(candidates).toEqual([
      {
        sourcePath: 'machine-login:codex',
        displayPath: '~/.codex',
        kind: 'machine_login',
        provider: 'codex',
        routeKind: 'codex-subscription',
        hasOauthLogin: true,
        envOverrides: [],
        warnings: [],
        alreadyAdded: false,
      },
    ]);
  });

  it('P-53: claude-code yields no machine-login candidate; a provider that is not installed yields none', async () => {
    const candidates = await machineScan([found('claude-code'), found('codex', { binPath: null, loggedIn: null })]);
    expect(candidates).toEqual([]);
  });

  it('P-53: hasOauthLogin is true only for loggedIn === true', async () => {
    const candidates = await machineScan([found('codex', { loggedIn: null }), found('copilot', { loggedIn: false })]);
    expect(candidates.map((c) => c.hasOauthLogin)).toEqual([false, false]);
  });

  it('P-53: alreadyAdded exactly when an account of that provider has no identityDir', async () => {
    const same = await machineScan([found('codex')], { accounts: [record({ provider: 'codex' })] });
    expect(same[0]?.alreadyAdded).toBe(true);
    const withDir = await machineScan([found('codex')], { accounts: [record({ provider: 'codex', identityDir: '/x' })] });
    expect(withDir[0]?.alreadyAdded).toBe(false);
    const other = await machineScan([found('codex')], { accounts: [record({ provider: 'copilot' })] });
    expect(other[0]?.alreadyAdded).toBe(false);
  });

  it('A-84: machine-login candidates follow the directory candidates', async () => {
    const fs = memoryFs({
      dirs: ['.claude-work'],
      contents: { [`${HOME}/.claude-work/.claude.json`]: identity(true) },
    });
    const candidates = await machineScan([found('codex'), found('copilot')], { fs });
    expect(candidates.map((c) => c.kind)).toEqual(['subscription', 'machine_login', 'machine_login']);
    expect(candidates.map((c) => c.provider)).toEqual(['claude-code', 'codex', 'copilot']);
  });

  it('I-38: displayPath is the override variable when set, then the documented path, then the provider name', async () => {
    const withEnv = await machineScan([found('codex')], { env: { CODEX_HOME: '/secret/place' } });
    expect(withEnv[0]?.displayPath).toBe('$CODEX_HOME');
    expect(JSON.stringify(withEnv)).not.toContain('/secret/place');
    const withoutEnv = await machineScan([found('copilot')], { env: {} });
    expect(withoutEnv[0]?.displayPath).toBe('~/.copilot');
    const noHome = await machineScan([found('agy', { name: 'Antigravity' })]);
    expect(noHome[0]?.displayPath).toBe('Antigravity');
  });

  it('I-38: nothing is read from disk for a machine-login candidate', async () => {
    const fs = memoryFs({ dirs: [], contents: {} });
    await machineScan([found('codex'), found('copilot')], { fs });
    expect(fs.reads).toEqual([]);
  });

  it('I-38: only codex and copilot carry an accountHome hint', () => {
    const homes = BUILTIN_PROVIDER_DEFS.filter((def) => def.accountHome !== undefined).map((def) => [def.id, def.accountHome]);
    expect(homes).toEqual([
      ['codex', { path: '~/.codex', env: 'CODEX_HOME' }],
      ['copilot', { path: '~/.copilot', env: 'COPILOT_HOME' }],
    ]);
  });
});
