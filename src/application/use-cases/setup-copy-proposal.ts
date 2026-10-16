import type { Actor, CapabilityDef, ProjectSlug, RepoSlug, Result, RoleRef } from '../../domain/index';
import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  copyFromRepo,
  err,
  ok,
  setupWarnings,
  slugFromName,
  validateDefinitions,
} from '../../domain/index';

import type { AppDeps } from '../ports/deps';
import { registerRepo } from './projects';
import { buildSetupProposal, type SetupProposal } from './setup';

export type SetupCopyProposalError =
  | 'source_not_in_project'
  | 'folder_not_found'
  | 'not_a_git_repo'
  | 'definitions_invalid';

export async function setupCopyProposal(
  deps: Pick<AppDeps, 'projects' | 'repos' | 'definitions' | 'capabilities' | 'accounts' | 'git' | 'repoScanner'>,
  input: {
    readonly project: ProjectSlug;
    readonly source: RepoSlug;
    readonly path: string;
  },
): Promise<Result<SetupProposal, SetupCopyProposalError>> {
  if (!(await deps.git.isWorkTree(input.path))) return err('not_a_git_repo');
  const project = await deps.projects.get(input.project);
  if (project === undefined || !project.repos.includes(input.source)) return err('source_not_in_project');
  const sourceEntry = (await deps.repos.list()).find((entry) => entry.slug === input.source);
  if (sourceEntry === undefined) return err('source_not_in_project');
  const loaded = await deps.definitions.load(input.source);
  const sourceDef = loaded.ok ? loaded.value.repo : undefined;
  if (sourceDef === undefined) return err('definitions_invalid');
  const folderName = input.path.split(/[/\\]/).filter((segment) => segment !== '').pop() ?? '';
  if (folderName === '') return err('folder_not_found');
  const detected = await deps.repoScanner.detect(input.path);
  const copied = copyFromRepo(
    {
      flow: sourceDef.flow,
      defaultLimitPolicy: sourceDef.defaultLimitPolicy,
      commandSets: sourceDef.commandSets,
    },
    detected,
  );
  const repoId = slugFromName<'repo'>(folderName, new Set(project.repos));
  const repo = {
    id: repoId,
    flow: copied.repo.flow as SetupProposal['repo']['flow'],
    defaultLimitPolicy: copied.repo.defaultLimitPolicy as SetupProposal['repo']['defaultLimitPolicy'],
    commandSets: copied.repo.commandSets,
    docsRoot: copied.repo.docsRoot,
    testGlobs: copied.repo.testGlobs,
  };
  const accounts = await deps.accounts.list();
  const provider = accounts[0]?.provider;
  // The stage's Docket-tools standing, resolved the way a run resolves the role — a detached
  // body wins, then the overlay field, then the library body at the binding's pinned version. An
  // unreadable role answers undefined, which never warns.
  const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const docketToolsOf = async (ref: RoleRef | undefined): Promise<boolean | undefined> => {
    if (ref === undefined) return undefined;
    if (ref.detached !== undefined) return ref.detached.docketTools !== false;
    const overlayTools = ref.overlay?.docketTools;
    if (overlayTools !== undefined) return overlayTools;
    const history = await deps.definitions.listVersions('roles', ref.roleId);
    const body = history.find((record) => record.version === ref.version)?.body;
    return isRecord(body) ? body['docketTools'] !== false : undefined;
  };
  const stages = await Promise.all(
    repo.flow.bindings.map(async (binding) => {
      const roleRef = binding.role;
      const fromOverlay = roleRef?.detached?.capabilities ?? roleRef?.overlay?.capabilities;
      const capabilities: readonly CapabilityDef[] = Array.isArray(fromOverlay)
        ? fromOverlay.filter((entry): entry is CapabilityDef => typeof entry === 'object' && entry !== null && 'kind' in entry)
        : [];
      return { stage: binding.stage, provider: provider ?? '', capabilities, docketTools: await docketToolsOf(roleRef) };
    }),
  );
  const warnings =
    provider === undefined
      ? []
      : setupWarnings(stages, deps.capabilities.translationTable(), deps.capabilities.permissionChannels());
  const differsFromRecommended = [...copied.copiedPaths];
  const proposal: SetupProposal = {
    project: { name: project.name, repos: [...project.repos, repoId] },
    repo,
    warnings,
    differsFromRecommended,
  };
  const checked = validateDefinitions({
    roles: BUILTIN_ROLES,
    flows: BUILTIN_FLOWS,
    capabilities: [],
    project: { id: project.id, name: project.name, repos: proposal.project.repos as readonly RepoSlug[] },
    repo: {
      id: repoId,
      name: repoId,
      flow: repo.flow,
      defaultLimitPolicy: repo.defaultLimitPolicy,
      commandSets: repo.commandSets,
      docsRoot: repo.docsRoot,
      testGlobs: repo.testGlobs,
    },
  });
  if (!checked.ok) return err('definitions_invalid');
  return ok(proposal);
}

export type SetupApplyError =
  | 'not_found'
  | 'folder_not_found'
  | 'not_a_git_repo'
  | 'definitions_invalid'
  | 'stale';

const folderNameOf = (path: string): string => {
  const segments = path.split(/[/\\]/).filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? '';
};

const projectYamlOf = (proposal: SetupProposal, projectId: ProjectSlug): string =>
  `${JSON.stringify({ id: projectId, name: proposal.project.name, repos: proposal.project.repos }, null, 2)}\n`;

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

const rebuildApplyProposal = (
  project: { readonly id: ProjectSlug; readonly name: string; readonly repos: readonly RepoSlug[] },
  path: string,
  answers: unknown,
  detected: { readonly docsRoot: string; readonly testGlobs: readonly string[] },
): SetupProposal => {
  const parsed = buildSetupProposal(answers);
  const folderName = folderNameOf(path);
  const repoId = slugFromName<'repo'>(folderName, new Set(project.repos));
  const repos = project.repos.includes(repoId) ? [...project.repos] : [...project.repos, repoId];
  return buildSetupProposal({
    project: { name: project.name, repos },
    repo: {
      ...parsed.repo,
      id: repoId,
      docsRoot: detected.docsRoot,
      testGlobs: detected.testGlobs,
    },
    warnings: parsed.warnings,
    differsFromRecommended: parsed.differsFromRecommended,
  });
};

export async function setupApply(
  deps: Pick<
    AppDeps,
    'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'workOrders' | 'git' | 'readFingerprint' | 'repoScanner'
  >,
  input: {
    readonly project: ProjectSlug;
    readonly path: string;
    readonly answers: unknown;
    readonly actor: Actor;
  },
): Promise<Result<void, SetupApplyError>> {
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('not_found');

  const already = (await deps.repos.list()).find((entry) => entry.path === input.path);
  if (already !== undefined && project.repos.includes(already.slug)) return ok(undefined);

  const folderName = folderNameOf(input.path);
  if (folderName === '' || (await deps.readFingerprint(input.path)) === undefined) return err('folder_not_found');
  if (!(await deps.git.isWorkTree(input.path))) return err('not_a_git_repo');

  const detected = await deps.repoScanner.detect(input.path);
  let proposal: SetupProposal;
  try {
    proposal = rebuildApplyProposal(project, input.path, input.answers, detected);
  } catch {
    return err('definitions_invalid');
  }

  const repo = proposal.repo.id as RepoSlug;
  const repos = proposal.project.repos as readonly RepoSlug[];
  const updated = { ...project, repos: [...repos] };
  const projectPath = `projects/${input.project}/project.yaml`;
  const repoPath = `repos/${repo}/repo.yaml`;
  const projectBody = projectYamlOf(proposal, input.project);
  const repoBody = repoYamlOf(proposal);
  const projectValid = validateDefinitions({
    roles: BUILTIN_ROLES,
    flows: BUILTIN_FLOWS,
    capabilities: [],
    project: updated,
    repo: {
      id: repo,
      name: repo,
      flow: proposal.repo.flow,
      defaultLimitPolicy: proposal.repo.defaultLimitPolicy,
      commandSets: proposal.repo.commandSets,
      docsRoot: proposal.repo.docsRoot,
      testGlobs: proposal.repo.testGlobs,
    },
  });
  if (!projectValid.ok) return err('definitions_invalid');

  await deps.projects.save(updated);
  const wroteProject = await deps.definitions.writeFile(projectPath, projectBody, '');
  const wroteRepo = await deps.definitions.writeFile(repoPath, repoBody, '');
  if (!wroteProject.ok || !wroteRepo.ok) return err('stale');
  const registered = await registerRepo(
    { clock: deps.clock, ids: deps.ids, log: deps.log, projects: deps.projects, repos: deps.repos, workOrders: deps.workOrders },
    { project: input.project, repo, path: input.path, actor: input.actor },
  );
  if (!registered.ok) return err('definitions_invalid');
  return ok(undefined);
}
