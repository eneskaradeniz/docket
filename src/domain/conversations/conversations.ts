// Conversations: the durable record of a chat with Docket AI. Everything a conversation holds that
// came from outside — message text, references, attachment names, bytes — is untrusted data, so
// the rules here keep it small, plainly named and tied to ids; attachments and artifacts travel
// by reference and are never copied into the record.
import { validatePagePath } from '../pages';
import {
  err,
  isSlug,
  isUlid,
  ok,
  type AttachmentId,
  type ConversationId,
  type DraftId,
  type EpochMs,
  type MessageId,
  type PageId,
  type ProjectSlug,
  type ProposalId,
  type RepoSlug,
  type Result,
  type TaskSlug,
  type WorkOrderId,
} from '../shared';

export type ConversationScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: ProjectSlug }
  | { readonly kind: 'workOrder'; readonly workOrder: WorkOrderId };

export type ReferenceKind = 'workOrder' | 'page' | 'file' | 'project' | 'repo';

/** `id` is a work order id, page id, project slug or repo slug; for `file` it is the
 *  repo-relative path and `repo` is required. */
export interface ConversationRef {
  readonly kind: ReferenceKind;
  readonly id: string;
  readonly project?: ProjectSlug;
  readonly repo?: RepoSlug;
}

export type AttachmentKind = 'image' | 'text' | 'pdf';

export interface AttachmentRef {
  readonly id: AttachmentId;
  readonly name: string;
  readonly kind: AttachmentKind;
  readonly bytes: number;
  readonly sha256: string;
}

export type Artifact =
  | { readonly kind: 'page'; readonly page: PageId; readonly version: number }
  | { readonly kind: 'proposal'; readonly proposal: ProposalId }
  | { readonly kind: 'draft'; readonly draft: DraftId }
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** Fields appear only when the provider reported them. */
export interface TurnUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costMicros?: number;
}

export interface Message {
  readonly id: MessageId;
  readonly role: 'user' | 'assistant';
  readonly at: EpochMs;
  readonly text: string;
  readonly refs: readonly ConversationRef[];
  readonly attachments: readonly AttachmentRef[];
  readonly artifacts: readonly Artifact[];
  readonly sources: readonly string[];
  readonly usage?: TurnUsage;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly scope: ConversationScope;
  readonly title: string;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly pinned: boolean;
  readonly messages: readonly Message[];
}

export interface WorkOrderDraft {
  readonly id: DraftId;
  readonly conversation: ConversationId;
  readonly project: ProjectSlug;
  readonly repo: RepoSlug;
  readonly title: string;
  readonly task?: TaskSlug;
  readonly status: 'draft' | 'confirmed' | 'dropped';
  readonly workOrder?: WorkOrderId;
}

export type ConversationError = {
  readonly code:
    | 'empty_message'
    | 'message_too_long'
    | 'too_many_refs'
    | 'bad_ref'
    | 'too_many_attachments'
    | 'attachment_too_large'
    | 'attachments_too_large'
    | 'bad_attachment'
    | 'title_too_long'
    | 'not_found'
    | 'bad_scope'
    | 'too_many_messages'
    | 'artifact_too_large'
    | 'conversation_too_large'
    | 'not_user'
    | 'not_draft';
};

export interface NewUserMessage {
  readonly text: string;
  readonly refs?: readonly ConversationRef[];
  readonly attachments?: readonly AttachmentRef[];
}

export interface NewAssistantMessage {
  readonly text: string;
  readonly artifacts?: readonly Artifact[];
  readonly sources?: readonly string[];
  readonly usage?: TurnUsage;
}

export const CONVERSATION_LIMITS = {
  messageMax: 8_000,
  refsMax: 12,
  attachmentsMax: 5,
  attachmentMaxBytes: 5_000_000,
  attachmentsTotalMaxBytes: 15_000_000,
  titleMax: 80,
  messagesMax: 400,
  tableColumnsMax: 20,
  tableRowsMax: 200,
  tableCellMax: 500,
  tableTotalMax: 65_536,
  conversationMaxBytes: 4_000_000,
} as const;

/** A drafted work order's title is the operator's to refine, so it may be longer than a conversation title. */
export const DRAFT_TITLE_MAX = 200;

/** Artifacts and sources per assistant message; the same bound as references on a user message. */
const ARTIFACTS_MAX = CONVERSATION_LIMITS.refsMax;
const SOURCES_MAX = CONVERSATION_LIMITS.refsMax;
const SOURCE_MAX_CHARS = 200;

const failure = (code: ConversationError['code']): Result<never, ConversationError> => err({ code });

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } => typeof value === 'object' && value !== null;
const isUlidString = (value: unknown): value is string => typeof value === 'string' && isUlid(value);
const isSlugString = (value: unknown): value is string => typeof value === 'string' && isSlug(value);

// --- scope -------------------------------------------------------------------------------------------

/** Rebuilds the scope from its known fields, so nothing else the caller attached survives. */
const checkedScope = (scope: unknown): ConversationScope | undefined => {
  if (!isRecord(scope)) return undefined;
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'project' && isSlugString(scope.project)) return { kind: 'project', project: scope.project as ProjectSlug };
  if (scope.kind === 'workOrder' && isUlidString(scope.workOrder)) return { kind: 'workOrder', workOrder: scope.workOrder as WorkOrderId };
  return undefined;
};

// --- references --------------------------------------------------------------------------------------

const REFERENCE_KINDS: ReadonlySet<string> = new Set(['workOrder', 'page', 'file', 'project', 'repo']);

const checkedRef = (ref: unknown): ConversationRef | undefined => {
  if (!isRecord(ref) || typeof ref.kind !== 'string' || !REFERENCE_KINDS.has(ref.kind) || typeof ref.id !== 'string') return undefined;
  if (ref.project !== undefined && !isSlugString(ref.project)) return undefined;
  if (ref.repo !== undefined && !isSlugString(ref.repo)) return undefined;
  switch (ref.kind) {
    case 'workOrder':
    case 'page':
      if (!isUlid(ref.id)) return undefined;
      break;
    case 'project':
    case 'repo':
      if (!isSlug(ref.id)) return undefined;
      break;
    default:
      // A file lives in a registered repo and is named by a plain relative path (R-74 rules).
      if (ref.repo === undefined || !validatePagePath(ref.id)) return undefined;
  }
  return {
    kind: ref.kind as ReferenceKind,
    id: ref.id,
    ...(ref.project === undefined ? {} : { project: ref.project as ProjectSlug }),
    ...(ref.repo === undefined ? {} : { repo: ref.repo as RepoSlug }),
  };
};

export function validateRef(ref: ConversationRef): Result<void, ConversationError> {
  return checkedRef(ref) === undefined ? failure('bad_ref') : ok(undefined);
}

// --- attachments -------------------------------------------------------------------------------------

const ATTACHMENT_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  // No svg and no gif: an svg can carry script, and an animation is not a screenshot.
  ['image', ['png', 'jpg', 'jpeg', 'webp']],
  ['text', ['md', 'txt', 'log', 'csv', 'json']],
  ['pdf', ['pdf']],
]);

/** An extension in front of the last one that a tool might honour instead of it ("a.exe.png"). */
const ACTIVE_INNER_EXTENSIONS: ReadonlySet<string> = new Set([
  'svg', 'svgz', 'html', 'htm', 'xhtml', 'js', 'mjs', 'exe', 'bat', 'cmd', 'com', 'sh', 'ps1', 'jar', 'app', 'dll', 'scr', 'msi', 'vbs', 'php',
]);

/** A plain file name: one segment (no separator in the raw or the NFKC form) that passes the page-path rules. */
const isPlainName = (name: string): boolean => {
  if (name !== name.trim()) return false;
  if (!validatePagePath(name)) return false;
  return !name.includes('/') && !name.normalize('NFKC').includes('/');
};

const extensionMatches = (kind: string, name: string): boolean => {
  const allowed = ATTACHMENT_EXTENSIONS.get(kind);
  if (allowed === undefined) return false;
  const parts = name.toLowerCase().split('.');
  if (parts.length < 2 || (parts[0] ?? '') === '') return false; // no extension, or nothing before it
  const last = parts[parts.length - 1] ?? '';
  if (!allowed.includes(last)) return false;
  return !parts.slice(1, -1).some((inner) => ACTIVE_INNER_EXTENSIONS.has(inner));
};

export function validateAttachment(a: {
  readonly name: string;
  readonly bytes: number;
  readonly kind: AttachmentKind;
}): Result<void, ConversationError> {
  if (typeof a.name !== 'string' || !isPlainName(a.name) || !extensionMatches(a.kind, a.name)) return failure('bad_attachment');
  if (!Number.isInteger(a.bytes) || a.bytes < 0) return failure('bad_attachment');
  if (a.bytes > CONVERSATION_LIMITS.attachmentMaxBytes) return failure('attachment_too_large');
  return ok(undefined);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const checkedAttachments = (
  attachments: readonly AttachmentRef[],
  taken: ReadonlySet<string>,
): Result<readonly AttachmentRef[], ConversationError> => {
  if (attachments.length > CONVERSATION_LIMITS.attachmentsMax) return failure('too_many_attachments');
  const seen = new Set<string>(taken);
  const kept: AttachmentRef[] = [];
  let total = 0;
  for (const attachment of attachments) {
    const valid = validateAttachment(attachment);
    if (!valid.ok) return err(valid.error);
    if (!isUlidString(attachment.id) || typeof attachment.sha256 !== 'string' || !SHA256_PATTERN.test(attachment.sha256) || seen.has(attachment.id)) {
      return failure('bad_attachment');
    }
    seen.add(attachment.id);
    total += attachment.bytes;
    kept.push({ id: attachment.id, name: attachment.name, kind: attachment.kind, bytes: attachment.bytes, sha256: attachment.sha256 });
  }
  if (total > CONVERSATION_LIMITS.attachmentsTotalMaxBytes) return failure('attachments_too_large');
  return ok(kept);
};

// --- artifacts, sources, usage -----------------------------------------------------------------------

/** An artifact, or why it is refused: malformed (`bad_ref`) or over a size limit (`artifact_too_large`). */
const checkedArtifact = (artifact: unknown): Artifact | 'bad_ref' | 'artifact_too_large' => {
  if (!isRecord(artifact)) return 'bad_ref';
  switch (artifact.kind) {
    case 'page':
      return isUlidString(artifact.page) && typeof artifact.version === 'number' && Number.isInteger(artifact.version) && artifact.version >= 1
        ? { kind: 'page', page: artifact.page as PageId, version: artifact.version }
        : 'bad_ref';
    case 'proposal':
      return isUlidString(artifact.proposal) ? { kind: 'proposal', proposal: artifact.proposal as ProposalId } : 'bad_ref';
    case 'draft':
      return isUlidString(artifact.draft) ? { kind: 'draft', draft: artifact.draft as DraftId } : 'bad_ref';
    case 'table': {
      const { columns, rows } = artifact;
      if (!Array.isArray(columns) || !Array.isArray(rows)) return 'bad_ref';
      if (!columns.every((column) => typeof column === 'string')) return 'bad_ref';
      // Counts are judged before any cell is visited, so a hostile table costs nothing to refuse.
      if (columns.length > CONVERSATION_LIMITS.tableColumnsMax || rows.length > CONVERSATION_LIMITS.tableRowsMax) return 'artifact_too_large';
      const rectangular = rows.every((row) => Array.isArray(row) && row.length === columns.length && row.every((cell) => typeof cell === 'string'));
      if (!rectangular) return 'bad_ref';
      let total = 0;
      for (const cell of [...(columns as string[]), ...(rows as string[][]).flat()]) {
        if (cell.length > CONVERSATION_LIMITS.tableCellMax) return 'artifact_too_large';
        total += cell.length;
      }
      if (total > CONVERSATION_LIMITS.tableTotalMax) return 'artifact_too_large';
      return { kind: 'table', columns: [...(columns as string[])], rows: (rows as string[][]).map((row) => [...row]) };
    }
    default:
      return 'bad_ref';
  }
};

const checkedUsage = (usage: unknown): TurnUsage | undefined => {
  if (!isRecord(usage)) return undefined;
  const reported = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);
  const inputTokens = reported(usage.inputTokens);
  const outputTokens = reported(usage.outputTokens);
  const costMicros = reported(usage.costMicros);
  const kept: TurnUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costMicros === undefined ? {} : { costMicros }),
  };
  return Object.keys(kept).length === 0 ? undefined : kept;
};

// --- messages ----------------------------------------------------------------------------------------

const checkedText = (text: unknown): Result<string, ConversationError> => {
  if (typeof text !== 'string') return failure('empty_message');
  const trimmed = text.trim();
  if (trimmed.length > CONVERSATION_LIMITS.messageMax) return failure('message_too_long');
  return ok(trimmed);
};

const attachmentIdsOf = (c: Conversation): ReadonlySet<string> =>
  new Set(c.messages.flatMap((message) => message.attachments.map((attachment) => attachment.id)));

const buildUserMessage = (
  m: NewUserMessage,
  now: EpochMs,
  id: MessageId,
  taken: ReadonlySet<string>,
): Result<Message, ConversationError> => {
  const text = checkedText(m.text);
  if (!text.ok) return err(text.error);
  if (text.value === '') return failure('empty_message');

  const refs = m.refs ?? [];
  if (refs.length > CONVERSATION_LIMITS.refsMax) return failure('too_many_refs');
  const keptRefs: ConversationRef[] = [];
  for (const ref of refs) {
    const checked = checkedRef(ref);
    if (checked === undefined) return failure('bad_ref');
    keptRefs.push(checked);
  }

  const attachments = checkedAttachments(m.attachments ?? [], taken);
  if (!attachments.ok) return err(attachments.error);

  return ok({ id, role: 'user', at: now, text: text.value, refs: keptRefs, attachments: attachments.value, artifacts: [], sources: [] });
};

export function titleFrom(text: string): string {
  const lines = text.split(/\r\n|\r|\n|[\p{Zl}\p{Zp}]/u);
  const first = lines.map((line) => line.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).find((line) => line !== '');
  if (first === undefined) return '';
  const points = Array.from(first);
  if (points.length <= CONVERSATION_LIMITS.titleMax) return first;
  return `${points.slice(0, CONVERSATION_LIMITS.titleMax - 1).join('').trimEnd()}…`;
}

export function startConversation(
  input: { readonly scope: ConversationScope; readonly firstMessage: NewUserMessage },
  now: EpochMs,
  ids: { readonly conversation: ConversationId; readonly message: MessageId },
): Result<Conversation, ConversationError> {
  const scope = checkedScope(input.scope);
  if (scope === undefined) return failure('bad_scope');
  const message = buildUserMessage(input.firstMessage, now, ids.message, new Set());
  if (!message.ok) return err(message.error);
  return ok({
    id: ids.conversation,
    scope,
    title: titleFrom(message.value.text),
    createdAt: now,
    updatedAt: now,
    pinned: false,
    messages: [message.value],
  });
}

/** Appends the message, unless the whole record would outgrow one stored row. */
const appended = (c: Conversation, message: Message, now: EpochMs): Result<Conversation, ConversationError> => {
  const next: Conversation = { ...c, updatedAt: now, messages: [...c.messages, message] };
  if (JSON.stringify(next).length > CONVERSATION_LIMITS.conversationMaxBytes) return failure('conversation_too_large');
  return ok(next);
};

export function addUserMessage(
  c: Conversation,
  m: NewUserMessage,
  now: EpochMs,
  id: MessageId,
): Result<Conversation, ConversationError> {
  if (c.messages.length >= CONVERSATION_LIMITS.messagesMax) return failure('too_many_messages');
  const message = buildUserMessage(m, now, id, attachmentIdsOf(c));
  if (!message.ok) return err(message.error);
  return appended(c, message.value, now);
}

export function addAssistantMessage(
  c: Conversation,
  m: NewAssistantMessage,
  now: EpochMs,
  id: MessageId,
): Result<Conversation, ConversationError> {
  if (c.messages.length >= CONVERSATION_LIMITS.messagesMax) return failure('too_many_messages');
  // An assistant message answers; it never carries what the operator attached or referenced.
  const smuggled = m as unknown as { readonly refs?: readonly unknown[]; readonly attachments?: readonly unknown[] };
  if ((smuggled.refs?.length ?? 0) > 0) return failure('bad_ref');
  if ((smuggled.attachments?.length ?? 0) > 0) return failure('bad_attachment');

  const text = checkedText(m.text);
  if (!text.ok) return err(text.error);

  const artifacts = m.artifacts ?? [];
  if (artifacts.length > ARTIFACTS_MAX) return failure('bad_ref');
  const keptArtifacts: Artifact[] = [];
  for (const artifact of artifacts) {
    const checked = checkedArtifact(artifact);
    if (typeof checked === 'string') return failure(checked);
    keptArtifacts.push(checked);
  }
  if (text.value === '' && keptArtifacts.length === 0) return failure('empty_message');

  const sources = (m.sources ?? []).map((source) => (typeof source === 'string' ? source.trim() : ''));
  if (sources.length > SOURCES_MAX || sources.some((source) => source === '' || source.length > SOURCE_MAX_CHARS)) return failure('bad_ref');

  const usage = checkedUsage(m.usage);
  const message: Message = {
    id,
    role: 'assistant',
    at: now,
    text: text.value,
    refs: [],
    attachments: [],
    artifacts: keptArtifacts,
    sources,
    ...(usage === undefined ? {} : { usage }),
  };
  return appended(c, message, now);
}

/** Pinning is the operator's marking, not activity: `updatedAt` stays the time of the last message,
 *  so pinning never reorders the history. `now` is part of the signature for callers that stamp it. */
export function setPinned(c: Conversation, pinned: boolean, _now: EpochMs): Conversation {
  return { ...c, pinned };
}

// --- drafts ------------------------------------------------------------------------------------------

export function newDraft(
  input: {
    readonly conversation: ConversationId;
    readonly project: ProjectSlug;
    readonly repo: RepoSlug;
    readonly title: string;
    readonly task?: TaskSlug;
  },
  id: DraftId,
): Result<WorkOrderDraft, ConversationError> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') return failure('empty_message');
  if (title.length > DRAFT_TITLE_MAX) return failure('title_too_long');
  if (!isUlidString(input.conversation) || !isUlidString(id)) return failure('bad_ref');
  if (!isSlugString(input.project) || !isSlugString(input.repo)) return failure('bad_ref');
  if (input.task !== undefined && !isSlugString(input.task)) return failure('bad_ref');
  return ok({
    id,
    conversation: input.conversation,
    project: input.project,
    repo: input.repo,
    title,
    ...(input.task === undefined ? {} : { task: input.task }),
    status: 'draft',
  });
}

export function confirmDraft(d: WorkOrderDraft, workOrder: WorkOrderId): Result<WorkOrderDraft, ConversationError> {
  if (d.status !== 'draft') return failure('not_draft');
  return ok({ ...d, status: 'confirmed', workOrder });
}

export function dropDraft(d: WorkOrderDraft): Result<WorkOrderDraft, ConversationError> {
  if (d.status !== 'draft') return failure('not_draft');
  return ok({ ...d, status: 'dropped' });
}
