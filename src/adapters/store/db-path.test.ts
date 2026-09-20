// src/adapters/store/db-path.test.ts — WO-0075: the ~/.docket app home, the legacy rename
// migration, and the DOCKET_DB_PATH override. The resolver is pure — the filesystem is a fake.
import { describe, expect, it } from 'vitest';
import { legacyDbPath, resolveDbPath, type PathIo } from './db-path';

const HOME = '/home/tester';

function fakeIo(opts: { existing?: string[]; failRename?: boolean } = {}): PathIo & { calls: string[] } {
  const calls: string[] = [];
  const existing = new Set(opts.existing ?? []);
  return {
    calls,
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => void calls.push(`mkdir ${p}`),
    renameSync: (from, to) => {
      if (opts.failRename) throw new Error('EXDEV');
      existing.delete(from);
      existing.add(to);
      calls.push(`rename ${from} -> ${to}`);
    },
  };
}

describe('resolveDbPath — the ~/.docket app home (WO-0075)', () => {
  it('an explicit DOCKET_DB_PATH wins verbatim and never migrates', () => {
    const io = fakeIo({ existing: ['/legacy/docket.db'] });
    const d = resolveDbPath({ DOCKET_DB_PATH: '/tmp/e2e/seeded.db' }, HOME, 'darwin', io);
    expect(d).toEqual({ dbPath: '/tmp/e2e/seeded.db', migrated: false });
    expect(io.calls).toEqual([]);
  });

  it('a fresh machine lands on ~/.docket/docket.db and touches nothing', () => {
    const io = fakeIo();
    const d = resolveDbPath({}, HOME, 'darwin', io);
    expect(d).toEqual({ dbPath: `${HOME}/.docket/docket.db`, migrated: false });
    expect(io.calls).toEqual([]);
  });

  it('legacy present + new missing: mkdir ~/.docket and RENAME (never copy), exactly once', () => {
    const legacy = legacyDbPath(HOME, 'darwin', {});
    const io = fakeIo({ existing: [legacy] });
    const d = resolveDbPath({}, HOME, 'darwin', io);
    expect(d).toEqual({ dbPath: `${HOME}/.docket/docket.db`, migrated: true });
    expect(io.calls).toEqual([`mkdir ${HOME}/.docket`, `rename ${legacy} -> ${HOME}/.docket/docket.db`]);
  });

  it('new already exists: the manual setup wins, the legacy file is never touched', () => {
    const legacy = legacyDbPath(HOME, 'darwin', {});
    const io = fakeIo({ existing: [legacy, `${HOME}/.docket/docket.db`] });
    const d = resolveDbPath({}, HOME, 'darwin', io);
    expect(d).toEqual({ dbPath: `${HOME}/.docket/docket.db`, migrated: false });
    expect(io.calls).toEqual([]);
  });

  it('an un-migratable legacy is FAIL-SAFE: keep using the legacy file, never risk it', () => {
    const legacy = legacyDbPath(HOME, 'darwin', {});
    const io = fakeIo({ existing: [legacy], failRename: true });
    const d = resolveDbPath({}, HOME, 'darwin', io);
    expect(d).toEqual({ dbPath: legacy, migrated: false });
  });

  it('the legacy location is the Electron-userData convention per platform', () => {
    expect(legacyDbPath(HOME, 'darwin', {})).toBe(`${HOME}/Library/Application Support/docket/docket.db`);
    expect(legacyDbPath(HOME, 'win32', { APPDATA: 'C:/AppData/Roaming' })).toBe('C:/AppData/Roaming/docket/docket.db');
    expect(legacyDbPath(HOME, 'win32', {})).toBe(`${HOME}/AppData/Roaming/docket/docket.db`);
    expect(legacyDbPath(HOME, 'linux', {})).toBe(`${HOME}/.config/docket/docket.db`);
  });
});
