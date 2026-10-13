// R-142 parity and durability tests for the SQLite memory store.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MemoryStore } from '../../../application/ports/memory-store';
import type { MemoryProposal } from '../../../domain/index';
import { createFakeMemoryStore } from '../../../application/ports/fakes/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteMemoryStore } from './memory-store';

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-memory-'));
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

describe('R-142: sqlite memory store', () => {
  describe.each([
    ['fake', (): MemoryStore => createFakeMemoryStore()],
    ['sqlite', (): MemoryStore => createSqliteMemoryStore(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeStore) => {
    it('saves and retrieves proposals; unknown id is undefined', async () => {
      const store = makeStore();
      const proposal: MemoryProposal = {
        id: 'p1',
        scope: 'project',
        scopeId: 'docket',
        text: 'Note text',
        sourceRun: 'r1',
        state: 'pending',
      };

      await store.saveProposal(proposal);
      const retrieved = await store.getProposal('p1');
      expect(retrieved).toEqual(proposal);
      expect(retrieved).not.toBe(proposal);
      expect(await store.getProposal('nonexistent')).toBeUndefined();
    });

    it('saveProposal with an existing id updates the proposal', async () => {
      const store = makeStore();
      const pending: MemoryProposal = {
        id: 'p1',
        scope: 'global',
        text: 'G1',
        sourceRun: 'r1',
        state: 'pending',
      };
      await store.saveProposal(pending);
      const accepted: MemoryProposal = { ...pending, state: 'accepted', text: 'G1 updated' };
      await store.saveProposal(accepted);
      expect(await store.getProposal('p1')).toEqual(accepted);
    });

    it('lists proposals and filters by state', async () => {
      const store = makeStore();
      const p1: MemoryProposal = { id: 'p1', scope: 'global', text: 'G1', sourceRun: 'r1', state: 'pending' };
      const p2: MemoryProposal = { id: 'p2', scope: 'repo', scopeId: 'repo-a', text: 'R1', sourceRun: 'r1', state: 'accepted' };
      const p3: MemoryProposal = { id: 'p3', scope: 'project', scopeId: 'proj-a', text: 'P1', sourceRun: 'r2', state: 'rejected' };

      await store.saveProposal(p1);
      await store.saveProposal(p2);
      await store.saveProposal(p3);

      expect(await store.listProposals()).toHaveLength(3);
      expect(await store.listProposals({ state: 'pending' })).toEqual([p1]);
      expect(await store.listProposals({ state: 'accepted' })).toEqual([p2]);
      expect(await store.listProposals({ state: 'rejected' })).toEqual([p3]);
    });

    it('recordNoteId is idempotent; listNoteIds keeps recording order', async () => {
      const store = makeStore();
      await store.recordNoteId('note-1');
      await store.recordNoteId('note-2');
      await store.recordNoteId('note-1');

      expect(await store.listNoteIds()).toEqual(['note-1', 'note-2']);
    });
  });

  describe('sqlite specifics', () => {
    it('proposals and note ids survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const store = createSqliteMemoryStore(first);
      const proposal: MemoryProposal = {
        id: 'p1',
        scope: 'repo',
        scopeId: 'acme',
        text: 'Remember this',
        sourceRun: 'run-1',
        state: 'pending',
      };
      await store.saveProposal(proposal);
      await store.recordNoteId('n1');
      await store.recordNoteId('n2');
      closeDb(first);

      const second = openDb(path);
      const reopened = createSqliteMemoryStore(second);
      expect(await reopened.getProposal('p1')).toEqual(proposal);
      expect(await reopened.listProposals({ state: 'pending' })).toEqual([proposal]);
      expect(await reopened.listNoteIds()).toEqual(['n1', 'n2']);
    });
  });
});
