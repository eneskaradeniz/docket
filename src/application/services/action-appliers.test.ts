// action appliers and undoers — rules A-187 … A-196 (docs/v2/application.md), driven over the
// in-memory fakes. The applier is the only place where something an assistant proposed becomes a
// real change, so every test that matters is an adversarial one: a mismatch of any kind must end
// in a stable code with the stores exactly as they were.
import { describe, expect, it, vi } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type ActionAuthority,
  type ActionRecord,
  type Actor,
  type AssistantAction,
  type ConversationId,
  type DraftId,
  type Grant,
  type ProjectDef,
  type ProjectSlug,
  type ProposalId,
  type RepoSlug,
  type RoleSlug,
  type RunId,
  type Ulid,
} from '../../domain/index';

import type { AppDeps, AppSettingsRepo, AuditEntry, DefinitionScope, GrantRepo } from '../ports';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeAppSettingsRepo,
  createFakeGrantRepo,
  createFakeProposalRepo,
  type FakeClock,
  type FakeDefinitionStore,
  type FakeEventLog,
} from '../ports/fakes';
import {
  createDraft,
  createProposal,
  decideActionUseCase,
  decideProposalUseCase,
  dropDraftUseCase,
  grantPermission,
  proposeAction,
  revokePermission,
  startConversationUseCase,
  undoAction,
} from '../use-cases';

import { createActionApplier, createActionUndoer } from './action-appliers';

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
const OTHER_PROJECT: ProjectSlug = slugOf('elsewhere');
const REPO: RepoSlug = slugOf('acme');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const ACTING_USER: Actor = { kind: 'user', id: 'u1' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR1') as RunId, role: slugOf<'role'>('planner') as RoleSlug };
const SYSTEM: Actor = { kind: 'system', component: 'chat-runner' };
const HOUR = 3_600_000;
const MINUTE = 60_000;
const UNKNOWN_DRAFT: DraftId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ8');
const UNKNOWN_PROPOSAL: ProposalId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ7');

const PROJECT_DEF: ProjectDef = { id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] };
const REPO_DEFINITIONS = {
  roles: [],
  flows: [{ id: 'flow-b', name: 'Flow B', stages: [{ id: 'only', name: 'Only', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] }] }],
  capabilities: [],
  repo: { id: 'acme', name: 'Acme', repos: [], flows: ['flow-b'], defaultFlow: 'flow-b', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
};

const rolesFile = (name: string): string =>
  JSON.stringify({ roles: [{ id: 'helper', name, instructions: 'help', writeScope: { kind: 'repo' }, capabilities: [], active: true }] });
const INVALID_FILE = JSON.stringify({ roles: [{ id: 'helper', name: 'Broken' }] });

const GLOBAL: DefinitionScope = { kind: 'global' };
const IN_PROJECT: DefinitionScope = { kind: 'project', project: PROJECT };
const IN_OTHER_PROJECT: DefinitionScope = { kind: 'project', project: OTHER_PROJECT };
const IN_REPO: DefinitionScope = { kind: 'repo', repo: REPO };
const ROADMAP = 'roadmap.yaml';
const ROLE_TARGET = 'roles/helper.yaml';
const OTHER_TARGET = 'roles/other.yaml';
const ROADMAP_BEFORE = JSON.stringify({ phases: [] });
const ROADMAP_AFTER = JSON.stringify({ phases: [], note: 'edited' });

/** Every file the tests seed or propose against, so "nothing applied" can compare them all. */
const WATCHED: readonly (readonly [DefinitionScope, string])[] = [
  [IN_PROJECT, ROADMAP],
  [IN_OTHER_PROJECT, ROADMAP],
  [GLOBAL, ROLE_TARGET],
  [IN_PROJECT, ROLE_TARGET],
  [IN_REPO, ROLE_TARGET],
  [GLOBAL, OTHER_TARGET],
  [IN_PROJECT, OTHER_TARGET],
];

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly conversation: ConversationId;
  readonly other: ConversationId;
  readonly apply: ReturnType<typeof createActionApplier>;
  readonly undo: ReturnType<typeof createActionUndoer>;
}

const makeHarness = async (overrides: Partial<AppDeps> = {}, wrap?: (d: FakeDefinitionStore) => FakeDefinitionStore): Promise<Harness> => {
  const clock = createFakeClock(1_000_000);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed(IN_REPO, 'defs.json', JSON.stringify(REPO_DEFINITIONS));
  definitions.setProject(PROJECT_DEF);
  definitions.seed(IN_PROJECT, ROADMAP, ROADMAP_BEFORE);
  definitions.seed(IN_OTHER_PROJECT, ROADMAP, ROADMAP_BEFORE);
  definitions.seed(GLOBAL, ROLE_TARGET, rolesFile('Helper'));
  definitions.seed(IN_PROJECT, ROLE_TARGET, rolesFile('Helper'));
  definitions.seed(GLOBAL, OTHER_TARGET, rolesFile('Other'));
  const deps = createFakeDeps({ clock, log, definitions: wrap === undefined ? definitions : wrap(definitions), ...overrides });
  await deps.projects.save(PROJECT_DEF);
  const first = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'plan' }, by: USER });
  const second = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'other' }, by: USER });
  if (!first.ok || !second.ok) throw new Error('fixture conversations must start');
  return { deps, clock, log, definitions, conversation: first.value.id, other: second.value.id, apply: createActionApplier(deps), undo: createActionUndoer(deps) };
};

const code = (r: { readonly ok: boolean; readonly error?: { readonly code: string } }): string => (r.ok ? 'ok' : (r.error?.code ?? '?'));

const draftIn = async (h: Harness, conversation: ConversationId = h.conversation, over: { repo?: RepoSlug; title?: string } = {}): Promise<DraftId> => {
  const made = await createDraft(h.deps, { conversation, project: PROJECT, repo: over.repo ?? REPO, title: over.title ?? 'Add the login screen' });
  if (!made.ok) throw new Error('draft must create');
  return made.value.id;
};

const proposalOf = async (
  h: Harness,
  over: { scope?: DefinitionScope; target?: string; after?: string; author?: Actor; summary?: string } = {},
): Promise<ProposalId> => {
  const scope = over.scope ?? IN_PROJECT;
  const target = over.target ?? ROADMAP;
  const made = await createProposal(h.deps, {
    scope,
    target,
    after: over.after ?? (target === ROADMAP ? ROADMAP_AFTER : rolesFile('Renamed')),
    summary: over.summary ?? 'A change',
    author: over.author ?? AGENT,
  });
  if (!made.ok) throw new Error('proposal must create');
  return made.value;
};

const roadmapEdit = (proposal: ProposalId, project: ProjectSlug = PROJECT): AssistantAction => ({ kind: 'roadmap_edit', project, proposal });
const definitionEdit = (proposal: ProposalId, scope: DefinitionScope = IN_PROJECT, target: string = ROLE_TARGET): AssistantAction => ({
  kind: 'definition_edit',
  scope: scope as Extract<AssistantAction, { kind: 'definition_edit' }>['scope'],
  target,
  proposal,
});
const modeChange = (value: unknown): AssistantAction => ({ kind: 'setting_change', key: 'dispatch.mode', value });
const limitsChange = (value: unknown): AssistantAction => ({ kind: 'setting_change', key: 'dispatch.limits', value });

/** The assistant proposes without a grant, the operator approves: the applier sees the user authority. */
const approve = async (h: Harness, action: AssistantAction, conversation: ConversationId = h.conversation): Promise<ActionRecord> => {
  const proposed = await proposeAction(h.deps, { conversation, action, by: AGENT }, h.apply);
  if (!proposed.ok || proposed.value.decision.kind !== 'needs_approval') throw new Error('fixture must wait for approval');
  const decided = await decideActionUseCase(h.deps, { id: proposed.value.record.id, decision: 'approved', by: USER }, h.apply);
  if (!decided.ok) throw new Error(`fixture decide failed: ${decided.error.code}`);
  return decided.value;
};

const grantFor = async (h: Harness, classes: readonly AssistantAction['kind'][], conversation: ConversationId = h.conversation): Promise<Grant> => {
  const made = await grantPermission(h.deps, { conversation, classes, minutes: 30, by: USER });
  if (!made.ok) throw new Error('grant must be created');
  return made.value;
};

/** The assistant proposes under a grant: the applier sees the grant authority. */
const viaGrant = async (h: Harness, action: AssistantAction, grant: Grant): Promise<ActionRecord> => {
  const proposed = await proposeAction(h.deps, { conversation: grant.conversation, action, by: AGENT }, h.apply);
  if (!proposed.ok) throw new Error(`fixture propose failed: ${proposed.error.code}`);
  return proposed.value.record;
};

/** A pending record the applier can be called against directly, for context checks and forged actions. */
const pendingRecord = async (h: Harness, action: AssistantAction, conversation: ConversationId = h.conversation): Promise<ActionRecord> => {
  const proposed = await proposeAction(h.deps, { conversation, action, by: AGENT }, h.apply);
  if (!proposed.ok) throw new Error(`fixture propose failed: ${proposed.error.code}`);
  return proposed.value.record;
};

/** Everything an applier could change, serialized: stores, settings, drafts, and the audit entries
 *  of the underlying use cases. */
const world = async (h: Harness): Promise<string> => {
  const workOrders = await h.deps.workOrders.list({});
  return JSON.stringify({
    workOrders,
    events: await Promise.all(workOrders.map((w) => h.deps.workOrders.events(w.id))),
    proposals: await h.deps.proposals.list({}),
    files: await Promise.all(WATCHED.map(([scope, target]) => h.deps.definitions.readFile(scope, target))),
    drafts: [...(await h.deps.conversations.draftsOf(h.conversation)), ...(await h.deps.conversations.draftsOf(h.other))],
    settings: [await h.deps.settings.get('dispatch.limits'), await h.deps.settings.get('dispatch.mode')],
    audit: h.log.entries().filter((e) => !e.action.startsWith('action.') && !e.action.startsWith('grant.')),
  });
};

const settingOf = (h: Harness, key: string): Promise<unknown> => h.deps.settings.get(key);

const failedWith = (record: ActionRecord, failure: string): void => {
  expect(record.status).toBe('failed');
  expect(record.failure).toBe(failure);
  expect(record.undo).toBeUndefined();
};

const DEFAULT_LIMITS = { global: 4, perRepo: 3, perAccount: {} };

// --- A-187 ------------------------------------------------------------------------------------------

describe('authority and acting user (A-187)', () => {
  it('A-187: under the user authority the underlying use case acts as that user', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h);
    const record = await approve(h, roadmapEdit(proposal));
    expect(record).toMatchObject({ status: 'applied', decidedBy: { kind: 'user', id: 'u1' } });
    expect(await h.deps.proposals.get(proposal)).toMatchObject({ status: 'approved', decidedBy: ACTING_USER });
    expect(h.log.entries().find((e) => e.action === 'proposal.decided')?.actor).toEqual(ACTING_USER);
  });

  it('A-187: under a grant the underlying use case acts as the grant\'s creator, while the record and the action audit keep the grant', async () => {
    const h = await makeHarness();
    const g = await grantFor(h, ['roadmap_edit', 'open_work_order']);
    const proposal = await proposalOf(h);
    const record = await viaGrant(h, roadmapEdit(proposal), g);
    expect(record).toMatchObject({ status: 'applied', decidedBy: { kind: 'grant', grant: g.id } });
    expect(await h.deps.proposals.get(proposal)).toMatchObject({ status: 'approved', decidedBy: ACTING_USER });
    const opened = await viaGrant(h, { kind: 'open_work_order', draft: await draftIn(h) }, g);
    expect(opened.status).toBe('applied');
    const [workOrder] = await h.deps.workOrders.list({});
    expect(workOrder?.createdBy).toEqual(ACTING_USER);
    const applied = h.log.entries().filter((e) => e.action === 'action.applied');
    expect(applied.map((e) => e.detail)).toEqual([
      { action: record.id, class: 'roadmap_edit', authority: 'grant', grant: g.id },
      { action: opened.id, class: 'open_work_order', authority: 'grant', grant: g.id },
    ]);
    expect(applied.map((e) => e.actor)).toEqual([AGENT, AGENT]);
  });

  it('A-187: a grant that is missing, revoked, expired, another conversation\'s, not covering the class or not user-created is grant_invalid and nothing is applied', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h);
    const action = roadmapEdit(proposal);
    const pending = await pendingRecord(h, action);
    const ctx = { conversation: h.conversation, action: pending.id };
    const before = await world(h);

    const missing = ulidOf<'grant'>('01ARZ3NDEKTSV4RRFFQ69G5FZ6');
    const revoked = await grantFor(h, ['roadmap_edit']);
    await revokePermission(h.deps, { grant: revoked.id, by: USER });
    const expired = await grantFor(h, ['roadmap_edit']);
    h.clock.advance(31 * MINUTE);
    const live = await grantFor(h, ['roadmap_edit']);
    const foreign = await grantFor(h, ['roadmap_edit'], h.other);
    const wrongClass = await grantFor(h, ['setting_change']);
    const forged = await grantFor(h, ['roadmap_edit']);
    await h.deps.grants.save({ ...forged, by: { kind: 'agent', runId: AGENT.kind === 'agent' ? AGENT.runId : ('x' as RunId) } } as unknown as Grant);

    const fresh = await world(h);
    expect(fresh).toBe(before);
    for (const id of [missing, revoked.id, expired.id, foreign.id, wrongClass.id, forged.id]) {
      const answer = await h.apply(action, { kind: 'grant', grant: id }, ctx);
      expect(answer).toEqual({ ok: false, error: { code: 'grant_invalid' } });
    }
    expect(await world(h)).toBe(before);
    // The one valid grant still works, so the refusals above were about the grants, not the action.
    expect(await h.apply(action, { kind: 'grant', grant: live.id }, ctx)).toMatchObject({ ok: true });
  });

  it('A-187: a grant revoked after the use case chose it but before the applier ran is re-checked: the record fails with grant_invalid and nothing changes', async () => {
    const real = createFakeGrantRepo();
    const grants: GrantRepo = {
      ...real,
      forConversation: async (conversation) => {
        const listed = await real.forConversation(conversation);
        for (const g of listed) await real.save({ ...g, revokedAt: 1_000_000 });
        return listed;
      },
    };
    const h = await makeHarness({ grants });
    const g = await grantFor(h, ['setting_change']);
    const before = await world(h);
    const record = await viaGrant(h, modeChange('fixed'), g);
    failedWith(record, 'grant_invalid');
    expect(await world(h)).toBe(before);
  });

  it('A-187: the context must name a real record of this conversation and the same kind of action — otherwise action_mismatch and nothing is applied', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h);
    const action = roadmapEdit(proposal);
    const mine = await pendingRecord(h, action);
    const theirs = await pendingRecord(h, action, h.other);
    const differentKind = await pendingRecord(h, modeChange('fixed'));
    const before = await world(h);
    const unknown = ulidOf<'action'>('01ARZ3NDEKTSV4RRFFQ69G5FZ5');
    const user: ActionAuthority = { kind: 'user', id: 'u1' };
    expect(await h.apply(action, user, { conversation: h.conversation, action: unknown })).toEqual({ ok: false, error: { code: 'action_mismatch' } });
    expect(await h.apply(action, user, { conversation: h.conversation, action: theirs.id })).toEqual({ ok: false, error: { code: 'action_mismatch' } });
    expect(await h.apply(action, user, { conversation: h.other, action: mine.id })).toEqual({ ok: false, error: { code: 'action_mismatch' } });
    expect(await h.apply(action, user, { conversation: h.conversation, action: differentKind.id })).toEqual({ ok: false, error: { code: 'action_mismatch' } });
    expect(await world(h)).toBe(before);
  });
});

// --- A-188 ------------------------------------------------------------------------------------------

describe('open_work_order (A-188)', () => {
  it('A-188: approved, it opens the work order through confirmDraft, marks the draft confirmed and hands back a one-hour close undo', async () => {
    const h = await makeHarness();
    const draft = await draftIn(h);
    const record = await approve(h, { kind: 'open_work_order', draft });
    const [workOrder] = await h.deps.workOrders.list({});
    expect(workOrder).toMatchObject({ project: PROJECT, repo: REPO, title: 'Add the login screen', createdBy: ACTING_USER });
    expect(record).toMatchObject({ status: 'applied', undo: { kind: 'close_work_order', ref: workOrder?.id, expiresAt: 1_000_000 + HOUR } });
    expect(await h.deps.conversations.getDraft(draft)).toMatchObject({ status: 'confirmed', workOrder: workOrder?.id });
  });

  it('A-188: a draft from another conversation is draft_mismatch — no work order, the draft stays a draft', async () => {
    const h = await makeHarness();
    const foreign = await draftIn(h, h.other);
    const before = await world(h);
    const record = await approve(h, { kind: 'open_work_order', draft: foreign });
    failedWith(record, 'draft_mismatch');
    expect(await world(h)).toBe(before);
    expect((await h.deps.conversations.getDraft(foreign))?.status).toBe('draft');
  });

  it('A-188: an unknown draft is draft_not_found, a confirmed or dropped one is draft_not_pending and opens no second work order', async () => {
    const h = await makeHarness();
    const confirmed = await draftIn(h);
    expect((await approve(h, { kind: 'open_work_order', draft: confirmed })).status).toBe('applied');
    const dropped = await draftIn(h);
    await dropDraftUseCase(h.deps, { draft: dropped, by: USER });
    const before = await world(h);
    failedWith(await approve(h, { kind: 'open_work_order', draft: UNKNOWN_DRAFT }), 'draft_not_found');
    failedWith(await approve(h, { kind: 'open_work_order', draft: confirmed }), 'draft_not_pending');
    failedWith(await approve(h, { kind: 'open_work_order', draft: dropped }), 'draft_not_pending');
    expect(await world(h)).toBe(before);
    expect(await h.deps.workOrders.list({})).toHaveLength(1);
  });

  it('A-188: a draft that cannot be opened (unknown repo) is open_failed and stays a draft', async () => {
    const h = await makeHarness();
    const draft = await draftIn(h, h.conversation, { repo: slugOf('nowhere') });
    const before = await world(h);
    failedWith(await approve(h, { kind: 'open_work_order', draft }), 'open_failed');
    expect(await world(h)).toBe(before);
    expect((await h.deps.conversations.getDraft(draft))?.status).toBe('draft');
  });
});

// --- A-189 ------------------------------------------------------------------------------------------

describe('proposal binding for roadmap_edit and definition_edit (A-189)', () => {
  it('A-189: an unknown proposal is proposal_not_found; one that is approved, rejected or stale is proposal_not_pending', async () => {
    const h = await makeHarness();
    const approved = await proposalOf(h);
    await decideProposalUseCase(h.deps, { id: approved, decision: 'approved', actor: USER });
    const rejected = await proposalOf(h, { after: ROADMAP_AFTER + ' ' });
    await decideProposalUseCase(h.deps, { id: rejected, decision: 'rejected', actor: USER });
    const stale = await proposalOf(h, { after: ROADMAP_AFTER + '  ' });
    h.definitions.seed(IN_PROJECT, ROADMAP, JSON.stringify({ phases: [], moved: true }));
    await decideProposalUseCase(h.deps, { id: stale, decision: 'approved', actor: USER });
    expect((await h.deps.proposals.get(stale))?.status).toBe('stale');
    const before = await world(h);
    failedWith(await approve(h, roadmapEdit(UNKNOWN_PROPOSAL)), 'proposal_not_found');
    for (const id of [approved, rejected, stale]) failedWith(await approve(h, roadmapEdit(id)), 'proposal_not_pending');
    expect(await world(h)).toBe(before);
  });

  it('A-189: roadmap_edit refuses a proposal whose scope, target or project differs from the action in any field', async () => {
    const h = await makeHarness();
    const flowsInProject = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET });
    const roadmapInOtherProject = await proposalOf(h, { scope: IN_OTHER_PROJECT, target: ROADMAP });
    h.definitions.seed(GLOBAL, ROADMAP, ROADMAP_BEFORE);
    const roadmapInGlobal = await proposalOf(h, { scope: GLOBAL, target: ROADMAP });
    h.definitions.seed(IN_REPO, ROADMAP, ROADMAP_BEFORE);
    const roadmapInRepo = await proposalOf(h, { scope: IN_REPO, target: ROADMAP });
    const wrongName = await proposalOf(h, { scope: IN_PROJECT, target: 'project.yaml' });
    const rightOne = await proposalOf(h);
    const before = await world(h);
    for (const id of [flowsInProject, roadmapInGlobal, roadmapInRepo, wrongName]) failedWith(await approve(h, roadmapEdit(id)), 'proposal_mismatch');
    // Right proposal, wrong project in the action; and the other project's proposal for this project's action.
    failedWith(await approve(h, roadmapEdit(rightOne, OTHER_PROJECT)), 'proposal_mismatch');
    failedWith(await approve(h, roadmapEdit(roadmapInOtherProject)), 'proposal_mismatch');
    expect((await world(h)).replace(/"audit":.*$/, '')).toBe(before.replace(/"audit":.*$/, ''));
    expect((await h.deps.proposals.get(rightOne))?.status).toBe('pending');
  });

  it('A-189: definition_edit refuses a proposal whose scope kind, scope slug or target differs from the action, and roadmap.yaml in any shape', async () => {
    const h = await makeHarness();
    const rightOne = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET });
    const globalOne = await proposalOf(h, { scope: GLOBAL, target: ROLE_TARGET });
    const otherTarget = await proposalOf(h, { scope: IN_PROJECT, target: OTHER_TARGET });
    const roadmapOne = await proposalOf(h, { scope: IN_PROJECT, target: ROADMAP });
    const before = await world(h);
    // scope kind differs
    failedWith(await approve(h, definitionEdit(globalOne, IN_PROJECT)), 'proposal_mismatch');
    failedWith(await approve(h, definitionEdit(rightOne, GLOBAL)), 'proposal_mismatch');
    // scope slug differs
    failedWith(await approve(h, definitionEdit(rightOne, IN_OTHER_PROJECT)), 'proposal_mismatch');
    // target differs
    failedWith(await approve(h, definitionEdit(otherTarget, IN_PROJECT, ROLE_TARGET)), 'proposal_mismatch');
    // a roadmap proposal behind a definition_edit
    failedWith(await approve(h, definitionEdit(roadmapOne, IN_PROJECT, ROLE_TARGET)), 'proposal_mismatch');
    expect(await world(h)).toBe(before);

    // roadmap.yaml is refused even when an action naming it reaches the applier unvalidated.
    const pending = await pendingRecord(h, definitionEdit(rightOne));
    const forged = { kind: 'definition_edit', scope: IN_PROJECT, target: ROADMAP, proposal: roadmapOne } as unknown as AssistantAction;
    expect(await h.apply(forged, { kind: 'user', id: 'u1' }, { conversation: h.conversation, action: pending.id })).toEqual({ ok: false, error: { code: 'proposal_mismatch' } });
    expect((await h.deps.proposals.get(roadmapOne))?.status).toBe('pending');
    expect(await h.definitions.readFile(IN_PROJECT, ROADMAP)).toMatchObject({ content: ROADMAP_BEFORE });
  });

  it('A-189: a user-authored proposal is never approved through an assistant action, under approval or a grant; agent and system authors are', async () => {
    const h = await makeHarness();
    const g = await grantFor(h, ['roadmap_edit', 'definition_edit']);
    const byUser = await proposalOf(h, { author: USER });
    const byUserDefinition = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET, author: USER });
    const before = await world(h);
    failedWith(await approve(h, roadmapEdit(byUser), h.other), 'proposal_mismatch');
    failedWith(await viaGrant(h, roadmapEdit(byUser), g), 'proposal_mismatch');
    failedWith(await viaGrant(h, definitionEdit(byUserDefinition), g), 'proposal_mismatch');
    expect((await world(h)).replace(/"audit":.*$/, '')).toBe(before.replace(/"audit":.*$/, ''));
    expect((await h.deps.proposals.get(byUser))?.status).toBe('pending');
    const byAgent = await proposalOf(h, { author: AGENT });
    const bySystem = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET, author: SYSTEM });
    expect((await viaGrant(h, roadmapEdit(byAgent), g)).status).toBe('applied');
    expect((await viaGrant(h, definitionEdit(bySystem), g)).status).toBe('applied');
  });
});

// --- A-190 ------------------------------------------------------------------------------------------

describe('applying a proposal (A-190)', () => {
  it('A-190: roadmap_edit writes the proposal\'s content, approves it and hands back a one-hour revert undo', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h);
    const record = await approve(h, roadmapEdit(proposal));
    expect(record).toMatchObject({ status: 'applied', undo: { kind: 'revert_proposal', ref: proposal, expiresAt: 1_000_000 + HOUR } });
    expect(await h.definitions.readFile(IN_PROJECT, ROADMAP)).toMatchObject({ content: ROADMAP_AFTER });
    expect((await h.deps.proposals.get(proposal))?.status).toBe('approved');
  });

  it('A-190: definition_edit writes the proposal\'s content in its scope and hands back the same undo', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET });
    const record = await approve(h, definitionEdit(proposal));
    expect(record).toMatchObject({ status: 'applied', undo: { kind: 'revert_proposal', ref: proposal } });
    expect(await h.definitions.readFile(IN_PROJECT, ROLE_TARGET)).toMatchObject({ content: rolesFile('Renamed') });
    // The same target in another scope is untouched.
    expect(await h.definitions.readFile(GLOBAL, ROLE_TARGET)).toMatchObject({ content: rolesFile('Helper') });
  });

  it('A-190: a file that moved since the proposal is stale — nothing written, the record fails with stale', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h);
    const moved = JSON.stringify({ phases: [], moved: true });
    h.definitions.seed(IN_PROJECT, ROADMAP, moved);
    failedWith(await approve(h, roadmapEdit(proposal)), 'stale');
    expect(await h.definitions.readFile(IN_PROJECT, ROADMAP)).toMatchObject({ content: moved });
    expect((await h.deps.proposals.get(proposal))?.status).toBe('stale');
  });

  it('A-190: a candidate that no longer validates is invalid_after — nothing written, the proposal stays pending', async () => {
    const h = await makeHarness();
    const proposal = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET, after: INVALID_FILE });
    failedWith(await approve(h, definitionEdit(proposal)), 'invalid_after');
    expect(await h.definitions.readFile(IN_PROJECT, ROLE_TARGET)).toMatchObject({ content: rolesFile('Helper') });
    expect((await h.deps.proposals.get(proposal))?.status).toBe('pending');
  });
});

// --- A-191 ------------------------------------------------------------------------------------------

describe('setting_change (A-191)', () => {
  it('A-191: dispatch.mode fixed|auto is written through setDispatchLimits with the stored limits unchanged', async () => {
    const h = await makeHarness();
    await h.deps.settings.set('dispatch.limits', { global: 6, perRepo: 2, perAccount: {} });
    const record = await approve(h, modeChange('fixed'));
    expect(record).toMatchObject({ status: 'applied', undo: { kind: 'restore_setting', ref: `assistant.undo.${record.id}`, expiresAt: 1_000_000 + HOUR } });
    expect(await settingOf(h, 'dispatch.mode')).toBe('fixed');
    expect(await settingOf(h, 'dispatch.limits')).toEqual({ global: 6, perRepo: 2, perAccount: {} });
    expect(h.log.entries().some((e) => e.action === 'settings.dispatch_changed' && e.actor.kind === 'user')).toBe(true);
    expect((await approve(h, modeChange('auto'))).status).toBe('applied');
    expect(await settingOf(h, 'dispatch.mode')).toBe('auto');
  });

  it('A-191: dispatch.limits is validated by setDispatchLimits itself and leaves the mode alone', async () => {
    const h = await makeHarness();
    await h.deps.settings.set('dispatch.mode', 'fixed');
    const record = await approve(h, limitsChange({ global: 8, perRepo: 2, perAccount: {} }));
    expect(record.status).toBe('applied');
    expect(await settingOf(h, 'dispatch.limits')).toEqual({ global: 8, perRepo: 2, perAccount: {} });
    expect(await settingOf(h, 'dispatch.mode')).toBe('fixed');
  });

  it('A-191: hostile values — wrong type, out of range, malformed, huge — are invalid_value and change nothing', async () => {
    const h = await makeHarness();
    const before = await world(h);
    const hostileModes: unknown[] = ['manual', 'FIXED', 1, null, true, {}, ['fixed'], 'x'.repeat(10_000)];
    for (const value of hostileModes) {
      const pending = await pendingRecord(h, modeChange('auto'));
      expect(await h.apply(modeChange(value), { kind: 'user', id: 'u1' }, { conversation: h.conversation, action: pending.id })).toEqual({ ok: false, error: { code: 'invalid_value' } });
    }
    const bigAccounts = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`a${i}`, 1]));
    const hostileLimits: unknown[] = [
      'x',
      null,
      42,
      [],
      { global: 999, perRepo: 1, perAccount: {} },
      { global: 0, perRepo: 0, perAccount: {} },
      { global: 2, perRepo: 3, perAccount: {} },
      { global: 2.5, perRepo: 1, perAccount: {} },
      { global: 4, perRepo: 1, perAccount: [] },
      { global: 4, perRepo: 1, perAccount: { a: -1 } },
      { global: 4, perRepo: 1 },
      { global: 4, perRepo: 1, perAccount: bigAccounts },
    ];
    for (const value of hostileLimits) {
      const pending = await pendingRecord(h, modeChange('auto'));
      const answer = await h.apply(limitsChange(value), { kind: 'user', id: 'u1' }, { conversation: h.conversation, action: pending.id });
      expect(answer.ok ? 'ok' : answer.error.code, JSON.stringify(value).slice(0, 40)).toMatch(/^(invalid_value|unknown_account)$/);
    }
    expect((await world(h)).replace(/"audit":.*$/, '')).toBe(before.replace(/"audit":.*$/, ''));
    expect(await settingOf(h, 'dispatch.mode')).toBeUndefined();
    expect(await settingOf(h, 'dispatch.limits')).toBeUndefined();
  });

  it('A-191: a per-account limit for an unknown account is unknown_account and changes nothing', async () => {
    const h = await makeHarness();
    const record = await approve(h, limitsChange({ global: 4, perRepo: 2, perAccount: { nobody: 1 } }));
    failedWith(record, 'unknown_account');
    expect(await settingOf(h, 'dispatch.limits')).toBeUndefined();
    expect(await settingOf(h, `assistant.undo.${record.id}`)).not.toEqual(expect.objectContaining({ key: 'dispatch.limits', previous: expect.anything() }));
  });
});

// --- A-192 ------------------------------------------------------------------------------------------

describe('previous value before a setting change (A-192)', () => {
  it('A-192: the previous value is stored under assistant.undo.<action id> before the new one is written', async () => {
    const order: string[] = [];
    const base = createFakeAppSettingsRepo();
    const settings: AppSettingsRepo = {
      get: base.get,
      set: async (key, value) => {
        order.push(key);
        return base.set(key, value);
      },
    };
    const h = await makeHarness({ settings });
    await h.deps.settings.set('dispatch.limits', { global: 6, perRepo: 2, perAccount: {} });
    order.length = 0;
    const record = await approve(h, modeChange('fixed'));
    expect(order.slice(0, 2)).toEqual([`assistant.undo.${record.id}`, 'dispatch.limits']);
    expect(await settingOf(h, `assistant.undo.${record.id}`)).toEqual({ key: 'dispatch.mode', previous: 'auto' });
    const limits = await approve(h, limitsChange({ global: 3, perRepo: 1, perAccount: {} }));
    expect(await settingOf(h, `assistant.undo.${limits.id}`)).toEqual({ key: 'dispatch.limits', previous: { global: 6, perRepo: 2, perAccount: {} } });
  });

  it('A-192: with nothing stored the effective defaults are remembered, so undo restores the behaviour the operator had', async () => {
    const h = await makeHarness();
    const mode = await approve(h, modeChange('fixed'));
    const limits = await approve(h, limitsChange({ global: 3, perRepo: 1, perAccount: {} }));
    expect(await settingOf(h, `assistant.undo.${mode.id}`)).toEqual({ key: 'dispatch.mode', previous: 'auto' });
    expect(await settingOf(h, `assistant.undo.${limits.id}`)).toEqual({ key: 'dispatch.limits', previous: DEFAULT_LIMITS });
  });

  it('A-192: when the previous value cannot be saved nothing is applied and the record fails with undo_not_saved', async () => {
    const base = createFakeAppSettingsRepo();
    const settings: AppSettingsRepo = {
      get: base.get,
      set: async (key, value) => {
        if (key.startsWith('assistant.undo.')) throw new Error('disk full /secret/path');
        return base.set(key, value);
      },
    };
    const h = await makeHarness({ settings });
    const before = await world(h);
    failedWith(await approve(h, modeChange('fixed')), 'undo_not_saved');
    failedWith(await approve(h, limitsChange({ global: 3, perRepo: 1, perAccount: {} })), 'undo_not_saved');
    expect((await world(h)).replace(/"audit":.*$/, '')).toBe(before.replace(/"audit":.*$/, ''));
    expect(await settingOf(h, 'dispatch.mode')).toBeUndefined();
    expect(await settingOf(h, 'dispatch.limits')).toBeUndefined();
    expect(h.log.entries().some((e) => e.action === 'settings.dispatch_changed')).toBe(false);
  });
});

// --- A-193 ------------------------------------------------------------------------------------------

describe('undoing open_work_order (A-193)', () => {
  const opened = async (h: Harness) => {
    const record = await approve(h, { kind: 'open_work_order', draft: await draftIn(h) });
    const [workOrder] = await h.deps.workOrders.list({});
    if (workOrder === undefined) throw new Error('work order must exist');
    return { record, workOrder: workOrder.id };
  };

  it('A-193: an unstarted work order is closed as the operator and the record becomes undone', async () => {
    const h = await makeHarness();
    const { record, workOrder } = await opened(h);
    const undone = await undoAction(h.deps, { id: record.id, by: USER }, h.undo);
    expect(undone).toMatchObject({ ok: true, value: { status: 'undone' } });
    const events = await h.deps.workOrders.events(workOrder);
    expect(events.at(-1)).toMatchObject({ type: 'closed', by: USER });
    expect(h.log.entries().some((e) => e.action === 'work_order.closed' && e.actor.kind === 'user')).toBe(true);
  });

  it('A-193: once a run started it is work_started and nothing is closed; a closed work order is already_closed', async () => {
    const h = await makeHarness();
    const { record, workOrder } = await opened(h);
    await h.deps.workOrders.appendEvent(workOrder, { type: 'run_started', at: 1_000_001, runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR2'), stage: slugOf<'stage'>('only'), attempt: 1 });
    const before = await world(h);
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'work_started' } });
    expect(await undoAction(h.deps, { id: record.id, by: USER }, h.undo)).toEqual({ ok: false, error: { code: 'undo_failed' } });
    expect(await world(h)).toBe(before);
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');

    const other = await makeHarness();
    const second = await opened(other);
    await other.deps.workOrders.appendEvent(second.workOrder, { type: 'closed', at: 1_000_001, by: USER });
    expect(await other.undo(second.record, USER)).toEqual({ ok: false, error: { code: 'already_closed' } });
  });

  it('A-193: undoing twice closes once; an agent or system actor cannot undo, directly or through the use case', async () => {
    const h = await makeHarness();
    const { record, workOrder } = await opened(h);
    for (const by of [AGENT, SYSTEM]) {
      expect(await h.undo(record, by)).toEqual({ ok: false, error: { code: 'not_user' } });
      expect(code(await undoAction(h.deps, { id: record.id, by }, h.undo))).toBe('not_user');
    }
    expect(await h.deps.workOrders.events(workOrder)).toHaveLength(1);
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, h.undo))).toBe('ok');
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, h.undo))).toBe('not_applied');
    expect((await h.deps.workOrders.events(workOrder)).filter((e) => e.type === 'closed')).toHaveLength(1);
  });

  it('A-193: a record whose undo info is missing, of another kind than its action, or points at an unknown work order is undo_unavailable', async () => {
    const h = await makeHarness();
    const { record } = await opened(h);
    const before = await world(h);
    const { undo: _dropped, ...withoutUndo } = record;
    expect(await h.undo(withoutUndo, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await h.undo({ ...record, undo: { kind: 'revert_proposal', ref: record.undo?.ref ?? 'x', expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await h.undo({ ...record, undo: { kind: 'close_work_order', ref: '01ARZ3NDEKTSV4RRFFQ69G5FZ4', expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await world(h)).toBe(before);
  });
});

// --- A-194 ------------------------------------------------------------------------------------------

describe('undoing a proposal (A-194)', () => {
  const edited = async (h: Harness, kind: 'roadmap' | 'definition') => {
    const proposal = kind === 'roadmap' ? await proposalOf(h) : await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET });
    const record = await approve(h, kind === 'roadmap' ? roadmapEdit(proposal) : definitionEdit(proposal));
    return { record, proposal, scope: IN_PROJECT, target: kind === 'roadmap' ? ROADMAP : ROLE_TARGET, before: kind === 'roadmap' ? ROADMAP_BEFORE : rolesFile('Helper') };
  };

  it('A-194: the file goes back to the proposal\'s before through a reverse proposal authored by the system and approved by the operator', async () => {
    for (const kind of ['roadmap', 'definition'] as const) {
      const h = await makeHarness();
      const { record, proposal, scope, target, before } = await edited(h, kind);
      expect(code(await undoAction(h.deps, { id: record.id, by: USER }, h.undo))).toBe('ok');
      expect(await h.definitions.readFile(scope, target)).toMatchObject({ content: before });
      const all = await h.deps.proposals.list({});
      const reverse = all.find((p) => p.id !== proposal);
      expect(reverse).toMatchObject({ author: { kind: 'system', component: 'assistant-undo' }, status: 'approved', decidedBy: ACTING_USER, after: before });
      expect((await h.deps.proposals.get(proposal))?.status).toBe('approved');
    }
  });

  it('A-194: someone edited the file since — file_changed, the file keeps their edit and no reverse proposal is left', async () => {
    const h = await makeHarness();
    const { record, scope, target } = await edited(h, 'roadmap');
    const theirs = JSON.stringify({ phases: [], theirs: true });
    h.definitions.seed(scope, target, theirs);
    const proposals = await h.deps.proposals.list({});
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'file_changed' } });
    expect(await undoAction(h.deps, { id: record.id, by: USER }, h.undo)).toEqual({ ok: false, error: { code: 'undo_failed' } });
    expect(await h.definitions.readFile(scope, target)).toMatchObject({ content: theirs });
    expect(await h.deps.proposals.list({})).toEqual(proposals);
    expect((await h.deps.actions.get(record.id))?.status).toBe('applied');
  });

  it('A-194: an edit that lands between the check and the write makes the reverse stale: the edit survives and the reverse proposal is rejected, not left pending', async () => {
    const h = await makeHarness({}, (store) => ({
      ...store,
      writeFile: async (scope, target, content, expectedHash) => {
        if (content === ROADMAP_BEFORE) store.seed(scope, target, JSON.stringify({ phases: [], race: true }));
        return store.writeFile(scope, target, content, expectedHash);
      },
    }));
    const record = await approve(h, roadmapEdit(await proposalOf(h)));
    const answer = await h.undo(record, USER);
    expect(answer).toEqual({ ok: false, error: { code: 'stale' } });
    expect((await h.definitions.readFile(IN_PROJECT, ROADMAP))?.content).toBe(JSON.stringify({ phases: [], race: true }));
    expect((await h.deps.proposals.list({ status: 'pending' }))).toEqual([]);
  });

  it('A-194: a proposal that is not approved, or a ref that is not the action\'s proposal, is undo_unavailable; agent actors and a second undo do nothing', async () => {
    const h = await makeHarness();
    const { record, proposal } = await edited(h, 'roadmap');
    const before = await world(h);
    const another = await proposalOf(h, { scope: IN_PROJECT, target: OTHER_TARGET });
    expect(await h.undo({ ...record, undo: { kind: 'revert_proposal', ref: another, expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    for (const by of [AGENT, SYSTEM]) expect(await h.undo(record, by)).toEqual({ ok: false, error: { code: 'not_user' } });
    await h.deps.proposals.save({ ...(await h.deps.proposals.get(proposal) as NonNullable<Awaited<ReturnType<AppDeps['proposals']['get']>>>), status: 'rejected' });
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'proposal_not_approved' } });
    expect(await h.definitions.readFile(IN_PROJECT, ROADMAP)).toMatchObject({ content: ROADMAP_AFTER });
    expect(before).toBeDefined();
    const h2 = await makeHarness();
    const second = await edited(h2, 'roadmap');
    expect(code(await undoAction(h2.deps, { id: second.record.id, by: USER }, h2.undo))).toBe('ok');
    expect(code(await undoAction(h2.deps, { id: second.record.id, by: USER }, h2.undo))).toBe('not_applied');
    expect(await h2.deps.proposals.list({})).toHaveLength(2);
  });
});

// --- A-195 ------------------------------------------------------------------------------------------

describe('undoing a setting change (A-195)', () => {
  it('A-195: the previous mode and limits are restored through setDispatchLimits and the stored previous value is cleared', async () => {
    const h = await makeHarness();
    await h.deps.settings.set('dispatch.limits', { global: 6, perRepo: 2, perAccount: {} });
    await h.deps.settings.set('dispatch.mode', 'auto');
    const mode = await approve(h, modeChange('fixed'));
    expect(code(await undoAction(h.deps, { id: mode.id, by: USER }, h.undo))).toBe('ok');
    expect(await settingOf(h, 'dispatch.mode')).toBe('auto');
    expect(await settingOf(h, 'dispatch.limits')).toEqual({ global: 6, perRepo: 2, perAccount: {} });
    const limits = await approve(h, limitsChange({ global: 2, perRepo: 1, perAccount: {} }));
    expect(code(await undoAction(h.deps, { id: limits.id, by: USER }, h.undo))).toBe('ok');
    expect(await settingOf(h, 'dispatch.limits')).toEqual({ global: 6, perRepo: 2, perAccount: {} });
    expect(await settingOf(h, `assistant.undo.${mode.id}`)).toBeNull();
    expect(await settingOf(h, `assistant.undo.${limits.id}`)).toBeNull();
  });

  it('A-195: a missing, cleared, foreign or damaged stored value is undo_unavailable and changes no setting', async () => {
    const h = await makeHarness();
    const record = await approve(h, modeChange('fixed'));
    const ref = `assistant.undo.${record.id}`;
    const before = await world(h);
    expect(await h.undo({ ...record, undo: { kind: 'restore_setting', ref: 'assistant.undo.01ARZ3NDEKTSV4RRFFQ69G5FZ3', expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await h.undo({ ...record, undo: { kind: 'restore_setting', ref: 'dispatch.mode', expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    // Another action's stored previous value, with the same key, must not be reachable through a forged ref.
    const sibling = await approve(h, modeChange('auto'));
    await h.deps.settings.set('dispatch.mode', 'fixed');
    expect(await h.undo({ ...record, undo: { kind: 'restore_setting', ref: `assistant.undo.${sibling.id}`, expiresAt: record.undo?.expiresAt ?? 0 } }, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await settingOf(h, 'dispatch.mode')).toBe('fixed');
    await h.deps.settings.set(ref, { key: 'dispatch.limits', previous: DEFAULT_LIMITS });
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    await h.deps.settings.set(ref, 'garbage');
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    await h.deps.settings.set(ref, { key: 'dispatch.mode', previous: 'manual' });
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    await h.deps.settings.set(ref, null);
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
    expect(await settingOf(h, 'dispatch.mode')).toBe('fixed');
    expect(before).toBeDefined();
  });

  it('A-195: an agent or system actor cannot undo, and a second undo does nothing', async () => {
    const h = await makeHarness();
    const record = await approve(h, modeChange('fixed'));
    for (const by of [AGENT, SYSTEM]) {
      expect(await h.undo(record, by)).toEqual({ ok: false, error: { code: 'not_user' } });
      expect(code(await undoAction(h.deps, { id: record.id, by }, h.undo))).toBe('not_user');
    }
    expect(await settingOf(h, 'dispatch.mode')).toBe('fixed');
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, h.undo))).toBe('ok');
    expect(code(await undoAction(h.deps, { id: record.id, by: USER }, h.undo))).toBe('not_applied');
    expect(await h.undo(record, USER)).toEqual({ ok: false, error: { code: 'undo_unavailable' } });
  });
});

// --- A-196 ------------------------------------------------------------------------------------------

describe('codes only (A-196)', () => {
  it('A-196: every applier and undoer failure is a stable code, and no content reaches a record, an audit entry or the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const SECRET = 'TOP-SECRET-9f3a';
      const base = createFakeAppSettingsRepo();
      const settings: AppSettingsRepo = {
        get: base.get,
        set: async (key, value) => {
          if (key.startsWith('assistant.undo.') && JSON.stringify(value).includes(SECRET)) throw new Error(`cannot store ${SECRET}`);
          return base.set(key, value);
        },
      };
      const h = await makeHarness({ settings });
      const secretTarget = 'roles/secret-target-role.yaml';
      h.definitions.seed(IN_PROJECT, secretTarget, rolesFile('Before'));
      const secretProposal = await proposalOf(h, { scope: IN_PROJECT, target: secretTarget, after: rolesFile(SECRET), summary: `summary ${SECRET}` });
      const secretUserProposal = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET, after: rolesFile(SECRET), summary: SECRET, author: USER });
      const secretDraft = await draftIn(h, h.other, { title: `draft ${SECRET}` });
      const staleOne = await proposalOf(h, { scope: IN_PROJECT, target: ROLE_TARGET, after: rolesFile(`${SECRET} stale`) });
      h.definitions.seed(IN_PROJECT, ROLE_TARGET, rolesFile('moved'));

      const records: ActionRecord[] = [];
      records.push(await approve(h, { kind: 'open_work_order', draft: secretDraft }));
      records.push(await approve(h, definitionEdit(secretProposal, IN_PROJECT, OTHER_TARGET)));
      records.push(await approve(h, definitionEdit(secretUserProposal)));
      records.push(await approve(h, definitionEdit(staleOne)));
      records.push(await approve(h, limitsChange({ global: 4, perRepo: 1, perAccount: { [SECRET]: 1 } })));
      records.push(await approve(h, modeChange(SECRET)));
      records.push(await approve(h, definitionEdit(secretProposal, IN_PROJECT, secretTarget)));
      for (const record of records.slice(0, 6)) {
        expect(record.status).toBe('failed');
        expect(record.failure).toMatch(/^[a-z_]{1,64}$/);
      }
      const undoable = records[6] as ActionRecord;
      expect(undoable.status).toBe('applied');
      h.definitions.seed(IN_PROJECT, secretTarget, rolesFile(`${SECRET} edited by someone`));
      await undoAction(h.deps, { id: undoable.id, by: USER }, h.undo);

      // A record stores the action it was asked to apply; what must stay content-free is everything
      // the applier's answer produced: the failure code, the undo, the authority and the audit trail.
      const serialized = JSON.stringify({
        outcomes: (await h.deps.actions.forConversation(h.conversation)).map((r) => ({ failure: r.failure, undo: r.undo, decidedBy: r.decidedBy, status: r.status })),
        audit: h.log.entries().filter((e: AuditEntry) => e.action.startsWith('action.') || e.action.startsWith('grant.')).map((e) => e.detail),
      });
      for (const forbidden of [SECRET, 'secret-target', 'summary', 'Before', 'draft ']) expect(serialized).not.toContain(forbidden);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('A-196: an applier or undoer dependency that throws is absorbed into a code by the use case, never leaked', async () => {
    const proposals = { ...createFakeProposalRepo(), get: async () => { throw new Error('boom SECRET'); } };
    const h = await makeHarness({ proposals });
    const record = await approve(h, roadmapEdit(UNKNOWN_PROPOSAL));
    expect(record.status).toBe('failed');
    expect(record.failure).toMatch(/^[a-z_]{1,64}$/);
    expect(JSON.stringify(record)).not.toContain('SECRET');
  });
});
