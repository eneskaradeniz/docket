import { describe, expect, it } from 'vitest';

import { BUILTIN_FLOWS, parseUlid, PROJECT_SETUP_PROPOSAL_TARGET, type Actor, type GateDef, type ProposalId, type RepoFlow } from '../../domain/index';

import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeProposalRepo } from '../ports/fakes/index';

import {
  buildSetupProposal,
  canStartDocketAiSetup,
  createProjectSetupProposal,
  decideProjectSetupProposal,
  defaultSetupAnswers,
  loadSetupDraft,
  persistSetupDraftAfterAnswer,
  type SetupDraft,
  type SetupDraftStore,
} from './setup';

const USER: Actor = { kind: 'user', id: 'op' };
const runParsed = parseUlid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1');
if (!runParsed.ok) throw new Error('fixture run');
const AGENT: Actor = { kind: 'agent', runId: runParsed.value, role: 'developer' as never };

const memoryDraftStore = (): SetupDraftStore & { all(): readonly SetupDraft[] } => {
  const byId = new Map<string, SetupDraft>();
  return {
    save: async (draft) => {
      byId.set(draft.id, draft);
    },
    load: async (id) => byId.get(id),
    all: () => [...byId.values()],
  };
};

const commandGatesOf = (flow: RepoFlow): readonly GateDef[] =>
  flow.stages.flatMap((stage) => stage.exit.filter((gate) => gate.kind === 'command'));

const gateIdsOf = (flow: RepoFlow): readonly string[] => flow.stages.flatMap((stage) => stage.exit.map((gate) => `${stage.id}/${gate.id}`));

const withCommandSets = (commandSets: unknown): unknown => {
  const answers = defaultSetupAnswers('Acme', 'acme') as { repo: Record<string, unknown> };
  return { ...answers, repo: { ...answers.repo, commandSets } };
};

describe('setup use cases', () => {
  it('A-339: buildSetupProposal produces identical proposal shape across Quick, Detailed, and AI paths', () => {
    const answers = defaultSetupAnswers('Acme', 'acme');
    const quick = buildSetupProposal({ ...(answers as object), mode: 'quick' });
    const detailed = buildSetupProposal({ ...(answers as object), mode: 'detailed' });
    const ai = buildSetupProposal({ ...(answers as object), mode: 'ai' });
    expect(quick).toEqual(detailed);
    expect(detailed).toEqual(ai);
    expect(quick.project.name).toBe('Acme');
    expect(quick.repo.id).toBe('acme');
  });

  it('A-76: default answers never guess a test command; an empty commandSets gains the built-in sets', () => {
    const quick = buildSetupProposal(defaultSetupAnswers('Acme', 'acme'));
    expect(quick.repo.commandSets).toEqual({ tests: [] });
    const answers = defaultSetupAnswers('Acme', 'acme') as { repo: Record<string, unknown> };
    const ai = buildSetupProposal({ ...answers, repo: { ...answers.repo, commandSets: {} } });
    expect(ai.repo.commandSets).toEqual({ tests: [] });
    const kept = buildSetupProposal({ ...answers, repo: { ...answers.repo, commandSets: { tests: ['make test'], lint: ['x'] } } });
    expect(kept.repo.commandSets).toEqual({ tests: ['make test'], lint: ['x'] });
  });

  it('A-419: an empty test command drops every command gate bound to an empty set from the flow copy, and only those', () => {
    const answers = defaultSetupAnswers('Acme', 'acme') as { repo: { flow: RepoFlow } };
    const full = gateIdsOf(answers.repo.flow);
    expect(commandGatesOf(answers.repo.flow).length).toBeGreaterThan(0);
    const proposal = buildSetupProposal(answers);
    expect(proposal.repo.commandSets).toEqual({ tests: [] });
    expect(commandGatesOf(proposal.repo.flow)).toEqual([]);
    expect(gateIdsOf(proposal.repo.flow)).toEqual(full.filter((id) => !id.endsWith('/tests')));
    expect(proposal.repo.flow.bindings).toEqual(answers.repo.flow.bindings);
  });

  it('A-419: a filled test command keeps the flow copy and its command gate', () => {
    const answers = withCommandSets({ tests: ['npm test'] }) as { repo: { flow: RepoFlow } };
    const proposal = buildSetupProposal(answers);
    expect(proposal.repo.commandSets).toEqual({ tests: ['npm test'] });
    expect(proposal.repo.flow.stages).toEqual(answers.repo.flow.stages);
    expect(commandGatesOf(proposal.repo.flow)).not.toEqual([]);
  });

  it('A-419: an AI-path proposal with commandSets {} is pruned like an empty test command', () => {
    const quick = buildSetupProposal(defaultSetupAnswers('Acme', 'acme'));
    const ai = buildSetupProposal(withCommandSets({}));
    expect(ai.repo.commandSets).toEqual({ tests: [] });
    expect(ai.repo.flow).toEqual(quick.repo.flow);
  });

  it('A-419: a command gate bound to a still-filled set is kept while the empty-set gate is dropped', () => {
    const answers = defaultSetupAnswers('Acme', 'acme') as { repo: { flow: RepoFlow } };
    const gate: GateDef = { kind: 'command', id: 'lint' as never, commandSet: 'lint' };
    const [first, ...rest] = answers.repo.flow.stages;
    if (first === undefined) throw new Error('flow stage');
    const flow: RepoFlow = { ...answers.repo.flow, stages: [{ ...first, exit: [...first.exit, gate] }, ...rest] };
    const proposal = buildSetupProposal({ repo: { ...answers.repo, flow, commandSets: { tests: [], lint: ['npm run lint'] } }, project: { name: 'Acme', repos: ['acme'] } });
    expect(commandGatesOf(proposal.repo.flow)).toEqual([gate]);
  });

  it('A-419: pruning leaves the library flows and the input answers untouched', () => {
    const before = JSON.stringify(BUILTIN_FLOWS);
    const answers = defaultSetupAnswers('Acme', 'acme');
    const answersBefore = JSON.stringify(answers);
    buildSetupProposal(answers);
    expect(JSON.stringify(BUILTIN_FLOWS)).toBe(before);
    expect(JSON.stringify(answers)).toBe(answersBefore);
    expect(BUILTIN_FLOWS.flatMap((flow) => flow.stages.flatMap((stage) => stage.exit)).some((gate) => gate.kind === 'command')).toBe(true);
  });

  it('A-419: createProjectSetupProposal stores the pruned flow copy, so approval writes what was reviewed', async () => {
    const proposals = createFakeProposalRepo();
    const definitions = createFakeDefinitionStore();
    const deps = createFakeDeps({ proposals, definitions, clock: createFakeClock(10) });
    const answers = defaultSetupAnswers('Acme', 'acme') as { repo: Record<string, unknown> };
    const raw = { ...buildSetupProposal(answers), repo: { ...buildSetupProposal(answers).repo, flow: answers.repo['flow'] as RepoFlow } };
    const created = await createProjectSetupProposal(deps, { proposal: raw, author: AGENT });
    if (!created.ok) throw new Error('create');
    const stored = JSON.parse((await proposals.get(created.value))?.after ?? '{}') as { repo: { flow: RepoFlow } };
    expect(commandGatesOf(stored.repo.flow)).toEqual([]);
    const decided = await decideProjectSetupProposal(deps, { id: created.value, decision: 'approved', actor: USER });
    expect(decided.ok).toBe(true);
    const written = JSON.parse((await definitions.readFile('repos/acme/repo.yaml'))?.content ?? '{}') as { flow: RepoFlow; commandSets: unknown };
    expect(commandGatesOf(written.flow)).toEqual([]);
    expect(written.commandSets).toEqual({ tests: [] });
  });

  it('A-76: createProjectSetupProposal stores a proposal whose empty commandSets gained the built-in sets', async () => {
    const proposals = createFakeProposalRepo();
    const deps = createFakeDeps({ proposals, clock: createFakeClock(10) });
    const base = buildSetupProposal(defaultSetupAnswers('Acme', 'acme'));
    const created = await createProjectSetupProposal(deps, {
      proposal: { ...base, repo: { ...base.repo, commandSets: {} } },
      author: AGENT,
    });
    if (!created.ok) throw new Error('create');
    const stored = await proposals.get(created.value);
    expect(JSON.parse(stored?.after ?? '{}').repo.commandSets).toEqual({ tests: [] });
  });

  it('A-338: approving project_setup writes definitions; rejecting keeps the setup draft', async () => {
    const definitions = createFakeDefinitionStore();
    const proposals = createFakeProposalRepo();
    const deps = createFakeDeps({ definitions, proposals, clock: createFakeClock(10) });
    const proposalBody = buildSetupProposal(defaultSetupAnswers('Acme', 'acme'));
    const created = await createProjectSetupProposal(deps, { proposal: proposalBody, author: AGENT });
    if (!created.ok) throw new Error('create');
    const draftStore = memoryDraftStore();
    await persistSetupDraftAfterAnswer(deps, draftStore, { id: 'draft-1', repoPath: '/repo', mode: 'quick', answers: defaultSetupAnswers('Acme', 'acme') });

    const rejected = await decideProjectSetupProposal(deps, {
      id: created.value,
      decision: 'rejected',
      actor: USER,
      draftStore,
      draftId: 'draft-1',
    });
    expect(rejected.ok).toBe(true);
    expect(await definitions.readFile('projects/acme/project.yaml')).toBeUndefined();
    expect(draftStore.all()).toHaveLength(1);

    const created2 = await createProjectSetupProposal(deps, { proposal: proposalBody, author: AGENT });
    if (!created2.ok) throw new Error('create2');
    const approved = await decideProjectSetupProposal(deps, { id: created2.value, decision: 'approved', actor: USER });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error}`);
    expect(approved.ok).toBe(true);
    expect((await definitions.readFile('projects/acme/project.yaml'))?.content).toContain('Acme');
    expect((await definitions.readFile('repos/acme/repo.yaml'))?.content).toContain('acme');
  });

  it('A-340: no connected provider returns typed no_provider; setup drafts persist without secrets or file content', async () => {
    const deps = createFakeDeps({ mcpEndpoint: undefined });
    expect(await canStartDocketAiSetup(deps)).toEqual({ ok: false, error: 'no_provider' });

    const store = memoryDraftStore();
    const draft = await persistSetupDraftAfterAnswer(createFakeDeps({ clock: createFakeClock(1) }), store, {
      id: 'd1',
      repoPath: '/Users/op/work/acme',
      mode: 'detailed',
      answers: defaultSetupAnswers('Acme', 'acme'),
    });
    const loaded = await loadSetupDraft(store, 'd1');
    expect(loaded).toEqual(draft);
    expect(JSON.stringify(loaded)).not.toMatch(/api_key|BEGIN PRIVATE KEY/);
    expect(JSON.stringify(loaded)).not.toContain('file content from agent');
  });

  it('A-338: project_setup proposals use the fixed target', async () => {
    const proposals = createFakeProposalRepo();
    const deps = createFakeDeps({ proposals, clock: createFakeClock(1) });
    const id = await createProjectSetupProposal(deps, { proposal: buildSetupProposal(defaultSetupAnswers('X', 'x')), author: AGENT });
    if (!id.ok) throw new Error('create');
    const stored = await proposals.get(id.value as ProposalId);
    expect(stored?.target).toBe(PROJECT_SETUP_PROPOSAL_TARGET);
  });
});
