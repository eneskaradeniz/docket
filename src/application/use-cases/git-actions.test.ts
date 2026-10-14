// use-cases/git-actions.test.ts — the four operator git actions (A-371 … A-375, GI-2): push the
// branch, open its pull request, merge it as the human step, release the branch and worktree.
// Driven over the in-memory fakes and createFakeForge; every refusal path asserts that nothing
// was written — no audit, no ledger event, no forge call. The grep-level guard that keeps
// mergePullRequest a single-caller seam lives beside the resolver's own, in
// infrastructure/forge/repo-forge-resolver.test.ts.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  redactSecretShapes,
  type Actor,
  type EpochMs,
  type RepoSlug,
  type Slug,
  type WorkOrderId,
} from '../../domain/index';
import type { RepoRef } from '../../domain/index';

import type { AppDeps, Forge, ForgeResolver } from '../ports';
import {
  createFakeClock,
  createFakeEventLog,
  createFakeForge,
  createFakeIdGen,
  createFakeRepoRegistry,
  createFakeWorkOrderRepo,
  createFakeWorktrees,
  type FakeEventLog,
  type FakeWorkOrderRepo,
  type FakeWorktrees,
} from '../ports/fakes';

import {
  mergeWorkOrderPr,
  openWorkOrderPr,
  pushWorkOrderBranch,
  releaseWorkOrderBranch,
} from './git-actions';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf('ws');
const REMOTE = 'https://github.com/octo/ws.git';
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const UNKNOWN: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FB9');
const USER: Actor = { kind: 'user', id: 'u-1' };
const BRANCH = `docket/wo-${WORK_ORDER.toLowerCase()}`;
const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

interface Harness {
  readonly deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'repos' | 'worktrees'>;
  readonly workOrders: FakeWorkOrderRepo;
  readonly log: FakeEventLog;
  readonly worktrees: FakeWorktrees;
}

const makeHarness = (events: readonly ('created' | 'pushed' | 'opened' | 'merged' | 'released')[] = ['created']): Harness => {
  const clock = createFakeClock(1_000);
  const workOrders = createFakeWorkOrderRepo();
  const log = createFakeEventLog();
  const worktrees = createFakeWorktrees();
  const repos = createFakeRepoRegistry();
  void repos.register({
    repoId: '1',
    slug: REPO,
    path: '/repo/ws',
    fingerprint: { rootCommit: 'root', remote: REMOTE },
  });

  workOrders.create({
    id: WORK_ORDER,
    project: slugOf('atolye'),
    repo: REPO,
    flow: slugOf('fixture'),
    title: 'Ship the widget',
    createdAt: 0 as EpochMs,
    createdBy: USER,
  });
  worktrees.markExisting(REPO, WORK_ORDER);
  worktrees.setBranchHead(REPO, WORK_ORDER, HEAD);

  let at = 0 as EpochMs;
  for (const kind of events) {
    if (kind === 'created') workOrders.appendEvent(WORK_ORDER, { type: 'created', at: (at += 1) as EpochMs, by: USER, flow: slugOf('fixture') });
    if (kind === 'pushed') workOrders.appendEvent(WORK_ORDER, { type: 'branch_pushed', at: (at += 1) as EpochMs, branch: BRANCH, head: HEAD });
    if (kind === 'opened') workOrders.appendEvent(WORK_ORDER, { type: 'pr_opened', at: (at += 1) as EpochMs, number: 3, url: 'https://forge.fake/ws/pull/3', head: BRANCH, base: 'main' });
    if (kind === 'merged') workOrders.appendEvent(WORK_ORDER, { type: 'pr_merged', at: (at += 1) as EpochMs, number: 3 });
    if (kind === 'released') workOrders.appendEvent(WORK_ORDER, { type: 'branch_released', at: (at += 1) as EpochMs });
  }

  return {
    deps: { clock, ids: createFakeIdGen('git-actions'), log, workOrders, repos, worktrees },
    workOrders,
    log,
    worktrees,
  };
};

/** A resolver answering one forge for every repo, recording the refs it was asked about. */
const resolverFor = (forge: Forge | undefined): { readonly resolver: ForgeResolver; readonly asked: readonly RepoRef[] } => {
  const asked: RepoRef[] = [];
  return { resolver: { forRepo: async (repo) => { asked.push(repo); return forge; } }, asked };
};

/** The fake forge wrapped so a test can observe the moment mergePullRequest runs. */
const mergingForge = (forge: Forge, onMerge: () => void): Forge => ({
  ...forge,
  mergePullRequest: (repo, number) => {
    onMerge();
    return forge.mergePullRequest(repo, number);
  },
});

describe('pushWorkOrderBranch', () => {
  it('A-371: pushes the worktree branch, writes one git.pushed audit, appends branch_pushed', async () => {
    const h = makeHarness();
    const forge = createFakeForge();

    const result = await pushWorkOrderBranch(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(forge.pushed).toEqual([BRANCH]);
    const events = await h.workOrders.events(WORK_ORDER);
    expect(events.at(-1)).toEqual({ type: 'branch_pushed', at: 1_000, branch: BRANCH, head: HEAD });
    expect(h.log.entries()).toEqual([
      expect.objectContaining({ action: 'git.pushed', actor: USER, subject: { kind: 'work_order', id: WORK_ORDER } }),
    ]);
  });

  it('A-371: an unknown id answers not_found and writes nothing at all', async () => {
    const h = makeHarness();
    const forge = createFakeForge();

    const result = await pushWorkOrderBranch(h.deps, resolverFor(forge).resolver, { id: UNKNOWN, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(forge.pushed).toEqual([]);
    expect(await h.workOrders.events(UNKNOWN)).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-371: a worktree that is not listed answers no_repo and writes nothing', async () => {
    const h = makeHarness();
    const bare = createFakeWorktrees();
    const deps = { ...h.deps, worktrees: bare };
    const forge = createFakeForge();

    const result = await pushWorkOrderBranch(deps, resolverFor(forge).resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'no_repo' });
    expect(forge.pushed).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(1); // the created event only
    expect(h.log.entries()).toEqual([]);
  });

  it('A-371: a silent resolver answers forge_unavailable with no writes', async () => {
    const h = makeHarness();
    const { resolver, asked } = resolverFor(undefined);

    const result = await pushWorkOrderBranch(h.deps, resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'forge_unavailable' });
    expect(asked).toEqual([{ id: REPO, remote: REMOTE, defaultBranch: '' }]); // asked, and silent
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(1);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-371: a repo row without a remote answers forge_unavailable and never asks a resolver', async () => {
    const h = makeHarness();
    const repos = createFakeRepoRegistry();
    void repos.register({
      repoId: '1',
      slug: REPO,
      path: '/repo/ws',
      fingerprint: { rootCommit: 'root' }, // no remote: nothing to resolve for
    });
    const deps = { ...h.deps, repos };
    const { resolver, asked } = resolverFor(createFakeForge());

    const result = await pushWorkOrderBranch(deps, resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'forge_unavailable' });
    expect(asked).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-371: a forge failure answers forge_error and appends no ledger event', async () => {
    const h = makeHarness();
    const failing: Forge = {
      ...createFakeForge(),
      pushBranch: async () => ({ ok: false, error: 'auth' }),
    };

    const result = await pushWorkOrderBranch(h.deps, resolverFor(failing).resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'forge_error' });
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(1); // no branch_pushed landed
    // The audit is the fact that the operator commanded a push; the refusal is the forge's answer.
    expect(h.log.entries()).toHaveLength(1);
  });

  it('A-371: a released work order refuses a new push without touching the forge', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged', 'released']);
    const forge = createFakeForge();

    const result = await pushWorkOrderBranch(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'released' });
    expect(forge.pushed).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });
});

describe('openWorkOrderPr', () => {
  it('A-372: opens the pull request on the pushed branch and records pr_opened with its ref', async () => {
    const h = makeHarness(['created', 'pushed']);
    const forge = createFakeForge();

    const result = await openWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, base: 'main', actor: USER });

    expect(result).toEqual({ ok: true, value: { number: 1, url: 'https://forge.fake/ws/pull/1' } });
    expect(forge.opened).toEqual([{ head: BRANCH, base: 'main', title: 'Ship the widget' }]);
    const events = await h.workOrders.events(WORK_ORDER);
    expect(events.at(-1)).toEqual({
      type: 'pr_opened',
      at: 1_000,
      number: 1,
      url: 'https://forge.fake/ws/pull/1',
      head: BRANCH,
      base: 'main',
    });
    expect(h.log.entries()).toEqual([
      expect.objectContaining({ action: 'pr.opened', actor: USER, subject: { kind: 'work_order', id: WORK_ORDER } }),
    ]);
  });

  it('A-372: an unpushed branch answers not_pushed and the forge is never called', async () => {
    const h = makeHarness();
    const forge = createFakeForge();

    const result = await openWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, base: 'main', actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_pushed' });
    expect(forge.opened).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-372: a repeated open answers pr_exists with the stored ref and opens no second PR', async () => {
    const h = makeHarness(['created', 'pushed', 'opened']);
    const forge = createFakeForge();

    const result = await openWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, base: 'main', actor: USER });

    expect(result).toEqual({ ok: false, error: { code: 'pr_exists', pr: { number: 3, url: 'https://forge.fake/ws/pull/3' } } });
    expect(forge.opened).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(3); // nothing appended
    expect(h.log.entries()).toEqual([]);
  });

  it('A-372: a forge failure answers forge_error and appends no ledger event', async () => {
    const h = makeHarness(['created', 'pushed']);
    const failing: Forge = {
      ...createFakeForge(),
      openPullRequest: async () => ({ ok: false, error: 'network' }),
    };

    const result = await openWorkOrderPr(h.deps, resolverFor(failing).resolver, { id: WORK_ORDER, base: 'main', actor: USER });

    expect(result).toEqual({ ok: false, error: 'forge_error' });
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(2);
    expect(h.log.entries()).toHaveLength(1);
  });

  it('A-375: an operator title rides along redacted like every recordable operator text', async () => {
    const h = makeHarness(['created', 'pushed']);
    const forge = createFakeForge();
    // Credential-shaped, assembled at runtime so the file itself never carries a secret-looking literal.
    const token = 'ghp_' + '1'.repeat(40);
    const title = `Ship ${token} now`;

    const result = await openWorkOrderPr(h.deps, resolverFor(forge).resolver, {
      id: WORK_ORDER,
      base: 'main',
      title,
      actor: USER,
    });

    expect(result.ok).toBe(true);
    expect(forge.opened).toEqual([{ head: BRANCH, base: 'main', title: redactSecretShapes(title) }]);
    // The audit precedes the forge call (the pinned order), so it carries the command's own text —
    // redacted — but not the number only the forge's answer knows.
    expect(h.log.entries()[0]?.detail).toEqual({ base: 'main', title: redactSecretShapes(title) });
  });
});

describe('mergeWorkOrderPr', () => {
  it('A-373: merges only the state open pull request, after its audit, and records pr_merged', async () => {
    const h = makeHarness(['created', 'pushed', 'opened']);
    const base = createFakeForge({ seedPullRequests: 3 });
    let auditsWhenForgeRan = -1;
    const forge = mergingForge(base, () => {
      auditsWhenForgeRan = h.log.entries().length;
    });

    const result = await mergeWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, number: 3, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    // A-373's pinned order: the audit entry is written before the forge call runs.
    expect(auditsWhenForgeRan).toBe(1);
    expect(h.log.entries()).toEqual([
      expect.objectContaining({ action: 'pr.merged', actor: USER, detail: { number: 3 } }),
    ]);
    const events = await h.workOrders.events(WORK_ORDER);
    expect(events.at(-1)).toEqual({ type: 'pr_merged', at: 1_000, number: 3 });
    expect(await base.pullRequest({ id: REPO, remote: REMOTE, defaultBranch: '' }, 3)).toEqual({
      ok: true,
      value: expect.objectContaining({ state: 'merged' }),
    });
  });

  it('A-373: a stale number answers not_found before any forge call', async () => {
    const h = makeHarness(['created', 'pushed', 'opened']);
    const base = createFakeForge();
    let mergeCalls = 0;
    const forge = mergingForge(base, () => {
      mergeCalls += 1;
    });

    const result = await mergeWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, number: 9, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(mergeCalls).toBe(0);
    expect(h.log.entries()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(3);
  });

  it('A-373: a work order without an open pull request answers not_found and merges nothing', async () => {
    const h = makeHarness(['created', 'pushed']);
    const forge = createFakeForge();

    const result = await mergeWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, number: 3, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.log.entries()).toEqual([]);
  });

  it('A-373: an already-merged pull request is not merged again', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged']);
    const forge = createFakeForge();

    const result = await mergeWorkOrderPr(h.deps, resolverFor(forge).resolver, { id: WORK_ORDER, number: 3, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.log.entries()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(4);
  });
});

describe('releaseWorkOrderBranch', () => {
  it('A-374: releases the worktree and branch after one branch.deleted audit and records branch_released', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged']);
    h.worktrees.scriptRelease(REPO, WORK_ORDER, 'released');

    const result = await releaseWorkOrderBranch(h.deps, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(h.log.entries()).toEqual([
      expect.objectContaining({ action: 'branch.deleted', actor: USER, detail: { branch: BRANCH } }),
    ]);
    const events = await h.workOrders.events(WORK_ORDER);
    expect(events.at(-1)).toEqual({ type: 'branch_released', at: 1_000 });
  });

  it('A-374: an unmerged pull request answers branch_not_merged and nothing is touched', async () => {
    const h = makeHarness(['created', 'pushed', 'opened']);
    h.worktrees.scriptRelease(REPO, WORK_ORDER, 'released'); // would succeed; must never run

    const result = await releaseWorkOrderBranch(h.deps, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'branch_not_merged' });
    expect(h.log.entries()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(3);
  });

  it('A-374: a git-level branch_not_merged refusal appends no event', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged']);
    h.worktrees.scriptRelease(REPO, WORK_ORDER, 'branch_not_merged');

    const result = await releaseWorkOrderBranch(h.deps, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'branch_not_merged' });
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(4); // no branch_released
    expect(h.log.entries()).toHaveLength(1); // the command is still an audited fact
  });

  it('A-374: a git failure answers git_failed and appends no event', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged']);
    h.worktrees.scriptRelease(REPO, WORK_ORDER, 'git_failed');

    const result = await releaseWorkOrderBranch(h.deps, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'git_failed' });
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(4);
  });

  it('A-374: a released work order answers released and runs no release again', async () => {
    const h = makeHarness(['created', 'pushed', 'opened', 'merged', 'released']);
    h.worktrees.scriptRelease(REPO, WORK_ORDER, 'released'); // would succeed; must never run

    const result = await releaseWorkOrderBranch(h.deps, { id: WORK_ORDER, actor: USER });

    expect(result).toEqual({ ok: false, error: 'released' });
    expect(h.log.entries()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toHaveLength(5);
  });

  it('A-374: an unknown work order answers not_found', async () => {
    const h = makeHarness();

    const result = await releaseWorkOrderBranch(h.deps, { id: UNKNOWN, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.log.entries()).toEqual([]);
  });
});
