// Parity (I-46) and durability / migration (I-47) tests for the SQLite app-settings repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppSettingsRepo } from '../../../application/index';
import { createFakeAppSettingsRepo } from '../../../application/ports/fakes/index';

import { createSqliteAppSettingsRepo } from './app-settings-repo';
import { openDatabase, type DocketDb } from './database';
import { MIGRATIONS } from './schema';

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-settings-'));
  openHandles = [];
});

afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openDb(path: string): DocketDb {
  const result = openDatabase(path);
  if (!result.ok) throw new Error(`expected openDatabase(${path}) to succeed`);
  openHandles.push(result.value);
  return result.value;
}

describe('createSqliteAppSettingsRepo', () => {
  describe.each([
    ['fake', (): AppSettingsRepo => createFakeAppSettingsRepo()],
    ['sqlite', (): AppSettingsRepo => createSqliteAppSettingsRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-46: an unset key reads as undefined', async () => {
      expect(await makeRepo().get('dispatch.limits')).toBeUndefined();
    });

    it('I-46: set and get round-trip any JSON value, structurally equal', async () => {
      const repo = makeRepo();
      const value = { global: 8, perRepo: 2, perAccount: { a: 1 }, list: [1, 'x', null, true] };
      await repo.set('k', value);
      expect(await repo.get('k')).toStrictEqual(value);
      await repo.set('n', 0);
      expect(await repo.get('n')).toBe(0);
      await repo.set('null', null);
      expect(await repo.get('null')).toBeNull();
    });

    it('I-46: setting a key again replaces its value; other keys are untouched', async () => {
      const repo = makeRepo();
      await repo.set('a', 1);
      await repo.set('b', 2);
      await repo.set('a', 3);
      expect(await repo.get('a')).toBe(3);
      expect(await repo.get('b')).toBe(2);
    });

    it('I-46: the stored value is a copy — mutating the input afterwards never reaches the store', async () => {
      const repo = makeRepo();
      const input = { n: { x: 1 } };
      await repo.set('k', input);
      input.n.x = 99;
      expect(await repo.get('k')).toStrictEqual({ n: { x: 1 } });
    });

    it('I-46: a value that is not JSON-serialisable (undefined) is rejected and nothing is written', async () => {
      const repo = makeRepo();
      await repo.set('k', 1);
      await expect(repo.set('k', undefined)).rejects.toThrow();
      expect(await repo.get('k')).toBe(1);
    });
  });

  it('I-47: a set value survives closing and reopening the database file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDb(path);
    await createSqliteAppSettingsRepo(first).set('dispatch.limits', { global: 6 });
    first.close();
    openHandles.splice(openHandles.indexOf(first), 1);

    expect(await createSqliteAppSettingsRepo(openDb(path)).get('dispatch.limits')).toStrictEqual({ global: 6 });
  });

  it('I-47: migration 4 creates app_settings(key TEXT PRIMARY KEY, value_json TEXT) and nothing else', () => {
    expect(MIGRATIONS[3]).toStrictEqual({
      version: 4,
      sql: 'CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT);',
    });
  });
});
