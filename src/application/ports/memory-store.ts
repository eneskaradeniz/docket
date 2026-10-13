// application/ports/memory-store.ts — persistence port for memory proposals and active note tracking (R-142, D-2).
import type { MemoryProposal } from '../../domain/index';

export interface MemoryStore {
  /** Saves or updates a memory proposal. */
  saveProposal(proposal: MemoryProposal): Promise<void>;
  /** Fetches a proposal by id; undefined when not found. */
  getProposal(id: string): Promise<MemoryProposal | undefined>;
  /** Lists proposals, optionally filtered by proposal state. */
  listProposals(filter?: { readonly state?: MemoryProposal['state'] }): Promise<readonly MemoryProposal[]>;
  /** Records an accepted or created note id so listActiveNotes can discover library memory items. */
  recordNoteId(id: string): Promise<void>;
  /** Lists all recorded note ids in order of recording. */
  listNoteIds(): Promise<readonly string[]>;
}
