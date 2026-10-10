// Rules R-95 … R-102 of docs/v2/domain.md: the actions module.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type ActionId,
  type Actor,
  type ConversationId,
  type DraftId,
  type GrantId,
  type ProjectSlug,
  type ProposalId,
  type RunId,
  type RoleSlug,
  type Ulid,
} from '../shared';

import {
  ACTION_CLASSES,
  ACTION_LIMITS,
  SETTING_KEYS,
  classOf,
  decideAction,
  grantActive,
  markApplied,
  markFailed,
  markRejected,
  markUndone,
  newActionRecord,
  newGrant,
  recordApplied,
  revokeGrant,
  validateAction,
  type ActionClass,
  type ActionRecord,
  type AssistantAction,
  type Grant,
  type UndoInfo,
} from './index';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const slug = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const CONV_A: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const CONV_B: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const DRAFT: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROPOSAL: ProposalId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const GRANT_1: GrantId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FG1');
const GRANT_2: GrantId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FG2');
const ACTION_ID: ActionId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const PROJECT: ProjectSlug = slug('mobile');
const NOW = 1_000_000;
const HOUR = ACTION_LIMITS.grantMaxMs;

const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR1') as RunId, role: slug<'role'>('planner') as RoleSlug };
const SYSTEM: Actor = { kind: 'system', component: 'runner' };

const openWorkOrder: AssistantAction = { kind: 'open_work_order', draft: DRAFT };
const roadmapEdit: AssistantAction = { kind: 'roadmap_edit', project: PROJECT, proposal: PROPOSAL };
const definitionEdit: AssistantAction = { kind: 'definition_edit', scope: { kind: 'project', project: PROJECT }, target: 'flows/main.yaml', proposal: PROPOSAL };
const settingChange: AssistantAction = { kind: 'setting_change', key: 'dispatch.mode', value: 'auto' };

const grantOf = (over: Partial<Grant> = {}): Grant => ({
  id: GRANT_1,
  conversation: CONV_A,
  by: { kind: 'user', id: 'u1' },
  classes: ['open_work_order', 'roadmap_edit'],
  grantedAt: NOW,
  expiresAt: NOW + 30 * 60_000,
  applied: 0,
  ...over,
});

const pending = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: ACTION_ID,
  conversation: CONV_A,
  action: openWorkOrder,
  status: 'pending',
  proposedAt: NOW,
  ...over,
});

const UNDO: UndoInfo = { kind: 'close_work_order', ref: '01ARZ3NDEKTSV4RRFFQ69G5FW1', expiresAt: NOW + 10 * 60_000 };
const code = (r: { readonly ok: boolean; readonly error?: { readonly code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

describe('actions: validation (R-95, R-96, R-97)', () => {
  it('R-95: the action classes are exactly the four closed classes and classOf names each action', () => {
    expect([...ACTION_CLASSES]).toEqual(['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change']);
    expect([openWorkOrder, roadmapEdit, definitionEdit, settingChange].map(classOf)).toEqual(ACTION_CLASSES);
  });

  it('R-95: a valid action of each kind is accepted and rebuilt from its known fields only', () => {
    for (const action of [openWorkOrder, roadmapEdit, definitionEdit, settingChange]) {
      const result = validateAction({ ...action, extra: 'smuggled' });
      expect(result).toEqual({ ok: true, value: action });
    }
  });

  it('R-95: a hostile kind outside the closed classes is bad_action (the never-list)', () => {
    for (const kind of [
      'gate_decide',
      'merge',
      'delete_work_order',
      'account_save',
      'spend_consent',
      'permission_answer',
      'deploy_approve',
      'run_command',
      'delete_conversation',
      'grant_permission',
      'constructor',
      '__proto__',
      'toString',
      '',
      'OPEN_WORK_ORDER',
    ]) {
      expect(code(validateAction({ kind, draft: DRAFT }))).toBe('bad_action');
    }
  });

  it('R-95: a non-object, null, array or missing kind is bad_action', () => {
    for (const value of [undefined, null, 'open_work_order', 7, [], [openWorkOrder], {}, { draft: DRAFT }, { kind: 5 }, { kind: null }]) {
      expect(code(validateAction(value))).toBe('bad_action');
    }
  });

  it('R-95: an inherited kind is not input', () => {
    const inherited = Object.create({ kind: 'open_work_order', draft: DRAFT }) as unknown;
    expect(code(validateAction(inherited))).toBe('bad_action');
  });

  it('R-95: ids and slugs must be well formed (draft, proposal, project, repo scope)', () => {
    expect(code(validateAction({ kind: 'open_work_order', draft: 'not-a-ulid' }))).toBe('bad_action');
    expect(code(validateAction({ kind: 'open_work_order', draft: DRAFT.toLowerCase() }))).toBe('bad_action');
    expect(code(validateAction({ kind: 'open_work_order' }))).toBe('bad_action');
    expect(code(validateAction({ kind: 'roadmap_edit', project: 'Not A Slug', proposal: PROPOSAL }))).toBe('bad_action');
    expect(code(validateAction({ kind: 'roadmap_edit', project: PROJECT, proposal: 'x' }))).toBe('bad_action');
    expect(code(validateAction({ kind: 'roadmap_edit', project: PROJECT }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'project', project: '../x' } }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'repo', repo: 'UP' }, target: 'repo.yaml' }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'organisation' } }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: undefined }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, proposal: 12 }))).toBe('bad_action');
  });

  it('R-95: a global scope carries no project and a repo scope is rebuilt from its own fields', () => {
    const global = validateAction({ ...definitionEdit, scope: { kind: 'global', project: PROJECT }, target: 'roles/dev.yaml' });
    expect(global).toEqual({ ok: true, value: { ...definitionEdit, scope: { kind: 'global' }, target: 'roles/dev.yaml' } });
    const repo = validateAction({ ...definitionEdit, scope: { kind: 'repo', repo: 'app' }, target: 'repo.yaml' });
    expect(repo).toEqual({ ok: true, value: { ...definitionEdit, scope: { kind: 'repo', repo: 'app' }, target: 'repo.yaml' } });
  });

  it('R-95: validateAction never mutates its input', () => {
    const input = { kind: 'definition_edit', scope: { kind: 'project', project: PROJECT }, target: 'flows/main.yaml', proposal: PROPOSAL, extra: 1 };
    const snapshot = JSON.stringify(input);
    validateAction(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('R-96: a definition_edit target is a definition file of the store vocabulary', () => {
    for (const target of ['roles/dev.yaml', 'flows/main.yaml', 'capabilities/lint.yaml', 'roles/a.yaml', 'flows/' + 'a'.repeat(63) + '.yaml']) {
      expect(validateAction({ ...definitionEdit, scope: { kind: 'global' }, target }).ok).toBe(true);
    }
    expect(validateAction({ ...definitionEdit, target: 'project.yaml' }).ok).toBe(true);
    expect(validateAction({ ...definitionEdit, scope: { kind: 'repo', repo: 'app' }, target: 'repo.yaml' }).ok).toBe(true);
  });

  it('R-96: traversal, absolute, backslash, percent, format characters and other shapes are bad_action', () => {
    for (const target of [
      '../roles/dev.yaml',
      'roles/../flows/main.yaml',
      '/etc/passwd',
      '/roles/dev.yaml',
      'roles\\dev.yaml',
      'roles/dev%2eyaml',
      'roles/%2e%2e/x.yaml',
      'roles/dev.yaml\u202e',
      'roles/\u200bdev.yaml',
      'roles/dev.yaml\u0000',
      'roles/dev\n.yaml',
      'roles/dev.yml',
      'roles/Dev.yaml',
      'roles/dev.yaml/',
      'roles//dev.yaml',
      'roles/a/b.yaml',
      'roles/.yaml',
      'secrets/x.yaml',
      'C:/x.yaml',
      '~/roles/dev.yaml',
      './roles/dev.yaml',
      'roles/ｄev.yaml',
      '',
      ' ',
      'flows/' + 'a'.repeat(64) + '.yaml',
    ]) {
      expect(code(validateAction({ ...definitionEdit, scope: { kind: 'global' }, target }))).toBe('bad_action');
    }
    expect(code(validateAction({ ...definitionEdit, target: 5 }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, target: undefined }))).toBe('bad_action');
  });

  it('R-96: roadmap.yaml is never a definition target, in any scope, and a roadmap_edit never carries a target', () => {
    for (const scope of [{ kind: 'global' }, { kind: 'project', project: PROJECT }, { kind: 'repo', repo: 'app' }]) {
      expect(code(validateAction({ ...definitionEdit, scope, target: 'roadmap.yaml' }))).toBe('bad_action');
      expect(code(validateAction({ ...definitionEdit, scope, target: '.docket/roadmap.yaml' }))).toBe('bad_action');
    }
    expect(validateAction({ ...roadmapEdit, target: 'flows/main.yaml' })).toEqual({ ok: true, value: roadmapEdit });
    const rebuilt = validateAction({ ...roadmapEdit, target: 'flows/main.yaml', scope: { kind: 'global' } });
    expect(rebuilt.ok && 'target' in rebuilt.value).toBe(false);
  });

  it('R-96: project.yaml needs a project scope and repo.yaml a repo scope', () => {
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'global' }, target: 'project.yaml' }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'repo', repo: 'app' }, target: 'project.yaml' }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'global' }, target: 'repo.yaml' }))).toBe('bad_action');
    expect(code(validateAction({ ...definitionEdit, scope: { kind: 'project', project: PROJECT }, target: 'repo.yaml' }))).toBe('bad_action');
  });

  it('R-97: a setting_change names an allowlisted key and anything else is bad_setting_key', () => {
    expect([...SETTING_KEYS]).toEqual(['dispatch.mode', 'dispatch.limits']);
    expect(validateAction({ kind: 'setting_change', key: 'dispatch.limits', value: { perAccount: 2 } }).ok).toBe(true);
    for (const key of ['account.token', 'secrets', 'dispatch', 'dispatch.mode ', 'DISPATCH.MODE', '', 'constructor', '__proto__', 'budget.cap']) {
      expect(code(validateAction({ kind: 'setting_change', key, value: 1 }))).toBe('bad_setting_key');
    }
    expect(code(validateAction({ kind: 'setting_change', key: 7, value: 1 }))).toBe('bad_setting_key');
    expect(code(validateAction({ kind: 'setting_change', value: 1 }))).toBe('bad_setting_key');
  });

  it('R-97: a value is required, JSON-serialisable and at most 4 KiB serialised', () => {
    const ok = (value: unknown): boolean => validateAction({ kind: 'setting_change', key: 'dispatch.limits', value }).ok;
    for (const value of [null, 0, -1.5, true, 'x', [], {}, { a: [1, { b: null }] }]) expect(ok(value)).toBe(true);
    expect(code(validateAction({ kind: 'setting_change', key: 'dispatch.mode' }))).toBe('bad_action');
    for (const value of [undefined, () => 1, Symbol('s'), 10n, Number.NaN, Infinity, new Date(0), new Map(), { a: undefined }, [undefined], { f() {} }]) {
      expect(code(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value }))).toBe('bad_action');
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(code(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value: cyclic }))).toBe('bad_action');
  });

  it('R-97: the size limit is in UTF-8 bytes of the serialised value and 4 096 is allowed, 4 097 is not', () => {
    const sized = (bytes: number): string => 'a'.repeat(bytes - 2); // two quotes
    expect(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value: sized(ACTION_LIMITS.valueMaxBytes) }).ok).toBe(true);
    expect(code(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value: sized(ACTION_LIMITS.valueMaxBytes + 1) }))).toBe('value_too_large');
    // 1 400 three-byte characters are 4 200 bytes though only 1 400 characters long.
    expect(code(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value: '€'.repeat(1_400) }))).toBe('value_too_large');
    // A deep structure is refused rather than recursed into forever.
    let deep: unknown = 1;
    for (let i = 0; i < 200; i += 1) deep = [deep];
    expect(validateAction({ kind: 'setting_change', key: 'dispatch.mode', value: deep }).ok).toBe(false);
  });
});

describe('actions: grants (R-98, R-99)', () => {
  it('R-98: a grant is created only by a user actor — agent and system are grant_not_user', () => {
    expect(code(newGrant({ conversation: CONV_A, by: AGENT, classes: ['open_work_order'], ms: 60_000 }, NOW, GRANT_1))).toBe('grant_not_user');
    expect(code(newGrant({ conversation: CONV_A, by: SYSTEM, classes: ['open_work_order'], ms: 60_000 }, NOW, GRANT_1))).toBe('grant_not_user');
    const made = newGrant({ conversation: CONV_A, by: USER, classes: ['open_work_order'], ms: 60_000 }, NOW, GRANT_1);
    expect(made).toEqual({
      ok: true,
      value: { id: GRANT_1, conversation: CONV_A, by: { kind: 'user', id: 'u1' }, classes: ['open_work_order'], grantedAt: NOW, expiresAt: NOW + 60_000, applied: 0 },
    });
  });

  it('R-98: classes are non-empty (grant_empty), all known (bad_class) and deduplicated in first-seen order', () => {
    expect(code(newGrant({ conversation: CONV_A, by: USER, classes: [], ms: 1_000 }, NOW, GRANT_1))).toBe('grant_empty');
    for (const hostile of ['gate_decide', 'merge', 'delete_work_order', 'account_save', 'spend_consent', 'permission_answer', 'deploy_approve', 'all', '*', '', 'constructor']) {
      expect(code(newGrant({ conversation: CONV_A, by: USER, classes: ['open_work_order', hostile as ActionClass], ms: 1_000 }, NOW, GRANT_1))).toBe('bad_class');
    }
    const deduped = newGrant({ conversation: CONV_A, by: USER, classes: ['roadmap_edit', 'open_work_order', 'roadmap_edit'], ms: 1_000 }, NOW, GRANT_1);
    expect(deduped.ok && deduped.value.classes).toEqual(['roadmap_edit', 'open_work_order']);
  });

  it('R-98: the duration is 1 ms … one hour; longer is grant_too_long and is never clamped', () => {
    const at = (ms: number) => newGrant({ conversation: CONV_A, by: USER, classes: ['setting_change'], ms }, NOW, GRANT_1);
    const full = at(HOUR);
    expect(full.ok && full.value.expiresAt).toBe(NOW + HOUR);
    expect(code(at(HOUR + 1))).toBe('grant_too_long');
    expect(code(at(61 * 60_000))).toBe('grant_too_long');
    expect(code(at(Number.MAX_SAFE_INTEGER))).toBe('grant_too_long');
    expect(code(at(Infinity))).toBe('grant_too_long');
    expect(at(1).ok).toBe(true);
  });

  it('R-98: a zero, negative, fractional or non-numeric duration is grant_expired (the grant would never be active)', () => {
    for (const ms of [0, -1, -HOUR, 0.5, 1.5, Number.NaN, '60000' as unknown as number, undefined as unknown as number]) {
      expect(code(newGrant({ conversation: CONV_A, by: USER, classes: ['setting_change'], ms }, NOW, GRANT_1))).toBe('grant_expired');
    }
  });

  it('R-98: a grant is bound to its conversation and a malformed class list is refused, not coerced', () => {
    const made = newGrant({ conversation: CONV_B, by: USER, classes: ['open_work_order'], ms: 1_000 }, NOW, GRANT_1);
    expect(made.ok && made.value.conversation).toBe(CONV_B);
    expect(code(newGrant({ conversation: CONV_A, by: USER, classes: 'open_work_order' as unknown as ActionClass[], ms: 1_000 }, NOW, GRANT_1))).toBe('bad_class');
    expect(code(newGrant({ conversation: CONV_A, by: USER, classes: [7 as unknown as ActionClass], ms: 1_000 }, NOW, GRANT_1))).toBe('bad_class');
  });

  it('R-99: grantActive is revoked → grant_revoked, then expired (now ≥ expiresAt) → grant_expired, else ok', () => {
    const g = grantOf();
    expect(grantActive(g, NOW)).toEqual({ ok: true, value: undefined });
    expect(grantActive(g, g.expiresAt - 1).ok).toBe(true);
    expect(code(grantActive(g, g.expiresAt))).toBe('grant_expired');
    expect(code(grantActive(g, g.expiresAt + 1))).toBe('grant_expired');
    expect(code(grantActive(grantOf({ revokedAt: NOW + 1 }), NOW))).toBe('grant_revoked');
    expect(code(grantActive(grantOf({ revokedAt: NOW + 1 }), g.expiresAt + 5))).toBe('grant_revoked');
  });

  it('R-99: revokeGrant stamps revokedAt, is idempotent (the first time stays) and never mutates its input', () => {
    const g = grantOf();
    const revoked = revokeGrant(g, NOW + 5);
    expect(revoked.revokedAt).toBe(NOW + 5);
    expect(g.revokedAt).toBeUndefined();
    expect(revokeGrant(revoked, NOW + 99)).toEqual(revoked);
    expect(code(grantActive(revoked, NOW + 6))).toBe('grant_revoked');
  });

  it('R-99: recordApplied adds one application, never mutates its input and never touches anything else', () => {
    const g = grantOf({ applied: 3 });
    const next = recordApplied(g);
    expect(next).toEqual({ ...g, applied: 4 });
    expect(g.applied).toBe(3);
  });
});

describe('actions: decideAction truth table (R-100)', () => {
  const decide = (action: AssistantAction, grants: readonly Grant[], conversation: ConversationId = CONV_A, now = NOW) =>
    decideAction(action, grants, conversation, now);

  it('R-100: no grant → needs_approval', () => {
    expect(decide(openWorkOrder, [])).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: a valid grant covering the class → apply with that grant', () => {
    expect(decide(openWorkOrder, [grantOf()])).toEqual({ kind: 'apply', grant: GRANT_1 });
    expect(decide(roadmapEdit, [grantOf()])).toEqual({ kind: 'apply', grant: GRANT_1 });
  });

  it('R-100: a grant covering open_work_order never covers a definition_edit or a setting_change', () => {
    const g = grantOf({ classes: ['open_work_order'] });
    expect(decide(definitionEdit, [g])).toEqual({ kind: 'needs_approval' });
    expect(decide(settingChange, [g])).toEqual({ kind: 'needs_approval' });
    expect(decide(roadmapEdit, [g])).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: a grant of conversation A never covers conversation B', () => {
    expect(decide(openWorkOrder, [grantOf()], CONV_B)).toEqual({ kind: 'needs_approval' });
    expect(decide(openWorkOrder, [grantOf({ conversation: CONV_B })], CONV_A)).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: an expired grant (at the boundary too) and a revoked grant → needs_approval', () => {
    const g = grantOf();
    expect(decide(openWorkOrder, [g], CONV_A, g.expiresAt - 1)).toEqual({ kind: 'apply', grant: GRANT_1 });
    expect(decide(openWorkOrder, [g], CONV_A, g.expiresAt)).toEqual({ kind: 'needs_approval' });
    expect(decide(openWorkOrder, [g], CONV_A, g.expiresAt + 1)).toEqual({ kind: 'needs_approval' });
    expect(decide(openWorkOrder, [grantOf({ revokedAt: NOW })])).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: an exhausted grant (25 applications) → needs_approval; the 25th application is the last', () => {
    expect(ACTION_LIMITS.grantMaxApplications).toBe(25);
    expect(decide(openWorkOrder, [grantOf({ applied: 24 })])).toEqual({ kind: 'apply', grant: GRANT_1 });
    expect(decide(openWorkOrder, [grantOf({ applied: 25 })])).toEqual({ kind: 'needs_approval' });
    expect(decide(openWorkOrder, [grantOf({ applied: 26 })])).toEqual({ kind: 'needs_approval' });
    expect(decide(openWorkOrder, [grantOf({ applied: -1 })]).kind).toBe('needs_approval');
    expect(decide(openWorkOrder, [grantOf({ applied: Number.NaN })]).kind).toBe('needs_approval');
  });

  it('R-100: the first usable grant wins and unusable ones before it are skipped', () => {
    const dead = grantOf({ id: GRANT_1, revokedAt: NOW });
    const live = grantOf({ id: GRANT_2 });
    expect(decide(openWorkOrder, [dead, live])).toEqual({ kind: 'apply', grant: GRANT_2 });
    expect(decide(openWorkOrder, [live, dead])).toEqual({ kind: 'apply', grant: GRANT_2 });
    const exhausted = grantOf({ id: GRANT_1, applied: 25 });
    expect(decide(openWorkOrder, [exhausted, live])).toEqual({ kind: 'apply', grant: GRANT_2 });
  });

  it('R-100: a grant not made by a user never applies, even when it looks valid', () => {
    const forged = { ...grantOf(), by: { kind: 'agent', id: 'x' } } as unknown as Grant;
    expect(decide(openWorkOrder, [forged])).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: an invalid action is refused with its own error, whatever the grants say', () => {
    const hostile = { kind: 'merge' } as unknown as AssistantAction;
    expect(decide(hostile, [grantOf()])).toEqual({ kind: 'refused', error: { code: 'bad_action' } });
    const badKey = { kind: 'setting_change', key: 'account.token', value: 1 } as unknown as AssistantAction;
    expect(decide(badKey, [grantOf({ classes: ACTION_CLASSES })])).toEqual({ kind: 'refused', error: { code: 'bad_setting_key' } });
    const roadmapTarget = { ...definitionEdit, target: 'roadmap.yaml' };
    expect(decide(roadmapTarget, [grantOf({ classes: ACTION_CLASSES })]).kind).toBe('refused');
  });

  it('R-100: a grant that names a class outside the closed list gives no cover for anything', () => {
    const forged = grantOf({ classes: ['merge' as ActionClass] });
    for (const action of [openWorkOrder, roadmapEdit, definitionEdit, settingChange]) expect(decide(action, [forged])).toEqual({ kind: 'needs_approval' });
  });

  it('R-100: decideAction never mutates the grants it reads', () => {
    const grants = [grantOf()];
    const snapshot = JSON.stringify(grants);
    decide(openWorkOrder, grants);
    expect(JSON.stringify(grants)).toBe(snapshot);
  });
});

describe('actions: record state machine and undo (R-101, R-102)', () => {
  it('R-101: a new record is pending with no decision, failure or undo', () => {
    expect(newActionRecord({ id: ACTION_ID, conversation: CONV_A, action: openWorkOrder }, NOW)).toEqual({
      id: ACTION_ID,
      conversation: CONV_A,
      action: openWorkOrder,
      status: 'pending',
      proposedAt: NOW,
    });
  });

  it('R-101: pending → applied by a user or by a grant, stamping the time, the authority and the undo', () => {
    const byUser = markApplied(pending(), { kind: 'user', id: 'u1' }, UNDO, NOW + 5);
    expect(byUser).toEqual({ ok: true, value: pending({ status: 'applied', decidedAt: NOW + 5, decidedBy: { kind: 'user', id: 'u1' }, undo: UNDO }) });
    const byGrant = markApplied(pending(), { kind: 'grant', grant: GRANT_1 }, undefined, NOW + 5);
    expect(byGrant).toEqual({ ok: true, value: pending({ status: 'applied', decidedAt: NOW + 5, decidedBy: { kind: 'grant', grant: GRANT_1 } }) });
  });

  it('R-101: markApplied refuses a missing or malformed authority and never invents one', () => {
    expect(code(markApplied(pending(), undefined, undefined, NOW))).toBe('bad_action');
    expect(code(markApplied(pending(), { kind: 'agent' } as never, undefined, NOW))).toBe('bad_action');
    expect(code(markApplied(pending(), { kind: 'user', id: '' }, undefined, NOW))).toBe('bad_action');
    expect(code(markApplied(pending(), { kind: 'grant', grant: 'x' as GrantId }, undefined, NOW))).toBe('bad_action');
  });

  it('R-101: carried undo info is validated — ref at most 200 characters without control characters, known kind, finite expiry', () => {
    const apply = (undo: UndoInfo) => markApplied(pending(), { kind: 'user', id: 'u1' }, undo, NOW);
    expect(apply({ ...UNDO, ref: 'r'.repeat(200) }).ok).toBe(true);
    expect(code(apply({ ...UNDO, ref: 'r'.repeat(201) }))).toBe('bad_action');
    expect(code(apply({ ...UNDO, ref: '' }))).toBe('bad_action');
    expect(code(apply({ ...UNDO, ref: 'a\nb' }))).toBe('bad_action');
    expect(code(apply({ ...UNDO, ref: 'a\u0000b' }))).toBe('bad_action');
    expect(code(apply({ ...UNDO, kind: 'delete_everything' as UndoInfo['kind'] }))).toBe('bad_action');
    expect(code(apply({ ...UNDO, expiresAt: Number.NaN }))).toBe('bad_action');
    const smuggled = apply({ ...UNDO, extra: 'x' } as UndoInfo);
    expect(smuggled.ok && smuggled.value.undo).toEqual(UNDO);
  });

  it('R-101: pending → rejected is user only; a grant or agent cannot reject', () => {
    expect(markRejected(pending(), { kind: 'user', id: 'u1' }, NOW + 2)).toEqual({
      ok: true,
      value: pending({ status: 'rejected', decidedAt: NOW + 2, decidedBy: { kind: 'user', id: 'u1' } }),
    });
    expect(code(markRejected(pending(), { kind: 'grant', grant: GRANT_1 } as never, NOW))).toBe('not_user');
    expect(code(markRejected(pending(), { kind: 'agent' } as never, NOW))).toBe('not_user');
  });

  it('R-101: pending → failed with a stable code (at most 64 characters of [a-z_]); the record keeps no content', () => {
    expect(markFailed(pending(), 'stale_proposal', NOW + 3)).toEqual({ ok: true, value: pending({ status: 'failed', decidedAt: NOW + 3, failure: 'stale_proposal' }) });
    expect(markFailed(pending(), 'a'.repeat(64), NOW).ok).toBe(true);
    for (const bad of ['', 'a'.repeat(65), 'Has Capitals', 'with-dash', 'digits1', 'ünï', 'line\nbreak', 'path/to/file', 'a b']) {
      expect(code(markFailed(pending(), bad, NOW))).toBe('bad_action');
    }
  });

  it('R-101: only pending records can be applied, rejected or failed — every other status is not_pending', () => {
    for (const status of ['applied', 'rejected', 'failed', 'undone'] as const) {
      const r = pending({ status });
      expect(code(markApplied(r, { kind: 'user', id: 'u1' }, undefined, NOW))).toBe('not_pending');
      expect(code(markRejected(r, { kind: 'user', id: 'u1' }, NOW))).toBe('not_pending');
      expect(code(markFailed(r, 'x', NOW))).toBe('not_pending');
    }
  });

  it('R-101: the transitions never mutate their input', () => {
    const r = pending();
    const snapshot = JSON.stringify(r);
    markApplied(r, { kind: 'user', id: 'u1' }, UNDO, NOW);
    markRejected(r, { kind: 'user', id: 'u1' }, NOW);
    markFailed(r, 'boom', NOW);
    expect(JSON.stringify(r)).toBe(snapshot);
  });

  it('R-102: applied → undone while now < undo.expiresAt, keeping who applied it', () => {
    const applied = pending({ status: 'applied', decidedAt: NOW, decidedBy: { kind: 'grant', grant: GRANT_1 }, undo: UNDO });
    const undone = markUndone(applied, UNDO.expiresAt - 1);
    expect(undone).toEqual({ ok: true, value: { ...applied, status: 'undone' } });
  });

  it('R-102: at or after the window it is undo_expired, and with no undo info nothing can be undone', () => {
    const applied = pending({ status: 'applied', decidedAt: NOW, decidedBy: { kind: 'user', id: 'u1' }, undo: UNDO });
    expect(code(markUndone(applied, UNDO.expiresAt))).toBe('undo_expired');
    expect(code(markUndone(applied, UNDO.expiresAt + 60_000))).toBe('undo_expired');
    expect(code(markUndone({ ...applied, undo: undefined }, NOW))).toBe('undo_expired');
  });

  it('R-102: only an applied record can be undone — others are not_applied, and undone cannot be undone twice', () => {
    for (const status of ['pending', 'rejected', 'failed', 'undone'] as const) {
      expect(code(markUndone(pending({ status, undo: UNDO }), NOW))).toBe('not_applied');
    }
  });
});
