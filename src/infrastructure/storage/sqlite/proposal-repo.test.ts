// Parity (I-5), round-trip (I-6) and durability (I-8) tests for the SQLite proposal repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProposalRecord, ProposalRepo } from '../../../application/index';
import { createFakeProposalRepo } from '../../../application/ports/fakes/index';
import { parseUlid, type Actor, type ProposalId, type RepoSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteProposalRepo } from './proposal-repo';

const P1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const P2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const P3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

const proposalId = (s: string): ProposalId => {
  const parsed = parseUlid<'proposal'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const REPO = 'acme' as RepoSlug;

const AUTHOR: Actor = { kind: 'user', id: 'u1' };
const DECIDER: Actor = { kind: 'user', id: 'u2', label: 'Enes' };
const GLOBAL_SCOPE: ProposalRecord['scope'] = { kind: 'global' };
const REPO_SCOPE: ProposalRecord['scope'] = { kind: 'repo', repo: REPO };

const record = (id: string, status: ProposalRecord['status'], scope: ProposalRecord['scope'] = GLOBAL_SCOPE): ProposalRecord => ({
  id: proposalId(id),
  author: AUTHOR,
  createdAt: 1_711_234_567_890,
  target: 'roles/implementer.yaml',
  baseHash: 'h0',
  before: 'a: 1\n',
  after: 'a: 2\n',
  summary: 'change',
  status,
  scope,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-proposal-'));
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

function closeDb(db: DocketDb): void {
  db.close();
  const index = openHandles.indexOf(db);
  if (index >= 0) openHandles.splice(index, 1);
}

describe('createSqliteProposalRepo', () => {
  describe.each([
    ['fake', (): ProposalRepo => createFakeProposalRepo()],
    ['sqlite', (): ProposalRepo => createSqliteProposalRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-5: save upserts by id; get round-trips the record and is undefined for an unknown id', async () => {
      const repo = makeRepo();
      await repo.save(record(P1, 'pending'));
      await repo.save(record(P2, 'pending', REPO_SCOPE));
      await repo.save(record(P1, 'approved'));

      expect(await repo.get(proposalId(P1))).toStrictEqual(record(P1, 'approved'));
      expect(await repo.get(proposalId(P2))).toStrictEqual(record(P2, 'pending', REPO_SCOPE));
      expect(await repo.get(proposalId(P3))).toBeUndefined();
    });

    it('I-5: list filters by status and lists everything for an empty filter', async () => {
      const repo = makeRepo();
      await repo.save(record(P1, 'pending'));
      await repo.save(record(P2, 'approved'));
      await repo.save(record(P3, 'rejected'));

      expect((await repo.list({})).map((p) => p.id).sort()).toEqual([proposalId(P1), proposalId(P2), proposalId(P3)].sort());
      expect((await repo.list({ status: 'pending' })).map((p) => p.id)).toEqual([proposalId(P1)]);
      expect((await repo.list({ status: 'approved' })).map((p) => p.id)).toEqual([proposalId(P2)]);
      expect((await repo.list({ status: 'stale' }))).toEqual([]);
    });

    it('I-6: a proposal read back deep-equals the record written — absent decision fields stay absent, actors and numbers survive', async () => {
      const repo = makeRepo();
      const pending = record(P1, 'pending', REPO_SCOPE);
      await repo.save(pending);
      const readPending = await repo.get(proposalId(P1));
      expect(readPending).toStrictEqual(pending);
      if (readPending === undefined) throw new Error('proposal must read back');
      expect('decidedBy' in readPending).toBe(false);
      expect('decidedAt' in readPending).toBe(false);

      const decided: ProposalRecord = {
        ...record(P2, 'approved', REPO_SCOPE),
        decidedBy: DECIDER,
        decidedAt: 1_711_235_000_000,
      };
      await repo.save(decided);
      expect(await repo.get(proposalId(P2))).toStrictEqual(decided);
    });

    it('I-6: the status index column is rewritten from the record on every save', async () => {
      const repo = makeRepo();
      await repo.save(record(P1, 'pending'));
      expect((await repo.list({ status: 'pending' })).map((p) => p.id)).toEqual([proposalId(P1)]);
      expect(await repo.list({ status: 'approved' })).toEqual([]);

      await repo.save(record(P1, 'approved'));
      expect(await repo.list({ status: 'pending' })).toEqual([]);
      expect((await repo.list({ status: 'approved' })).map((p) => p.id)).toEqual([proposalId(P1)]);
    });
  });

  describe('sqlite specifics', () => {
    it('I-5: list orders proposals by id asc even when inserted out of order', async () => {
      const db = openDb(':memory:');
      const repo = createSqliteProposalRepo(db);
      await repo.save(record(P3, 'pending'));
      await repo.save(record(P1, 'pending'));
      await repo.save(record(P2, 'approved'));

      expect((await repo.list({})).map((p) => p.id)).toEqual([proposalId(P1), proposalId(P2), proposalId(P3)]);
      expect((await repo.list({ status: 'pending' })).map((p) => p.id)).toEqual([proposalId(P1), proposalId(P3)]);
    });

    it('I-8: proposals survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqliteProposalRepo(first);
      const pending = record(P1, 'pending', REPO_SCOPE);
      const decided: ProposalRecord = { ...record(P2, 'approved'), decidedBy: DECIDER, decidedAt: 1_711_235_000_000 };
      await repo.save(pending);
      await repo.save(decided);
      closeDb(first);

      const second = openDb(path);
      const reopened = createSqliteProposalRepo(second);
      expect(await reopened.get(proposalId(P1))).toStrictEqual(pending);
      expect(await reopened.get(proposalId(P2))).toStrictEqual(decided);
      expect((await reopened.list({ status: 'pending' })).map((p) => p.id)).toEqual([proposalId(P1)]);
      expect((await reopened.list({ status: 'approved' })).map((p) => p.id)).toEqual([proposalId(P2)]);
    });
  });
});
