// action use cases — rules A-176 … A-185 (docs/v2/application.md), driven over the in-memory fakes
// with a recording applier and undoer: the real ones belong to a later slice.
import { describe, expect, it, vi } from 'vitest';

import {
  ACTION_LIMITS,
  parseSlug,
  parseUlid,
  type ActionAuthority,
  type ActionClass,
  type ActionId,
  type ActionRecord,
  type Actor,
  type AssistantAction,
  type ConversationId,
  type DraftId,
  type GrantId,
  type ProjectSlug,
  type ProposalId,
  type Result,
  type RoleSlug,
  type RunId,
  type Ulid,
  type UndoInfo,
} from '../../domain/index';

import type { AppDeps, AuditAction, AuditEntry } from '../ports';
import { createFakeClock, createFakeDeps, createFakeEventLog, type FakeClock, type FakeEventLog } from '../ports/fakes';

import {
  activeGrants,
  decideActionUseCase,
  grantPermission,
  listActions,
  proposeAction,
  revokePermission,
  undoAction,
  type ActionApplier,
  type ActionUndoer,
} from './actions';
import { startConversationUseCase } from './conversations';

// --- fixtures ---------------------------------------------------------------------------------------

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const PROJECT: ProjectSlug = slugOf('atolye');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR1') as RunId, role: slugOf<'role'>('planner') as RoleSlug };
const SYSTEM: Actor = { kind: 'system', component: 'chat-runner' };
const DRAFT: DraftId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROPOSAL: ProposalId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const UNKNOWN_CONVERSATION: ConversationId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ9');
const UNKNOWN_ACTION: ActionId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ8');
const UNKNOWN_GRANT: GrantId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ7');
const MINUTE = 60_000;

const openWorkOrder: AssistantAction = { kind: 'open_work_order', draft: DRAFT };
const roadmapEdit: AssistantAction = { kind: 'roadmap_edit', project: PROJECT, proposal: PROPOSAL };
const definitionEdit: AssistantAction = { kind: 'definition_edit', scope: { kind: 'project', project: PROJECT }, target: 'flows/main.yaml', proposal: PROPOSAL };
const settingChange: AssistantAction = { kind: 'setting_change', key: 'dispatch.mode', value: 'auto' };

interface Recorder {
  readonly apply: ActionApplier;
  readonly calls: { readonly action: AssistantAction; readonly authority: ActionAuthority }[];
}

const recorder = (result: (a: AssistantAction) => Result<{ readonly undo?: UndoInfo }, { readonly code: string }> | 'throw' = () => ({ ok: true, value: {} })): Recorder => {
  const calls: { action: AssistantAction; authority: ActionAuthority }[] = [];
  return {
    calls,
    apply: async (action, authority) => {
      calls.push({ action, authority });
      const answer = result(action);
      if (answer === 'throw') throw new Error('applier exploded with SECRET-VALUE');
      return answer;
    },
  };
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly conversation: ConversationId;
  readonly other: ConversationId;
}

const makeHarness = async (): Promise<Harness> => {
  const clock = createFakeClock(1_000_000);
  const log = createFakeEventLog();
  const deps = createFakeDeps({ clock, log });
  const first = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'plan' }, by: USER });
  const second = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'other' }, by: USER });
  if (!first.ok || !second.ok) throw new Error('fixture conversations must start');
  // The conversation use cases audit too; the action tests look only at what follows.
  return { deps, clock, log, conversation: first.value.id, other: second.value.id };
};

const code = (r: { readonly ok: boolean; readonly error?: { readonly code: string } }): string => (r.ok ? 'ok' : (r.error?.code ?? '?'));

const grant = async (h: Harness, classes: readonly ActionClass[], minutes = 30, conversation = h.conversation) => {
  const made = await grantPermission(h.deps, { conversation, classes, minutes, by: USER });
  if (!made.ok) throw new Error(`fixture grant failed: ${made.error.code}`);
  return made.value;
};

const propose = async (h: Harness, action: unknown, apply: ActionApplier, by: Actor = AGENT, conversation = h.conversation) => {
  const r = await proposeAction(h.deps, { conversation, action, by }, apply);
  if (!r.ok) throw new Error(`fixture propose failed: ${r.error.code}`);
  return r.value;
};

const auditOf = async (h: Harness, conversation = h.conversation): Promise<readonly AuditEntry[]> => {
  const entries = await h.log.list({ kind: 'conversation', id: conversation }, 1_000);
  return entries.filter((e) => /^(action|grant)\./.test(e.action)).reverse(); // oldest first
};
const auditActions = async (h: Harness): Promise<AuditAction[]> => (await auditOf(h)).map((e) => e.action);

const UNDO: UndoInfo = { kind: 'close_work_order', ref: '01ARZ3NDEKTSV4RRFFQ69G5FW1', expiresAt: 1_000_000 + 10 * MINUTE };

// --- A-176 … A-185 ----------------------------------------------------------------------------------

describe('proposeAction guards (A-176)', () => {
  it('A-176: only an agent or system actor proposes — a user actor is not_assistant and nothing is stored or applied', async () => {
    const h = await makeHarness();
    const rec = recorder();
    const r = await proposeAction(h.deps, { conversation: h.conversation, action: openWorkOrder, by: USER }, rec.apply);
    expect(code(r)).toBe('not_assistant');
    expect(await h.deps.actions.countFor(h.conversation)).toBe(0);
    expect(rec.calls).toEqual([]);
    expect(await auditActions(h)).toEqual([]);
  });

  it('A-176: a hostile or malformed action is refused with its validation code and stores, applies and audits nothing', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change']);
    const rec = recorder();
    const hostile: [unknown, string][] = [
      [{ kind: 'gate_decide', gate: 'x' }, 'bad_action'],
      [{ kind: 'merge' }, 'bad_action'],
      [{ kind: 'delete_work_order', id: DRAFT }, 'bad_action'],
      [{ kind: 'account_save' }, 'bad_action'],
      [{ kind: 'spend_consent' }, 'bad_action'],
      [{ kind: 'permission_answer' }, 'bad_action'],
      [{ kind: 'deploy_approve' }, 'bad_action'],
      [{ ...definitionEdit, target: '../../etc/passwd' }, 'bad_action'],
      [{ ...definitionEdit, target: 'roadmap.yaml' }, 'bad_action'],
      [{ kind: 'setting_change', key: 'account.token', value: 'x' }, 'bad_setting_key'],
      [{ kind: 'setting_change', key: 'dispatch.limits', value: 'x'.repeat(5_000) }, 'value_too_large'],
      [null, 'bad_action'],
    ];
    for (const [action, expected] of hostile) {
      for (const by of [AGENT, SYSTEM]) {
        const r = await proposeAction(h.deps, { conversation: h.conversation, action, by }, rec.apply);
        expect(code(r)).toBe(expected);
      }
    }
    expect(await h.deps.actions.countFor(h.conversation)).toBe(0);
    expect(rec.calls).toEqual([]);
    expect(await auditActions(h)).toEqual(['grant.created']);
  });

  it('A-176: an unknown conversation is not_found and stores nothing', async () => {
    const h = await makeHarness();
    const rec = recorder();
    const r = await proposeAction(h.deps, { conversation: UNKNOWN_CONVERSATION, action: openWorkOrder, by: AGENT }, rec.apply);
    expect(code(r)).toBe('not_found');
    expect(await h.deps.actions.countFor(UNKNOWN_CONVERSATION)).toBe(0);
  });

  it('A-176: a conversation holding 500 actions refuses the 501st with rate_limited, even under a valid grant', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order']);
    for (let i = 0; i < ACTION_LIMITS.actionsPerConversationMax; i += 1) {
      const id = ulidOf<'action'>(`01ARZ3NDEKTSV4RRFFQ6${String(i).padStart(6, '0').replace(/[ILOU]/g, '1')}`);
      await h.deps.actions.save({ id, conversation: h.conversation, action: openWorkOrder, status: 'rejected', proposedAt: 1 });
    }
    expect(await h.deps.actions.countFor(h.conversation)).toBe(500);
    const rec = recorder();
    const r = await proposeAction(h.deps, { conversation: h.conversation, action: openWorkOrder, by: AGENT }, rec.apply);
    expect(code(r)).toBe('rate_limited');
    expect(rec.calls).toEqual([]);
    expect(await h.deps.actions.countFor(h.conversation)).toBe(500);
    // Another conversation is not affected.
    expect(code(await proposeAction(h.deps, { conversation: h.other, action: openWorkOrder, by: AGENT }, rec.apply))).toBe('ok');
  });
});

describe('proposeAction without a grant (A-177)', () => {
  it('A-177: with no grant the record is pending, the decision is needs_approval and the applier is never called', async () => {
    const h = await makeHarness();
    const rec = recorder();
    const { record, decision } = await propose(h, roadmapEdit, rec.apply);
    expect(decision).toEqual({ kind: 'needs_approval' });
    expect(record).toEqual({ id: record.id, conversation: h.conversation, action: roadmapEdit, status: 'pending', proposedAt: 1_000_000 });
    expect(rec.calls).toEqual([]);
    expect(await h.deps.actions.get(record.id)).toEqual(record);
    expect(await h.deps.actions.pending(h.conversation)).toEqual([record]);
  });

  it('A-177: a system actor proposes the same way and the proposal is audited with class and decision only', async () => {
    const h = await makeHarness();
    const { record } = await propose(h, settingChange, recorder().apply, SYSTEM);
    const entries = await auditOf(h);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'action.proposed',
      actor: SYSTEM,
      subject: { kind: 'conversation', id: h.conversation },
      detail: { action: record.id, class: 'setting_change', decision: 'needs_approval' },
    });
  });

  it('A-177: a grant that does not cover the class leaves the action pending', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order']);
    const rec = recorder();
    const { record, decision } = await propose(h, definitionEdit, rec.apply);
    expect(decision).toEqual({ kind: 'needs_approval' });
    expect(record.status).toBe('pending');
    expect(rec.calls).toEqual([]);
  });
});

describe('proposeAction under a grant (A-178)', () => {
  it('A-178: a covering grant applies through the applier with the grant authority, records the undo and consumes one application', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order', 'roadmap_edit']);
    const rec = recorder(() => ({ ok: true, value: { undo: UNDO } }));
    const { record, decision } = await propose(h, openWorkOrder, rec.apply);
    expect(decision).toEqual({ kind: 'apply', grant: g.id });
    expect(rec.calls).toEqual([{ action: openWorkOrder, authority: { kind: 'grant', grant: g.id } }]);
    expect(record).toMatchObject({ status: 'applied', decidedAt: 1_000_000, decidedBy: { kind: 'grant', grant: g.id }, undo: UNDO });
    expect(await h.deps.actions.get(record.id)).toEqual(record);
    expect((await h.deps.grants.get(g.id))?.applied).toBe(1);

    const second = await propose(h, roadmapEdit, rec.apply, SYSTEM);
    expect(second.record.status).toBe('applied');
    expect((await h.deps.grants.get(g.id))?.applied).toBe(2);
  });

  it('A-178: a grant covering open_work_order and roadmap_edit leaves a definition_edit and a setting_change pending', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order', 'roadmap_edit'], 30);
    const rec = recorder();
    expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('applied');
    expect((await propose(h, roadmapEdit, rec.apply)).record.status).toBe('applied');
    expect((await propose(h, definitionEdit, rec.apply)).record.status).toBe('pending');
    expect((await propose(h, settingChange, rec.apply)).record.status).toBe('pending');
    expect(rec.calls.map((c) => c.action.kind)).toEqual(['open_work_order', 'roadmap_edit']);
  });

  it('A-178: an applied action under a grant appends proposed then applied, the latter naming the grant authority', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const { record } = await propose(h, openWorkOrder, recorder().apply);
    const entries = await auditOf(h);
    expect(entries.map((e) => e.action)).toEqual(['grant.created', 'action.proposed', 'action.applied']);
    expect(entries[1]?.detail).toEqual({ action: record.id, class: 'open_work_order', decision: 'apply' });
    expect(entries[2]?.detail).toEqual({ action: record.id, class: 'open_work_order', authority: 'grant', grant: g.id });
  });
});

describe('applier failures (A-179)', () => {
  it('A-179: an applier failure marks the record failed with its code, keeps it visible and does not consume an application', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const rec = recorder(() => ({ ok: false, error: { code: 'stale_proposal' } }));
    const { record, decision } = await propose(h, openWorkOrder, rec.apply);
    expect(decision).toEqual({ kind: 'apply', grant: g.id });
    expect(record).toMatchObject({ status: 'failed', failure: 'stale_proposal', decidedAt: 1_000_000 });
    expect(record.undo).toBeUndefined();
    expect(await listActions(h.deps, { conversation: h.conversation })).toEqual([record]);
    expect((await h.deps.grants.get(g.id))?.applied).toBe(0);
    expect((await auditOf(h)).map((e) => e.action)).toEqual(['grant.created', 'action.proposed', 'action.failed']);
  });

  it('A-179: a throwing applier is a failed record with a fixed code — the message never reaches the record or the audit', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const { record } = await propose(h, openWorkOrder, recorder(() => 'throw').apply);
    expect(record).toMatchObject({ status: 'failed', failure: 'applier_error' });
    expect((await h.deps.grants.get(g.id))?.applied).toBe(0);
    expect(JSON.stringify([record, await auditOf(h)])).not.toContain('SECRET-VALUE');
  });

  it('A-179: a failure code that is not a stable code (content, spaces, upper case) is replaced by apply_failed', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order']);
    const { record } = await propose(h, openWorkOrder, recorder(() => ({ ok: false, error: { code: 'Could not open "Secret title": disk full' } })).apply);
    expect(record).toMatchObject({ status: 'failed', failure: 'apply_failed' });
  });

  it('A-179: a malformed undo from the applier is dropped — the work happened, so the record is applied, but never undoable', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const bad = { kind: 'close_work_order', ref: 'a\nb', expiresAt: 5 } as UndoInfo;
    const { record } = await propose(h, openWorkOrder, recorder(() => ({ ok: true, value: { undo: bad } })).apply);
    expect(record.status).toBe('applied');
    expect(record.undo).toBeUndefined();
    expect((await h.deps.grants.get(g.id))?.applied).toBe(1);
  });

  it('A-179: failures do not exhaust a grant — 30 failures leave it able to apply', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const failing = recorder(() => ({ ok: false, error: { code: 'disk_full' } }));
    for (let i = 0; i < 30; i += 1) await propose(h, openWorkOrder, failing.apply);
    expect((await h.deps.grants.get(g.id))?.applied).toBe(0);
    expect((await propose(h, openWorkOrder, recorder().apply)).record.status).toBe('applied');
  });
});

describe('decideActionUseCase (A-180)', () => {
  it('A-180: the user approving a pending action calls the applier with the user authority and records the result', async () => {
    const h = await makeHarness();
    const { record } = await propose(h, roadmapEdit, recorder().apply);
    h.clock.advance(5_000);
    const rec = recorder(() => ({ ok: true, value: { undo: UNDO } }));
    const r = await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, rec.apply);
    expect(r).toEqual({ ok: true, value: { ...record, status: 'applied', decidedAt: 1_005_000, decidedBy: { kind: 'user', id: 'u1' }, undo: UNDO } });
    expect(rec.calls).toEqual([{ action: roadmapEdit, authority: { kind: 'user', id: 'u1' } }]);
    expect(await h.deps.actions.get(record.id)).toEqual(r.ok ? r.value : undefined);
  });

  it('A-180: rejecting marks the record rejected, never calls the applier and audits action.rejected', async () => {
    const h = await makeHarness();
    const { record } = await propose(h, roadmapEdit, recorder().apply);
    const rec = recorder();
    const r = await decideActionUseCase(h.deps, { id: record.id, decision: 'rejected', by: USER }, rec.apply);
    expect(r).toMatchObject({ ok: true, value: { status: 'rejected', decidedBy: { kind: 'user', id: 'u1' } } });
    expect(rec.calls).toEqual([]);
    const entries = await auditOf(h);
    expect(entries.at(-1)).toMatchObject({ action: 'action.rejected', actor: USER, detail: { action: record.id, class: 'roadmap_edit' } });
  });

  it('A-180: an agent or system actor can neither approve nor reject — not_user, the record stays pending, nothing applied or audited', async () => {
    const h = await makeHarness();
    const { record } = await propose(h, roadmapEdit, recorder().apply);
    const rec = recorder();
    for (const by of [AGENT, SYSTEM]) {
      for (const decision of ['approved', 'rejected'] as const) {
        expect(code(await decideActionUseCase(h.deps, { id: record.id, decision, by }, rec.apply))).toBe('not_user');
      }
    }
    expect(rec.calls).toEqual([]);
    expect((await h.deps.actions.get(record.id))?.status).toBe('pending');
    expect(await auditActions(h)).toEqual(['action.proposed']);
  });

  it('A-180: an unknown action is not_found; a record that is not pending is not_pending and the applier is not called again', async () => {
    const h = await makeHarness();
    const rec = recorder();
    expect(code(await decideActionUseCase(h.deps, { id: UNKNOWN_ACTION, decision: 'approved', by: USER }, rec.apply))).toBe('not_found');
    const { record } = await propose(h, roadmapEdit, recorder().apply);
    expect(code(await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, rec.apply))).toBe('ok');
    expect(code(await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, rec.apply))).toBe('not_pending');
    expect(code(await decideActionUseCase(h.deps, { id: record.id, decision: 'rejected', by: USER }, rec.apply))).toBe('not_pending');
    expect(rec.calls).toHaveLength(1);
  });

  it('A-180: an applier failure on approval leaves the record failed and visible, with the failure code and no grant touched', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const { record } = await propose(h, roadmapEdit, recorder().apply);
    const r = await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, recorder(() => ({ ok: false, error: { code: 'stale_proposal' } })).apply);
    expect(r).toMatchObject({ ok: true, value: { status: 'failed', failure: 'stale_proposal' } });
    expect((await h.deps.grants.get(g.id))?.applied).toBe(0);
    expect((await auditOf(h)).at(-1)?.action).toBe('action.failed');
  });

  it('A-180: approving by hand does not consume the grant — only grant-authorised applications count', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const { record } = await propose(h, settingChange, recorder().apply);
    await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, recorder().apply);
    expect((await h.deps.grants.get(g.id))?.applied).toBe(0);
  });
});

describe('grantPermission and revokePermission (A-181)', () => {
  it('A-181: the user grants classes for N minutes on an existing conversation and the grant lives in the grant repo', async () => {
    const h = await makeHarness();
    const made = await grantPermission(h.deps, { conversation: h.conversation, classes: ['open_work_order', 'roadmap_edit'], minutes: 30, by: USER });
    expect(made).toMatchObject({
      ok: true,
      value: { conversation: h.conversation, by: { kind: 'user', id: 'u1' }, classes: ['open_work_order', 'roadmap_edit'], grantedAt: 1_000_000, expiresAt: 1_000_000 + 30 * MINUTE, applied: 0 },
    });
    if (!made.ok) throw new Error('unreachable');
    expect(await h.deps.grants.get(made.value.id)).toEqual(made.value);
    expect((await auditOf(h)).at(-1)).toMatchObject({
      action: 'grant.created',
      actor: USER,
      detail: { grant: made.value.id, classes: 'open_work_order,roadmap_edit', count: 2, minutes: 30 },
    });
  });

  it('A-181: an agent or system actor can never create a grant — grant_not_user and nothing stored', async () => {
    const h = await makeHarness();
    for (const by of [AGENT, SYSTEM]) {
      expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['open_work_order'], minutes: 5, by }))).toBe('grant_not_user');
    }
    expect(await h.deps.grants.forConversation(h.conversation)).toEqual([]);
    expect(await auditActions(h)).toEqual([]);
  });

  it('A-181: 60 minutes is allowed; 61 minutes is grant_too_long and is not clamped or stored', async () => {
    const h = await makeHarness();
    const full = await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: 60, by: USER });
    expect(full).toMatchObject({ ok: true, value: { expiresAt: 1_000_000 + 60 * MINUTE } });
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: 61, by: USER }))).toBe('grant_too_long');
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: 24 * 60, by: USER }))).toBe('grant_too_long');
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: Number.NaN, by: USER }))).not.toBe('ok');
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: 0, by: USER }))).not.toBe('ok');
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: ['setting_change'], minutes: -5, by: USER }))).not.toBe('ok');
    expect(await h.deps.grants.forConversation(h.conversation)).toHaveLength(1);
  });

  it('A-181: empty or hostile classes are refused (grant_empty, bad_class) and an unknown conversation is not_found', async () => {
    const h = await makeHarness();
    expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: [], minutes: 5, by: USER }))).toBe('grant_empty');
    for (const hostile of ['gate_decide', 'merge', 'delete_work_order', 'account_save', 'spend_consent', 'permission_answer', 'deploy_approve']) {
      expect(code(await grantPermission(h.deps, { conversation: h.conversation, classes: [hostile as ActionClass], minutes: 5, by: USER }))).toBe('bad_class');
    }
    expect(code(await grantPermission(h.deps, { conversation: UNKNOWN_CONVERSATION, classes: ['open_work_order'], minutes: 5, by: USER }))).toBe('not_found');
    expect(await h.deps.grants.forConversation(h.conversation)).toEqual([]);
  });

  it('A-181: revokePermission is user-only, needs a known grant, stamps the time, is idempotent and audits grant.revoked once', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    for (const by of [AGENT, SYSTEM]) expect(code(await revokePermission(h.deps, { grant: g.id, by }))).toBe('not_user');
    expect((await h.deps.grants.get(g.id))?.revokedAt).toBeUndefined();
    expect(code(await revokePermission(h.deps, { grant: UNKNOWN_GRANT, by: USER }))).toBe('not_found');

    h.clock.advance(1_000);
    const revoked = await revokePermission(h.deps, { grant: g.id, by: USER });
    expect(revoked).toMatchObject({ ok: true, value: { id: g.id, revokedAt: 1_001_000 } });
    h.clock.advance(1_000);
    const again = await revokePermission(h.deps, { grant: g.id, by: USER });
    expect(again).toMatchObject({ ok: true, value: { revokedAt: 1_001_000 } });
    expect((await auditActions(h)).filter((a) => a === 'grant.revoked')).toHaveLength(1);
  });
});

describe('grant boundaries (A-182)', () => {
  it('A-182: a grant of conversation A never covers a proposal in conversation B', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order'], 30, h.conversation);
    const rec = recorder();
    const inOther = await propose(h, openWorkOrder, rec.apply, AGENT, h.other);
    expect(inOther.decision).toEqual({ kind: 'needs_approval' });
    expect(inOther.record.status).toBe('pending');
    expect(rec.calls).toEqual([]);
    expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('applied');
  });

  it('A-182: the 25th application is the last — the 26th proposal waits for approval', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const rec = recorder();
    for (let i = 0; i < ACTION_LIMITS.grantMaxApplications; i += 1) expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('applied');
    expect((await h.deps.grants.get(g.id))?.applied).toBe(25);
    const twentySixth = await propose(h, openWorkOrder, rec.apply);
    expect(twentySixth.decision).toEqual({ kind: 'needs_approval' });
    expect(twentySixth.record.status).toBe('pending');
    expect(rec.calls).toHaveLength(25);
  });

  it('A-182: an exhausted grant falls through to a second live grant of the same conversation', async () => {
    const h = await makeHarness();
    const first = await grant(h, ['open_work_order']);
    await h.deps.grants.save({ ...first, applied: 25 });
    const second = await grant(h, ['open_work_order']);
    const r = await propose(h, openWorkOrder, recorder().apply);
    expect(r.decision).toEqual({ kind: 'apply', grant: second.id });
  });

  it('A-182: when the clock reaches the expiry the next proposal waits for approval', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order'], 30);
    const rec = recorder();
    h.clock.advance(30 * MINUTE - 1);
    expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('applied');
    h.clock.advance(1);
    const late = await propose(h, openWorkOrder, rec.apply);
    expect(late.decision).toEqual({ kind: 'needs_approval' });
    expect(late.record.status).toBe('pending');
    expect(rec.calls).toHaveLength(1);
  });

  it('A-182: after revocation the next proposal waits for approval', async () => {
    const h = await makeHarness();
    const g = await grant(h, ['open_work_order']);
    const rec = recorder();
    expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('applied');
    await revokePermission(h.deps, { grant: g.id, by: USER });
    expect((await propose(h, openWorkOrder, rec.apply)).record.status).toBe('pending');
    expect(rec.calls).toHaveLength(1);
  });

  it('A-182: an approved pending action is still decided by the operator even after its grant expired', async () => {
    const h = await makeHarness();
    await grant(h, ['open_work_order'], 1);
    h.clock.advance(2 * MINUTE);
    const { record } = await propose(h, openWorkOrder, recorder().apply);
    expect(record.status).toBe('pending');
    const rec = recorder();
    expect(code(await decideActionUseCase(h.deps, { id: record.id, decision: 'approved', by: USER }, rec.apply))).toBe('ok');
    expect(rec.calls[0]?.authority).toEqual({ kind: 'user', id: 'u1' });
  });
});

describe('undoAction (A-183)', () => {
  const appliedRecord = async (h: Harness, undo: UndoInfo | null = UNDO): Promise<ActionRecord> => {
    const g = await grant(h, ['open_work_order']);
    void g;
    const { record } = await propose(h, openWorkOrder, recorder(() => ({ ok: true, value: undo === null ? {} : { undo } })).apply);
    return record;
  };
  const undoer = (result: Result<void, { readonly code: string }> = { ok: true, value: undefined }) => {
    const seen: ActionRecord[] = [];
    const fn: ActionUndoer = async (r) => {
      seen.push(r);
      return result;
    };
    return { fn, seen };
  };

  it('A-183: the user undoes an applied action inside the window — the undoer sees the record and the record becomes undone', async () => {
    const h = await makeHarness();
    const record = await appliedRecord(h);
    h.clock.advance(5 * MINUTE);
    const u = undoer();
    const r = await undoAction(h.deps, { id: record.id, by: USER }, u.fn);
    expect(r).toEqual({ ok: true, value: { ...record, status: 'undone' } });
    expect(u.seen).toEqual([record]);
    expect((await h.deps.actions.get(record.id))?.status).toBe('undone');
    expect((await auditOf(h)).at(-1)).toMatchObject({ action: 'action.undone', actor: USER, detail: { action: record.id, class: 'open_work_order' } });
  });

  it('A-183: at or after the window it is undo_expired and the undoer is not called', async () => {
    const h = await makeHarness();
    const record = await appliedRecord(h);
    h.clock.advance(10 * MINUTE);
    const u = undoer();
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, u.fn))).toBe('undo_expired');
    h.clock.advance(60 * MINUTE);
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, u.fn))).toBe('undo_expired');
    expect(u.seen).toEqual([]);
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');
  });

  it('A-183: an agent or system actor cannot undo — not_user and the undoer is not called', async () => {
    const h = await makeHarness();
    const record = await appliedRecord(h);
    const u = undoer();
    for (const by of [AGENT, SYSTEM]) expect(code(await undoAction(h.deps, { id: record.id, by }, u.fn))).toBe('not_user');
    expect(u.seen).toEqual([]);
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');
  });

  it('A-183: unknown, pending, rejected, failed and already undone records are refused without calling the undoer', async () => {
    const h = await makeHarness();
    const u = undoer();
    expect(code(await undoAction(h.deps, { id: UNKNOWN_ACTION, by: USER }, u.fn))).toBe('not_found');
    const pendingOne = (await propose(h, settingChange, recorder().apply)).record;
    expect(code(await undoAction(h.deps, { id: pendingOne.id, by: USER }, u.fn))).toBe('not_applied');
    await decideActionUseCase(h.deps, { id: pendingOne.id, decision: 'rejected', by: USER }, recorder().apply);
    expect(code(await undoAction(h.deps, { id: pendingOne.id, by: USER }, u.fn))).toBe('not_applied');
    const record = await appliedRecord(h);
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, u.fn))).toBe('ok');
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, u.fn))).toBe('not_applied');
    expect(u.seen).toHaveLength(1);
  });

  it('A-183: an applied action that carries no undo info cannot be undone (undo_expired)', async () => {
    const h = await makeHarness();
    const record = await appliedRecord(h, null);
    const u = undoer();
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, u.fn))).toBe('undo_expired');
    expect(u.seen).toEqual([]);
  });

  it('A-183: an undoer failure is undo_failed and the record stays applied, so the operator can try again', async () => {
    const h = await makeHarness();
    const record = await appliedRecord(h);
    const failing = undoer({ ok: false, error: { code: 'already_closed' } });
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, failing.fn))).toBe('undo_failed');
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');
    const throwing: ActionUndoer = async () => {
      throw new Error('boom SECRET-VALUE');
    };
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, throwing))).toBe('undo_failed');
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');
    expect(JSON.stringify(await auditOf(h))).not.toContain('SECRET-VALUE');
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, undoer().fn))).toBe('ok');
  });
});

describe('listActions and activeGrants (A-184)', () => {
  it('A-184: listActions answers one conversation oldest first, or only its pending records', async () => {
    const h = await makeHarness();
    const rec = recorder();
    const a = (await propose(h, roadmapEdit, rec.apply)).record;
    h.clock.advance(1_000);
    const b = (await propose(h, settingChange, rec.apply)).record;
    await propose(h, roadmapEdit, rec.apply, AGENT, h.other);
    await decideActionUseCase(h.deps, { id: a.id, decision: 'rejected', by: USER }, rec.apply);
    const all = await listActions(h.deps, { conversation: h.conversation });
    expect(all.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(all.map((r) => r.status)).toEqual(['rejected', 'pending']);
    expect((await listActions(h.deps, { conversation: h.conversation, pending: true })).map((r) => r.id)).toEqual([b.id]);
    expect(await listActions(h.deps, { conversation: UNKNOWN_CONVERSATION })).toEqual([]);
  });

  it('A-184: activeGrants answers the conversation\'s grants that are neither expired nor revoked', async () => {
    const h = await makeHarness();
    const live = await grant(h, ['open_work_order'], 30);
    const short = await grant(h, ['roadmap_edit'], 1);
    const revoked = await grant(h, ['setting_change'], 30);
    await grant(h, ['open_work_order'], 30, h.other);
    await revokePermission(h.deps, { grant: revoked.id, by: USER });
    expect((await activeGrants(h.deps, { conversation: h.conversation })).map((g) => g.id)).toEqual([live.id, short.id]);
    h.clock.advance(2 * MINUTE);
    expect((await activeGrants(h.deps, { conversation: h.conversation })).map((g) => g.id)).toEqual([live.id]);
    h.clock.advance(30 * MINUTE);
    expect(await activeGrants(h.deps, { conversation: h.conversation })).toEqual([]);
  });
});

describe('audit entries and records carry no content (A-185)', () => {
  it('A-185: serialized audit entries and records hold ids, class names, counts and the authority kind — never values or targets — and nothing logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const h = await makeHarness();
      const SECRET_VALUE = 'SECRET-VALUE-9f3a';
      const SECRET_TARGET = 'flows/secret-target-flow.yaml';
      const g = await grant(h, ['setting_change', 'definition_edit', 'open_work_order']);
      const secretSetting: AssistantAction = { kind: 'setting_change', key: 'dispatch.limits', value: { note: SECRET_VALUE } };
      const secretDefinition: AssistantAction = { ...definitionEdit, target: SECRET_TARGET };

      const applied = (await propose(h, secretSetting, recorder(() => ({ ok: true, value: { undo: UNDO } })).apply)).record;
      const failed = (await propose(h, secretDefinition, recorder(() => ({ ok: false, error: { code: `${SECRET_VALUE} ${SECRET_TARGET}` } })).apply)).record;
      await revokePermission(h.deps, { grant: g.id, by: USER });
      const waiting = (await propose(h, secretDefinition, recorder().apply)).record;
      await decideActionUseCase(h.deps, { id: waiting.id, decision: 'rejected', by: USER }, recorder().apply);
      const approved = (await propose(h, secretSetting, recorder().apply)).record;
      await decideActionUseCase(h.deps, { id: approved.id, decision: 'approved', by: USER }, recorder().apply);
      await undoAction(h.deps, { id: applied.id, by: USER }, async () => ({ ok: true, value: undefined }));

      const entries = await auditOf(h);
      expect(entries.map((e) => e.action)).toEqual([
        'grant.created',
        'action.proposed',
        'action.applied',
        'action.proposed',
        'action.failed',
        'grant.revoked',
        'action.proposed',
        'action.rejected',
        'action.proposed',
        'action.applied',
        'action.undone',
      ]);
      const serialized = JSON.stringify(entries);
      for (const forbidden of [SECRET_VALUE, SECRET_TARGET, 'secret-target', 'dispatch.limits', 'note', 'flows/']) expect(serialized).not.toContain(forbidden);
      for (const entry of entries) {
        for (const [key, value] of Object.entries(entry.detail ?? {})) {
          expect(['action', 'class', 'decision', 'authority', 'grant', 'classes', 'count', 'minutes', 'code'], `unexpected detail key ${key}`).toContain(key);
          expect(typeof value === 'string' ? value.length <= 80 : true).toBe(true);
        }
      }
      expect(failed.failure).toBe('apply_failed');
      const records = JSON.stringify(await listActions(h.deps, { conversation: h.conversation }));
      expect(records).not.toContain('apply_failed '); // the failure is a bare code
      expect(JSON.stringify(failed)).not.toContain('Could not');
      expect(JSON.stringify(failed.failure)).toBe('"apply_failed"');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
