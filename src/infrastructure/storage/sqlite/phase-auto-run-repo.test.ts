// Parity (I-48) and durability / migration (I-49) tests for the SQLite PhaseAutoRun repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type PhaseAutoRun, type Slug, type WorkOrderId } from '../../../domain/index';
import type { PhaseAutoRunRepo } from '../../../application/index';
import { createFakePhaseAutoRunRepo } from '../../../application/ports/fakes/index';

import { openDatabase, type DocketDb } from './database';
import { createSqlitePhaseAutoRunRepo } from './phase-auto-run-repo';
import { MIGRATIONS } from './schema';

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const WORK_ORDER = ((): WorkOrderId => {
  const parsed = parseUlid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FCV');
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
})();

const record = (project: string, phase: string, overrides: Partial<PhaseAutoRun> = {}): PhaseAutoRun => ({
  project: slugOf(project),
  phase: slugOf(phase),
  state: 'running',
  startedAt: 1_000,
  attention: [],
  ...overrides,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-auto-run-'));
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

describe('createSqlitePhaseAutoRunRepo', () => {
  describe.each([
    ['fake', (): PhaseAutoRunRepo => createFakePhaseAutoRunRepo()],
    ['sqlite', (): PhaseAutoRunRepo => createSqlitePhaseAutoRunRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-48: an unknown (project, phase) reads as undefined and an empty store lists nothing', async () => {
      const repo = makeRepo();
      expect(await repo.get(slugOf('atolye'), slugOf('p1'))).toBeUndefined();
      expect(await repo.list()).toEqual([]);
    });

    it('I-48: put and get round-trip the record, attention ids included, structurally equal', async () => {
      const repo = makeRepo();
      const full = record('atolye', 'p1', { state: 'paused', startedAt: 7, attention: [WORK_ORDER] });
      await repo.put(full);
      expect(await repo.get(full.project, full.phase)).toStrictEqual(full);
    });

    it('I-48: put replaces the record of the same (project, phase) and leaves others alone', async () => {
      const repo = makeRepo();
      await repo.put(record('atolye', 'p1'));
      await repo.put(record('atolye', 'p2', { startedAt: 2 }));
      await repo.put(record('atolye', 'p1', { state: 'done', startedAt: 9, attention: [WORK_ORDER] }));
      expect(await repo.get(slugOf('atolye'), slugOf('p1'))).toStrictEqual(record('atolye', 'p1', { state: 'done', startedAt: 9, attention: [WORK_ORDER] }));
      expect(await repo.get(slugOf('atolye'), slugOf('p2'))).toStrictEqual(record('atolye', 'p2', { startedAt: 2 }));
    });

    it('I-48: list answers every record ordered by project then phase', async () => {
      const repo = makeRepo();
      await repo.put(record('zeta', 'a'));
      await repo.put(record('atolye', 'p2'));
      await repo.put(record('atolye', 'p1'));
      expect((await repo.list()).map((entry) => `${entry.project}/${entry.phase}`)).toEqual(['atolye/p1', 'atolye/p2', 'zeta/a']);
    });

    it('I-48: the stored record is a copy — mutating the input afterwards never reaches the store', async () => {
      const repo = makeRepo();
      const ids: WorkOrderId[] = [WORK_ORDER];
      await repo.put(record('atolye', 'p1', { attention: ids }));
      ids.length = 0;
      expect((await repo.get(slugOf('atolye'), slugOf('p1')))?.attention).toEqual([WORK_ORDER]);
    });
  });

  it('I-49: a stored record survives closing and reopening the database file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDb(path);
    await createSqlitePhaseAutoRunRepo(first).put(record('atolye', 'p1', { attention: [WORK_ORDER] }));
    first.close();
    openHandles.splice(openHandles.indexOf(first), 1);

    expect(await createSqlitePhaseAutoRunRepo(openDb(path)).list()).toStrictEqual([record('atolye', 'p1', { attention: [WORK_ORDER] })]);
  });

  it('I-49: migration 5 creates phase_auto_runs with primary key (project, phase) and an attention_json column', () => {
    expect(MIGRATIONS[4]).toStrictEqual({
      version: 5,
      sql: 'CREATE TABLE phase_auto_runs (project TEXT NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, attention_json TEXT NOT NULL, PRIMARY KEY (project, phase));',
    });
  });
});
