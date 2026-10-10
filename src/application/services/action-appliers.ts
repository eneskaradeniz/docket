// services/action-appliers.ts — the only code through which something an assistant proposed becomes
// a real change. The applier and the undoer are injected into the actions use cases (proposeAction,
// decideActionUseCase, undoAction); they re-check, at the moment of applying, everything the
// proposal's author could have got wrong or lied about: that a referenced draft or proposal really
// belongs to this action, that a grant is still alive and covers the class, that a setting value is
// valid. They then call the existing use cases as the operator who approved or granted — those use
// cases refuse non-user approvals by design — so every change leaves the same trail it would if the
// operator had made it by hand. Every failure is a stable code and nothing is applied; no value,
// title, target or file content is ever returned.
import type {
  ActionClass,
  ActionScope,
  Actor,
  AssistantAction,
  ConversationId,
  DispatchLimits,
  ProposalId,
  Result,
  SettingKey,
  UndoInfo,
  WorkOrderId,
} from '../../domain/index';
import { classOf, err, grantActive, ok } from '../../domain/index';

import type { AppDeps, DefinitionScope, ProposalRecord } from '../ports';
import {
  closeWorkOrder,
  confirmDraftUseCase,
  createProposal,
  decideProposalUseCase,
  getDispatchLimits,
  getDispatchMode,
  setDispatchLimits,
  type ActionApplier,
  type ActionContext,
  type ActionUndoer,
  type DispatchMode,
} from '../use-cases';

export type ActionApplierDeps = Pick<
  AppDeps,
  'clock' | 'ids' | 'log' | 'conversations' | 'workOrders' | 'definitions' | 'projects' | 'proposals' | 'settings' | 'accounts' | 'grants' | 'actions'
>;

const UNDO_WINDOW_MS = 3_600_000;
const ROADMAP_TARGET = 'roadmap.yaml';
const UNDO_KEY_PREFIX = 'assistant.undo.';
const UNDO_AUTHOR: Actor = { kind: 'system', component: 'assistant-undo' };
const UNDO_SUMMARY = 'Revert an assistant change';

type Failure = Result<never, { readonly code: string }>;
const fail = (code: string): Failure => err({ code });

const undoKeyOf = (action: ActionContext['action']): string => `${UNDO_KEY_PREFIX}${action}`;

const sameScope = (action: ActionScope, proposal: DefinitionScope): boolean => {
  if (action.kind !== proposal.kind) return false;
  if (action.kind === 'project' && proposal.kind === 'project') return action.project === proposal.project;
  if (action.kind === 'repo' && proposal.kind === 'repo') return action.repo === proposal.repo;
  return action.kind === 'global';
};

const isMode = (value: unknown): value is DispatchMode => value === 'fixed' || value === 'auto';

/** The user an application acts as: the approving operator, or the operator who created the grant.
 *  A grant is judged again here — it may have been revoked or expired since the use case chose it. */
const actingUser = async (
  deps: ActionApplierDeps,
  authority: Parameters<ActionApplier>[1],
  conversation: ConversationId,
  cls: ActionClass,
): Promise<Result<Actor, { readonly code: string }>> => {
  if (authority.kind === 'user') return authority.id.length > 0 ? ok({ kind: 'user', id: authority.id }) : fail('grant_invalid');
  const grant = await deps.grants.get(authority.grant);
  if (grant === undefined) return fail('grant_invalid');
  const usable =
    grant.conversation === conversation && grant.by.kind === 'user' && grant.by.id.length > 0 && grant.classes.includes(cls) && grantActive(grant, deps.clock.now()).ok;
  return usable ? ok({ kind: 'user', id: grant.by.id }) : fail('grant_invalid');
};

const undoInfo = (deps: ActionApplierDeps, kind: UndoInfo['kind'], ref: string): { readonly undo: UndoInfo } => ({
  undo: { kind, ref, expiresAt: deps.clock.now() + UNDO_WINDOW_MS },
});

// --- open_work_order ---------------------------------------------------------------------------------

const openWorkOrder = async (
  deps: ActionApplierDeps,
  action: Extract<AssistantAction, { kind: 'open_work_order' }>,
  ctx: ActionContext,
  acting: Actor,
): Promise<Result<{ readonly undo: UndoInfo }, { readonly code: string }>> => {
  const draft = await deps.conversations.getDraft(action.draft);
  if (draft === undefined) return fail('draft_not_found');
  if (draft.conversation !== ctx.conversation) return fail('draft_mismatch');
  if (draft.status !== 'draft') return fail('draft_not_pending');
  const confirmed = await confirmDraftUseCase(deps, { draft: draft.id, by: acting });
  if (!confirmed.ok) return fail('open_failed');
  return ok(undoInfo(deps, 'close_work_order', confirmed.value.workOrder));
};

// --- roadmap_edit and definition_edit ----------------------------------------------------------------

/** The proposal an action names, only when it is exactly the one the action describes and was not
 *  written by a person: an assistant action must never approve somebody else's proposal. */
const boundProposal = async (
  deps: ActionApplierDeps,
  id: ProposalId,
  expected: { readonly scope: ActionScope; readonly target: string },
): Promise<Result<ProposalRecord, { readonly code: string }>> => {
  const proposal = await deps.proposals.get(id);
  if (proposal === undefined) return fail('proposal_not_found');
  if (proposal.status !== 'pending') return fail('proposal_not_pending');
  if (!sameScope(expected.scope, proposal.scope) || proposal.target !== expected.target || proposal.author.kind === 'user') return fail('proposal_mismatch');
  return ok(proposal);
};

const applyProposal = async (
  deps: ActionApplierDeps,
  proposal: ProposalRecord,
  acting: Actor,
): Promise<Result<{ readonly undo: UndoInfo }, { readonly code: string }>> => {
  const decided = await decideProposalUseCase(deps, { id: proposal.id, decision: 'approved', actor: acting });
  if (decided.ok) return ok(undoInfo(deps, 'revert_proposal', proposal.id));
  switch (decided.error) {
    case 'stale':
      return fail('stale');
    case 'invalid_after':
      return fail('invalid_after');
    case 'not_found':
      return fail('proposal_not_found');
    case 'not_pending':
      return fail('proposal_not_pending');
    case 'self_approval':
      return fail('apply_failed');
  }
};

// --- setting_change ----------------------------------------------------------------------------------

/** Stored before the new value is written, so an undo can never depend on a value that was lost. */
interface PreviousValue {
  readonly key: SettingKey;
  readonly previous: unknown;
}

const clearPrevious = async (deps: ActionApplierDeps, key: string): Promise<void> => {
  try {
    // The settings port has no delete: a null tombstone is what "nothing to restore" reads as.
    await deps.settings.set(key, null);
  } catch {
    // The setting itself is already as it should be; a leftover key is harmless.
  }
};

const changeSetting = async (
  deps: ActionApplierDeps,
  action: Extract<AssistantAction, { kind: 'setting_change' }>,
  ctx: ActionContext,
  acting: Actor,
): Promise<Result<{ readonly undo: UndoInfo }, { readonly code: string }>> => {
  if (action.key === 'dispatch.mode' && !isMode(action.value)) return fail('invalid_value');
  const previous: unknown = action.key === 'dispatch.mode' ? await getDispatchMode(deps) : await getDispatchLimits(deps);
  const key = undoKeyOf(ctx.action);
  const remembered: PreviousValue = { key: action.key, previous };
  try {
    await deps.settings.set(key, remembered);
  } catch {
    return fail('undo_not_saved');
  }

  const written =
    action.key === 'dispatch.mode' && isMode(action.value)
      ? await setDispatchLimits(deps, { limits: await getDispatchLimits(deps), mode: action.value, actor: acting })
      : await setDispatchLimits(deps, { limits: action.value as DispatchLimits, actor: acting });
  if (!written.ok) {
    await clearPrevious(deps, key);
    return fail(written.error === 'unknown_account' ? 'unknown_account' : 'invalid_value');
  }
  return ok(undoInfo(deps, 'restore_setting', key));
};

export const createActionApplier =
  (deps: ActionApplierDeps): ActionApplier =>
  async (action, authority, ctx) => {
    // The record the context names must be this conversation's, and of the same kind as the action.
    const record = await deps.actions.get(ctx.action);
    if (record === undefined || record.conversation !== ctx.conversation || record.action.kind !== action.kind) return fail('action_mismatch');
    const acting = await actingUser(deps, authority, ctx.conversation, classOf(action));
    if (!acting.ok) return acting;

    switch (action.kind) {
      case 'open_work_order':
        return openWorkOrder(deps, action, ctx, acting.value);
      case 'roadmap_edit': {
        const proposal = await boundProposal(deps, action.proposal, { scope: { kind: 'project', project: action.project }, target: ROADMAP_TARGET });
        return proposal.ok ? applyProposal(deps, proposal.value, acting.value) : proposal;
      }
      case 'definition_edit': {
        // Roadmaps are their own class; a definition action never writes one.
        if (action.target === ROADMAP_TARGET) return fail('proposal_mismatch');
        const proposal = await boundProposal(deps, action.proposal, { scope: action.scope, target: action.target });
        return proposal.ok ? applyProposal(deps, proposal.value, acting.value) : proposal;
      }
      case 'setting_change':
        return changeSetting(deps, action, ctx, acting.value);
    }
  };

// --- undo --------------------------------------------------------------------------------------------

const closeUnstarted = async (deps: ActionApplierDeps, record: Parameters<ActionUndoer>[0], ref: string, by: Actor): Promise<Result<void, { readonly code: string }>> => {
  if (record.action.kind !== 'open_work_order') return fail('undo_unavailable');
  // The work order to close is the one this action's own draft opened, never whatever `ref` says.
  const draft = await deps.conversations.getDraft(record.action.draft);
  if (draft === undefined || draft.workOrder === undefined || draft.workOrder !== ref) return fail('undo_unavailable');
  const id = draft.workOrder as WorkOrderId;
  if ((await deps.workOrders.get(id)) === undefined) return fail('undo_unavailable');
  const events = await deps.workOrders.events(id);
  if (events.some((event) => event.type === 'closed')) return fail('already_closed');
  if (events.some((event) => event.type === 'run_started')) return fail('work_started');
  const closed = await closeWorkOrder(deps, { id, actor: by });
  if (closed.ok) return ok(undefined);
  return fail(closed.error === 'already_done' ? 'already_closed' : 'undo_unavailable');
};

const revertProposal = async (deps: ActionApplierDeps, record: Parameters<ActionUndoer>[0], ref: string, by: Actor): Promise<Result<void, { readonly code: string }>> => {
  if (record.action.kind !== 'roadmap_edit' && record.action.kind !== 'definition_edit') return fail('undo_unavailable');
  if (record.action.proposal !== ref) return fail('undo_unavailable');
  const proposal = await deps.proposals.get(record.action.proposal);
  if (proposal === undefined) return fail('undo_unavailable');
  if (proposal.status !== 'approved') return fail('proposal_not_approved');
  // Someone edited the file since: their edit is not ours to overwrite.
  const current = await deps.definitions.readFile(proposal.scope, proposal.target);
  if ((current?.content ?? '') !== proposal.after) return fail('file_changed');

  const reverse = await createProposal(deps, { scope: proposal.scope, target: proposal.target, after: proposal.before, summary: UNDO_SUMMARY, author: UNDO_AUTHOR });
  if (!reverse.ok) return fail('undo_unavailable');
  const decided = await decideProposalUseCase(deps, { id: reverse.value, decision: 'approved', actor: by });
  if (decided.ok) return ok(undefined);
  // A reverse proposal that could not be applied must not wait around to be approved later.
  await decideProposalUseCase(deps, { id: reverse.value, decision: 'rejected', actor: by });
  return fail(decided.error === 'stale' ? 'stale' : decided.error === 'invalid_after' ? 'invalid_after' : 'undo_unavailable');
};

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } => typeof value === 'object' && value !== null && !Array.isArray(value);

const restoreSetting = async (deps: ActionApplierDeps, record: Parameters<ActionUndoer>[0], ref: string, by: Actor): Promise<Result<void, { readonly code: string }>> => {
  if (record.action.kind !== 'setting_change') return fail('undo_unavailable');
  if (ref !== undoKeyOf(record.id)) return fail('undo_unavailable');
  const stored = await deps.settings.get(ref);
  if (!isRecord(stored) || stored['key'] !== record.action.key || !('previous' in stored)) return fail('undo_unavailable');
  const previous = stored['previous'];

  let restored: Result<void, string>;
  if (record.action.key === 'dispatch.mode') {
    if (!isMode(previous)) return fail('undo_unavailable');
    restored = await setDispatchLimits(deps, { limits: await getDispatchLimits(deps), mode: previous, actor: by });
  } else {
    if (!isRecord(previous)) return fail('undo_unavailable');
    restored = await setDispatchLimits(deps, { limits: previous as unknown as DispatchLimits, actor: by });
  }
  if (!restored.ok) return fail('restore_failed');
  await clearPrevious(deps, ref);
  return ok(undefined);
};

export const createActionUndoer =
  (deps: ActionApplierDeps): ActionUndoer =>
  async (record, by) => {
    if (by.kind !== 'user') return fail('not_user');
    const undo = record.undo;
    if (undo === undefined) return fail('undo_unavailable');
    switch (undo.kind) {
      case 'close_work_order':
        return closeUnstarted(deps, record, undo.ref, by);
      case 'revert_proposal':
        return revertProposal(deps, record, undo.ref, by);
      case 'restore_setting':
        return restoreSetting(deps, record, undo.ref, by);
    }
  };
