// use-cases/git-actions.ts — the operator git actions (GI-2, A-371 … A-375, A-425): push the work
// order's branch, open its pull request, merge it (the human step) — or, in a repo without a
// forge, merge the branch into the base locally — and release the branch and worktree. Every action follows the same pinned order: validate → one audit entry → the forge or
// vcs call → on success the ledger event → workOrders.changed. A refusal before the call writes
// nothing; a failure after the audit leaves the audit (the operator's command is a fact) and
// appends no ledger event.
import type {
  Actor,
  EpochMs,
  GitLifecycleState,
  RepoRef,
  Result,
  WorkOrderId,
} from '../../domain/index';
import { deriveGitLifecycle, err, ok, redactSecretShapes, workOrderBranch } from '../../domain/index';

import type { AppDeps, Forge, ForgeResolver, LocalMergeError, PullRequestRef, WorkOrderRecord } from '../ports';

/** The bounds of the pull request's operator-typed text (A-372, A-377): the base branch name and,
 *  when a title is given at all, the title itself. */
export const PR_TEXT_MAX_CHARS = 255;

export type PushBranchError =
  | 'not_found' | 'released' | 'no_repo' | 'no_branch' | 'forge_unavailable' | 'forge_error';

/** A repeated open answers the pull request the state already holds (A-372), never a second PR. */
export type OpenPrError =
  | 'not_found' | 'bad_input' | 'released' | 'not_pushed'
  | { readonly code: 'pr_exists'; readonly pr: PullRequestRef }
  | 'forge_unavailable' | 'forge_error';

export type MergePrError = 'not_found' | 'released' | 'forge_unavailable' | 'forge_error';

/** The local merge's own refusals (A-425): the validation set before the audit, then git's typed
 *  answers from the repo checkout. */
export type MergeLocalError =
  | 'not_found' | 'bad_input' | 'released' | 'already_merged' | 'forge_configured' | LocalMergeError;

export type LocalBaseError = 'not_found' | 'forge_configured' | 'no_repo' | 'base_not_checked_out';

export type ReleaseBranchError = 'not_found' | 'released' | 'branch_not_merged' | 'no_repo' | 'git_failed';

/** The git actions never consult the machine fold — only the git lifecycle derives from the
 *  events — so a repo whose definitions will not load still answers its git doors. */
const loadGitState = async (
  deps: Pick<AppDeps, 'workOrders'>,
  id: WorkOrderId,
): Promise<Result<{ readonly record: WorkOrderRecord; readonly git: GitLifecycleState }, 'not_found'>> => {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');
  return ok({ record, git: deriveGitLifecycle(await deps.workOrders.events(id)) });
};

/** The forge for the work order's repo, with the ref every call routes by. A repo the registry
 *  does not list, or a row without a remote, has no forge to speak to — exactly like a resolver
 *  that stays silent. The default branch belongs to the pull request prefill, which reads it from
 *  the forge host itself, so no local guess lands here. */
const forgeFor = async (
  deps: Pick<AppDeps, 'repos'>,
  forges: ForgeResolver,
  record: WorkOrderRecord,
): Promise<Result<{ readonly forge: Forge; readonly repo: RepoRef }, 'forge_unavailable'>> => {
  const entry = (await deps.repos.list()).find((row) => row.slug === record.repo);
  if (entry === undefined || entry.fingerprint.remote === undefined) return err('forge_unavailable');
  const repo: RepoRef = { id: entry.slug, remote: entry.fingerprint.remote, defaultBranch: '' };
  const forge = await forges.forRepo(repo);
  if (forge === undefined) return err('forge_unavailable');
  return ok({ forge, repo });
};

const audit = (
  deps: Pick<AppDeps, 'ids' | 'log'>,
  input: { readonly at: EpochMs; readonly actor: Actor; readonly id: WorkOrderId },
  action: 'git.pushed' | 'pr.opened' | 'pr.merged' | 'branch.merged_local' | 'branch.deleted',
  detail?: Readonly<Record<string, string | number | boolean>>,
): Promise<void> =>
  deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: input.at,
    actor: input.actor,
    action,
    subject: { kind: 'work_order', id: input.id },
    ...(detail === undefined ? {} : { detail }),
  });

export async function pushWorkOrderBranch(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'repos' | 'worktrees'>,
  forges: ForgeResolver,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, PushBranchError>> {
  const loaded = await loadGitState(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value.git.released === true) return err('released');

  // The push itself runs in the repo checkout, but a work order with no worktree never ran:
  // pushing its branch would publish the base commit and nothing else.
  if ((await deps.worktrees.existing(loaded.value.record.repo, input.id)) === undefined) return err('no_repo');
  const head = await deps.worktrees.branchHead(loaded.value.record.repo, input.id);
  if (!head.ok) return err(head.error);

  const resolved = await forgeFor(deps, forges, loaded.value.record);
  if (!resolved.ok) return err(resolved.error);

  const branch = workOrderBranch(input.id);
  const at = deps.clock.now();
  await audit(deps, { at, actor: input.actor, id: input.id }, 'git.pushed', { branch });
  const pushed = await resolved.value.forge.pushBranch(resolved.value.repo, branch);
  if (!pushed.ok) return err('forge_error');
  await deps.workOrders.appendEvent(input.id, { type: 'branch_pushed', at, branch, head: head.value });
  return ok(undefined);
}

export async function openWorkOrderPr(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'repos'>,
  forges: ForgeResolver,
  input: { readonly id: WorkOrderId; readonly base: string; readonly title?: string; readonly actor: Actor },
): Promise<Result<PullRequestRef, OpenPrError>> {
  const base = input.base.trim();
  if (base === '' || base.length > PR_TEXT_MAX_CHARS) return err('bad_input');
  const title =
    input.title === undefined || input.title.trim() === ''
      ? undefined
      : redactSecretShapes(input.title.trim());
  if (title !== undefined && title.length > PR_TEXT_MAX_CHARS) return err('bad_input');

  const loaded = await loadGitState(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value.git.released === true) return err('released');
  const branch = loaded.value.git.branch;
  if (branch === undefined) return err('not_pushed');
  const open = loaded.value.git.pr;
  if (open !== undefined && !open.merged) {
    return err({ code: 'pr_exists', pr: { number: open.number, url: open.url } });
  }

  const resolved = await forgeFor(deps, forges, loaded.value.record);
  if (!resolved.ok) return err(resolved.error);

  const at = deps.clock.now();
  await audit(deps, { at, actor: input.actor, id: input.id }, 'pr.opened', {
    base,
    ...(title === undefined ? {} : { title }),
  });
  const opened = await resolved.value.forge.openPullRequest(resolved.value.repo, {
    head: branch.name,
    base,
    // Without an operator title the work order's own title names the PR; the body carries the
    // work order's stored description, already redacted at its own boundary.
    title: title ?? loaded.value.record.title,
    body: loaded.value.record.description ?? '',
  });
  if (!opened.ok) return err('forge_error');
  await deps.workOrders.appendEvent(input.id, {
    type: 'pr_opened',
    at,
    number: opened.value.number,
    url: opened.value.url,
    head: branch.name,
    base,
  });
  return ok(opened.value);
}

export async function mergeWorkOrderPr(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'repos'>,
  forges: ForgeResolver,
  input: { readonly id: WorkOrderId; readonly number: number; readonly actor: Actor },
): Promise<Result<void, MergePrError>> {
  const loaded = await loadGitState(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value.git.released === true) return err('released');
  // The number the operator saw on screen is the explicit approval pin: a stale number is
  // not_found before any forge call, and nothing merges on any other path.
  const open = loaded.value.git.pr;
  if (open === undefined || open.merged || open.number !== input.number) return err('not_found');

  const resolved = await forgeFor(deps, forges, loaded.value.record);
  if (!resolved.ok) return err(resolved.error);

  const at = deps.clock.now();
  await audit(deps, { at, actor: input.actor, id: input.id }, 'pr.merged', { number: input.number });
  const merged = await resolved.value.forge.mergePullRequest(resolved.value.repo, input.number);
  if (!merged.ok) return err('forge_error');
  await deps.workOrders.appendEvent(input.id, { type: 'pr_merged', at, number: input.number });
  return ok(undefined);
}

export async function mergeWorkOrderLocal(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'repos' | 'worktrees'>,
  forges: ForgeResolver,
  input: { readonly id: WorkOrderId; readonly base: string; readonly actor: Actor },
): Promise<Result<void, MergeLocalError>> {
  // The base the operator saw on the confirm is the approval pin: it must still be the checked-out
  // branch when git runs, and a git ref name is never free text.
  const base = input.base.trim();
  if (base === '' || base.length > PR_TEXT_MAX_CHARS) return err('bad_input');

  const loaded = await loadGitState(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value.git.released === true) return err('released');
  if (loaded.value.git.mergedLocal !== undefined || loaded.value.git.pr?.merged === true) return err('already_merged');
  // The action exists for repos without a forge only; a resolving forge owns the merge.
  if ((await forgeFor(deps, forges, loaded.value.record)).ok) return err('forge_configured');

  if ((await deps.worktrees.existing(loaded.value.record.repo, input.id)) === undefined) return err('no_repo');
  const head = await deps.worktrees.branchHead(loaded.value.record.repo, input.id);
  if (!head.ok) return err(head.error);

  const branch = workOrderBranch(input.id);
  const at = deps.clock.now();
  await audit(deps, { at, actor: input.actor, id: input.id }, 'branch.merged_local', { branch, base });
  const merged = await deps.worktrees.mergeLocal(loaded.value.record.repo, input.id, base);
  if (!merged.ok) return err(merged.error);
  await deps.workOrders.appendEvent(input.id, { type: 'branch_merged_local', at, branch, base });
  return ok(undefined);
}

/** The branch a local merge would land on (A-426): the repo checkout's current branch, for the
 *  confirm to name. A pure read — no audit, no event; a repo with a forge has no such door. */
export async function workOrderLocalBase(
  deps: Pick<AppDeps, 'workOrders' | 'repos' | 'worktrees'>,
  forges: ForgeResolver,
  id: WorkOrderId,
): Promise<Result<string, LocalBaseError>> {
  const loaded = await loadGitState(deps, id);
  if (!loaded.ok) return err(loaded.error);
  if ((await forgeFor(deps, forges, loaded.value.record)).ok) return err('forge_configured');
  return deps.worktrees.checkedOutBranch(loaded.value.record.repo);
}

export async function releaseWorkOrderBranch(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'worktrees'>,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, ReleaseBranchError>> {
  const loaded = await loadGitState(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value.git.released === true) return err('released');
  // R-163/R-185 at the command level: nothing is released while no merge — a forge pull request
  // or a local one — has folded in.
  if (loaded.value.git.pr?.merged !== true && loaded.value.git.mergedLocal === undefined) return err('branch_not_merged');

  const branch = loaded.value.git.branch?.name ?? workOrderBranch(input.id);
  const at = deps.clock.now();
  await audit(deps, { at, actor: input.actor, id: input.id }, 'branch.deleted', { branch });
  const released = await deps.worktrees.release(loaded.value.record.repo, input.id);
  if (!released.ok) return err(released.error);
  if (released.value === 'branch_not_merged') return err('branch_not_merged');
  await deps.workOrders.appendEvent(input.id, { type: 'branch_released', at });
  return ok(undefined);
}
