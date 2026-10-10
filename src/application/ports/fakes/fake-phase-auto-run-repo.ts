// In-memory PhaseAutoRunRepo — records are held as JSON text so the fake round-trips exactly what
// the SQLite adapter does (I-48): copies in, copies out.
import type { PhaseAutoRun, PhaseSlug, ProjectSlug } from '../../../domain/index';

import type { PhaseAutoRunRepo } from '../phase-auto-run-repo';

export interface FakePhaseAutoRunRepo extends PhaseAutoRunRepo {}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const createFakePhaseAutoRunRepo = (): FakePhaseAutoRunRepo => {
  const byKey = new Map<string, string>();
  const keyOf = (project: ProjectSlug, phase: PhaseSlug): string => JSON.stringify([project, phase]);

  return {
    get: async (project: ProjectSlug, phase: PhaseSlug): Promise<PhaseAutoRun | undefined> => {
      const json = byKey.get(keyOf(project, phase));
      return json === undefined ? undefined : (JSON.parse(json) as PhaseAutoRun);
    },

    put: async (record: PhaseAutoRun): Promise<void> => {
      byKey.set(keyOf(record.project, record.phase), JSON.stringify(record));
    },

    list: async (): Promise<readonly PhaseAutoRun[]> =>
      [...byKey.values()]
        .map((json) => JSON.parse(json) as PhaseAutoRun)
        .sort((a, b) => compare(a.project, b.project) || compare(a.phase, b.phase)),
  };
};
