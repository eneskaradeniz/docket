// domain/definitions/memory.ts — pure memory selection and proposal logic (R-142, R-143).
// Contract: docs/v2/domain.md § 2.
import type { MemoryNote, MemoryProposal, MemoryScope } from './types';

/** Maximum number of characters of memory notes injected per run total across all scopes (R-143). */
export const MEMORY_INJECTION_CAP_CHARS: number = 4000;

export interface SelectMemoryContext {
  readonly project?: string;
  readonly repo?: string;
}

export interface SelectedMemory {
  readonly text: string;
  readonly truncated: boolean;
  readonly used: readonly string[];
}

/**
 * R-143: selectMemory takes active notes of the global scope, the run's project and the run's
 * repo (in that order, newest last), and stops at MEMORY_INJECTION_CAP_CHARS without cutting
 * a note in the middle (the first note that would exceed the cap and everything after it is
 * dropped, truncated: true).
 */
export function selectMemory(
  notes: readonly MemoryNote[],
  ctx: SelectMemoryContext,
): SelectedMemory {
  const active = notes.filter((note) => note.active);

  const globals = active.filter((note) => note.scope === 'global');
  const projects = active.filter(
    (note) => note.scope === 'project' && ctx.project !== undefined && note.scopeId === ctx.project,
  );
  const repos = active.filter(
    (note) => note.scope === 'repo' && ctx.repo !== undefined && note.scopeId === ctx.repo,
  );

  const candidates = [...globals, ...projects, ...repos];
  const used: string[] = [];
  let text = '';
  let truncated = false;

  for (const note of candidates) {
    const candidateText = text === '' ? note.text : `${text}\n\n${note.text}`;
    if (candidateText.length > MEMORY_INJECTION_CAP_CHARS) {
      truncated = true;
      break;
    }
    text = candidateText;
    used.push(note.id);
  }

  return { text, truncated, used };
}

export interface CreateMemoryProposalInput {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
  readonly sourceRun: string;
  readonly autoAccept?: boolean;
}

export interface CreateMemoryProposalResult {
  readonly proposal: MemoryProposal;
  readonly note?: MemoryNote;
}

/**
 * R-142: An agent creates a pending proposal; if auto-accept is enabled for that scope,
 * the proposal is immediately accepted and produces a MemoryNote with createdBy: 'agent'.
 */
export function createMemoryProposal(input: CreateMemoryProposalInput): CreateMemoryProposalResult {
  if (input.autoAccept) {
    const proposal: MemoryProposal = {
      id: input.id,
      scope: input.scope,
      ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
      text: input.text,
      sourceRun: input.sourceRun,
      state: 'accepted',
    };
    const note: MemoryNote = {
      id: input.id,
      scope: input.scope,
      ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
      text: input.text,
      createdBy: 'agent',
      active: true,
    };
    return { proposal, note };
  }

  const proposal: MemoryProposal = {
    id: input.id,
    scope: input.scope,
    ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
    text: input.text,
    sourceRun: input.sourceRun,
    state: 'pending',
  };
  return { proposal };
}

/**
 * R-142: Accepting a proposal creates a MemoryNote with createdBy: 'user' and transitions
 * the proposal to 'accepted'.
 */
export function acceptMemoryProposal(
  proposal: MemoryProposal,
): { readonly proposal: MemoryProposal; readonly note: MemoryNote } {
  const updated: MemoryProposal = { ...proposal, state: 'accepted' };
  const note: MemoryNote = {
    id: proposal.id,
    scope: proposal.scope,
    ...(proposal.scopeId !== undefined ? { scopeId: proposal.scopeId } : {}),
    text: proposal.text,
    createdBy: 'user',
    active: true,
  };
  return { proposal: updated, note };
}

/** Rejecting a proposal transitions its state to 'rejected'. */
export function rejectMemoryProposal(proposal: MemoryProposal): MemoryProposal {
  return { ...proposal, state: 'rejected' };
}

/** Deactivating a note marks active: false. */
export function deactivateMemoryNote(note: MemoryNote): MemoryNote {
  return { ...note, active: false };
}
