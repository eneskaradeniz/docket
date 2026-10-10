// Headless scenario for the actions core: the assistant proposes, the operator approves or grants
// a short permission, the recording applier sees who authorised each application, failures and
// expiry fall back to approval, and undo works only inside its window.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type ActionAuthority, type Actor, type AssistantAction, type RoleSlug, type RunId, type Ulid, type UndoInfo } from '../../domain/index';
import { createFakeClock, createFakeDeps, createFakeEventLog } from '../ports/fakes';
import { grantPermission, listActions, proposeAction, decideActionUseCase, revokePermission, startConversationUseCase, undoAction, type ActionApplier } from '../use-cases';

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

const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR1') as RunId, role: slugOf<'role'>('planner') as RoleSlug };
const PROJECT = slugOf<'project'>('mobile');
const PROPOSAL = ulidOf<'proposal'>('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const DRAFT = ulidOf<'draft'>('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const MINUTE = 60_000;

const roadmapEdit: AssistantAction = { kind: 'roadmap_edit', project: PROJECT, proposal: PROPOSAL };
const openWorkOrder: AssistantAction = { kind: 'open_work_order', draft: DRAFT };
const definitionEdit: AssistantAction = { kind: 'definition_edit', scope: { kind: 'project', project: PROJECT }, target: 'flows/main.yaml', proposal: PROPOSAL };

describe('actions core scenario', () => {
  it('propose, approve, grant, fail, revoke, expire and undo', async () => {
    const clock = createFakeClock(1_000_000);
    const deps = createFakeDeps({ clock, log: createFakeEventLog() });
    const started = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'Plan the roadmap' }, by: USER });
    if (!started.ok) throw new Error('conversation must start');
    const conversation = started.value.id;

    const calls: { action: AssistantAction; authority: ActionAuthority }[] = [];
    let fail = false;
    const undo = (): UndoInfo => ({ kind: 'revert_proposal', ref: PROPOSAL, expiresAt: clock.now() + 10 * MINUTE });
    const apply: ActionApplier = async (action, authority) => {
      calls.push({ action, authority });
      return fail ? { ok: false, error: { code: 'stale_proposal' } } : { ok: true, value: { undo: undo() } };
    };
    const propose = async (action: AssistantAction) => {
      const r = await proposeAction(deps, { conversation, action, by: AGENT }, apply);
      if (!r.ok) throw new Error(`propose failed: ${r.error.code}`);
      return r.value;
    };

    // 1. No grant: the roadmap edit waits, nothing is applied.
    const first = await propose(roadmapEdit);
    expect(first.decision).toEqual({ kind: 'needs_approval' });
    expect(first.record.status).toBe('pending');
    expect(calls).toEqual([]);

    // 2. The user approves: the applier sees the user authority.
    const approved = await decideActionUseCase(deps, { id: first.record.id, decision: 'approved', by: USER }, apply);
    expect(approved).toMatchObject({ ok: true, value: { status: 'applied', decidedBy: { kind: 'user', id: 'u1' } } });
    expect(calls.map((c) => c.authority)).toEqual([{ kind: 'user', id: 'u1' }]);

    // 3. A 30-minute grant for two classes: both apply through the grant, a definition edit still waits.
    const granted = await grantPermission(deps, { conversation, classes: ['open_work_order', 'roadmap_edit'], minutes: 30, by: USER });
    if (!granted.ok) throw new Error('grant must be created');
    const grantId = granted.value.id;
    const second = await propose(roadmapEdit);
    const third = await propose(openWorkOrder);
    const fourth = await propose(definitionEdit);
    expect([second.record.status, third.record.status, fourth.record.status]).toEqual(['applied', 'applied', 'pending']);
    expect(calls.slice(1).map((c) => c.authority)).toEqual([
      { kind: 'grant', grant: grantId },
      { kind: 'grant', grant: grantId },
    ]);
    expect((await deps.grants.get(grantId))?.applied).toBe(2);

    // 4. An applier failure is a failed record and does not spend the grant.
    fail = true;
    const failed = await propose(roadmapEdit);
    expect(failed.record).toMatchObject({ status: 'failed', failure: 'stale_proposal' });
    expect((await deps.grants.get(grantId))?.applied).toBe(2);
    fail = false;

    // 5. Revoking: the next proposal waits.
    await revokePermission(deps, { grant: grantId, by: USER });
    expect((await propose(roadmapEdit)).record.status).toBe('pending');

    // 6. A new grant, then the clock passes its expiry: the next proposal waits.
    await grantPermission(deps, { conversation, classes: ['roadmap_edit'], minutes: 5, by: USER });
    expect((await propose(roadmapEdit)).record.status).toBe('applied');
    clock.advance(5 * MINUTE);
    expect((await propose(roadmapEdit)).record.status).toBe('pending');

    // 7. Undo inside the window works; after the window it is refused.
    const undoer = async () => ({ ok: true, value: undefined }) as const;
    const inWindow = await undoAction(deps, { id: second.record.id, by: USER }, undoer);
    expect(inWindow).toMatchObject({ ok: true, value: { status: 'undone' } });
    clock.advance(11 * MINUTE);
    const late = await undoAction(deps, { id: third.record.id, by: USER }, undoer);
    expect(late).toEqual({ ok: false, error: { code: 'undo_expired' } });

    // The history is all there, oldest first.
    const statuses = (await listActions(deps, { conversation })).map((r) => r.status);
    expect(statuses).toEqual(['applied', 'undone', 'applied', 'pending', 'failed', 'pending', 'applied', 'pending']);
  });
});
