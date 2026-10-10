// Assistant actions and permissions: the pure rules that decide whether something Docket AI wants
// done waits for the operator (tier "Öner") or may be applied under a grant the operator gave for
// this conversation (tier "Uygula"). `ActionClass` is a closed union and the only thing a grant can
// name, so everything outside it — gates, merges, deletes, accounts, spend, permission answers,
// deploys — is not an action at all and can never be proposed, granted or applied.
import {
  err,
  isSlug,
  isUlid,
  ok,
  type ActionId,
  type Actor,
  type ConversationId,
  type DraftId,
  type EpochMs,
  type GrantId,
  type ProjectSlug,
  type ProposalId,
  type RepoSlug,
  type Result,
} from '../shared';

export type ActionClass = 'open_work_order' | 'roadmap_edit' | 'definition_edit' | 'setting_change';
export const ACTION_CLASSES: readonly ActionClass[] = ['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change'];

export type SettingKey = 'dispatch.mode' | 'dispatch.limits';
export const SETTING_KEYS: readonly SettingKey[] = ['dispatch.mode', 'dispatch.limits'];

export type ActionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: ProjectSlug }
  | { readonly kind: 'repo'; readonly repo: RepoSlug };

export type AssistantAction =
  | { readonly kind: 'open_work_order'; readonly draft: DraftId }
  | { readonly kind: 'roadmap_edit'; readonly project: ProjectSlug; readonly proposal: ProposalId }
  | { readonly kind: 'definition_edit'; readonly scope: ActionScope; readonly target: string; readonly proposal: ProposalId }
  | { readonly kind: 'setting_change'; readonly key: SettingKey; readonly value: unknown };

export type ActionStatus = 'pending' | 'applied' | 'rejected' | 'failed' | 'undone';

export interface UndoInfo {
  readonly kind: 'close_work_order' | 'revert_proposal' | 'restore_setting';
  readonly ref: string;
  readonly expiresAt: EpochMs;
}

export type ActionAuthority = { readonly kind: 'user'; readonly id: string } | { readonly kind: 'grant'; readonly grant: GrantId };

export interface ActionRecord {
  readonly id: ActionId;
  readonly conversation: ConversationId;
  readonly action: AssistantAction;
  readonly status: ActionStatus;
  readonly proposedAt: EpochMs;
  readonly decidedAt?: EpochMs;
  readonly decidedBy?: ActionAuthority;
  /** A stable code, never content. */
  readonly failure?: string;
  readonly undo?: UndoInfo;
}

export interface Grant {
  readonly id: GrantId;
  readonly conversation: ConversationId;
  readonly by: { readonly kind: 'user'; readonly id: string };
  readonly classes: readonly ActionClass[];
  readonly grantedAt: EpochMs;
  readonly expiresAt: EpochMs;
  readonly revokedAt?: EpochMs;
  readonly applied: number;
}

export type ActionError = {
  readonly code:
    | 'bad_action'
    | 'bad_class'
    | 'bad_setting_key'
    | 'value_too_large'
    | 'grant_not_user'
    | 'grant_empty'
    | 'grant_too_long'
    | 'grant_expired'
    | 'grant_revoked'
    | 'not_found'
    | 'not_pending'
    | 'not_applied'
    | 'undo_expired'
    | 'rate_limited'
    | 'not_user'
    | 'not_assistant';
};

export const ACTION_LIMITS = { grantMaxMs: 3_600_000, grantMaxApplications: 25, actionsPerConversationMax: 500, valueMaxBytes: 4_096 } as const;

export type ActionDecision =
  | { readonly kind: 'needs_approval' }
  | { readonly kind: 'apply'; readonly grant: GrantId }
  | { readonly kind: 'refused'; readonly error: ActionError };

const failure = (code: ActionError['code']): Result<never, ActionError> => err({ code });

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Only own properties count: an inherited `kind` is not input. */
const field = (o: object, key: string): unknown => (own(o, key) ? (o as Record<string, unknown>)[key] : undefined);

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null && !Array.isArray(value);

const isClass = (value: unknown): value is ActionClass => typeof value === 'string' && (ACTION_CLASSES as readonly string[]).includes(value);

const isSettingKey = (value: unknown): value is SettingKey => typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value);

const hasControlCharacter = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const ulidField = <T extends string>(o: object, key: string): T | undefined => {
  const value = field(o, key);
  return typeof value === 'string' && isUlid(value) ? (value as T) : undefined;
};

const slugField = <T extends string>(o: object, key: string): T | undefined => {
  const value = field(o, key);
  return typeof value === 'string' && isSlug(value) ? (value as T) : undefined;
};

/** Rebuilds a scope from its known fields, so a `global` scope never carries a project. */
const validateScope = (value: unknown): ActionScope | undefined => {
  if (!isObject(value)) return undefined;
  const kind = field(value, 'kind');
  if (kind === 'global') return { kind: 'global' };
  if (kind === 'project') {
    const project = slugField<ProjectSlug>(value, 'project');
    return project === undefined ? undefined : { kind: 'project', project };
  }
  if (kind === 'repo') {
    const repo = slugField<RepoSlug>(value, 'repo');
    return repo === undefined ? undefined : { kind: 'repo', repo };
  }
  return undefined;
};

const DEFINITION_FOLDERS: readonly string[] = ['roles', 'flows', 'capabilities'];
const DEFINITION_EXTENSION = '.yaml';

/** The definition store's own vocabulary and nothing wider: `<folder>/<slug>.yaml`, plus
 *  `project.yaml` in a project scope and `repo.yaml` in a repo scope. `roadmap.yaml` is absent on
 *  purpose — roadmap edits are their own class — and since every accepted shape is spelled out,
 *  traversal, absolute paths, separators, escapes and look-alike characters cannot match. */
const isDefinitionTarget = (scope: ActionScope, target: string): boolean => {
  if (target === 'project.yaml') return scope.kind === 'project';
  if (target === 'repo.yaml') return scope.kind === 'repo';
  const parts = target.split('/');
  if (parts.length !== 2) return false;
  const [folder, fileName] = parts;
  if (folder === undefined || fileName === undefined) return false;
  if (!DEFINITION_FOLDERS.includes(folder) || !fileName.endsWith(DEFINITION_EXTENSION)) return false;
  return isSlug(fileName.slice(0, -DEFINITION_EXTENSION.length));
};

const VALUE_MAX_DEPTH = 16;
const VALUE_MAX_NODES = 2_000;

type ValueCheck = 'ok' | 'invalid' | 'too_large';

/** Plain JSON only: strings, finite numbers, booleans, null, arrays and plain objects whose every
 *  member is again such a value. Depth and node count are bounded so a cyclic or heavily shared
 *  structure is refused instead of walked. */
const checkValue = (value: unknown, depth: number, budget: { nodes: number }): ValueCheck => {
  budget.nodes += 1;
  if (budget.nodes > VALUE_MAX_NODES) return 'too_large';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return 'ok';
  if (typeof value === 'number') return Number.isFinite(value) ? 'ok' : 'invalid';
  if (typeof value !== 'object') return 'invalid';
  if (depth >= VALUE_MAX_DEPTH) return 'invalid';
  if (Array.isArray(value)) {
    for (const item of value as readonly unknown[]) {
      const checked = checkValue(item, depth + 1, budget);
      if (checked !== 'ok') return checked;
    }
    return 'ok';
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return 'invalid';
  for (const key of Object.keys(value)) {
    const checked = checkValue((value as Record<string, unknown>)[key], depth + 1, budget);
    if (checked !== 'ok') return checked;
  }
  return 'ok';
};

const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

export function classOf(a: AssistantAction): ActionClass {
  return a.kind;
}

export function validateAction(input: unknown): Result<AssistantAction, ActionError> {
  if (!isObject(input)) return failure('bad_action');
  const kind = field(input, 'kind');
  if (kind === 'open_work_order') {
    const draft = ulidField<DraftId>(input, 'draft');
    return draft === undefined ? failure('bad_action') : ok({ kind, draft });
  }
  if (kind === 'roadmap_edit') {
    const project = slugField<ProjectSlug>(input, 'project');
    const proposal = ulidField<ProposalId>(input, 'proposal');
    return project === undefined || proposal === undefined ? failure('bad_action') : ok({ kind, project, proposal });
  }
  if (kind === 'definition_edit') {
    const scope = validateScope(field(input, 'scope'));
    const target = field(input, 'target');
    const proposal = ulidField<ProposalId>(input, 'proposal');
    if (scope === undefined || proposal === undefined || typeof target !== 'string' || !isDefinitionTarget(scope, target)) return failure('bad_action');
    return ok({ kind, scope, target, proposal });
  }
  if (kind === 'setting_change') {
    const key = field(input, 'key');
    if (!isSettingKey(key)) return failure('bad_setting_key');
    if (!own(input, 'value')) return failure('bad_action');
    const value = field(input, 'value');
    const checked = checkValue(value, 0, { nodes: 0 });
    if (checked === 'invalid') return failure('bad_action');
    if (checked === 'too_large' || utf8Length(JSON.stringify(value)) > ACTION_LIMITS.valueMaxBytes) return failure('value_too_large');
    return ok({ kind, key, value });
  }
  return failure('bad_action');
}

export function newGrant(
  input: { readonly conversation: ConversationId; readonly by: Actor; readonly classes: readonly ActionClass[]; readonly ms: number },
  now: EpochMs,
  id: GrantId,
): Result<Grant, ActionError> {
  if (input.by.kind !== 'user') return failure('grant_not_user');
  if (!Array.isArray(input.classes)) return failure('bad_class');
  if (input.classes.length === 0) return failure('grant_empty');
  const classes: ActionClass[] = [];
  for (const candidate of input.classes as readonly unknown[]) {
    if (!isClass(candidate)) return failure('bad_class');
    if (!classes.includes(candidate)) classes.push(candidate);
  }
  const ms: unknown = input.ms;
  if (typeof ms !== 'number' || Number.isNaN(ms)) return failure('grant_expired');
  // Refused, never clamped: a longer grant is not the grant the operator asked for.
  if (ms > ACTION_LIMITS.grantMaxMs) return failure('grant_too_long');
  if (!Number.isInteger(ms) || ms < 1) return failure('grant_expired');
  return ok({ id, conversation: input.conversation, by: { kind: 'user', id: input.by.id }, classes, grantedAt: now, expiresAt: now + ms, applied: 0 });
}

export function grantActive(g: Grant, now: EpochMs): Result<void, ActionError> {
  if (g.revokedAt !== undefined) return failure('grant_revoked');
  if (now >= g.expiresAt) return failure('grant_expired');
  return ok(undefined);
}

export function revokeGrant(g: Grant, now: EpochMs): Grant {
  return g.revokedAt === undefined ? { ...g, revokedAt: now } : g;
}

const usable = (g: Grant, conversation: ConversationId, cls: ActionClass, now: EpochMs): boolean =>
  g.conversation === conversation &&
  g.by.kind === 'user' &&
  g.classes.includes(cls) &&
  grantActive(g, now).ok &&
  Number.isInteger(g.applied) &&
  g.applied >= 0 &&
  g.applied < ACTION_LIMITS.grantMaxApplications;

export function decideAction(a: AssistantAction, grants: readonly Grant[], conversation: ConversationId, now: EpochMs): ActionDecision {
  const valid = validateAction(a);
  if (!valid.ok) return { kind: 'refused', error: valid.error };
  const cls = classOf(valid.value);
  const covering = grants.find((g) => usable(g, conversation, cls, now));
  return covering === undefined ? { kind: 'needs_approval' } : { kind: 'apply', grant: covering.id };
}

export function recordApplied(g: Grant): Grant {
  return { ...g, applied: g.applied + 1 };
}

export function newActionRecord(input: { readonly id: ActionId; readonly conversation: ConversationId; readonly action: AssistantAction }, now: EpochMs): ActionRecord {
  return { id: input.id, conversation: input.conversation, action: input.action, status: 'pending', proposedAt: now };
}

const UNDO_KINDS: readonly string[] = ['close_work_order', 'revert_proposal', 'restore_setting'];
const UNDO_REF_MAX = 200;
const FAILURE_CODE = /^[a-z_]{1,64}$/;

const checkedUndo = (undo: UndoInfo): UndoInfo | undefined => {
  if (!isObject(undo)) return undefined;
  const { kind, ref, expiresAt } = undo as { kind: unknown; ref: unknown; expiresAt: unknown };
  if (typeof kind !== 'string' || !UNDO_KINDS.includes(kind)) return undefined;
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > UNDO_REF_MAX || hasControlCharacter(ref)) return undefined;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return undefined;
  return { kind: kind as UndoInfo['kind'], ref, expiresAt };
};

const checkedAuthority = (by: ActionAuthority | undefined): ActionAuthority | undefined => {
  if (by === undefined || !isObject(by)) return undefined;
  if (by.kind === 'user') return typeof by.id === 'string' && by.id.length > 0 ? { kind: 'user', id: by.id } : undefined;
  if (by.kind === 'grant') return typeof by.grant === 'string' && isUlid(by.grant) ? { kind: 'grant', grant: by.grant } : undefined;
  return undefined;
};

export function markApplied(r: ActionRecord, by: ActionAuthority | undefined, undo: UndoInfo | undefined, now: EpochMs): Result<ActionRecord, ActionError> {
  if (r.status !== 'pending') return failure('not_pending');
  const authority = checkedAuthority(by);
  if (authority === undefined) return failure('bad_action');
  const carried = undo === undefined ? undefined : checkedUndo(undo);
  if (undo !== undefined && carried === undefined) return failure('bad_action');
  return ok({ ...r, status: 'applied', decidedAt: now, decidedBy: authority, ...(carried === undefined ? {} : { undo: carried }) });
}

export function markRejected(r: ActionRecord, by: { readonly kind: 'user'; readonly id: string }, now: EpochMs): Result<ActionRecord, ActionError> {
  if (r.status !== 'pending') return failure('not_pending');
  if (!isObject(by) || by.kind !== 'user' || typeof by.id !== 'string' || by.id.length === 0) return failure('not_user');
  return ok({ ...r, status: 'rejected', decidedAt: now, decidedBy: { kind: 'user', id: by.id } });
}

export function markFailed(r: ActionRecord, code: string, now: EpochMs): Result<ActionRecord, ActionError> {
  if (r.status !== 'pending') return failure('not_pending');
  if (typeof code !== 'string' || !FAILURE_CODE.test(code)) return failure('bad_action');
  return ok({ ...r, status: 'failed', decidedAt: now, failure: code });
}

export function markUndone(r: ActionRecord, now: EpochMs): Result<ActionRecord, ActionError> {
  if (r.status !== 'applied') return failure('not_applied');
  if (r.undo === undefined || now >= r.undo.expiresAt) return failure('undo_expired');
  return ok({ ...r, status: 'undone' });
}

