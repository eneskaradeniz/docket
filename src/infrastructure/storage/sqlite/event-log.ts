// SQLite-backed audit event log; newest-first listing by (at DESC, id DESC).
import type { AuditEntry, AuditSubject, EventLog } from '../../../application/index';

import type { DocketDb } from './database';

const decodeEntry = (text: unknown): AuditEntry => {
  if (typeof text !== 'string') throw new Error('audit.data must hold text');
  return JSON.parse(text) as AuditEntry;
};

/** The audit table's subject key: the subject's id, or the role for a binding. */
const subjectKey = (subject: AuditSubject): string =>
  subject.kind === 'binding' ? subject.role : subject.id;

export function createSqliteEventLog(db: DocketDb): EventLog {
  const insert = db.raw.prepare(
    'INSERT INTO audit (id, at, subject_kind, subject_key, data) VALUES (?, ?, ?, ?, ?)',
  );
  const listFor = db.raw.prepare(
    'SELECT data FROM audit WHERE subject_kind = ? AND subject_key = ? ORDER BY at DESC, id DESC LIMIT ?',
  );

  return {
    append: async (entry: AuditEntry): Promise<void> => {
      insert.run(entry.id, entry.at, entry.subject.kind, subjectKey(entry.subject), JSON.stringify(entry));
    },

    list: async (subject: AuditSubject, limit: number): Promise<readonly AuditEntry[]> =>
      // Ids are monotonic ULIDs, so (at DESC, id DESC) puts the later append first on `at` ties;
      // a negative limit is clamped like the fake's slice, never SQLite's unlimited -1.
      listFor
        .all(subject.kind, subjectKey(subject), Math.max(0, limit))
        .map((row) => decodeEntry(row['data'])),
  };
}
