// Credential importer tests: an injected in-memory reader only — no real file or home is read.
import { describe, expect, it } from 'vitest';

import { MAX_READ_BYTES, type AccountScanFs } from './account-scan';
import { createCredentialImporter } from './credential-import';

const HOME = '/home/tester';
const DIR = `${HOME}/.claude-glm`;
const TOKEN = 'sk-IMPORT-SENTINEL-0123456789';

const readerOf = (files: Readonly<Record<string, string>>, failOn?: string): AccountScanFs & { readonly reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    async listEntries() {
      throw new Error('the importer never lists');
    },
    async isDirectory() {
      throw new Error('the importer never stats');
    },
    async readText(path, maxBytes) {
      reads.push(path);
      if (path === failOn) throw new Error(`EACCES ${TOKEN}`);
      const text = files[path];
      if (text === undefined) return undefined;
      if (Buffer.byteLength(text) > maxBytes) throw new Error('too large');
      return text;
    },
  };
};

const settings = (env: Record<string, unknown>): string => JSON.stringify({ env, other: 'x' });

describe('createCredentialImporter', () => {
  it('returns the auth token string from settings.json and reads only that file', async () => {
    const fs = readerOf({ [`${DIR}/settings.json`]: settings({ ANTHROPIC_AUTH_TOKEN: TOKEN }) });
    expect(await createCredentialImporter({ fs, homeDir: HOME }).readEndpointToken(DIR)).toBe(TOKEN);
    expect(fs.reads).toEqual([`${DIR}/settings.json`]);
  });

  it('prefers the auth token key and falls back to the api key', async () => {
    const both = readerOf({ [`${DIR}/settings.json`]: settings({ ANTHROPIC_API_KEY: 'second', ANTHROPIC_AUTH_TOKEN: TOKEN }) });
    expect(await createCredentialImporter({ fs: both, homeDir: HOME }).readEndpointToken(DIR)).toBe(TOKEN);
    const only = readerOf({ [`${DIR}/settings.json`]: settings({ ANTHROPIC_API_KEY: TOKEN }) });
    expect(await createCredentialImporter({ fs: only, homeDir: HOME }).readEndpointToken(DIR)).toBe(TOKEN);
  });

  it('answers undefined for a missing file, no token key, a non-string value, bad JSON or an oversized file', async () => {
    const cases: readonly Record<string, string>[] = [
      {},
      { [`${DIR}/settings.json`]: settings({ ANTHROPIC_BASE_URL: 'https://api.example.test' }) },
      { [`${DIR}/settings.json`]: settings({ ANTHROPIC_AUTH_TOKEN: 42 }) },
      { [`${DIR}/settings.json`]: settings({ ANTHROPIC_AUTH_TOKEN: '' }) },
      { [`${DIR}/settings.json`]: '{ not json' },
      { [`${DIR}/settings.json`]: settings({ ANTHROPIC_AUTH_TOKEN: TOKEN }) + ' '.repeat(MAX_READ_BYTES) },
    ];
    for (const files of cases) {
      expect(await createCredentialImporter({ fs: readerOf(files), homeDir: HOME }).readEndpointToken(DIR)).toBeUndefined();
    }
  });

  it('swallows a read failure without carrying its text', async () => {
    const fs = readerOf({}, `${DIR}/settings.json`);
    expect(await createCredentialImporter({ fs, homeDir: HOME }).readEndpointToken(DIR)).toBeUndefined();
  });

  it('refuses a path that is not a direct child of the home directory, without reading', async () => {
    const fs = readerOf({ '/etc/settings.json': settings({ ANTHROPIC_AUTH_TOKEN: TOKEN }) });
    const importer = createCredentialImporter({ fs, homeDir: HOME });
    for (const path of ['/etc', `${HOME}/.claude/../..`, `${HOME}/a/b`, HOME, `${HOME}/`]) {
      expect(await importer.readEndpointToken(path)).toBeUndefined();
    }
    expect(fs.reads).toEqual([]);
  });
});
