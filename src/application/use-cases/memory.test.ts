// application/use-cases/memory.test.ts — rules R-142, R-143, D-1, D-2.
import { beforeEach, describe, expect, it } from 'vitest';

import type { MemoryNote } from '../../domain/index';
import { createFakeDeps } from '../ports/fakes/index';
import {
  acceptMemoryProposalUseCase,
  createMemoryNoteUseCase,
  deactivateMemoryNoteUseCase,
  getMemoryAutoAccept,
  listActiveMemoryNotes,
  listMemoryProposals,
  proposeMemory,
  rejectMemoryProposalUseCase,
  setMemoryAutoAccept,
} from './memory';

describe('memory use-cases (R-142, R-143, D-1, D-2)', () => {
  let deps = createFakeDeps();

  beforeEach(() => {
    deps = createFakeDeps();
  });

  describe('auto-accept settings (D-1)', () => {
    it('defaults auto-accept to false for global, project, and repo scopes', async () => {
      expect(await getMemoryAutoAccept(deps, 'global')).toBe(false);
      expect(await getMemoryAutoAccept(deps, 'project')).toBe(false);
      expect(await getMemoryAutoAccept(deps, 'repo')).toBe(false);
    });

    it('round-trips auto-accept per scope kind through machine settings', async () => {
      await setMemoryAutoAccept(deps, 'project', true);
      expect(await getMemoryAutoAccept(deps, 'project')).toBe(true);
      expect(await getMemoryAutoAccept(deps, 'global')).toBe(false);
      expect(await getMemoryAutoAccept(deps, 'repo')).toBe(false);

      await setMemoryAutoAccept(deps, 'global', true);
      expect(await getMemoryAutoAccept(deps, 'global')).toBe(true);

      await setMemoryAutoAccept(deps, 'project', false);
      expect(await getMemoryAutoAccept(deps, 'project')).toBe(false);
    });
  });

  describe('propose-and-approve (R-142)', () => {
    it('R-142: agent proposals are pending when auto-accept is off', async () => {
      const result = await proposeMemory(deps, {
        id: 'mem-prop-1',
        scope: 'project',
        scopeId: 'proj-alpha',
        text: 'Always use strict TypeScript checks.',
        sourceRun: 'run-101',
      });

      expect(result.proposal).toEqual({
        id: 'mem-prop-1',
        scope: 'project',
        scopeId: 'proj-alpha',
        text: 'Always use strict TypeScript checks.',
        sourceRun: 'run-101',
        state: 'pending',
      });
      expect(result.note).toBeUndefined();

      // The proposal lives in MemoryStore, not DefinitionStore (D-2)
      const stored = await deps.memory.getProposal('mem-prop-1');
      expect(stored).toEqual(result.proposal);
      const versions = await deps.definitions.listVersions('memory', 'mem-prop-1');
      expect(versions).toHaveLength(0);
    });

    it('R-142: operator accept creates note with createdBy: user and records in DefinitionStore (A-343)', async () => {
      await proposeMemory(deps, {
        id: 'mem-prop-2',
        scope: 'global',
        text: 'Format code with prettier.',
        sourceRun: 'run-102',
      });

      const accepted = await acceptMemoryProposalUseCase(deps, 'mem-prop-2');
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;

      expect(accepted.value.proposal.state).toBe('accepted');
      expect(accepted.value.note).toEqual({
        id: 'mem-prop-2',
        scope: 'global',
        text: 'Format code with prettier.',
        createdBy: 'user',
        active: true,
      });

      // The note is saved as versioned item in DefinitionStore
      const versions = await deps.definitions.listVersions('memory', 'mem-prop-2');
      expect(versions).toHaveLength(1);
      expect(versions[0].body).toEqual(accepted.value.note);

      // And discoverable via listActiveMemoryNotes
      const active = await listActiveMemoryNotes(deps);
      expect(active).toHaveLength(1);
      expect(active[0]).toEqual(accepted.value.note);
    });

    it('R-142: auto-accept honors scope setting with createdBy: agent', async () => {
      await setMemoryAutoAccept(deps, 'repo', true);

      const result = await proposeMemory(deps, {
        id: 'mem-prop-3',
        scope: 'repo',
        scopeId: 'repo-core',
        text: 'Run unit tests before pushing.',
        sourceRun: 'run-103',
      });

      expect(result.proposal.state).toBe('accepted');
      expect(result.note).toEqual({
        id: 'mem-prop-3',
        scope: 'repo',
        scopeId: 'repo-core',
        text: 'Run unit tests before pushing.',
        createdBy: 'agent',
        active: true,
      });

      const versions = await deps.definitions.listVersions('memory', 'mem-prop-3');
      expect(versions).toHaveLength(1);
      expect(versions[0].body).toEqual(result.note);

      const active = await listActiveMemoryNotes(deps);
      expect(active.some((n) => n.id === 'mem-prop-3' && n.createdBy === 'agent')).toBe(true);
    });

    it('operator reject updates proposal state to rejected and creates no note', async () => {
      await proposeMemory(deps, {
        id: 'mem-prop-4',
        scope: 'global',
        text: 'Ignore lint warnings.',
        sourceRun: 'run-104',
      });

      const rejected = await rejectMemoryProposalUseCase(deps, 'mem-prop-4');
      expect(rejected.ok).toBe(true);
      if (!rejected.ok) return;

      expect(rejected.value.state).toBe('rejected');

      const versions = await deps.definitions.listVersions('memory', 'mem-prop-4');
      expect(versions).toHaveLength(0);
    });

    it('listMemoryProposals lists all or filtered by state', async () => {
      await proposeMemory(deps, { id: 'p1', scope: 'global', text: 'n1', sourceRun: 'r1' });
      await proposeMemory(deps, { id: 'p2', scope: 'global', text: 'n2', sourceRun: 'r2' });
      await acceptMemoryProposalUseCase(deps, 'p1');

      const all = await listMemoryProposals(deps);
      expect(all).toHaveLength(2);

      const pending = await listMemoryProposals(deps, { state: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('p2');

      const accepted = await listMemoryProposals(deps, { state: 'accepted' });
      expect(accepted).toHaveLength(1);
      expect(accepted[0].id).toBe('p1');
    });
  });

  describe('note creation and deactivation (D-2, R-129)', () => {
    it('operator can create note directly with createdBy: user', async () => {
      const note = await createMemoryNoteUseCase(deps, {
        id: 'user-note-1',
        scope: 'project',
        scopeId: 'proj-1',
        text: 'Architecture decision: use events.',
      });

      expect(note).toEqual({
        id: 'user-note-1',
        scope: 'project',
        scopeId: 'proj-1',
        text: 'Architecture decision: use events.',
        createdBy: 'user',
        active: true,
      });

      const active = await listActiveMemoryNotes(deps);
      expect(active).toContainEqual(note);
    });

    it('deactivating note appends an inactive version record (R-129) and excludes from active notes', async () => {
      await createMemoryNoteUseCase(deps, {
        id: 'note-to-deactivate',
        scope: 'global',
        text: 'Old guideline.',
      });

      const deactivated = await deactivateMemoryNoteUseCase(deps, 'note-to-deactivate');
      expect(deactivated.ok).toBe(true);
      if (!deactivated.ok) return;

      expect(deactivated.value.active).toBe(false);

      // Definition store has 2 versions: v1 active, v2 inactive
      const versions = await deps.definitions.listVersions('memory', 'note-to-deactivate');
      expect(versions).toHaveLength(2);
      expect((versions[0].body as MemoryNote).active).toBe(true);
      expect((versions[1].body as MemoryNote).active).toBe(false);

      // listActiveMemoryNotes excludes inactive notes
      const active = await listActiveMemoryNotes(deps);
      expect(active.some((n) => n.id === 'note-to-deactivate')).toBe(false);
    });
  });
});
