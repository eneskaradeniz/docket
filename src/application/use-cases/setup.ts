// use-cases/setup.ts — SetupProposal builder, drafts and project_setup proposal execution (A-338 … A-340).
import type {
  Actor,
  FlowDef,
  LimitPolicy,
  ProposalId,
  RepoFlow,
  RepoSlug,
  Result,
} from '../../domain/index';
import {
  BUILTIN_COMMAND_SET_NAMES,
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  decideProposal,
  err,
  ok,
  PROJECT_SETUP_PROPOSAL_TARGET,
  validateDefinitions,
  type SetupWarning,
} from '../../domain/index';

import type { AppDeps, DefinitionScope } from '../ports';

export interface SetupProposal {
  readonly project: { readonly name: string; readonly repos: readonly string[] };
  readonly repo: {
    readonly id: string;
    readonly flow: RepoFlow;
    readonly defaultLimitPolicy: LimitPolicy;
    readonly commandSets: Readonly<Record<string, readonly string[]>>;
    readonly docsRoot: string;
    readonly testGlobs: readonly string[];
  };
  readonly warnings: readonly SetupWarning[];
  readonly differsFromRecommended: readonly string[];
}

export interface SetupDraft {
  readonly id: string;
  readonly repoPath: string;
  readonly mode: 'quick' | 'detailed' | 'ai';
  readonly answers: unknown;
  readonly updatedAt: number;
}

export interface SetupDraftStore {
  save(draft: SetupDraft): Promise<void>;
  load(id: string): Promise<SetupDraft | undefined>;
  /** The newest stored draft — the resume read (A-340, A-358). Optional so the in-memory fakes
   *  of the pre-wiring tests keep satisfying the port. */
  newest?(): Promise<SetupDraft | undefined>;
}

export type DocketAiStartError = 'no_provider';

const GLOBAL_SCOPE: DefinitionScope = { kind: 'global' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A-76: a built-in command set the proposal does not name is filled with [] — Docket never guesses a command. */
export const withBuiltinCommandSets = (
  commandSets: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> => {
  const filled: Record<string, readonly string[]> = { ...commandSets };
  for (const name of BUILTIN_COMMAND_SET_NAMES) filled[name] = filled[name] ?? [];
  return filled;
};

/** A-339: the same answers yield the same proposal regardless of setup path. */
export function buildSetupProposal(answers: unknown): SetupProposal {
  if (!isRecord(answers)) throw new Error('setup answers must be an object');
  const project = answers['project'];
  const repo = answers['repo'];
  if (!isRecord(project) || !isRecord(repo)) throw new Error('setup answers need project and repo');
  const name = project['name'];
  const repos = project['repos'];
  const repoId = repo['id'];
  const flow = repo['flow'];
  const defaultLimitPolicy = repo['defaultLimitPolicy'];
  const commandSets = repo['commandSets'];
  const docsRoot = repo['docsRoot'];
  const testGlobs = repo['testGlobs'];
  if (
    typeof name !== 'string' ||
    !Array.isArray(repos) ||
    typeof repoId !== 'string' ||
    !isRecord(flow) ||
    typeof defaultLimitPolicy !== 'string' ||
    !isRecord(commandSets)
  ) {
    throw new Error('setup answers are incomplete');
  }
  const warnings = Array.isArray(answers['warnings']) ? (answers['warnings'] as SetupWarning[]) : [];
  const differs = Array.isArray(answers['differsFromRecommended'])
    ? answers['differsFromRecommended'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    project: { name, repos: repos.filter((entry): entry is string => typeof entry === 'string') },
    repo: {
      id: repoId,
      flow: flow as unknown as RepoFlow,
      defaultLimitPolicy: defaultLimitPolicy as LimitPolicy,
      commandSets: withBuiltinCommandSets(commandSets as Readonly<Record<string, readonly string[]>>),
      docsRoot: typeof docsRoot === 'string' ? docsRoot : 'docs',
      testGlobs: Array.isArray(testGlobs) ? testGlobs.filter((g): g is string => typeof g === 'string') : ['**/*.test.ts'],
    },
    warnings,
    differsFromRecommended: differs,
  };
}

export async function saveSetupDraft(store: SetupDraftStore, draft: SetupDraft): Promise<void> {
  await store.save(draft);
}

export async function loadSetupDraft(store: SetupDraftStore, id: string): Promise<SetupDraft | undefined> {
  return store.load(id);
}

export async function persistSetupDraftAfterAnswer(
  deps: Pick<AppDeps, 'clock'>,
  store: SetupDraftStore,
  input: { readonly id: string; readonly repoPath: string; readonly mode: SetupDraft['mode']; readonly answers: unknown },
): Promise<SetupDraft> {
  const draft: SetupDraft = { ...input, updatedAt: deps.clock.now() };
  await store.save(draft);
  return draft;
}

export async function canStartDocketAiSetup(
  deps: Pick<AppDeps, 'accounts' | 'transports' | 'capabilities' | 'mcpEndpoint'>,
): Promise<Result<void, DocketAiStartError>> {
  if (deps.mcpEndpoint === undefined) return err('no_provider');
  const accounts = await deps.accounts.list();
  for (const account of accounts) {
    if (deps.capabilities.mcpSupport(account.provider) === false) continue;
    const transport = await deps.transports.forAccount(account.id);
    if (transport !== undefined) return ok(undefined);
  }
  return err('no_provider');
}

const projectYamlOf = (proposal: SetupProposal, slug: RepoSlug): string =>
  `${JSON.stringify({ id: slug, name: proposal.project.name, repos: proposal.project.repos }, null, 2)}\n`;

const repoYamlOf = (proposal: SetupProposal): string =>
  `${JSON.stringify(
    {
      id: proposal.repo.id,
      name: proposal.repo.id,
      flow: proposal.repo.flow,
      defaultLimitPolicy: proposal.repo.defaultLimitPolicy,
      commandSets: proposal.repo.commandSets,
      docsRoot: proposal.repo.docsRoot,
      testGlobs: proposal.repo.testGlobs,
    },
    null,
    2,
  )}\n`;

export async function createProjectSetupProposal(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals'>,
  input: { readonly proposal: SetupProposal; readonly author: Actor; readonly draftId?: string },
): Promise<Result<ProposalId, 'invalid'>> {
  const proposal: SetupProposal = {
    ...input.proposal,
    repo: { ...input.proposal.repo, commandSets: withBuiltinCommandSets(input.proposal.repo.commandSets) },
  };
  const checked = validateDefinitions({
    roles: BUILTIN_ROLES,
    flows: BUILTIN_FLOWS,
    capabilities: [],
    project: { id: proposal.repo.id as RepoSlug, name: proposal.project.name, repos: proposal.project.repos as readonly RepoSlug[] },
    repo: {
      id: proposal.repo.id as RepoSlug,
      name: proposal.repo.id,
      flow: proposal.repo.flow,
      defaultLimitPolicy: proposal.repo.defaultLimitPolicy,
      commandSets: proposal.repo.commandSets,
      docsRoot: proposal.repo.docsRoot,
      testGlobs: proposal.repo.testGlobs,
    },
  });
  if (!checked.ok) return err('invalid');

  const id = deps.ids.next<'proposal'>();
  const createdAt = deps.clock.now();
  await deps.proposals.save({
    id,
    author: input.author,
    createdAt,
    target: PROJECT_SETUP_PROPOSAL_TARGET,
    baseHash: '',
    before: '',
    after: JSON.stringify(proposal),
    summary: `Set up project ${proposal.project.name}`,
    status: 'pending',
    scope: GLOBAL_SCOPE,
  });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: createdAt,
    actor: input.author,
    action: 'proposal.created',
    subject: { kind: 'proposal', id },
    detail: { target: PROJECT_SETUP_PROPOSAL_TARGET, ...(input.draftId === undefined ? {} : { draftId: input.draftId }) },
  });
  return ok(id);
}

export type DecideProjectSetupError = 'not_found' | 'not_pending' | 'stale' | 'self_approval' | 'invalid_after' | 'not_project_setup';

export async function decideProjectSetupProposal(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals' | 'definitions'>,
  input: {
    readonly id: ProposalId;
    readonly decision: 'approved' | 'rejected';
    readonly actor: Actor;
    readonly draftStore?: SetupDraftStore;
    readonly draftId?: string;
  },
): Promise<Result<void, DecideProjectSetupError>> {
  const proposal = await deps.proposals.get(input.id);
  if (proposal === undefined) return err('not_found');
  if (proposal.target !== PROJECT_SETUP_PROPOSAL_TARGET) return err('not_project_setup');

  const setup = parseStoredSetupProposal(proposal.after);
  if (setup === undefined) return err('invalid_after');

  const decided = decideProposal(proposal, input.decision, input.actor, proposal.baseHash, deps.clock.now());
  if (!decided.ok) return err(decided.error.code);

  if (input.decision === 'approved') {
    const slug = setup.repo.id as RepoSlug;
    const projectPath = `projects/${slug}/project.yaml`;
    const repoPath = `repos/${slug}/repo.yaml`;
    const projectBody = projectYamlOf(setup, slug);
    const repoBody = repoYamlOf(setup);
    const projectDef = { id: slug, name: setup.project.name, repos: setup.project.repos as readonly RepoSlug[] };
    const repoDef = {
      id: slug,
      name: setup.repo.id,
      flow: setup.repo.flow,
      defaultLimitPolicy: setup.repo.defaultLimitPolicy,
      commandSets: setup.repo.commandSets,
      docsRoot: setup.repo.docsRoot,
      testGlobs: setup.repo.testGlobs,
    };
    const projectValid = validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], project: projectDef });
    const repoValid = validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], repo: repoDef });
    if (!projectValid.ok || !repoValid.ok) return err('invalid_after');

    const wroteProject = await deps.definitions.writeFile(projectPath, projectBody, '');
    const wroteRepo = await deps.definitions.writeFile(repoPath, repoBody, '');
    if (!wroteProject.ok || !wroteRepo.ok) return err('stale');
  } else if (input.draftStore !== undefined && input.draftId !== undefined) {
    const draft = await input.draftStore.load(input.draftId);
    if (draft !== undefined) await input.draftStore.save(draft);
  }

  await deps.proposals.save({ ...decided.value, scope: proposal.scope });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'proposal.decided',
    subject: { kind: 'proposal', id: input.id },
    detail: { decision: input.decision },
  });
  return ok(undefined);
}

export const parseStoredSetupProposal = (after: string): SetupProposal | undefined => {
  try {
    const parsed = JSON.parse(after) as unknown;
    return buildSetupProposal({ project: (parsed as SetupProposal).project, repo: (parsed as SetupProposal).repo, warnings: (parsed as SetupProposal).warnings, differsFromRecommended: (parsed as SetupProposal).differsFromRecommended });
  } catch {
    return undefined;
  }
};

const repoFlowOf = (flow: FlowDef): RepoFlow => ({
  flowId: flow.id,
  version: 1,
  stages: flow.stages,
  bindings: flow.stages.map((stage) => ({
    stage: stage.id,
    ...(stage.role === null ? {} : { role: { roleId: stage.role, version: 1 } }),
    accounts: [],
  })),
});

/** Helper for tests and quick setup: the standard built-in flow in answer shape. */
export const defaultSetupAnswers = (name: string, repoSlug: string): unknown => {
  const standard = BUILTIN_FLOWS[0];
  if (standard === undefined) throw new Error('builtin flow');
  return {
    project: { name, repos: [repoSlug] },
    repo: {
      id: repoSlug,
      flow: repoFlowOf(standard),
      defaultLimitPolicy: 'wait_resume',
      commandSets: { tests: [] },
      docsRoot: 'docs',
      testGlobs: ['**/*.test.ts'],
    },
    warnings: [],
    differsFromRecommended: [],
  };
};
