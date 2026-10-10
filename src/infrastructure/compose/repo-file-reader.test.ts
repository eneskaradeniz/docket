// I-81 (containment, secret names, symlinks) and I-82 (limits, paging, redaction, binary) for the
// RepoFileReader port, against the real disk in a temporary directory, with the real redaction.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepoFileReader } from '../../application/index';
import { parseSlug, type RepoSlug } from '../../domain/index';
import { redactSecrets } from '../gates/index';

import { createRepoFileReader } from './repo-file-reader';

const slug = (value: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(value);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value as RepoSlug;
};
const REPO = slug('acme');
const GHOST = slug('ghost');
const PLANTED_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const PLANTED_AWS = 'AKIAABCDEFGHIJKLMNOP';

let base: string;
let repo: string;
let outside: string;
let reader: RepoFileReader;

const OPTIONS = { from: 1, maxLines: 400, maxBytes: 64 * 1024 } as const;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'docket-repo-reader-'));
  repo = join(base, 'repo');
  outside = join(base, 'outside');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside secret');
  writeFileSync(join(repo, 'src', 'main.ts'), 'line one\nline two\nline three\n');
  reader = createRepoFileReader({ repoPath: async (slugValue) => (slugValue === REPO ? repo : undefined), redact: redactSecrets });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('createRepoFileReader: containment (I-81)', () => {
  it('I-81: reads a file of a registered repo as lines; the trailing newline is not a line', async () => {
    expect(await reader.read(REPO, 'src/main.ts', OPTIONS)).toEqual({ ok: true, value: { lines: ['line one', 'line two', 'line three'], truncated: false } });
  });

  it('I-81: a repo that is not registered is repo_unknown, and nothing is read', async () => {
    expect(await reader.read(GHOST, 'src/main.ts', OPTIONS)).toEqual({ ok: false, error: 'repo_unknown' });
  });

  it('I-81: a path that is not a plain relative path is outside_repo, whether or not something exists there', async () => {
    const bad = ['../outside/secret.txt', 'src/../../outside/secret.txt', '/etc/passwd', 'src\\main.ts', 'src/%2e%2e/x', 'src/main.ts\0', 'src//main.ts', '', '..'];
    for (const path of bad) expect(await reader.read(REPO, path, OPTIONS), JSON.stringify(path)).toEqual({ ok: false, error: 'outside_repo' });
  });

  it('I-81: secret-bearing names are outside_repo even though the file exists', async () => {
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'cfg'));
    const names = ['.git/config', '.env', '.env.local', 'cfg/prod.pem', 'cfg/server.key', 'cfg/a.p12', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'cfg/app.keystore', 'credentials.json', 'cfg/Credentials.yml', '.npmrc', '.netrc'];
    for (const name of names) writeFileSync(join(repo, name), 'TOP SECRET');
    for (const name of names) expect(await reader.read(REPO, name, OPTIONS), name).toEqual({ ok: false, error: 'outside_repo' });
  });

  it('I-81: a symlink to a file outside the repo is outside_repo, and so is one through a linked directory', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(repo, 'leak.txt'));
    symlinkSync(outside, join(repo, 'linked'));
    expect(await reader.read(REPO, 'leak.txt', OPTIONS)).toEqual({ ok: false, error: 'outside_repo' });
    expect(await reader.read(REPO, 'linked/secret.txt', OPTIONS)).toEqual({ ok: false, error: 'outside_repo' });
  });

  it('I-81: a symlink inside the repo is followed to a plain file, but never to a secret-bearing one', async () => {
    symlinkSync(join(repo, 'src', 'main.ts'), join(repo, 'alias.ts'));
    writeFileSync(join(repo, '.env'), 'KEY=1');
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, '.git', 'config'), '[core]');
    symlinkSync(join(repo, '.env'), join(repo, 'innocent.txt'));
    symlinkSync(join(repo, '.git', 'config'), join(repo, 'gitcfg.txt'));
    expect(await reader.read(REPO, 'alias.ts', OPTIONS)).toMatchObject({ ok: true, value: { lines: ['line one', 'line two', 'line three'] } });
    expect(await reader.read(REPO, 'innocent.txt', OPTIONS)).toEqual({ ok: false, error: 'outside_repo' });
    expect(await reader.read(REPO, 'gitcfg.txt', OPTIONS)).toEqual({ ok: false, error: 'outside_repo' });
  });

  it('I-81: a dangling symlink, a missing file and a directory are not_found, with no path in the answer', async () => {
    symlinkSync(join(base, 'nowhere'), join(repo, 'dangling'));
    for (const path of ['dangling', 'src/missing.ts', 'src']) {
      const answer = await reader.read(REPO, path, OPTIONS);
      expect(answer, path).toEqual({ ok: false, error: 'not_found' });
      expect(JSON.stringify(answer)).not.toContain(base);
    }
  });

  it('I-81: a path with a symlinked parent that leads back inside is allowed; the registered path itself may be a symlink', async () => {
    symlinkSync(join(repo, 'src'), join(repo, 'srclink'));
    expect(await reader.read(REPO, 'srclink/main.ts', OPTIONS)).toMatchObject({ ok: true });
    const front = join(base, 'front');
    symlinkSync(repo, front);
    const viaLink = createRepoFileReader({ repoPath: async () => front, redact: redactSecrets });
    expect(await viaLink.read(REPO, 'src/main.ts', OPTIONS)).toMatchObject({ ok: true });
  });
});

describe('createRepoFileReader: limits, paging and redaction (I-82)', () => {
  const numbered = (count: number): string => Array.from({ length: count }, (_, i) => `row ${i + 1}`).join('\n') + '\n';

  it('I-82: returns at most maxLines lines from `from`, with truncated and nextFrom to continue', async () => {
    writeFileSync(join(repo, 'big.txt'), numbered(1000));
    const first = await reader.read(REPO, 'big.txt', { from: 1, maxLines: 400, maxBytes: 64 * 1024 });
    expect(first).toMatchObject({ ok: true, value: { truncated: true, nextFrom: 401 } });
    expect(first.ok && first.value.lines).toHaveLength(400);
    const second = await reader.read(REPO, 'big.txt', { from: 401, maxLines: 400, maxBytes: 64 * 1024 });
    expect(second.ok && second.value.lines[0]).toBe('row 401');
    const last = await reader.read(REPO, 'big.txt', { from: 801, maxLines: 400, maxBytes: 64 * 1024 });
    expect(last).toMatchObject({ ok: true, value: { truncated: false } });
    expect(last.ok && last.value.lines).toHaveLength(200);
    expect(last.ok && 'nextFrom' in last.value).toBe(false);
  });

  it('I-82: maxBytes bounds a page by bytes, always returning at least one line; a `from` past the end is an empty, complete page', async () => {
    writeFileSync(join(repo, 'wide.txt'), `${'a'.repeat(100)}\n${'b'.repeat(100)}\n${'c'.repeat(100)}\n`);
    const page = await reader.read(REPO, 'wide.txt', { from: 1, maxLines: 400, maxBytes: 150 });
    expect(page).toMatchObject({ ok: true, value: { truncated: true, nextFrom: 2 } });
    expect(page.ok && page.value.lines).toEqual(['a'.repeat(100)]);
    const tiny = await reader.read(REPO, 'wide.txt', { from: 2, maxLines: 400, maxBytes: 1 });
    expect(tiny.ok && tiny.value.lines).toEqual(['b'.repeat(100)]);
    expect(await reader.read(REPO, 'wide.txt', { from: 99, maxLines: 400, maxBytes: 1000 })).toEqual({ ok: true, value: { lines: [], truncated: false } });
  });

  it('I-82: a planted secret in the content never comes out — token and key patterns are redacted, other text and line count stay', async () => {
    writeFileSync(
      join(repo, 'src', 'config.ts'),
      `const token = '${PLANTED_TOKEN}';\nconst note = 'fine';\nconst aws = '${PLANTED_AWS}';\n${'x\n'.repeat(3)}later = '${PLANTED_TOKEN}'\n`,
    );
    const answer = await reader.read(REPO, 'src/config.ts', OPTIONS);
    expect(answer.ok).toBe(true);
    const text = JSON.stringify(answer);
    expect(text).not.toContain(PLANTED_TOKEN);
    expect(text).not.toContain(PLANTED_AWS);
    expect(answer.ok && answer.value.lines).toHaveLength(7);
    expect(answer.ok && answer.value.lines[1]).toBe("const note = 'fine';");
    const paged = await reader.read(REPO, 'src/config.ts', { from: 6, maxLines: 400, maxBytes: 64 * 1024 });
    expect(JSON.stringify(paged)).not.toContain(PLANTED_TOKEN);
  });

  it('I-82: the redaction handed in is the one applied (not a built-in one)', async () => {
    const custom = createRepoFileReader({ repoPath: async () => repo, redact: (text) => text.replaceAll('line', 'LINE') });
    const answer = await custom.read(REPO, 'src/main.ts', OPTIONS);
    expect(answer.ok && answer.value.lines).toEqual(['LINE one', 'LINE two', 'LINE three']);
  });

  it('I-82: binary content is not_text and a file over 256 KiB is too_large', async () => {
    writeFileSync(join(repo, 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));
    writeFileSync(join(repo, 'invalid.txt'), Buffer.from([0xff, 0xfe, 0xfd]));
    writeFileSync(join(repo, 'huge.txt'), 'x'.repeat(300 * 1024));
    expect(await reader.read(REPO, 'logo.png', OPTIONS)).toEqual({ ok: false, error: 'not_text' });
    expect(await reader.read(REPO, 'invalid.txt', OPTIONS)).toEqual({ ok: false, error: 'not_text' });
    expect(await reader.read(REPO, 'huge.txt', OPTIONS)).toEqual({ ok: false, error: 'too_large' });
  });

  it('I-82: an empty file has no lines', async () => {
    writeFileSync(join(repo, 'empty.txt'), '');
    expect(await reader.read(REPO, 'empty.txt', OPTIONS)).toEqual({ ok: true, value: { lines: [], truncated: false } });
  });
});
