import { describe, expect, it } from 'vitest';

import type { MemoryProposal } from '../../../domain/index';
import { createFakeMemoryStore } from './fake-memory-store';

describe('createFakeMemoryStore', () => {
  it('saves and retrieves proposals, preserving immutability', async () => {
    const store = createFakeMemoryStore();
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

  it('lists proposals and filters by state', async () => {
    const store = createFakeMemoryStore();
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

  it('records and lists note IDs without duplicates', async () => {
    const store = createFakeMemoryStore();
    await store.recordNoteId('note-1');
    await store.recordNoteId('note-2');
    await store.recordNoteId('note-1');

    expect(await store.listNoteIds()).toEqual(['note-1', 'note-2']);
  });

  it('clear resets proposals and note IDs', async () => {
    const store = createFakeMemoryStore();
    await store.saveProposal({ id: 'p1', scope: 'global', text: 'G', sourceRun: 'r', state: 'pending' });
    await store.recordNoteId('n1');

    store.clear();
    expect(await store.listProposals()).toEqual([]);
    expect(await store.listNoteIds()).toEqual([]);
  });
});
