// In-memory ProposalRepo — proposals keyed by id, listed in first-insertion order.
import type { ProposalId, ProposalStatus } from '../../../domain/index';

import type { ProposalRecord, ProposalRepo } from '../proposal-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeProposalRepo extends ProposalRepo {}

export const createFakeProposalRepo = (): FakeProposalRepo => {
  const byId = new Map<ProposalId, ProposalRecord>();

  return {
    save: async (record: ProposalRecord): Promise<void> => {
      byId.set(record.id, { ...record });
    },

    get: async (id: ProposalId): Promise<ProposalRecord | undefined> => byId.get(id),

    list: async (filter: { readonly status?: ProposalStatus }): Promise<readonly ProposalRecord[]> =>
      [...byId.values()].filter((record) => filter.status === undefined || record.status === filter.status),
  };
};
