// Headless scenario for the real appliers: the assistant proposes, the operator approves or grants,
// each of the four action kinds really changes the world and is taken back with undo — and a sweep
// in which the assistant tries every forbidden or mismatched combination and nothing changes.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type ActionRecord, type Actor, type AssistantAction, type DraftId, type ProjectDef, type ProposalId, type RunId, type RoleSlug, type Ulid } from '../../domain/index';
import type { AppDeps, DefinitionScope } from '../ports';
import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog, type FakeDefinitionStore } from '../ports/fakes';
import { createActionApplier, createActionUndoer } from '../services';
import { createDraft, createProposal, decideActionUseCase, grantPermission, proposeAction, startConversationUseCase, undoAction } from '../use-cases';

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

const PROJECT = slugOf<'project'>('atolye');
const REPO = slugOf<'repo'>('acme');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FR1') as RunId, role: slugOf<'role'>('planner') as RoleSlug };
const IN_PROJECT: DefinitionScope = { kind: 'project', project: PROJECT };
const IN_REPO: DefinitionScope = { kind: 'repo', repo: REPO };
const PROJECT_DEF: ProjectDef = { id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] };
const REPO_BODY = {
  roles: [],
  flows: [{ id: 'flow-b', name: 'Flow B', stages: [{ id: 'only', name: 'Only', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] }] }],
  capabilities: [],
  repo: { id: 'acme', name: 'Acme', repos: [], flows: ['flow-b'], defaultFlow: 'flow-b', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
};
const rolesFile = (name: string): string => JSON.stringify({ roles: [{ id: 'helper', name, instructions: 'help', writeScope: { kind: 'repo' }, capabilities: [], active: true }] });
const ROADMAP_BEFORE = JSON.stringify({ phases: [] });

interface World {
  readonly deps: AppDeps;
  readonly definitions: FakeDefinitionStore;
  readonly conversation: ReturnType<typeof ulidOf<'conversation'>>;
  readonly other: ReturnType<typeof ulidOf<'conversation'>>;
  readonly apply: ReturnType<typeof createActionApplier>;
  readonly undo: ReturnType<typeof createActionUndoer>;
}

const build = async (): Promise<World> => {
  const definitions = createFakeDefinitionStore();
  definitions.seed(IN_REPO, 'defs.json', JSON.stringify(REPO_BODY));
  definitions.setProject(PROJECT_DEF);
  definitions.seed(IN_PROJECT, 'roadmap.yaml', ROADMAP_BEFORE);
  definitions.seed(IN_PROJECT, 'roles/helper.yaml', rolesFile('Helper'));
  const deps = createFakeDeps({ clock: createFakeClock(1_000_000), log: createFakeEventLog(), definitions });
  await deps.projects.save(PROJECT_DEF);
  const a = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'plan' }, by: USER });
  const b = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: 'other' }, by: USER });
  if (!a.ok || !b.ok) throw new Error('conversations must start');
  return { deps, definitions, conversation: a.value.id, other: b.value.id, apply: createActionApplier(deps), undo: createActionUndoer(deps) };
};

const newProposal = async (w: World, target: string, after: string, author: Actor = AGENT): Promise<ProposalId> => {
  const made = await createProposal(w.deps, { scope: IN_PROJECT, target, after, summary: 's', author });
  if (!made.ok) throw new Error('proposal must create');
  return made.value;
};

const newDraft = async (w: World, conversation = w.conversation): Promise<DraftId> => {
  const made = await createDraft(w.deps, { conversation, project: PROJECT, repo: REPO, title: 'Add the login screen' });
  if (!made.ok) throw new Error('draft must create');
  return made.value.id;
};

const byApproval = async (w: World, action: AssistantAction): Promise<ActionRecord> => {
  const proposed = await proposeAction(w.deps, { conversation: w.conversation, action, by: AGENT }, w.apply);
  if (!proposed.ok) throw new Error(`propose failed: ${proposed.error.code}`);
  const decided = await decideActionUseCase(w.deps, { id: proposed.value.record.id, decision: 'approved', by: USER }, w.apply);
  if (!decided.ok) throw new Error('decide failed');
  return decided.value;
};

const byGrant = async (w: World, action: AssistantAction): Promise<ActionRecord> => {
  const proposed = await proposeAction(w.deps, { conversation: w.conversation, action, by: AGENT }, w.apply);
  if (!proposed.ok) throw new Error(`propose failed: ${proposed.error.code}`);
  return proposed.value.record;
};

describe('action appliers scenario', () => {
  const kinds: readonly [string, (w: World) => Promise<AssistantAction>, (w: World) => Promise<boolean>, (w: World) => Promise<boolean>][] = [
    [
      'open_work_order',
      async (w) => ({ kind: 'open_work_order', draft: await newDraft(w) }),
      async (w) => (await w.deps.workOrders.list({})).length === 1,
      async (w) => (await w.deps.workOrders.events((await w.deps.workOrders.list({}))[0]?.id as never)).some((e) => e.type === 'closed'),
    ],
    [
      'roadmap_edit',
      async (w) => ({ kind: 'roadmap_edit', project: PROJECT, proposal: await newProposal(w, 'roadmap.yaml', JSON.stringify({ phases: [], note: 'x' })) }),
      async (w) => (await w.definitions.readFile(IN_PROJECT, 'roadmap.yaml'))?.content !== ROADMAP_BEFORE,
      async (w) => (await w.definitions.readFile(IN_PROJECT, 'roadmap.yaml'))?.content === ROADMAP_BEFORE,
    ],
    [
      'definition_edit',
      async (w) => ({ kind: 'definition_edit', scope: IN_PROJECT as never, target: 'roles/helper.yaml', proposal: await newProposal(w, 'roles/helper.yaml', rolesFile('Renamed')) }),
      async (w) => (await w.definitions.readFile(IN_PROJECT, 'roles/helper.yaml'))?.content === rolesFile('Renamed'),
      async (w) => (await w.definitions.readFile(IN_PROJECT, 'roles/helper.yaml'))?.content === rolesFile('Helper'),
    ],
    [
      'setting_change',
      async () => ({ kind: 'setting_change', key: 'dispatch.mode', value: 'fixed' }),
      async (w) => (await w.deps.settings.get('dispatch.mode')) === 'fixed',
      async (w) => (await w.deps.settings.get('dispatch.mode')) === 'auto',
    ],
  ];

  for (const [name, make, changed, restored] of kinds) {
    it(`approval path: ${name} applies as the operator and is taken back by undo`, async () => {
      const w = await build();
      const record = await byApproval(w, await make(w));
      expect(record).toMatchObject({ status: 'applied', decidedBy: { kind: 'user', id: 'u1' } });
      expect(await changed(w)).toBe(true);
      expect(await undoAction(w.deps, { id: record.id, by: USER }, w.undo)).toMatchObject({ ok: true, value: { status: 'undone' } });
      expect(await restored(w)).toBe(true);
    });

    it(`grant path: ${name} applies under a grant without a card and is taken back by undo`, async () => {
      const w = await build();
      const granted = await grantPermission(w.deps, { conversation: w.conversation, classes: ['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change'], minutes: 30, by: USER });
      if (!granted.ok) throw new Error('grant must be created');
      const record = await byGrant(w, await make(w));
      expect(record).toMatchObject({ status: 'applied', decidedBy: { kind: 'grant', grant: granted.value.id } });
      expect(await changed(w)).toBe(true);
      expect(await undoAction(w.deps, { id: record.id, by: USER }, w.undo)).toMatchObject({ ok: true, value: { status: 'undone' } });
      expect(await restored(w)).toBe(true);
    });
  }

  it('sweep: every forbidden or mismatched combination ends failed or refused with nothing applied', async () => {
    const w = await build();
    const granted = await grantPermission(w.deps, { conversation: w.conversation, classes: ['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change'], minutes: 30, by: USER });
    if (!granted.ok) throw new Error('grant must be created');
    w.definitions.seed(IN_PROJECT, 'roles/other.yaml', rolesFile('Other'));
    const foreignDraft = await newDraft(w, w.other);
    const userProposal = await newProposal(w, 'roadmap.yaml', JSON.stringify({ phases: [], by: 'user' }), USER);
    const roadmapProposal = await newProposal(w, 'roadmap.yaml', JSON.stringify({ phases: [], by: 'agent' }));
    const roleProposal = await newProposal(w, 'roles/helper.yaml', rolesFile('Renamed'));
    const otherRoleProposal = await newProposal(w, 'roles/other.yaml', rolesFile('Renamed other'));
    const snapshot = async (): Promise<string> =>
      JSON.stringify([
        await w.deps.workOrders.list({}),
        await w.deps.proposals.list({}),
        await w.definitions.readFile(IN_PROJECT, 'roadmap.yaml'),
        await w.definitions.readFile(IN_PROJECT, 'roles/helper.yaml'),
        await w.definitions.readFile(IN_PROJECT, 'roles/other.yaml'),
        await w.deps.settings.get('dispatch.mode'),
        await w.deps.settings.get('dispatch.limits'),
        await w.deps.conversations.draftsOf(w.other),
      ]);
    const before = await snapshot();

    const attempts: readonly unknown[] = [
      { kind: 'open_work_order', draft: foreignDraft },
      { kind: 'roadmap_edit', project: PROJECT, proposal: userProposal },
      { kind: 'roadmap_edit', project: PROJECT, proposal: roleProposal },
      { kind: 'roadmap_edit', project: slugOf<'project'>('ghost'), proposal: roadmapProposal },
      { kind: 'definition_edit', scope: IN_PROJECT, target: 'roles/helper.yaml', proposal: roadmapProposal },
      { kind: 'definition_edit', scope: IN_PROJECT, target: 'roles/helper.yaml', proposal: otherRoleProposal },
      { kind: 'definition_edit', scope: { kind: 'global' }, target: 'roles/helper.yaml', proposal: roleProposal },
      { kind: 'setting_change', key: 'dispatch.mode', value: 'maybe' },
      { kind: 'setting_change', key: 'dispatch.limits', value: { global: 99, perRepo: 1, perAccount: {} } },
      { kind: 'gate_decide', gate: 'x' },
      { kind: 'merge' },
      { kind: 'definition_edit', scope: IN_PROJECT, target: 'roadmap.yaml', proposal: roadmapProposal },
    ];
    for (const attempt of attempts) {
      const proposed = await proposeAction(w.deps, { conversation: w.conversation, action: attempt, by: AGENT }, w.apply);
      if (proposed.ok) expect(proposed.value.record.status, JSON.stringify(attempt)).toBe('failed');
      else expect(proposed.error.code).toMatch(/^[a-z_]+$/);
    }
    for (const action of await w.deps.actions.pending(w.conversation)) {
      const decided = await decideActionUseCase(w.deps, { id: action.id, decision: 'approved', by: USER }, w.apply);
      if (decided.ok) expect(decided.value.status).toBe('failed');
    }
    expect(await snapshot()).toBe(before);
    expect((await w.deps.actions.forConversation(w.conversation)).every((r) => r.status === 'failed')).toBe(true);
  });
});
