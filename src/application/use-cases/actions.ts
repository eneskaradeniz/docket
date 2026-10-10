// use-cases/actions.ts — proposing, approving, granting and undoing assistant actions. The domain
// decides every rule (what an action is, who may grant, whether a grant covers an action); this
// layer gathers the records, calls the injected applier or undoer — the only code that changes
// anything, supplied by the caller — and writes the outcome back. Approving, rejecting, granting,
// revoking and undoing are the operator's alone: a chat turn runs as an agent or system actor and
// can only propose. Audit entries carry ids, class names, counts and the authority kind — never an
// action's values, targets or titles — and nothing here logs.
import type {
  ActionAuthority,
  ActionClass,
  ActionDecision,
  ActionError,
  ActionId,
  ActionRecord,
  Actor,
  AssistantAction,
  ConversationId,
  Grant,
  GrantId,
  Result,
  UndoInfo,
} from '../../domain/index';
import {
  decideAction,
  err,
  grantActive,
  markApplied,
  markFailed,
  markRejected,
  markUndone,
  newActionRecord,
  newGrant,
  ok,
  recordApplied,
  revokeGrant,
  ACTION_LIMITS,
  classOf,
  validateAction,
} from '../../domain/index';

import type { AppDeps, AuditAction } from '../ports';

/** The one place an action's effect happens. Injected: the concrete appliers live elsewhere. */
export type ActionApplier = (a: AssistantAction, authority: ActionAuthority) => Promise<Result<{ readonly undo?: UndoInfo }, { readonly code: string }>>;
export type ActionUndoer = (r: ActionRecord) => Promise<Result<void, { readonly code: string }>>;
export type UndoActionError = ActionError | { readonly code: 'undo_failed' };

const MINUTE_MS = 60_000;
const FALLBACK_FAILURE = 'apply_failed';
const THROWN_FAILURE = 'applier_error';

const failure = (code: ActionError['code']): Result<never, ActionError> => err({ code });

const audit = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log'>,
  entry: {
    readonly action: AuditAction;
    readonly actor: Actor;
    readonly conversation: ConversationId;
    readonly detail: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: entry.actor,
    action: entry.action,
    subject: { kind: 'conversation', id: entry.conversation },
    detail: entry.detail,
  });
};

/** Only the operator approves, rejects, grants, revokes or undoes. */
const operatorOnly = (by: Actor): Result<never, ActionError> | undefined => (by.kind === 'user' ? undefined : failure('not_user'));

/** What an applier answered, reduced to something safe to store: a stable failure code, or an undo. */
type Outcome = { readonly ok: true; readonly undo: UndoInfo | undefined } | { readonly ok: false; readonly code: string };

const STABLE_CODE = /^[a-z_]{1,64}$/;

const runApplier = async (apply: ActionApplier, action: AssistantAction, authority: ActionAuthority): Promise<Outcome> => {
  try {
    const answer = await apply(action, authority);
    if (answer.ok) return { ok: true, undo: answer.value.undo };
    // The applier's message never reaches the record: only a code that is already a stable code does.
    return { ok: false, code: STABLE_CODE.test(answer.error.code) ? answer.error.code : FALLBACK_FAILURE };
  } catch {
    return { ok: false, code: THROWN_FAILURE };
  }
};

/** Settles a pending record after the applier ran. An applier that did its work but handed back
 *  an undo the domain refuses is still recorded as applied — the work happened — only without
 *  the undo, so nothing is ever claimed to be undoable on the strength of malformed data. */
const settle = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'actions'>,
  record: ActionRecord,
  outcome: Outcome,
  authority: ActionAuthority,
  actor: Actor,
): Promise<ActionRecord> => {
  const now = deps.clock.now();
  const cls = classOf(record.action);
  if (outcome.ok) {
    const withUndo = markApplied(record, authority, outcome.undo, now);
    const applied = withUndo.ok ? withUndo : markApplied(record, authority, undefined, now);
    if (applied.ok) {
      await deps.actions.save(applied.value);
      await audit(deps, {
        action: 'action.applied',
        actor,
        conversation: record.conversation,
        detail: { action: record.id, class: cls, authority: authority.kind, ...(authority.kind === 'grant' ? { grant: authority.grant } : {}) },
      });
      return applied.value;
    }
  }
  const code = outcome.ok ? FALLBACK_FAILURE : outcome.code;
  const failed = markFailed(record, code, now);
  if (!failed.ok) return record;
  await deps.actions.save(failed.value);
  await audit(deps, { action: 'action.failed', actor, conversation: record.conversation, detail: { action: record.id, class: cls, code } });
  return failed.value;
};

export async function proposeAction(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations' | 'actions' | 'grants'>,
  input: { readonly conversation: ConversationId; readonly action: unknown; readonly by: Actor },
  apply: ActionApplier,
): Promise<Result<{ readonly record: ActionRecord; readonly decision: ActionDecision }, ActionError>> {
  if (input.by.kind === 'user') return failure('not_assistant');
  const valid = validateAction(input.action);
  if (!valid.ok) return err(valid.error);
  if ((await deps.conversations.get(input.conversation)) === undefined) return failure('not_found');
  if ((await deps.actions.countFor(input.conversation)) >= ACTION_LIMITS.actionsPerConversationMax) return failure('rate_limited');

  const now = deps.clock.now();
  const pending = newActionRecord({ id: deps.ids.next<'action'>(), conversation: input.conversation, action: valid.value }, now);
  const grants = await deps.grants.forConversation(input.conversation);
  const decision = decideAction(valid.value, grants, input.conversation, now);
  if (decision.kind === 'refused') return err(decision.error);

  await deps.actions.save(pending);
  await audit(deps, {
    action: 'action.proposed',
    actor: input.by,
    conversation: input.conversation,
    detail: { action: pending.id, class: classOf(valid.value), decision: decision.kind },
  });
  if (decision.kind === 'needs_approval') return ok({ record: pending, decision });

  const authority: ActionAuthority = { kind: 'grant', grant: decision.grant };
  const outcome = await runApplier(apply, valid.value, authority);
  const record = await settle(deps, pending, outcome, authority, input.by);
  // A failed application is not spent: only work that happened counts against the grant. The grant
  // is read again so a count written while the applier ran is not overwritten.
  if (record.status === 'applied') {
    const fresh = await deps.grants.get(decision.grant);
    if (fresh !== undefined) await deps.grants.save(recordApplied(fresh));
  }
  return ok({ record, decision });
}

export async function decideActionUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'actions'>,
  input: { readonly id: ActionId; readonly decision: 'approved' | 'rejected'; readonly by: Actor },
  apply: ActionApplier,
): Promise<Result<ActionRecord, ActionError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  if (input.by.kind !== 'user') return failure('not_user');
  const found = await deps.actions.get(input.id);
  if (found === undefined) return failure('not_found');
  if (found.status !== 'pending') return failure('not_pending');

  if (input.decision === 'rejected') {
    const rejected = markRejected(found, { kind: 'user', id: input.by.id }, deps.clock.now());
    if (!rejected.ok) return err(rejected.error);
    await deps.actions.save(rejected.value);
    await audit(deps, { action: 'action.rejected', actor: input.by, conversation: found.conversation, detail: { action: found.id, class: classOf(found.action) } });
    return ok(rejected.value);
  }

  // What is applied is re-judged: the stored record is data like any other.
  const valid = validateAction(found.action);
  if (!valid.ok) return err(valid.error);
  const authority: ActionAuthority = { kind: 'user', id: input.by.id };
  const outcome = await runApplier(apply, valid.value, authority);
  return ok(await settle(deps, found, outcome, authority, input.by));
}

export async function grantPermission(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations' | 'grants'>,
  input: { readonly conversation: ConversationId; readonly classes: readonly ActionClass[]; readonly minutes: number; readonly by: Actor },
): Promise<Result<Grant, ActionError>> {
  if (input.by.kind !== 'user') return failure('grant_not_user');
  if ((await deps.conversations.get(input.conversation)) === undefined) return failure('not_found');
  const made = newGrant(
    { conversation: input.conversation, by: input.by, classes: input.classes, ms: input.minutes * MINUTE_MS },
    deps.clock.now(),
    deps.ids.next<'grant'>(),
  );
  if (!made.ok) return err(made.error);
  await deps.grants.save(made.value);
  await audit(deps, {
    action: 'grant.created',
    actor: input.by,
    conversation: input.conversation,
    detail: { grant: made.value.id, classes: made.value.classes.join(','), count: made.value.classes.length, minutes: input.minutes },
  });
  return ok(made.value);
}

export async function revokePermission(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'grants'>,
  input: { readonly grant: GrantId; readonly by: Actor },
): Promise<Result<Grant, ActionError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const found = await deps.grants.get(input.grant);
  if (found === undefined) return failure('not_found');
  if (found.revokedAt !== undefined) return ok(found);
  const revoked = revokeGrant(found, deps.clock.now());
  await deps.grants.save(revoked);
  await audit(deps, { action: 'grant.revoked', actor: input.by, conversation: found.conversation, detail: { grant: found.id } });
  return ok(revoked);
}

export async function listActions(
  deps: Pick<AppDeps, 'actions'>,
  input: { readonly conversation: ConversationId; readonly pending?: boolean },
): Promise<readonly ActionRecord[]> {
  return input.pending === true ? deps.actions.pending(input.conversation) : deps.actions.forConversation(input.conversation);
}

/** The grants that could still cover something: neither revoked nor expired (an exhausted one is
 *  listed, so the operator sees its count). */
export async function activeGrants(deps: Pick<AppDeps, 'clock' | 'grants'>, input: { readonly conversation: ConversationId }): Promise<readonly Grant[]> {
  const now = deps.clock.now();
  return (await deps.grants.forConversation(input.conversation)).filter((g) => grantActive(g, now).ok);
}

export async function undoAction(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'actions'>,
  input: { readonly id: ActionId; readonly by: Actor },
  undo: ActionUndoer,
): Promise<Result<ActionRecord, UndoActionError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const found = await deps.actions.get(input.id);
  if (found === undefined) return failure('not_found');
  // The window and the status are judged before the undoer runs, so a late or repeated undo does nothing.
  const undone = markUndone(found, deps.clock.now());
  if (!undone.ok) return err(undone.error);

  let reverted: Result<void, { readonly code: string }>;
  try {
    reverted = await undo(found);
  } catch {
    return err({ code: 'undo_failed' });
  }
  if (!reverted.ok) return err({ code: 'undo_failed' });

  await deps.actions.save(undone.value);
  await audit(deps, { action: 'action.undone', actor: input.by, conversation: found.conversation, detail: { action: found.id, class: classOf(found.action) } });
  return ok(undone.value);
}
