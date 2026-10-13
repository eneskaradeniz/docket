// application/use-cases/memory.ts — scoped memory notes, proposal queue and auto-accept settings (R-142, R-143, D-1, D-2).
import type { MemoryNote, MemoryProposal, MemoryScope, Result } from '../../domain/index';
import {
  acceptMemoryProposal,
  createMemoryProposal,
  deactivateMemoryNote,
  err,
  ok,
  rejectMemoryProposal,
  selectMemory,
} from '../../domain/index';

import type { AppDeps } from '../ports/index';

export const MEMORY_AUTO_ACCEPT_GLOBAL_KEY = 'memory.autoAccept.global';
export const MEMORY_AUTO_ACCEPT_PROJECT_KEY = 'memory.autoAccept.project';
export const MEMORY_AUTO_ACCEPT_REPO_KEY = 'memory.autoAccept.repo';

export function memoryAutoAcceptKey(scope: MemoryScope): string {
  switch (scope) {
    case 'global':
      return MEMORY_AUTO_ACCEPT_GLOBAL_KEY;
    case 'project':
      return MEMORY_AUTO_ACCEPT_PROJECT_KEY;
    case 'repo':
      return MEMORY_AUTO_ACCEPT_REPO_KEY;
  }
}

/** Reads the machine-level auto-accept boolean setting for a scope kind (Decision 1, default false). */
export async function getMemoryAutoAccept(
  deps: Pick<AppDeps, 'settings'>,
  scope: MemoryScope,
): Promise<boolean> {
  const stored = await deps.settings.get(memoryAutoAcceptKey(scope));
  return typeof stored === 'boolean' ? stored : false;
}

/** Updates the machine-level auto-accept boolean setting for a scope kind. */
export async function setMemoryAutoAccept(
  deps: Pick<AppDeps, 'settings'>,
  scope: MemoryScope,
  enabled: boolean,
): Promise<void> {
  await deps.settings.set(memoryAutoAcceptKey(scope), enabled);
}

export interface ProposeMemoryInput {
  readonly id?: string;
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
  readonly sourceRun: string;
}

export interface ProposeMemoryResult {
  readonly proposal: MemoryProposal;
  readonly note?: MemoryNote;
}

/**
 * R-142: An agent creates a pending MemoryProposal. If auto-accept is enabled for that scope,
 * it is immediately accepted into a MemoryNote with createdBy: 'agent' and saved in DefinitionStore.
 */
export async function proposeMemory(
  deps: Pick<AppDeps, 'memory' | 'definitions' | 'settings' | 'clock' | 'ids'>,
  input: ProposeMemoryInput,
): Promise<ProposeMemoryResult> {
  const id = input.id ?? deps.ids.next<'memory'>();
  const autoAccept = await getMemoryAutoAccept(deps, input.scope);
  const result = createMemoryProposal({
    id,
    scope: input.scope,
    ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
    text: input.text,
    sourceRun: input.sourceRun,
    autoAccept,
  });

  await deps.memory.saveProposal(result.proposal);

  if (result.note !== undefined) {
    await deps.definitions.appendVersion('memory', result.note.id, result.note, deps.clock.now());
    await deps.memory.recordNoteId(result.note.id);
  }

  return result;
}

/** Lists memory proposals, optionally filtered by state. */
export async function listMemoryProposals(
  deps: Pick<AppDeps, 'memory'>,
  filter?: { readonly state?: MemoryProposal['state'] },
): Promise<readonly MemoryProposal[]> {
  return deps.memory.listProposals(filter);
}

/**
 * R-142: An operator decides to accept a pending proposal, creating a MemoryNote
 * with createdBy: 'user' in DefinitionStore (A-343) and updating proposal state to 'accepted'.
 */
export async function acceptMemoryProposalUseCase(
  deps: Pick<AppDeps, 'memory' | 'definitions' | 'clock'>,
  id: string,
): Promise<Result<{ readonly proposal: MemoryProposal; readonly note: MemoryNote }, 'not_found' | 'not_pending'>> {
  const proposal = await deps.memory.getProposal(id);
  if (proposal === undefined) return err('not_found');
  if (proposal.state !== 'pending') return err('not_pending');

  const accepted = acceptMemoryProposal(proposal);
  await deps.memory.saveProposal(accepted.proposal);
  await deps.definitions.appendVersion('memory', accepted.note.id, accepted.note, deps.clock.now());
  await deps.memory.recordNoteId(accepted.note.id);

  return ok(accepted);
}

/** Operator rejects a pending proposal. */
export async function rejectMemoryProposalUseCase(
  deps: Pick<AppDeps, 'memory'>,
  id: string,
): Promise<Result<MemoryProposal, 'not_found' | 'not_pending'>> {
  const proposal = await deps.memory.getProposal(id);
  if (proposal === undefined) return err('not_found');
  if (proposal.state !== 'pending') return err('not_pending');

  const rejected = rejectMemoryProposal(proposal);
  await deps.memory.saveProposal(rejected);

  return ok(rejected);
}

export interface CreateMemoryNoteInput {
  readonly id?: string;
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
}

/** Operator directly creates a MemoryNote with createdBy: 'user'. */
export async function createMemoryNoteUseCase(
  deps: Pick<AppDeps, 'definitions' | 'memory' | 'clock' | 'ids'>,
  input: CreateMemoryNoteInput,
): Promise<MemoryNote> {
  const id = input.id ?? deps.ids.next<'memory'>();
  const note: MemoryNote = {
    id,
    scope: input.scope,
    ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
    text: input.text,
    createdBy: 'user',
    active: true,
  };
  await deps.definitions.appendVersion('memory', id, note, deps.clock.now());
  await deps.memory.recordNoteId(id);
  return note;
}

/**
 * Deactivates a note by appending an inactive version record (R-129, Decision 2).
 * Never rewrites existing version files.
 */
export async function deactivateMemoryNoteUseCase(
  deps: Pick<AppDeps, 'definitions' | 'clock'>,
  id: string,
): Promise<Result<MemoryNote, 'not_found' | 'already_inactive'>> {
  const versions = await deps.definitions.listVersions('memory', id);
  if (versions.length === 0) return err('not_found');
  const latest = versions[versions.length - 1];
  const currentNote = latest.body as MemoryNote;
  if (!currentNote.active) return err('already_inactive');

  const deactivated = deactivateMemoryNote(currentNote);
  await deps.definitions.appendVersion('memory', id, deactivated, deps.clock.now());
  return ok(deactivated);
}

/**
 * Lists all active memory notes from recorded note IDs by fetching their latest version.
 */
/** Every recorded note id's latest version, including inactive notes. */
export async function listAllMemoryNotes(
  deps: Pick<AppDeps, 'memory' | 'definitions'>,
): Promise<readonly MemoryNote[]> {
  const noteIds = await deps.memory.listNoteIds();
  const notes: MemoryNote[] = [];

  for (const id of noteIds) {
    const versions = await deps.definitions.listVersions('memory', id);
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1];
    const note = latest.body as MemoryNote;
    if (note !== undefined) notes.push(note);
  }

  return notes;
}

export interface MemoryOverview {
  readonly notes: readonly MemoryNote[];
  readonly proposals: readonly MemoryProposal[];
  readonly autoAccept: { readonly global: boolean; readonly project: boolean; readonly repo: boolean };
  readonly truncated: boolean;
}

/** Settings memory panel: all notes, pending proposals, auto-accept flags, global injection cap flag. */
export async function memoryOverview(
  deps: Pick<AppDeps, 'memory' | 'definitions' | 'settings'>,
): Promise<MemoryOverview> {
  const notes = await listAllMemoryNotes(deps);
  const proposals = await listMemoryProposals(deps, { state: 'pending' });
  const global = await getMemoryAutoAccept(deps, 'global');
  const project = await getMemoryAutoAccept(deps, 'project');
  const repo = await getMemoryAutoAccept(deps, 'repo');
  const activeGlobals = notes.filter((note) => note.active && note.scope === 'global');
  const { truncated } = selectMemory(activeGlobals, {});
  return {
    notes,
    proposals,
    autoAccept: { global, project, repo },
    truncated,
  };
}

export async function listActiveMemoryNotes(
  deps: Pick<AppDeps, 'memory' | 'definitions'>,
): Promise<readonly MemoryNote[]> {
  const noteIds = await deps.memory.listNoteIds();
  const activeNotes: MemoryNote[] = [];

  for (const id of noteIds) {
    const versions = await deps.definitions.listVersions('memory', id);
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1];
    const note = latest.body as MemoryNote;
    if (note !== undefined && note.active) {
      activeNotes.push(note);
    }
  }

  return activeNotes;
}
