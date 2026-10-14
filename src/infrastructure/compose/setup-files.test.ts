// compose/setup-files.test.ts — the fs adapters of the setup conversation: the draft store under
// <dataDir>/setup/ (A-340: a draft survives a store re-creation and carries no secret) and the path
// reader (A-334: `..` collapsed, symlinks resolved to their real path before any scope check).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isUlid, parseUlid } from '../../domain/index';

import { createSetupDraftFiles, createSetupPathReader } from './setup-files';

const DRAFT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA7';
if (!isUlid(DRAFT_ID)) throw new Error('fixture draft id');

let dataDir: string;
let repo: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'docket-setup-files-'));
  dataDir = join(base, 'data');
  repo = join(base, 'acme');
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(join(dataDir, '..'), { recursive: true, force: true });
});

describe('the setup draft files', () => {
  it('A-340: a saved draft survives a store re-creation and the newest read answers it', async () => {
    const first = createSetupDraftFiles(dataDir);
    const conversation = parseUlid<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FA1');
    if (!conversation.ok) throw new Error('fixture conversation');
    await first.save({ id: DRAFT_ID, repoPath: repo, mode: 'ai', answers: { conversation: conversation.value }, updatedAt: 10 });
    await first.save({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA8', repoPath: '/other', mode: 'ai', answers: {}, updatedAt: 5 });

    // The app restarted: a fresh store over the same folder reads what the last one wrote.
    const second = createSetupDraftFiles(dataDir);
    const loaded = await second.load(DRAFT_ID);
    expect(loaded).toMatchObject({ id: DRAFT_ID, repoPath: repo, mode: 'ai' });
    expect(JSON.stringify(loaded)).not.toMatch(/sk-|BEGIN PRIVATE KEY/);
    expect((await second.newest?.())?.id).toBe(DRAFT_ID);
  });

  it('a non-ULID id loads nothing and a corrupt file never hides the rest', async () => {
    const store = createSetupDraftFiles(dataDir);
    await store.save({ id: DRAFT_ID, repoPath: repo, mode: 'ai', answers: {}, updatedAt: 1 });
    expect(await store.load('../../etc/passwd')).toBeUndefined();
    writeFileSync(join(dataDir, 'setup', 'not-a-ulid.json'), '{broken', 'utf8');
    expect((await store.newest?.())?.id).toBe(DRAFT_ID);
  });
});

describe('the setup path reader', () => {
  it('A-334: resolve collapses dots and follows symlinks to their real path; read answers file, dir and missing', async () => {
    const reader = createSetupPathReader();
    writeFileSync(join(repo, 'note.md'), 'hello', 'utf8');
    const linked = join(repo, 'linked');
    const target = join(dataDir, 'outside-target.txt');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(target, 'via symlink', 'utf8');
    symlinkSync(target, linked);

    // macOS answers tmpdir through /private; the reader resolves the real path, so the fixture
    // expectations go through realpath too.
    const real = (path: string): string => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    };
    expect(reader.resolve(`${repo}/nested/../note.md`)).toBe(real(join(repo, 'note.md')));
    expect(reader.resolve(linked)).toBe(real(target));

    const note = await reader.read(join(repo, 'note.md'));
    expect(note).toEqual({ kind: 'file', content: 'hello' });
    const listing = await reader.read(repo);
    expect(listing.kind).toBe('dir');
    if (listing.kind === 'dir') expect(listing.names).toEqual(['linked', 'note.md']);
    expect(await reader.read(join(repo, 'absent.txt'))).toEqual({ kind: 'missing' });
    const viaLink = await reader.read(reader.resolve(linked));
    expect(viaLink).toEqual({ kind: 'file', content: 'via symlink' });
  });
});
