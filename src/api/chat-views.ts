// api/chat-views.ts — the chat surface's views (6e-5): plain JSON, no domain brand, no raw
// sessionRef, token, environment value or file byte ever leaves through one of them. References
// and artifacts resolve to labels (codes, titles, names) — a label names a thing, it never
// carries its contents. The builders here read the stores; every rule stays in the use cases.
import type {
  ActionClass,
  ActionRecord,
  Artifact,
  AssistantAction,
  AttachmentKind,
  Conversation,
  ConversationId,
  ConversationRef,
  ConversationScope,
  EpochMs,
  Grant,
  Message,
  PageId,
  ProjectSlug,
  RepoSlug,
  Result,
  RoleSlug,
  WorkOrderDraft,
  WorkOrderId,
} from '../domain/index';
import {
  ACTION_CLASSES,
  ACTION_LIMITS,
  CONVERSATION_LIMITS,
  err,
  grantActive,
  isSlug,
  isUlid,
  matchesSearch,
  ok,
  validateAttachment,
  validatePagePath,
} from '../domain/index';

import type { AppDeps } from '../application';
import { isSecretRepoPath } from '../application';
import type { ChatRunner } from '../application';
import { activeGrants, listActions, workOrderCodeOf } from '../application';

// --- wire shapes ---------------------------------------------------------------------------------------

export type ChatScopeView =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'workOrder'; readonly workOrder: string };

export interface ChatConversationSummaryView {
  readonly id: string;
  readonly title: string;
  readonly scope: ChatScopeView;
  readonly pinned: boolean;
  readonly updatedAt: number;
  /** The newest message's text, cut at 120 characters. */
  readonly lastText: string;
  readonly messageCount: number;
  readonly activeTurn: boolean;
}

export interface ChatRefView {
  readonly kind: string;
  readonly id: string;
  /** The code, title or name the reference resolves to — never contents. */
  readonly label: string;
  readonly repo?: string;
  readonly project?: string;
}

export interface ChatAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly type: AttachmentKind;
  readonly bytes: number;
}

export type ChatArtifactView =
  | { readonly kind: 'page'; readonly id: string; readonly version: number; readonly title: string | null; readonly pageKind: string | null }
  | { readonly kind: 'proposal'; readonly id: string; readonly label: string | null; readonly action: string | null }
  | { readonly kind: 'draft'; readonly id: string; readonly label: string | null; readonly action: string | null }
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

export interface ChatMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly at: number;
  readonly text: string;
  readonly refs: readonly ChatRefView[];
  readonly attachments: readonly ChatAttachmentView[];
  readonly artifacts: readonly ChatArtifactView[];
  readonly sources: readonly string[];
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly costMicros?: number };
}

export interface ChatActionView {
  readonly id: string;
  readonly class: string;
  readonly status: string;
  readonly undoable: boolean;
  readonly undoExpiresAt: number | null;
  readonly authority: 'user' | 'grant' | null;
  readonly failure: string | null;
}

export interface ChatGrantView {
  readonly id: string;
  readonly classes: readonly string[];
  readonly expiresAt: number;
  readonly applicationsLeft: number;
}

export interface ChatDraftView {
  readonly id: string;
  readonly project: string;
  readonly repo: string;
  readonly title: string;
  readonly task: string | null;
  readonly status: string;
  readonly workOrder: string | null;
}

export interface ChatConversationView {
  readonly id: string;
  readonly title: string;
  readonly scope: ChatScopeView;
  readonly pinned: boolean;
  readonly messages: readonly ChatMessageView[];
  readonly drafts: readonly ChatDraftView[];
  readonly actions: readonly ChatActionView[];
  readonly grants: readonly ChatGrantView[];
  /** The live turn's id, present exactly while one runs. */
  readonly activeTurn?: string;
}

export interface ChatReferenceView {
  readonly kind: 'work_order' | 'page' | 'project' | 'repo';
  readonly id: string;
  readonly label: string;
  readonly project?: string;
}

export interface ChatUsageView {
  readonly month: { readonly messages: number; readonly tokens?: number; readonly costUsd?: number };
  readonly account?: { readonly label: string };
}

export interface ChatAttachmentBytesView {
  readonly name: string;
  readonly type: AttachmentKind;
  readonly base64: string;
}

// --- limits --------------------------------------------------------------------------------------------

export const CHAT_API_LIMITS = {
  listDefault: 30,
  listMax: 100,
  lastTextChars: 120,
  referencesDefault: 20,
  referencesMax: 50,
  queryMax: 200,
  /** The one chat event allowed to carry a payload: each fragment stays within this many bytes. */
  deltaMaxBytes: 4_096,
  /** Pending uploads this old are swept when a turn starts. */
  uploadSweepMs: 3_600_000,
} as const;

// --- scope and reference parsing -----------------------------------------------------------------------

export const chatScopeView = (scope: ConversationScope): ChatScopeView =>
  scope.kind === 'global'
    ? { kind: 'global' }
    : scope.kind === 'project'
      ? { kind: 'project', project: scope.project }
      : { kind: 'workOrder', workOrder: scope.workOrder };

/** A wire scope becomes a domain scope, or undefined when malformed. */
export const chatScopeOf = (
  input: { readonly kind?: unknown; readonly project?: unknown; readonly workOrder?: unknown } | undefined,
): ConversationScope | undefined => {
  if (input === undefined || typeof input !== 'object') return undefined;
  const { kind, project, workOrder } = input as { readonly kind?: unknown; readonly project?: unknown; readonly workOrder?: unknown };
  if (kind === 'global') return { kind: 'global' };
  if (kind === 'project' && typeof project === 'string' && isSlug(project)) return { kind: 'project', project: project as ProjectSlug };
  if (kind === 'workOrder' && typeof workOrder === 'string' && isUlid(workOrder)) return { kind: 'workOrder', workOrder: workOrder as WorkOrderId };
  return undefined;
};

/** One wire reference of any kind, with its domain shape already checked (never its existence). */
const refInputOf = (
  input: { readonly kind?: unknown; readonly id?: unknown; readonly repo?: unknown; readonly path?: unknown },
): ConversationRef | undefined => {
  const { kind, id, repo, path } = input as { readonly kind?: unknown; readonly id?: unknown; readonly repo?: unknown; readonly path?: unknown };
  if (kind === 'workOrder' || kind === 'page') {
    return typeof id === 'string' && isUlid(id) ? { kind, id } : undefined;
  }
  if (kind === 'project' || kind === 'repo') {
    return typeof id === 'string' && isSlug(id) ? { kind, id } : undefined;
  }
  if (kind === 'file') {
    if (typeof repo !== 'string' || !isSlug(repo) || typeof path !== 'string') return undefined;
    return { kind: 'file', id: path, repo: repo as RepoSlug };
  }
  return undefined;
};

/** The repos of the operator's own projects: the only repos a reference may ever name. */
const knownRepos = async (deps: Pick<AppDeps, 'projects'>): Promise<Map<RepoSlug, ProjectSlug>> => {
  const byRepo = new Map<RepoSlug, ProjectSlug>();
  for (const project of await deps.projects.list()) {
    for (const repo of project.repos) if (!byRepo.has(repo)) byRepo.set(repo, project.id);
  }
  return byRepo;
};

export type ChatRefError = { readonly code: 'bad_ref' | 'too_many_refs' | 'bad_input' };

/** Reference resolution at the boundary (A-261): every ref must exist in the operator's own state,
 *  and a file ref must name a registered repo and pass the same plain-path and secret-name rules
 *  as `docket_read_file` — shared functions, never a copy. Nothing reaches a use case otherwise. */
export const resolveChatRefs = async (
  deps: Pick<AppDeps, 'workOrders' | 'pages' | 'projects'>,
  inputs: readonly { readonly kind?: unknown; readonly id?: unknown; readonly repo?: unknown; readonly path?: unknown }[] | undefined,
): Promise<Result<readonly ConversationRef[], ChatRefError>> => {
  if (inputs === undefined) return ok([]);
  if (inputs.length > CONVERSATION_LIMITS.refsMax) return err({ code: 'too_many_refs' });
  const repos = await knownRepos(deps);
  const refs: ConversationRef[] = [];
  for (const input of inputs) {
    const parsed = refInputOf(input);
    if (parsed === undefined) return err({ code: 'bad_ref' });
    switch (parsed.kind) {
      case 'workOrder':
        if ((await deps.workOrders.get(parsed.id as WorkOrderId)) === undefined) return err({ code: 'bad_ref' });
        break;
      case 'page':
        if ((await deps.pages.get(parsed.id as PageId)) === undefined) return err({ code: 'bad_ref' });
        break;
      case 'project':
        if ((await deps.projects.get(parsed.id as ProjectSlug)) === undefined) return err({ code: 'bad_ref' });
        break;
      case 'repo':
        if (!repos.has(parsed.id as RepoSlug)) return err({ code: 'bad_ref' });
        break;
      default:
        // The shared docket_read_file rules: a plain repo-relative path, and no secret-bearing name.
        if (!repos.has(parsed.repo as RepoSlug)) return err({ code: 'bad_ref' });
        if (!validatePagePath(parsed.id) || isSecretRepoPath(parsed.id)) return err({ code: 'bad_ref' });
        break;
    }
    refs.push(parsed);
  }
  return ok(refs);
};

// --- attachment decoding --------------------------------------------------------------------------------

/** Strict canonical base64: a multiple-of-four length, the alphabet only, padding only at the
 *  very end. Written as a scan, not a regex — a regex over a multi-megabyte upload overflows the
 *  engine's stack, and the whole point of this check is to run before anything else does. */
const isCanonicalBase64 = (input: string): boolean => {
  if (input.length % 4 !== 0 || input.length === 0) return false;
  let padding = false;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 61) {
      // Padding starts only in the last two positions and runs to the end.
      if (index < input.length - 2) return false;
      padding = true;
      continue;
    }
    if (padding) return false; // anything after '=' is malformed
    const plain = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (!plain) return false;
  }
  return true;
};

export const decodeBase64 = (input: string): Uint8Array | undefined => {
  if (!isCanonicalBase64(input)) return undefined;
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
};

export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // 8 KiB steps: fromCharCode is variadic and a multi-megabyte call would blow the stack budget.
  for (let at = 0; at < bytes.length; at += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8_192));
  }
  return btoa(binary);
};

/** The declared types the attach command accepts, mapped onto the domain's kinds. `jpeg` rides
 *  beside `jpg` because the domain's own extension whitelist accepts both spellings. */
const DECLARED_TYPES: Readonly<Record<string, AttachmentKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  md: 'text',
  txt: 'text',
  log: 'text',
  csv: 'text',
  json: 'text',
  pdf: 'pdf',
};

export type AttachDecodeError = 'bad_base64' | 'attachment_too_large' | 'bad_attachment';

/** Magic-byte sniff: a declared image must actually be a png, jpg or webp, a declared pdf a pdf.
 *  Text needs no sniff — any bytes are text-like, and nothing ever executes them. */
const sniffsAs = (kind: AttachmentKind, bytes: Uint8Array): boolean => {
  const head = (length: number): string => Array.from(bytes.subarray(0, length)).map((byte) => String.fromCharCode(byte)).join('');
  if (kind === 'image') {
    const png = head(4) === '\x89PNG';
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp = head(4) === 'RIFF' && bytes.length >= 12 && head(12).slice(8) === 'WEBP';
    return png || jpeg || webp;
  }
  if (kind === 'pdf') return head(5) === '%PDF-';
  return true;
};

/** One upload's decode-and-validate pass (A-259): strict base64, the size cap, the allowed
 *  declared types, the name rules the domain owns, and the magic-byte sniff. */
export const decodeAttachment = (
  input: { readonly name: string; readonly type: string; readonly base64: string },
): Result<{ readonly name: string; readonly kind: AttachmentKind; readonly bytes: Uint8Array }, AttachDecodeError> => {
  const kind = DECLARED_TYPES[input.type];
  if (kind === undefined || typeof input.name !== 'string' || typeof input.base64 !== 'string') return err('bad_attachment');
  const bytes = decodeBase64(input.base64);
  if (bytes === undefined) return err('bad_base64');
  if (bytes.length > CONVERSATION_LIMITS.attachmentMaxBytes) return err('attachment_too_large');
  const valid = validateAttachment({ name: input.name, bytes: bytes.length, kind });
  if (!valid.ok) return err(valid.error.code === 'attachment_too_large' ? 'attachment_too_large' : 'bad_attachment');
  if (!sniffsAs(kind, bytes)) return err('bad_attachment');
  return ok({ name: input.name, kind, bytes });
};

// --- label resolution ------------------------------------------------------------------------------------

const workOrderLabel = async (
  deps: Pick<AppDeps, 'workOrders'>,
  id: WorkOrderId,
): Promise<string> => `${workOrderCodeOf((await deps.workOrders.number(id)) ?? 0)} ${(await deps.workOrders.get(id))?.title ?? ''}`.trim();

/** What one stored reference becomes on a message: its own kind and id plus a label the surface
 *  can show — a code with a title, a page title, a project name, a repo slug, or the file's own
 *  repo-relative path (a path names a file, it is not its contents). */
const refViewsOf = async (
  deps: Pick<AppDeps, 'workOrders' | 'pages' | 'projects'>,
  refs: readonly ConversationRef[],
): Promise<readonly ChatRefView[]> => {
  const views: ChatRefView[] = [];
  for (const ref of refs) {
    switch (ref.kind) {
      case 'workOrder':
        views.push({ kind: ref.kind, id: ref.id, label: await workOrderLabel(deps, ref.id as WorkOrderId) });
        break;
      case 'page':
        views.push({ kind: ref.kind, id: ref.id, label: (await deps.pages.get(ref.id as PageId))?.title ?? ref.id });
        break;
      case 'project':
        views.push({ kind: ref.kind, id: ref.id, label: (await deps.projects.get(ref.id as ProjectSlug))?.name ?? ref.id });
        break;
      case 'repo':
        views.push({ kind: ref.kind, id: ref.id, label: ref.id });
        break;
      default:
        views.push({ kind: ref.kind, id: ref.id, label: ref.id, ...(ref.repo === undefined ? {} : { repo: ref.repo }) });
        break;
    }
  }
  return views;
};

/** What an action record names, in artifact terms: the draft or proposal it proposed. */
const refOfAction = (action: AssistantAction): { readonly kind: string; readonly ref: string } | undefined =>
  action.kind === 'open_work_order'
    ? { kind: action.kind, ref: action.draft }
    : action.kind === 'roadmap_edit' || action.kind === 'definition_edit'
      ? { kind: action.kind, ref: action.proposal }
      : undefined;

const actionOfArtifact = async (
  deps: Pick<AppDeps, 'actions'>,
  conversation: ConversationId,
  kinds: readonly string[],
  ref: string,
): Promise<string | null> => {
  for (const record of await deps.actions.forConversation(conversation)) {
    const found = refOfAction(record.action);
    if (found !== undefined && found.ref === ref && kinds.includes(found.kind)) return record.id;
  }
  return null;
};

/** What one assistant message's artifacts become: a page by its title and kind, a proposal or
 *  draft by its own summary or title plus the action that proposed it, a table as itself (the
 *  domain has already bounded it). An id that no longer resolves keeps its label null. */
const artifactViewsOf = async (
  deps: Pick<AppDeps, 'pages' | 'conversations' | 'proposals' | 'actions'>,
  conversation: ConversationId,
  artifacts: readonly Artifact[],
): Promise<readonly ChatArtifactView[]> => {
  const views: ChatArtifactView[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === 'page') {
      const page = await deps.pages.get(artifact.page);
      views.push({
        kind: 'page',
        id: artifact.page,
        version: artifact.version,
        title: page?.title ?? null,
        pageKind: page?.kind ?? null,
      });
    } else if (artifact.kind === 'proposal') {
      views.push({
        kind: 'proposal',
        id: artifact.proposal,
        label: (await deps.proposals.get(artifact.proposal))?.summary ?? null,
        action: await actionOfArtifact(deps, conversation, ['roadmap_edit', 'definition_edit'], artifact.proposal),
      });
    } else if (artifact.kind === 'draft') {
      views.push({
        kind: 'draft',
        id: artifact.draft,
        label: (await deps.conversations.getDraft(artifact.draft))?.title ?? null,
        action: await actionOfArtifact(deps, conversation, ['open_work_order'], artifact.draft),
      });
    } else {
      views.push({ kind: 'table', columns: artifact.columns, rows: artifact.rows });
    }
  }
  return views;
};

const messageView = async (
  deps: Pick<AppDeps, 'workOrders' | 'pages' | 'projects' | 'conversations' | 'proposals' | 'actions'>,
  conversation: ConversationId,
  message: Message,
): Promise<ChatMessageView> => ({
  id: message.id,
  role: message.role,
  at: message.at,
  text: message.text,
  refs: await refViewsOf(deps, message.refs),
  attachments: message.attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, type: attachment.kind, bytes: attachment.bytes })),
  artifacts: await artifactViewsOf(deps, conversation, message.artifacts),
  sources: [...message.sources],
  ...(message.usage === undefined ? {} : { usage: message.usage }),
});

// --- the queries -----------------------------------------------------------------------------------------

/** The history list (A-251): pinned first, then newest-updated first; `q` is the Turkish-aware
 *  fold-search over titles and message text; `limit` defaults to 30 and caps at 100. */
export const chatConversationsView = async (
  deps: Pick<AppDeps, 'clock' | 'conversations'>,
  runner: Pick<ChatRunner, 'active'> | undefined,
  input: { readonly q?: string; readonly scope?: ConversationScope; readonly pinned?: boolean; readonly before?: number; readonly limit?: number },
): Promise<readonly ChatConversationSummaryView[]> => {
  const summaries = await deps.conversations.list({});
  const limit = input.limit ?? CHAT_API_LIMITS.listDefault;
  const views: ChatConversationSummaryView[] = [];
  for (const summary of summaries) {
    if (input.scope !== undefined) {
      const same =
        (input.scope.kind === 'global' && summary.scope.kind === 'global') ||
        (input.scope.kind === 'project' && summary.scope.kind === 'project' && summary.scope.project === input.scope.project) ||
        (input.scope.kind === 'workOrder' && summary.scope.kind === 'workOrder' && summary.scope.workOrder === input.scope.workOrder);
      if (!same) continue;
    }
    if (input.pinned !== undefined && summary.pinned !== input.pinned) continue;
    if (input.before !== undefined && summary.updatedAt >= input.before) continue;
    const conversation = await deps.conversations.get(summary.id);
    if (conversation === undefined) continue; // deleted between the two reads: not this list's business
    if (input.q !== undefined) {
      const haystack = [conversation.title, ...conversation.messages.map((message) => message.text)].join('\n');
      if (!matchesSearch(haystack, input.q)) continue;
    }
    const last = conversation.messages[conversation.messages.length - 1];
    const lastText = last === undefined ? '' : Array.from(last.text).slice(0, CHAT_API_LIMITS.lastTextChars).join('');
    views.push({
      id: conversation.id,
      title: conversation.title,
      scope: chatScopeView(conversation.scope),
      pinned: conversation.pinned,
      updatedAt: conversation.updatedAt,
      lastText,
      messageCount: conversation.messages.length,
      activeTurn: runner?.active(conversation.id) !== undefined,
    });
    if (views.length >= limit) break;
  }
  return views;
};

const actionView = (record: ActionRecord, now: EpochMs): ChatActionView => ({
  id: record.id,
  class: record.action.kind,
  status: record.status,
  undoable: record.status === 'applied' && record.undo !== undefined && now < record.undo.expiresAt,
  undoExpiresAt: record.undo?.expiresAt ?? null,
  authority: record.decidedBy?.kind ?? null,
  failure: record.failure ?? null,
});

const grantView = (grant: Grant): ChatGrantView => ({
  id: grant.id,
  classes: [...grant.classes],
  expiresAt: grant.expiresAt,
  applicationsLeft: Math.max(0, ACTION_LIMITS.grantMaxApplications - grant.applied),
});

const draftView = (draft: WorkOrderDraft): ChatDraftView => ({
  id: draft.id,
  project: draft.project,
  repo: draft.repo,
  title: draft.title,
  task: draft.task ?? null,
  status: draft.status,
  workOrder: draft.workOrder ?? null,
});

/** The whole conversation (A-252): messages with resolved labels, drafts, the action cards and
 *  the live grants, plus the active turn while one runs. */
export const chatConversationView = async (
  deps: Pick<AppDeps, 'clock' | 'conversations' | 'workOrders' | 'pages' | 'projects' | 'proposals' | 'actions' | 'grants'>,
  runner: Pick<ChatRunner, 'active'> | undefined,
  conversation: Conversation,
): Promise<ChatConversationView> => {
  const now = deps.clock.now();
  const [drafts, actions, grants] = await Promise.all([
    deps.conversations.draftsOf(conversation.id),
    listActions(deps, { conversation: conversation.id }),
    activeGrants(deps, { conversation: conversation.id }),
  ]);
  const messages: ChatMessageView[] = [];
  for (const message of conversation.messages) messages.push(await messageView(deps, conversation.id, message));
  return {
    id: conversation.id,
    title: conversation.title,
    scope: chatScopeView(conversation.scope),
    pinned: conversation.pinned,
    messages,
    drafts: drafts.map(draftView),
    actions: actions.map((record) => actionView(record, now)),
    grants: grants.filter((grant) => grantActive(grant, now).ok).map(grantView),
    ...(runner !== undefined && runner.active(conversation.id) !== undefined ? { activeTurn: runner.active(conversation.id) } : {}),
  };
};

/** The `@` list (A-253): the same fold-search the assistant's docket_search runs, but over the
 *  operator's OWN projects only — no scope, because the operator is the scope. */
export const chatReferencesView = async (
  deps: Pick<AppDeps, 'projects' | 'workOrders' | 'pages'>,
  input: { readonly q: string; readonly kinds?: ReadonlySet<'work_order' | 'page' | 'project' | 'repo'>; readonly project?: ProjectSlug; readonly limit: number },
): Promise<readonly ChatReferenceView[]> => {
  const projects = (await deps.projects.list()).filter((project) => input.project === undefined || project.id === input.project);
  const items: ChatReferenceView[] = [];
  const room = (): boolean => items.length < input.limit;

  if (input.kinds === undefined || input.kinds.has('project')) {
    for (const project of projects) {
      if (room() && matchesSearch(`${project.name} ${project.id}`, input.q)) {
        items.push({ kind: 'project', id: project.id, label: project.name });
      }
    }
  }
  if (input.kinds === undefined || input.kinds.has('repo')) {
    const seen = new Set<RepoSlug>();
    for (const project of projects) {
      for (const repo of project.repos) {
        if (seen.has(repo)) continue;
        seen.add(repo);
        if (room() && matchesSearch(repo, input.q)) items.push({ kind: 'repo', id: repo, label: repo, project: project.id });
      }
    }
  }
  if (input.kinds === undefined || input.kinds.has('work_order')) {
    for (const record of await deps.workOrders.list({})) {
      if (!room()) break;
      if (input.project !== undefined && record.project !== input.project) continue;
      const code = workOrderCodeOf((await deps.workOrders.number(record.id)) ?? 0);
      if (matchesSearch(`${code} ${record.title}`, input.q)) {
        items.push({ kind: 'work_order', id: record.id, label: `${code} ${record.title}`, project: record.project });
      }
    }
  }
  if (input.kinds === undefined || input.kinds.has('page')) {
    for (const page of await deps.pages.list({})) {
      if (!room()) break;
      if (input.project !== undefined && page.project !== input.project) continue;
      if (matchesSearch(page.title, input.q)) {
        items.push({ kind: 'page', id: page.id, label: page.title, ...(page.project === undefined ? {} : { project: page.project }) });
      }
    }
  }
  return items;
};

/** The footer line (A-255): this month's message and token totals over every conversation, and
 *  the account the assistant role's global binding resolves to — a label only, never a secret. */
export const chatUsageView = async (
  deps: Pick<AppDeps, 'clock' | 'conversations' | 'bindings' | 'accounts'>,
  assistantRole: RoleSlug,
  monthStart: EpochMs,
): Promise<ChatUsageView> => {
  let messages = 0;
  let tokens = 0;
  let costMicros = 0;
  let costSeen = false;
  for (const summary of await deps.conversations.list({})) {
    const conversation = await deps.conversations.get(summary.id);
    if (conversation === undefined) continue;
    for (const message of conversation.messages) {
      if (message.at < monthStart) continue;
      messages += 1;
      if (message.usage === undefined) continue;
      tokens += (message.usage.inputTokens ?? 0) + (message.usage.outputTokens ?? 0);
      if (message.usage.costMicros !== undefined) {
        costSeen = true;
        costMicros += message.usage.costMicros;
      }
    }
  }
  // The footer names the account a GLOBAL conversation's turn would ride: no conversation, so no
  // work-order or project layer — the global binding alone.
  const binding = await deps.bindings.get({ level: 'global' }, assistantRole);
  let account: { readonly label: string } | undefined;
  if (binding !== undefined) {
    for (const route of binding.accounts) {
      const record = await deps.accounts.get(route.accountId);
      if (record !== undefined) {
        account = { label: record.label };
        break;
      }
    }
  }
  return {
    month: {
      messages,
      ...(tokens > 0 ? { tokens } : {}),
      ...(costSeen ? { costUsd: costMicros / 1_000_000 } : {}),
    },
    ...(account === undefined ? {} : { account }),
  };
};

/** One stored attachment's bytes (A-254): metadata from the message that owns it, the bytes from
 *  the store, re-encoded as base64 for the data-URL chips. */
export const chatAttachmentView = async (
  deps: Pick<AppDeps, 'conversations' | 'attachmentFiles'>,
  conversation: Conversation,
  attachmentId: string,
): Promise<ChatAttachmentBytesView | undefined> => {
  for (const message of conversation.messages) {
    for (const attachment of message.attachments) {
      if (attachment.id !== attachmentId) continue;
      const bytes = await deps.attachmentFiles.read(conversation.id, attachment.id);
      // The bytes answer only for a record that still owns them; the view never invents content.
      return bytes === undefined ? undefined : { name: attachment.name, type: attachment.kind, base64: encodeBase64(bytes) };
    }
  }
  return undefined;
};

/** The classes a grant may name, as the wire sees them: the domain's closed set, in its order. */
export const CHAT_ACTION_CLASSES: readonly ActionClass[] = ACTION_CLASSES;
