// In-memory EventLog — the audit trail as an append-only list.
import type { AuditEntry, AuditSubject, EventLog } from '../event-log';

export interface FakeEventLog extends EventLog {
  /** Every appended entry in append order, regardless of subject. */
  entries(): readonly AuditEntry[];
}

/** Subjects match on their identifying field; a work order never sees a run's entries. */
const sameSubject = (a: AuditSubject, b: AuditSubject): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'binding' && b.kind === 'binding') return a.role === b.role;
  if (a.kind === 'binding' || b.kind === 'binding') return false;
  return a.id === b.id;
};

export const createFakeEventLog = (): FakeEventLog => {
  const log: AuditEntry[] = [];

  return {
    append: async (entry: AuditEntry): Promise<void> => {
      log.push({ ...entry });
    },

    // Newest first: sort by `at` descending; Array#sort is stable, so entries appended later win
    // the tie after the reverse pass put them ahead of their equals.
    list: async (subject: AuditSubject, limit: number): Promise<readonly AuditEntry[]> =>
      log
        .filter((entry) => sameSubject(entry.subject, subject))
        .reverse()
        .sort((a, b) => b.at - a.at)
        .slice(0, Math.max(0, limit)),

    entries: (): readonly AuditEntry[] => [...log],
  };
};
