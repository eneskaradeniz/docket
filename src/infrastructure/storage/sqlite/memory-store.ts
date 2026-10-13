// SQLite-backed memory store; proposals mirror the proposals table shape, note ids keep insert order.
import type { MemoryStore } from '../../../application/ports/memory-store';
import type { MemoryProposal } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

function proposalFromRow(row: DataRow): MemoryProposal {
  if (typeof row.data !== 'string') throw new Error('memory_proposals row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  return parsed as MemoryProposal;
}

function optionalProposalFromRow(row: DataRow | undefined): MemoryProposal | undefined {
  return row === undefined ? undefined : proposalFromRow(row);
}

export function createSqliteMemoryStore(db: DocketDb): MemoryStore {
  const upsertProposal = db.raw.prepare(
    'INSERT INTO memory_proposals (id, state, data) VALUES (?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET state = excluded.state, data = excluded.data',
  );
  const insertNoteId = db.raw.prepare('INSERT OR IGNORE INTO memory_note_ids (note_id) VALUES (?)');

  return {
    saveProposal: async (proposal: MemoryProposal): Promise<void> => {
      upsertProposal.run(proposal.id, proposal.state, JSON.stringify(proposal));
    },

    getProposal: async (id: string): Promise<MemoryProposal | undefined> =>
      optionalProposalFromRow(db.raw.prepare('SELECT data FROM memory_proposals WHERE id = ?').get(id)),

    listProposals: async (filter?: { readonly state?: MemoryProposal['state'] }): Promise<readonly MemoryProposal[]> => {
      const rows =
        filter?.state === undefined
          ? db.raw.prepare('SELECT data FROM memory_proposals ORDER BY id ASC').all()
          : db.raw.prepare('SELECT data FROM memory_proposals WHERE state = ? ORDER BY id ASC').all(filter.state);
      return rows.map((row) => proposalFromRow(row));
    },

    recordNoteId: async (id: string): Promise<void> => {
      insertNoteId.run(id);
    },

    listNoteIds: async (): Promise<readonly string[]> =>
      db.raw
        .prepare('SELECT note_id FROM memory_note_ids ORDER BY seq ASC')
        .all()
        .map((row) => {
          if (typeof row.note_id !== 'string') throw new Error('memory_note_ids row without note_id');
          return row.note_id;
        }),
  };
}
