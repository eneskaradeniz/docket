import { describe, expect, it } from 'vitest';

import {
  acceptMemoryProposal,
  createMemoryProposal,
  deactivateMemoryNote,
  MEMORY_INJECTION_CAP_CHARS,
  rejectMemoryProposal,
  selectMemory,
} from './memory';
import type { MemoryNote } from './types';

describe('domain/definitions/memory — R-142 and R-143', () => {
  it('R-142: agent proposals are pending; accept creates note; auto-accept honors scope setting with createdBy: agent', () => {
    // 1. Agent creates proposal without auto-accept -> pending proposal, no note
    const pendingResult = createMemoryProposal({
      id: 'prop-1',
      scope: 'project',
      scopeId: 'docket',
      text: 'Always use pnpm',
      sourceRun: 'run-1',
      autoAccept: false,
    });
    expect(pendingResult.proposal).toEqual({
      id: 'prop-1',
      scope: 'project',
      scopeId: 'docket',
      text: 'Always use pnpm',
      sourceRun: 'run-1',
      state: 'pending',
    });
    expect(pendingResult.note).toBeUndefined();

    // 2. User decision (accept) makes a MemoryNote with createdBy: 'user'
    const acceptedResult = acceptMemoryProposal(pendingResult.proposal);
    expect(acceptedResult.proposal.state).toBe('accepted');
    expect(acceptedResult.note).toEqual({
      id: 'prop-1',
      scope: 'project',
      scopeId: 'docket',
      text: 'Always use pnpm',
      createdBy: 'user',
      active: true,
    });

    // 3. User decision (reject)
    const rejected = rejectMemoryProposal(pendingResult.proposal);
    expect(rejected.state).toBe('rejected');

    // 4. Auto-accept honors scope setting: creates note with createdBy: 'agent'
    const autoResult = createMemoryProposal({
      id: 'prop-2',
      scope: 'global',
      text: 'Global convention',
      sourceRun: 'run-2',
      autoAccept: true,
    });
    expect(autoResult.proposal.state).toBe('accepted');
    expect(autoResult.note).toEqual({
      id: 'prop-2',
      scope: 'global',
      text: 'Global convention',
      createdBy: 'agent',
      active: true,
    });

    // 5. Deactivation makes active: false
    if (autoResult.note) {
      const deactivated = deactivateMemoryNote(autoResult.note);
      expect(deactivated.active).toBe(false);
      expect(deactivated.id).toBe('prop-2');
    }
  });

  it('R-143: selectMemory orders global -> project -> repo (newest last) and stops at 4000 chars with truncated: true without cutting notes', () => {
    expect(MEMORY_INJECTION_CAP_CHARS).toBe(4000);

    const g1: MemoryNote = { id: 'g1', scope: 'global', text: 'Global note 1', createdBy: 'user', active: true };
    const g2: MemoryNote = { id: 'g2', scope: 'global', text: 'Global note 2 (newer)', createdBy: 'user', active: true };
    const p1: MemoryNote = { id: 'p1', scope: 'project', scopeId: 'proj-a', text: 'Project A note', createdBy: 'user', active: true };
    const pOther: MemoryNote = { id: 'pOther', scope: 'project', scopeId: 'proj-b', text: 'Project B note', createdBy: 'user', active: true };
    const r1: MemoryNote = { id: 'r1', scope: 'repo', scopeId: 'repo-1', text: 'Repo 1 note', createdBy: 'user', active: true };
    const rOther: MemoryNote = { id: 'rOther', scope: 'repo', scopeId: 'repo-2', text: 'Repo 2 note', createdBy: 'user', active: true };

    // Notes passed in arbitrary order: global, project, repo should be ordered, and irrelevant scopes ignored
    const notes = [r1, pOther, g2, rOther, p1, g1];
    const selection = selectMemory(notes, { project: 'proj-a', repo: 'repo-1' });

    expect(selection.truncated).toBe(false);
    expect(selection.used).toEqual(['g2', 'g1', 'p1', 'r1']);
    expect(selection.text).toBe('Global note 2 (newer)\n\nGlobal note 1\n\nProject A note\n\nRepo 1 note');

    // Bounded injection cap check: 4000 chars without cutting notes mid-way
    const longNoteA: MemoryNote = {
      id: 'long-a',
      scope: 'global',
      text: 'A'.repeat(2500),
      createdBy: 'user',
      active: true,
    };
    const longNoteB: MemoryNote = {
      id: 'long-b',
      scope: 'project',
      scopeId: 'proj-a',
      text: 'B'.repeat(2000), // 2500 + 2 + 2000 = 4502 > 4000
      createdBy: 'user',
      active: true,
    };
    const noteC: MemoryNote = {
      id: 'note-c',
      scope: 'repo',
      scopeId: 'repo-1',
      text: 'C'.repeat(100),
      createdBy: 'user',
      active: true,
    };

    const capped = selectMemory([longNoteA, longNoteB, noteC], { project: 'proj-a', repo: 'repo-1' });
    expect(capped.truncated).toBe(true);
    expect(capped.used).toEqual(['long-a']);
    expect(capped.text).toBe('A'.repeat(2500)); // Whole note kept, longNoteB and noteC dropped
  });

  it('Inactive notes are ignored by selectMemory', () => {
    const activeNote: MemoryNote = { id: 'a1', scope: 'global', text: 'Active', createdBy: 'user', active: true };
    const inactiveNote: MemoryNote = { id: 'i1', scope: 'global', text: 'Inactive', createdBy: 'user', active: false };

    const result = selectMemory([inactiveNote, activeNote], {});
    expect(result.used).toEqual(['a1']);
    expect(result.text).toBe('Active');
    expect(result.truncated).toBe(false);
  });
});
