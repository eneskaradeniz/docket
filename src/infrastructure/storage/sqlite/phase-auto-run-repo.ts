// SQLite-backed PhaseAutoRunRepo; one row per (project, phase), the attention ids as JSON text.
import type { PhaseAutoRun, PhaseAutoRunState, PhaseSlug, ProjectSlug, WorkOrderId } from '../../../domain/index';
import type { PhaseAutoRunRepo } from '../../../application/index';
import type { DocketDb } from './database';

type Row = { readonly [column: string]: unknown };

const STATES: readonly unknown[] = ['running', 'paused', 'done'] satisfies readonly PhaseAutoRunState[];

/** Rows are written only by `put`, so a malformed one is a defect worth surfacing loudly. */
const toRecord = (row: Row): PhaseAutoRun => {
  const { project, phase, state, started_at: startedAt, attention_json: attentionJson } = row;
  if (typeof project !== 'string' || typeof phase !== 'string' || !STATES.includes(state) || typeof startedAt !== 'number' || typeof attentionJson !== 'string') {
    throw new Error('phase_auto_runs row is malformed');
  }
  return {
    project: project as ProjectSlug,
    phase: phase as PhaseSlug,
    state: state as PhaseAutoRunState,
    startedAt,
    attention: JSON.parse(attentionJson) as WorkOrderId[],
  };
};

export function createSqlitePhaseAutoRunRepo(db: DocketDb): PhaseAutoRunRepo {
  return {
    get: async (project: ProjectSlug, phase: PhaseSlug): Promise<PhaseAutoRun | undefined> => {
      const row: Row | undefined = db.raw.prepare('SELECT * FROM phase_auto_runs WHERE project = ? AND phase = ?').get(project, phase);
      return row === undefined ? undefined : toRecord(row);
    },

    put: async (record: PhaseAutoRun): Promise<void> => {
      db.raw
        .prepare(
          `INSERT INTO phase_auto_runs (project, phase, state, started_at, attention_json) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (project, phase) DO UPDATE SET state = excluded.state, started_at = excluded.started_at, attention_json = excluded.attention_json`,
        )
        .run(record.project, record.phase, record.state, record.startedAt, JSON.stringify(record.attention));
    },

    list: async (): Promise<readonly PhaseAutoRun[]> => {
      const rows: readonly Row[] = db.raw.prepare('SELECT * FROM phase_auto_runs ORDER BY project, phase').all();
      return rows.map(toRecord);
    },
  };
}
