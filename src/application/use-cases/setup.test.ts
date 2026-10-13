import { describe, expect, it } from 'vitest';

import { parseUlid, PROJECT_SETUP_PROPOSAL_TARGET, type Actor, type ProposalId } from '../../domain/index';

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
