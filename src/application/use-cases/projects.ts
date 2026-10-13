// use-cases/projects.ts — the Project & Repo layer (docs/v2/application.md rules A-24..A-26).
// Attaching registers a machine-local registry entry and reads nothing from the folder; project
// creation writes the library copies and the projects mirror only — the repo's own yaml arrives
// with the legacy import or the setup proposal, never from here.
import type {
  Actor,
  ProjectDef,
  ProjectSlug,
  RepoSlug,
  Result,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
} from '../../domain/index';
import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  err,
  ok,
  slugFromName,
  validateDefinitions,
} from '../../domain/index';

import type { AppDeps, RepoRegistryEntry } from '../ports/index';
import { openWorkOrder, type OpenError } from './work-orders';

// A folder that is not a git work tree is the one refusal attach itself can reach; everything
// the folder carries arrives through the import, which attach only registers the entry for.
export type AttachError = 'not_a_repo';

/** The last path segment, pure string arithmetic — the layer owns no path module. */
const folderNameOf = (path: string): string => {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? '';
};

/** Registers one machine-local entry for the slug: a first registration mints the repoId and
 *  records an unread fingerprint ('' until the app reads git); a re-registration re-points the
 *  existing identity, keeping its repoId and any fingerprint already read. */
async function registerRepoEntry(deps: Pick<AppDeps, 'ids' | 'repos'>, slug: RepoSlug, path: string): Promise<void> {
  const existing = (await deps.repos.list()).find((entry) => entry.slug === slug);
  await deps.repos.register(existing === undefined
    ? { repoId: deps.ids.next<'repo'>(), slug, path, fingerprint: { rootCommit: '' } }
    : { ...existing, path });
}

export async function attachProject(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'repos' | 'git'>,
  input: {
    readonly path: string;
    readonly actor: Actor;
  },
): Promise<Result<RepoRegistryEntry, AttachError>> {
  if (!(await deps.git.isWorkTree(input.path))) return err('not_a_repo');

  const slug = slugFromName<'repo'>(folderNameOf(input.path), new Set());
  const existing = (await deps.repos.list()).find((entry) => entry.slug === slug);
  const entry: RepoRegistryEntry = existing === undefined
    ? { repoId: deps.ids.next<'repo'>(), slug, path: input.path, fingerprint: { rootCommit: '' } }
    : { ...existing, path: input.path };
  await deps.repos.register(entry);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'repo.registered',
    subject: { kind: 'repo', id: slug },
  });
  return ok(entry);
}

export type CreateProjectSource =
  | { readonly kind: 'existing'; readonly path: string }
  | { readonly kind: 'blank'; readonly parent: string };

export type CreateProjectError =
  | 'invalid_name' | 'not_a_repo' | 'project_exists' | 'docket_folder_exists'
  | 'not_a_folder' | 'folder_exists' | 'io_failed' | 'definitions_invalid' | AttachError;

const MAX_NAME_LENGTH = 80;
const DEFAULT_FLOW = 'standard';

/**
 * A-75..A-78: validates first, then writes in the contract's order. A folder this creates stays when a
 * later step fails (Docket never deletes a folder it showed the user), and built-in library copies in
 * the global root stay too — they are idempotent. No project.yaml or repo.yaml is written: the repo's
 * definitions arrive with the setup proposal, so the interim leaves the run flow dormant by design.
 */
export async function createProject(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'git' | 'repoFolders'>,
  input: { readonly source: CreateProjectSource; readonly name: string; readonly actor: Actor },
): Promise<Result<ProjectDef, CreateProjectError>> {
  const name = input.name.trim();
  if (name === '' || [...name].length > MAX_NAME_LENGTH) return err('invalid_name');

  const taken = new Set<string>();
  for (const project of await deps.projects.list()) taken.add(project.id);
  for (const entry of await deps.repos.list()) taken.add(entry.slug);
  const slug = slugFromName<'project'>(name, taken);
  const repoSlug = slugFromName<'repo'>(slug, new Set());

  if (input.source.kind === 'existing') {
    const source = input.source;
    if (!(await deps.git.isWorkTree(source.path))) return err('not_a_repo');

    // The folder a checkout names is already a registered repo: creating a second project over
    // it is rejected — attaching or importing is the operation.
    const registered = (await deps.repos.list()).find((entry) => entry.path === source.path);
    if (registered !== undefined) return err('project_exists');
  }

  const defaultFlow = BUILTIN_FLOWS.find((flow) => flow.id === DEFAULT_FLOW);
  if (defaultFlow === undefined) return err('definitions_invalid');

  const project: ProjectDef = { id: slug, name, mainRepo: repoSlug, repos: [repoSlug] };
  const checked = validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], project });
  if (!checked.ok) return err('definitions_invalid');

  let path: string;
  if (input.source.kind === 'blank') {
    const created = await deps.repoFolders.createRepo(input.source.parent, slug);
    if (!created.ok) return err(created.error);
    path = created.value.path;
  } else {
    path = input.source.path;
  }

  const installed = await deps.definitions.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
  await deps.projects.save(project);
  await registerRepoEntry(deps, repoSlug, path);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'project.created',
    subject: { kind: 'project', id: slug },
    detail: { source: input.source.kind, builtinsWritten: installed.written.length },
  });
  return ok(project);
}

export type RepoRegistrationError = 'unknown_project' | 'repo_not_in_project' | 'repo_in_use';

export async function registerRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'workOrders'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly path: string; readonly actor: Actor },
): Promise<Result<void, RepoRegistrationError>> {
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('unknown_project');
  if (!project.repos.includes(input.repo)) return err('repo_not_in_project');

  await registerRepoEntry(deps, input.repo, input.path);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'repo.registered',
    subject: { kind: 'repo', id: input.repo },
  });
  return ok(undefined);
}

export async function unregisterRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'workOrders'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly actor: Actor },
): Promise<Result<void, RepoRegistrationError>> {
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('unknown_project');
  if (!project.repos.includes(input.repo)) return err('repo_not_in_project');

  // Without a definitions pick, "done" is what the history says is final: a `closed` event.
  for (const record of await deps.workOrders.list({ repo: input.repo })) {
    const closed = (await deps.workOrders.events(record.id)).some((event: WorkOrderEvent) => event.type === 'closed');
    if (!closed) return err('repo_in_use');
  }

  // Registry entries are permanent machine-local truth: removal from a project is the project.yaml
  // edit (or a proposal), never a registry deletion — the entry stays for the next attach.
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'repo.unregistered',
    subject: { kind: 'repo', id: input.repo },
  });
  return ok(undefined);
}

/** A thrown marker for the dry-run pass: it means openWorkOrder validated everything and is
 *  about to write — exactly the fact the all-or-nothing pass needs, with no port touched. */
const VALIDATED = Symbol('validated');

/** S4: one work order per target repo of a task; the task completes when all of them close (R-40). */
export type TaskOpenError = OpenError | 'unknown_task';

export async function openTaskWorkOrders(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'projects'>,
  input: { readonly project: ProjectSlug; readonly task: TaskSlug; readonly actor: Actor },
): Promise<Result<readonly WorkOrderId[], TaskOpenError>> {
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('unknown_project');

  const roadmap = await deps.definitions.loadRoadmap(input.project);
  if (roadmap === undefined) return err('unknown_task');
  if (!roadmap.ok) return err('definitions_invalid');
  const task = roadmap.value.phases.flatMap((phase) => phase.tasks).find((candidate) => candidate.id === input.task);
  if (task === undefined) return err('unknown_task');

  // A task without targets means the project's only repo; a project that lists more than one
  // cannot pick one silently, and the roadmap validator's own refusal is the roadmap model's to
  // report — this transitional mapping answers definitions_invalid until then.
  const onlyRepo = project.repos.length === 1 ? project.repos[0] : undefined;
  const targets = task.targets.length > 0 ? [...task.targets] : onlyRepo === undefined ? undefined : [onlyRepo];
  if (targets === undefined) return err('definitions_invalid');

  // Dry-run every opening against ports that refuse the first write: any error surfaces here,
  // before a single real work order exists (A-25's all-or-nothing). Reaching `create` means the
  // opening validated in full — that is the marker's whole message.
  const dryDeps = {
    ...deps,
    workOrders: {
      ...deps.workOrders,
      create: async (): Promise<void> => {
        throw VALIDATED;
      },
    },
  };
  for (const repo of targets) {
    try {
      const outcome = await openWorkOrder(dryDeps, {
        project: input.project,
        repo,
        title: task.title,
        task: input.task,
        actor: input.actor,
      });
      if (!outcome.ok) return err(outcome.error);
    } catch (error) {
      if (error !== VALIDATED) throw error;
    }
  }

  const opened: WorkOrderId[] = [];
  for (const repo of targets) {
    const outcome = await openWorkOrder(deps, { project: input.project, repo, title: task.title, task: input.task, actor: input.actor });
    if (!outcome.ok) return err(outcome.error);
    opened.push(outcome.value);
  }
  return ok(opened);
}
