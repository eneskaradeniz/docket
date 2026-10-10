// use-cases/conversations.ts — starting, appending to, listing, pinning and deleting conversations,
// and the work-order drafts they produce. The domain decides every rule; this layer writes a
// message's attachment bytes FIRST and the record second (a failed record write removes the bytes
// again, so there is never an attachment without a record or a record without its bytes), and
// appends an audit entry whose detail is ids, kinds, counts and byte totals only — never a title,
// message text, file name or file content. Nothing here logs.
import type {
  Actor,
  AttachmentId,
  AttachmentKind,
  AttachmentRef,
  Conversation,
  ConversationError,
  ConversationId,
  ConversationRef,
  ConversationScope,
  DraftId,
  NewAssistantMessage,
  ProjectSlug,
  RepoSlug,
  Result,
  TaskSlug,
  WorkOrderDraft,
  WorkOrderId,
} from '../../domain/index';
import {
  CONVERSATION_LIMITS,
  addAssistantMessage,
  addUserMessage,
  confirmDraft,
  dropDraft,
  err,
  newDraft,
  ok,
  setPinned,
  sha256Hex,
  startConversation,
} from '../../domain/index';

import type { AppDeps, AuditAction, ConversationFilter, ConversationSummary } from '../ports';

import { openWorkOrder, type OpenError } from './work-orders';

export interface AttachmentInput {
  readonly name: string;
  readonly kind: AttachmentKind;
  readonly bytes: Uint8Array;
}

export interface UserMessageInput {
  readonly text: string;
  readonly refs?: readonly ConversationRef[];
  readonly attachments?: readonly AttachmentInput[];
}

/** A draft that could not be opened as a work order carries openWorkOrder's own reason. */
export type ConfirmDraftError = ConversationError | { readonly code: 'open_failed'; readonly reason: OpenError };

const failure = (code: ConversationError['code']): Result<never, ConversationError> => err({ code });

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

/** Pinning, deleting, dropping and confirming are the operator's alone: a chat turn runs as an agent
 *  or system actor and must never be able to open a work order or remove history. */
const operatorOnly = (by: Actor): Result<never, ConversationError> | undefined => (by.kind === 'user' ? undefined : failure('not_user'));

const NO_HASH = '0'.repeat(64);

/** Names the bytes of each attachment. The domain refuses anything oversize or too many before
 *  the hash matters, so those are not hashed: a refused upload costs no digest of its bytes. */
const refsOf = (deps: Pick<AppDeps, 'ids'>, inputs: readonly AttachmentInput[]): readonly AttachmentRef[] => {
  const hashable = inputs.length <= CONVERSATION_LIMITS.attachmentsMax;
  return inputs.map((input) => ({
    id: deps.ids.next<'attachment'>(),
    name: input.name,
    kind: input.kind,
    bytes: input.bytes.length,
    sha256: hashable && input.bytes.length <= CONVERSATION_LIMITS.attachmentMaxBytes ? sha256Hex(input.bytes) : NO_HASH,
  }));
};

const totalBytes = (refs: readonly AttachmentRef[]): number => refs.reduce((sum, ref) => sum + ref.bytes, 0);

/** Bytes first, then the record. When either step fails the bytes written so far go away again —
 *  an attachment without a record would be unreachable — and the failure still surfaces. */
const storeMessage = async (
  deps: Pick<AppDeps, 'conversations' | 'attachmentFiles'>,
  conversation: Conversation,
  refs: readonly AttachmentRef[],
  inputs: readonly AttachmentInput[],
): Promise<void> => {
  const written: AttachmentId[] = [];
  try {
    for (const [index, ref] of refs.entries()) {
      const input = inputs[index];
      if (input === undefined) throw new Error('attachment without bytes');
      await deps.attachmentFiles.write(conversation.id, ref.id, input.bytes);
      written.push(ref.id);
    }
    await deps.conversations.save(conversation);
  } catch (failed) {
    for (const id of written) await deps.attachmentFiles.remove(conversation.id, id).catch(() => undefined);
    throw failed;
  }
};

export async function startConversationUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations' | 'attachmentFiles'>,
  input: {
    readonly scope: ConversationScope;
    readonly firstMessage: UserMessageInput;
    readonly by: Actor;
  },
): Promise<Result<Conversation, ConversationError>> {
  const attachments = input.firstMessage.attachments ?? [];
  const refs = refsOf(deps, attachments);
  const started = startConversation(
    { scope: input.scope, firstMessage: { text: input.firstMessage.text, refs: input.firstMessage.refs ?? [], attachments: refs } },
    deps.clock.now(),
    { conversation: deps.ids.next<'conversation'>(), message: deps.ids.next<'message'>() },
  );
  if (!started.ok) return err(started.error);

  await storeMessage(deps, started.value, refs, attachments);
  await audit(deps, {
    action: 'conversation.started',
    actor: input.by,
    conversation: started.value.id,
    detail: {
      scope: started.value.scope.kind,
      messages: 1,
      refs: (input.firstMessage.refs ?? []).length,
      attachments: refs.length,
      bytes: totalBytes(refs),
    },
  });
  return ok(started.value);
}

export async function appendUserMessage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'conversations' | 'attachmentFiles'>,
  input: { readonly conversation: ConversationId; readonly message: UserMessageInput },
): Promise<Result<Conversation, ConversationError>> {
  const found = await deps.conversations.get(input.conversation);
  if (found === undefined) return failure('not_found');
  const attachments = input.message.attachments ?? [];
  const refs = refsOf(deps, attachments);
  const added = addUserMessage(
    found,
    { text: input.message.text, refs: input.message.refs ?? [], attachments: refs },
    deps.clock.now(),
    deps.ids.next<'message'>(),
  );
  if (!added.ok) return err(added.error);

  await storeMessage(deps, added.value, refs, attachments);
  return ok(added.value);
}

export async function appendAssistantMessage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'conversations'>,
  input: { readonly conversation: ConversationId; readonly message: NewAssistantMessage },
): Promise<Result<Conversation, ConversationError>> {
  const found = await deps.conversations.get(input.conversation);
  if (found === undefined) return failure('not_found');
  const added = addAssistantMessage(found, input.message, deps.clock.now(), deps.ids.next<'message'>());
  if (!added.ok) return err(added.error);
  await deps.conversations.save(added.value);
  return ok(added.value);
}

export async function listConversations(
  deps: Pick<AppDeps, 'conversations'>,
  filter: ConversationFilter,
): Promise<readonly ConversationSummary[]> {
  return deps.conversations.list(filter);
}

export async function conversationDetail(
  deps: Pick<AppDeps, 'conversations'>,
  input: { readonly conversation: ConversationId },
): Promise<Result<{ readonly conversation: Conversation; readonly drafts: readonly WorkOrderDraft[] }, ConversationError>> {
  const conversation = await deps.conversations.get(input.conversation);
  if (conversation === undefined) return failure('not_found');
  return ok({ conversation, drafts: await deps.conversations.draftsOf(input.conversation) });
}

export async function pinConversation(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations'>,
  input: { readonly conversation: ConversationId; readonly pinned: boolean; readonly by: Actor },
): Promise<Result<Conversation, ConversationError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const found = await deps.conversations.get(input.conversation);
  if (found === undefined) return failure('not_found');
  const pinned = setPinned(found, input.pinned, deps.clock.now());
  await deps.conversations.save(pinned);
  await audit(deps, { action: 'conversation.pinned', actor: input.by, conversation: pinned.id, detail: { pinned: input.pinned } });
  return ok(pinned);
}

/** Idempotent. The record (and its drafts) goes first: if removing the bytes then fails, what is
 *  left is unreachable bytes the next delete of the same id sweeps away, never a record whose
 *  attachments are gone. */
export async function deleteConversation(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations' | 'attachmentFiles'>,
  input: { readonly conversation: ConversationId; readonly by: Actor },
): Promise<Result<void, ConversationError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const found = await deps.conversations.get(input.conversation);
  if (found !== undefined) {
    const drafts = await deps.conversations.draftsOf(input.conversation);
    const refs = found.messages.flatMap((message) => message.attachments);
    await deps.conversations.delete(input.conversation);
    await audit(deps, {
      action: 'conversation.deleted',
      actor: input.by,
      conversation: input.conversation,
      detail: { messages: found.messages.length, attachments: refs.length, bytes: totalBytes(refs), drafts: drafts.length },
    });
  }
  await deps.attachmentFiles.removeAll(input.conversation);
  return ok(undefined);
}

export async function createDraft(
  deps: Pick<AppDeps, 'ids' | 'conversations'>,
  input: {
    readonly conversation: ConversationId;
    readonly project: ProjectSlug;
    readonly repo: RepoSlug;
    readonly title: string;
    readonly task?: TaskSlug;
  },
): Promise<Result<WorkOrderDraft, ConversationError>> {
  if ((await deps.conversations.get(input.conversation)) === undefined) return failure('not_found');
  const draft = newDraft(
    {
      conversation: input.conversation,
      project: input.project,
      repo: input.repo,
      title: input.title,
      ...(input.task === undefined ? {} : { task: input.task }),
    },
    deps.ids.next<'draft'>(),
  );
  if (!draft.ok) return err(draft.error);
  await deps.conversations.saveDraft(draft.value);
  return ok(draft.value);
}

/** Opens the work order through the one existing path, as the calling user, and only then marks the
 *  draft confirmed; when opening fails the draft stays a draft and the reason is returned. */
export async function confirmDraftUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations' | 'workOrders' | 'definitions' | 'projects'>,
  input: { readonly draft: DraftId; readonly by: Actor },
): Promise<Result<{ readonly draft: WorkOrderDraft; readonly workOrder: WorkOrderId }, ConfirmDraftError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const draft = await deps.conversations.getDraft(input.draft);
  if (draft === undefined) return failure('not_found');
  // Checked before opening: a draft that is already done must never open a second work order.
  if (draft.status !== 'draft') return failure('not_draft');

  const opened = await openWorkOrder(deps, {
    project: draft.project,
    repo: draft.repo,
    title: draft.title,
    ...(draft.task === undefined ? {} : { task: draft.task }),
    actor: input.by,
  });
  if (!opened.ok) return err({ code: 'open_failed', reason: opened.error });

  const confirmed = confirmDraft(draft, opened.value);
  if (!confirmed.ok) return err(confirmed.error);
  await deps.conversations.saveDraft(confirmed.value);
  await audit(deps, {
    action: 'conversation.draft_confirmed',
    actor: input.by,
    conversation: draft.conversation,
    detail: { draft: draft.id, workOrder: opened.value },
  });
  return ok({ draft: confirmed.value, workOrder: opened.value });
}

export async function dropDraftUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'conversations'>,
  input: { readonly draft: DraftId; readonly by: Actor },
): Promise<Result<WorkOrderDraft, ConversationError>> {
  const refused = operatorOnly(input.by);
  if (refused !== undefined) return refused;
  const draft = await deps.conversations.getDraft(input.draft);
  if (draft === undefined) return failure('not_found');
  const dropped = dropDraft(draft);
  if (!dropped.ok) return err(dropped.error);
  await deps.conversations.saveDraft(dropped.value);
  await audit(deps, {
    action: 'conversation.draft_dropped',
    actor: input.by,
    conversation: draft.conversation,
    detail: { draft: draft.id },
  });
  return ok(dropped.value);
}
