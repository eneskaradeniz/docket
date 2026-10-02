// use-cases/projects.ts — the Project & Repo layer (docs/v2/application.md rules A-24..A-26).
// Attaching reads the project.yaml the checkout carries; membership is versioned truth that only
// the file (or a proposal) edits — the registry and the project mirror follow it, never lead.
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
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import { openWorkOrder, type OpenError } from './work-orders';

// A-24 names repo_not_in_project in its rule text; the union carries it for the attach flow.
export type AttachError = 'not_a_repo' | 'no_project_yaml' | 'definitions_invalid' | 'repo_not_in_project';

export async function attachProject(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'git'>,
  input: {
    readonly path: string;
    readonly actor: Actor;
    readonly repos?: readonly { readonly repo: RepoSlug; readonly path: string }[];
  },
): Promise<Result<ProjectDef, AttachError>> {
  if (!(await deps.git.isWorkTree(input.path))) return err('not_a_repo');

  const read = await deps.definitions.readProjectAt(input.path);
  if (!read.ok) {
    // Only the absent file is its own answer; a broken project.yaml is a definitions failure.
    const missing = read.error.length === 1 && read.error[0]?.path === 'project.yaml' && read.error[0]?.code === 'missing_field';
    return err(missing ? 'no_project_yaml' : 'definitions_invalid');
  }
  const def = read.value;

  // Every extra registration is validated before anything is written: a partial attach would
  // leave a project pointing at checkouts the registry does not know.
  const extras = input.repos ?? [];
  for (const entry of extras) {
    if (!def.repos.includes(entry.repo)) return err('repo_not_in_project');
  }

  await deps.projects.save(def);
  await deps.repos.register(def.mainRepo, input.path);
  for (const entry of extras) await deps.repos.register(entry.repo, entry.path);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'project.attached',
    subject: { kind: 'project', id: def.id },
  });
  return ok(def);
}

export type RepoRegistrationError = 'unknown_project' | 'repo_not_in_project' | 'repo_in_use';

export async function registerRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'workOrders'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly path: string; readonly actor: Actor },
): Promise<Result<void, RepoRegistrationError>> {
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('unknown_project');
  if (!project.repos.includes(input.repo)) return err('repo_not_in_project');

  await deps.repos.register(input.repo, input.path);
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

  await deps.repos.remove(input.repo);
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

  const targets = task.targets.length > 0 ? task.targets : [project.mainRepo];

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
