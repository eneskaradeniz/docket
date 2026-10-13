// ports/fakes/fake-memory-store.ts — in-memory fake for MemoryStore.
import type { MemoryProposal } from '../../../domain/index';
import type { MemoryStore } from '../memory-store';

export interface FakeMemoryStore extends MemoryStore {
  clear(): void;
}

export const createFakeMemoryStore = (): FakeMemoryStore => {
  const proposals = new Map<string, string>();
  const noteIds: string[] = [];

  return {
    saveProposal: async (proposal: MemoryProposal): Promise<void> => {
      proposals.set(proposal.id, JSON.stringify(proposal));
    },

    getProposal: async (id: string): Promise<MemoryProposal | undefined> => {
      const raw = proposals.get(id);
      return raw === undefined ? undefined : (JSON.parse(raw) as MemoryProposal);
    },

    listProposals: async (filter?: { readonly state?: MemoryProposal['state'] }): Promise<readonly MemoryProposal[]> => {
      const all = [...proposals.values()].map((raw) => JSON.parse(raw) as MemoryProposal);
      if (filter?.state !== undefined) {
        return all.filter((p) => p.state === filter.state);
      }
      return all;
    },

    recordNoteId: async (id: string): Promise<void> => {
      if (!noteIds.includes(id)) {
        noteIds.push(id);
      }
    },

    listNoteIds: async (): Promise<readonly string[]> => [...noteIds],

    clear: (): void => {
      proposals.clear();
      noteIds.length = 0;
    },
  };
};
