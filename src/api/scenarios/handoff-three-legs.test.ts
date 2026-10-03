// scenarios/handoff-three-legs.test.ts — the docs/v2/application.md section-7 acceptance (A-66):
// the limit-handoff contract over fakes — account A on provider X (reads CLAUDE.md natively) hits
// the window limit mid-stage, account B on provider Y (AGENTS.md-only, never reads CLAUDE.md)
// continues the stage from the handoff pack, and A reviews what B wrote. Opening and the human
// gate decisions go through the api boundary (`createApi`), exactly as the UI will issue them;
// runs, the limit decision, machine gates and the verdict call the application directly. Every
// started item runs the composition root's path: the prompt comes from `composeRunPrompt`, and
// the executor replaces it with the pack for a handoff item.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  decideOnLimit,
  parseSlug,
  parseUlid,
  stageBrief,
  type AccountId,
  type Actor,
  type AgentEvent,
  type DispatchLimits,
  type EpochMs,
  type FlowDef,
  type GateSlug,
  type LimitClass,
  type QueueItem,
  type RepoSlug,
  type RoleDef,
  type RoleSlug,
  type Slug,
  type StageDef,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import { createApi } from '../index';
import type { AccountRecord, AppDeps } from '../../application/index';
import {
  DEFAULT_MODEL_CONSENT,
  applyLimitDecision,
  composeRunPrompt,
  dispatcherTick,
  enqueueStage,
  evaluateMachineGates,
  executeRun,
  getWorkOrder,
  resolveRoute,
  submitAgentVerdict,
  type ExecuteOutcome,
  type PermissionGate,
} from '../../application/index';
import {
  createFakeCapabilityCatalog,
  createFakeCheckpointCommitter,
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeInstructionFiles,
  createFakeTransport,
  createFakeTransportResolver,
  type FakeCheckpointCommitter,
  type FakeClock,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeEvidenceChecker,
  type FakeRouteKind,
  type FakeTransportResolver,
} from '../../application/ports/fakes/index';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf('ws');
const T0: EpochMs = 1_700_000_000_000;
/** Far enough out that waiting is not a remedy the scenario could accidentally take. */
const RESETS_AT: EpochMs = T0 + 30 * 24 * 3_600_000;

const ACCOUNT_A: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const ACCOUNT_B: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCW');

// The two fixture providers: X reads CLAUDE.md natively; Y is drawn from the AGENTS.md-only
// providers — its CLI's own source shows CLAUDE.md is not read, which is what makes leg 2's
// inline assertion non-vacuous (a both-files Y would inline nothing either). The route-kind rows
// mirror the capability registry's data for the two providers, Y's unknown default billing
// included, so the continuation rides the P-46 consent the fixture records instead of a billing
// the fake invented.
const PROVIDER_X = 'claude-code';
const PROVIDER_Y = 'vibe';
const ROUTE_KINDS: readonly FakeRouteKind[] = [
  {
    id: 'anthropic-subscription',
    provider: PROVIDER_X,
    authMode: 'subscription',
    instructionFiles: ['CLAUDE.md', 'CLAUDE.local.md', '~/.claude/projects/<project>/memory/'],
  },
  { id: 'vibe-login', provider: PROVIDER_Y, authMode: 'subscription', defaultBilling: 'unknown', instructionFiles: ['AGENTS.md'] },
];

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const PLAN: StageSlug = slugOf<'stage'>('plan');
const IMPLEMENT: StageSlug = slugOf<'stage'>('implement');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const CLOSE: StageSlug = slugOf<'stage'>('close');
const PLAN_APPROVAL: GateSlug = slugOf<'gate'>('plan-approval');
const REVIEW_VERDICT: GateSlug = slugOf<'gate'>('review-verdict');
const REVIEW_APPROVAL: GateSlug = slugOf<'gate'>('review-approval');

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };
const TEST_COMMAND = 'npm test';

const definitionsBody = (): unknown => {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('expected a built-in flow "standard"');
  return {
    roles: BUILTIN_ROLES,
    flows: [standard],
    capabilities: [],
    repo: {
      id: 'ws',
      name: 'Repo',
      repos: [],
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: [TEST_COMMAND] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    },
  };
};

const accountA = (): AccountRecord => ({
  id: ACCOUNT_A,
  provider: PROVIDER_X,
  label: 'account A on the CLAUDE.md reader',
  authMode: 'subscription',
  limitPolicy: 'fallback_account',
  caps: [],
});

const accountB = (): AccountRecord => ({
  id: ACCOUNT_B,
  provider: PROVIDER_Y,
  label: 'account B on the AGENTS.md-only reader',
  authMode: 'subscription',
  limitPolicy: 'fallback_account',
  // Y's route kind bills its unpinned default as unknown, so the fallback candidate is eligible
  // only through recorded consent — the marker for the default model plus one spend cap (P-46).
  consentedModels: [DEFAULT_MODEL_CONSENT],
  caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
});

const bindRole = async (deps: AppDeps, role: RoleSlug, accounts: readonly AccountId[]): Promise<void> => {
  await deps.bindings.save({ level: 'global' }, { role, accounts: accounts.map((accountId) => ({ accountId })) });
};

const editedFile = 'src/main.ts';
/** A token-shaped string planted in the fixture diff — the pack must never carry it unredacted. */
const PLANTED_TOKEN = 'sk-live-9f14c2ab67de40519b3f7b8ea2d60c41';
const REDACTED = '[REDACTED]';
const RAW_PATCH = [
  'diff --git a/src/main.ts b/src/main.ts',
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1,2 +1,3 @@',
  ' import { boot } from "./boot";',
  `+const API_TOKEN = "${PLANTED_TOKEN}";`,
  '+boot();',
].join('\n');

const CLAUDE_MD = '# Repo ground rules\n\nRead the acceptance criteria before claiming the stage done.';

const completedScript = (): readonly AgentEvent[] => [
  { type: 'session_started', at: T0, sessionRef: 'sess-a' },
  { type: 'finished', at: T0 + 1_000, reason: 'completed' },
];

const legOneScript = (): readonly AgentEvent[] => [
  { type: 'session_started', at: T0, sessionRef: 'sess-first-leg' },
  { type: 'text', at: T0 + 1_000, delta: 'Editing the entry point for the first leg.' },
  { type: 'tool_call', at: T0 + 2_000, id: 'edit-1', name: 'Edit', target: editedFile },
  { type: 'tool_result', at: T0 + 3_000, id: 'edit-1', ok: true },
  { type: 'usage', at: T0 + 4_000, inputTokens: 12_000, outputTokens: 800 },
  {
    type: 'limit_hit',
    at: T0 + 5_000,
    hit: { class: 'window_exhausted' as LimitClass, remedies: ['wait'], resetsAt: RESETS_AT },
  },
  { type: 'finished', at: T0 + 6_000, reason: 'limit' },
];

const legTwoScript = (): readonly AgentEvent[] => [
  { type: 'text', at: T0, delta: 'Continuing the stage from the pack.' },
  { type: 'tool_call', at: T0 + 1_000, id: 'edit-2', name: 'Edit', target: editedFile },
  { type: 'tool_result', at: T0 + 2_000, id: 'edit-2', ok: true },
  { type: 'usage', at: T0 + 3_000, inputTokens: 9_000, outputTokens: 400 },
  { type: 'finished', at: T0 + 4_000, reason: 'completed' },
];

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly commands: FakeCommandRunner;
  readonly evidence: FakeEvidenceChecker;
  readonly transports: FakeTransportResolver;
  readonly checkpoints: FakeCheckpointCommitter;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(T0);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(definitionsBody()));
  const commands = createFakeCommandRunner();
  const evidence = createFakeEvidenceChecker();
  const transports = createFakeTransportResolver();

  // The checkpoint fake stands exactly at the port boundary, where the adapter redacts the patch
  // before application ever sees it (the CheckpointCommitter contract). The wrapper keeps that
  // guarantee visible: the raw fixture diff carries the planted token, and only its redacted
  // form crosses into the pack.
  const checkpoints = createFakeCheckpointCommitter();
  const redacting = {
    ...checkpoints,
    diffSince: async (input: Parameters<FakeCheckpointCommitter['diffSince']>[0]) => {
      const answered = await checkpoints.diffSince(input);
      return answered.ok
        ? { ok: true as const, value: { ...answered.value, patch: answered.value.patch.split(PLANTED_TOKEN).join(REDACTED) } }
        : answered;
    },
  };

  // One repo content for the one work order's worktree: the repo carries CLAUDE.md and no
  // AGENTS.md. Every read of any worktree root answers it — the alias keeps the fake's by-cwd
  // map out of the work-order id that only open() mints.
  const repoContent = createFakeInstructionFiles({ 'repo-root': [{ name: 'CLAUDE.md', content: CLAUDE_MD }] });
  const instructionFiles = {
    read: (_cwd: string, names: readonly string[]) => repoContent.read('repo-root', names),
  };

  definitions.setProject({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: REPO, repos: [REPO] });
  const deps = createFakeDeps({
    clock,
    log,
    definitions,
    commands,
    evidence,
    transports,
    capabilities: createFakeCapabilityCatalog(ROUTE_KINDS),
    checkpoints: redacting,
    instructionFiles,
  });
  deps.projects.save({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: REPO, repos: [REPO] });
  return { deps, clock, log, definitions, commands, evidence, transports, checkpoints };
};

const allowAll: PermissionGate = { onAsk: async () => 'allow' };

const viewOf = async (deps: AppDeps, id: WorkOrderId) => {
  const view = await getWorkOrder(deps, id);
  if (!view.ok) throw new Error(`work order must load: ${view.error}`);
  return view.value;
};

const expectState = (
  view: Awaited<ReturnType<typeof viewOf>>,
  expected: { readonly status: string; readonly stage: string | null; readonly pendingGates?: readonly string[] },
): void => {
  expect(view.state.status).toBe(expected.status);
  expect(view.state.stage).toBe(expected.stage);
  if (expected.pendingGates !== undefined) expect([...view.state.pendingGates]).toEqual(expected.pendingGates);
};

const openViaApi = async (deps: AppDeps, title: string): Promise<WorkOrderId | undefined> => {
  const result = await createApi(deps).command(USER, { type: 'workOrder.open', project: slugOf<'project'>('ws-proj'), repo: REPO, title });
  if (!result.ok || result.id === undefined) return undefined;
  const parsed = parseUlid<'work-order'>(result.id);
  return parsed.ok ? parsed.value : undefined;
};

const approveViaApi = (deps: AppDeps, id: WorkOrderId, gate: GateSlug) =>
  createApi(deps).command(USER, { type: 'gate.decide', workOrderId: id, gate, decision: 'approved' });

/** The stage's role over the loaded definitions — the same resolution the gates and the executor
 *  resolve against, never a second copy of the role in the fixture. */
const resolve = async <T>(
  h: Harness,
  stage: StageSlug,
  pick: (found: { readonly flow: FlowDef; readonly stage: StageDef; readonly role: RoleDef }) => T,
): Promise<T> => {
  const loaded = await h.deps.definitions.load(REPO);
  if (!loaded.ok) throw new Error('fixture definitions must load');
  const flow = loaded.value.flows.find((candidate) => candidate.id === slugOf<'flow'>('standard'));
  const stageDef = flow?.stages.find((candidate) => candidate.id === stage);
  const roleId = stageDef === undefined ? undefined : stageDef.role;
  const role =
    roleId === null || roleId === undefined
      ? undefined
      : loaded.value.roles.find((candidate) => candidate.id === roleId);
  if (flow === undefined || stageDef === undefined || role === undefined) {
    throw new Error(`fixture stage ${stage} must resolve with a runnable role`);
  }
  return pick({ flow, stage: stageDef, role });
};

/** The Docket layers of a stage, derived from the loaded store — never restated (A-53). */
const briefOf = async (h: Harness, id: WorkOrderId, stage: StageSlug): Promise<string> => {
  const record = await h.deps.workOrders.get(id);
  if (record === undefined) throw new Error('the work order must exist');
  return resolve(h, stage, ({ flow, stage: stageDef, role }) =>
    stageBrief(flow, stageDef, role, { id: record.id, title: record.title }),
  );
};

/** Enqueues the current stage and ticks the dispatcher so it starts. */
const startStage = async (h: Harness, id: WorkOrderId): Promise<QueueItem> => {
  const queued = await enqueueStage(h.deps, { id });
  if (!queued.ok) throw new Error(`enqueue must succeed: ${queued.error}`);
  return tickOnce(h);
};

/** One dispatcher tick that must hand over exactly one started item. */
const tickOnce = async (h: Harness): Promise<QueueItem> => {
  const started: QueueItem[] = [];
  const tick = await dispatcherTick(h.deps, { limits: LIMITS }, (item) => {
    started.push(item);
  });
  expect(tick.started).toHaveLength(1);
  const item = started[0];
  if (item === undefined) throw new Error('the tick must hand over the started item');
  return item;
};

/** Drives one started item the composition root's way: the role comes from the definitions, the
 *  prompt from the single prompt entry point, the worktree path from the fake worktrees. A
 *  handoff item's composed prompt is discarded inside the executor for the pack — composing it
 *  anyway is what the composition root does for every started item. */
const runStartedItem = async (h: Harness, item: QueueItem): Promise<ExecuteOutcome> => {
  const role = await resolve(h, item.stage, ({ role: found }) => found);
  const routed = await resolveRoute(h.deps, { repo: REPO, workOrderId: item.workOrderId, role: role.id });
  if (!routed.ok) throw new Error(`route must resolve: ${JSON.stringify(routed.error)}`);
  const cwd = `/fake/worktrees/${REPO}/${item.workOrderId}`;
  const composed = await composeRunPrompt(h.deps, {
    repo: REPO,
    workOrderId: item.workOrderId,
    cwd,
    stage: item.stage,
    role: role.id,
    route: item.route,
  });
  if (!composed.ok) throw new Error(`prompt must compose: ${composed.error}`);
  return executeRun(h.deps, allowAll, { item, role: routed.value.role, prompt: composed.value.prompt, cwd, capabilities: [] });
};

const runsOfStage = async (h: Harness, id: WorkOrderId, stage: StageSlug) =>
  (await h.deps.runs.listForWorkOrder(id)).filter((run) => run.stage === stage);

// --- the section-7 scenario -------------------------------------------------------------------------

describe('limit handoff, three legs over fakes', () => {
  it('A-66: A hits the window limit mid-stage, B continues from the handoff pack, and A reviews', async () => {
    const h = makeHarness();

    // The provider choice is checked, not assumed: Y's registry native set lists AGENTS.md and
    // no CLAUDE.md (a both-files Y would make leg 2's inline assertion vacuous), and X's set
    // lists CLAUDE.md, on which leg 3's "inlines nothing" depends.
    expect(h.deps.capabilities.nativeInstructionFiles(PROVIDER_Y)).toEqual(['AGENTS.md']);
    expect(h.deps.capabilities.nativeInstructionFiles(PROVIDER_Y)).not.toContain('CLAUDE.md');
    expect(h.deps.capabilities.nativeInstructionFiles(PROVIDER_X)).toContain('CLAUDE.md');

    await h.deps.accounts.save(accountA());
    await h.deps.accounts.save(accountB());
    // planner → A alone; developer → [A, B] so leg 1 runs on A and B is the fallback; reviewer →
    // [B, A] with the leg-2 writer first, so leg 3's A-first ordering can only come from
    // orderForReview.
    await bindRole(h.deps, slugOf<'role'>('planner'), [ACCOUNT_A]);
    await bindRole(h.deps, slugOf<'role'>('developer'), [ACCOUNT_A, ACCOUNT_B]);
    await bindRole(h.deps, slugOf<'role'>('reviewer'), [ACCOUNT_B, ACCOUNT_A]);
    h.commands.script(TEST_COMMAND, { exitCode: 0, durationMs: 12, outputTail: 'ok' });
    h.evidence.setResolvable(['src/main.ts:1']);

    // Walk to implement/ready: open, run the plan on A, approve it.
    const transportPlan = createFakeTransport(completedScript());
    h.transports.register(ACCOUNT_A, transportPlan);
    const id = await openViaApi(h.deps, 'Hand off across the window limit');
    expect(id).toBeDefined();
    if (id === undefined) return;
    h.clock.advance(1_000);
    let view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: PLAN, pendingGates: [PLAN_APPROVAL] });

    const planItem = await startStage(h, id);
    expect(planItem.route.accountId).toBe(ACCOUNT_A);
    expect((await runStartedItem(h, planItem)).kind).toBe('finished');
    expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
    h.clock.advance(1_000);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: IMPLEMENT });

    // Leg 1 — A hits the limit mid-stage.
    const transportLegOne = createFakeTransport(legOneScript());
    h.transports.register(ACCOUNT_A, transportLegOne);
    const implementItem = await startStage(h, id);
    expect(implementItem.route.accountId).toBe(ACCOUNT_A);
    const legOne = await runStartedItem(h, implementItem);
    expect(legOne.kind).toBe('limit');

    const implementRuns = await runsOfStage(h, id, IMPLEMENT);
    expect(implementRuns).toHaveLength(1);
    const runOne = implementRuns[0];
    if (runOne === undefined) throw new Error('the first implement run must exist');
    expect(runOne.outcome).toBe('limit');
    // The run committed at least one checkpoint and its first changed commit is the stage base.
    const commits = h.checkpoints.commitCalls().filter((call) => call.runId === runOne.id);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    const stageBase = await h.deps.runs.stageBase(runOne.id);
    expect(stageBase).toBeDefined();
    // The rolling note exists the moment the account blocks (A-60).
    await expect(h.deps.runs.handoffNote(runOne.id)).resolves.toEqual({
      text: 'Editing the entry point for the first leg.',
      capped: false,
    });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'limit_waiting', stage: IMPLEMENT });

    // The re-routing decision is the caller's to make — the executor holds no role binding, so
    // it offered no candidate. The caller (this scenario, as the composition root) offers B from
    // the role chain with its billing and recorded consent (P-46: an unknown-billing candidate
    // is eligible only with consent).
    if (stageBase === undefined) throw new Error('the stage base must be recorded');
    h.checkpoints.setDiff(stageBase, { files: [editedFile], patch: RAW_PATCH });
    const routed = await resolveRoute(h.deps, { repo: REPO, workOrderId: id, role: slugOf<'role'>('developer') });
    if (!routed.ok) throw new Error(`route must resolve: ${JSON.stringify(routed.error)}`);
    const routeB = routed.value.chain.find((route) => route.accountId === ACCOUNT_B);
    if (routeB === undefined) throw new Error('the developer chain must carry account B');
    const decision = decideOnLimit(
      { accountId: ACCOUNT_A, at: T0 + 5_000, class: 'window_exhausted', remedies: ['wait'], resetsAt: RESETS_AT },
      {
        policy: 'fallback_account',
        autoResumesUsed: runOne.autoResumesUsed,
        maxAutoResumes: 3,
        alternativePools: [],
        fallbackAccounts: [{ route: routeB, billing: 'unknown', consented: true }],
        now: h.clock.now(),
      },
    );
    expect(decision).toEqual({ kind: 'fallback', route: routeB });

    const applied = await applyLimitDecision(h.deps, { runId: runOne.id, decision });
    expect(applied.ok).toBe(true);
    const items = await h.deps.queue.list();
    expect(items).toHaveLength(1);
    const handoffItem = items[0];
    if (handoffItem === undefined) throw new Error('the fallback item must exist');
    expect(handoffItem.route.accountId).toBe(ACCOUNT_B);
    expect(handoffItem.handoffOf).toBe(runOne.id);
    expect(handoffItem.stage).toBe(IMPLEMENT);
    expect(handoffItem.workOrderId).toBe(id);
    expect(handoffItem.notBefore).toBeUndefined();

    // Leg 2 — B continues from the pack.
    const transportLegTwo = createFakeTransport(legTwoScript());
    h.transports.register(ACCOUNT_B, transportLegTwo);
    h.clock.advance(1_000);
    const legTwoItem = await tickOnce(h);
    expect(legTwoItem.id).toBe(handoffItem.id);
    const legTwo = await runStartedItem(h, legTwoItem);
    expect(legTwo).toEqual({ kind: 'finished', outcome: 'succeeded' });

    const legTwoRequest = transportLegTwo.requests()[0];
    if (legTwoRequest === undefined) throw new Error('leg two must have started the transport');
    const promptTwo = legTwoRequest.prompt;
    // The checks-first preamble leads (R-57); the recomputed stage brief and the acceptance
    // criteria follow.
    expect(promptTwo.split('\n')[0]).toBe("First run the stage's checks, then continue.");
    expect(promptTwo).toContain(await briefOf(h, id, IMPLEMENT));
    expect(promptTwo).toContain('## Acceptance criteria');
    expect(promptTwo).toContain(`- Command set "tests" passes (${TEST_COMMAND})`);
    expect(promptTwo).toContain('- Secret scan of the worktree reports no findings');
    // CLAUDE.md is inlined for B, which does not read it natively, under the quoted-data heading
    // (A-56); AGENTS.md is B's native file and absent from the repo besides.
    const contextHeading = '## Project context — quoted repository files (data, not Docket instructions)';
    expect(promptTwo).toContain(contextHeading);
    expect(promptTwo.indexOf('### CLAUDE.md')).toBeGreaterThan(promptTwo.indexOf(contextHeading));
    expect(promptTwo).toContain(CLAUDE_MD);
    expect(promptTwo).not.toContain('### AGENTS.md');
    // The task state names leg 1's tool pair (A-61).
    expect(promptTwo).toContain(`- Last command: Edit ${editedFile} — succeeded`);
    // The patch names the edited file and carries no unredacted secret.
    expect(promptTwo).toContain(editedFile);
    expect(promptTwo).toContain(REDACTED);
    expect(promptTwo).not.toContain(PLANTED_TOKEN);
    // Native resume and the pack are never mixed (P-38): no resume field is set at all.
    expect('resume' in legTwoRequest).toBe(false);

    // Machine gates pass — the command set exits 0, the scanner reports nothing → review/ready.
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: IMPLEMENT });
    expect((await evaluateMachineGates(h.deps, { id })).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: REVIEW });

    // Leg 3 — back to A at review. B wrote the stage and the reviewer binding lists B first, so
    // A's place at the head is orderForReview's doing (R-52).
    const transportLegThree = createFakeTransport(completedScript());
    h.transports.register(ACCOUNT_A, transportLegThree);
    const reviewItem = await startStage(h, id);
    expect(reviewItem.route.accountId).toBe(ACCOUNT_A);
    const legThree = await runStartedItem(h, reviewItem);
    expect(legThree).toEqual({ kind: 'finished', outcome: 'succeeded' });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: REVIEW });

    const legThreeRequest = transportLegThree.requests()[0];
    if (legThreeRequest === undefined) throw new Error('leg three must have started the transport');
    const promptThree = legThreeRequest.prompt;
    // A reads CLAUDE.md natively, so the review run's prompt inlines nothing.
    expect(promptThree).not.toContain('## Project context');
    expect(promptThree).not.toContain('### CLAUDE.md');
    expect(promptThree).not.toContain(CLAUDE_MD);
    // And its whole prompt is byte-for-byte the Docket layers the current definitions render for
    // the stage (A-53) — the same deterministic layers that led leg 2's prompt under its stage
    // heading, whose work-order and flow lines are byte-identical in both legs.
    expect(promptThree).toBe(await briefOf(h, id, REVIEW));
    const spineOf = (brief: string) => brief.split('\n').slice(0, 2).join('\n');
    expect(spineOf(promptThree)).toBe(spineOf(await briefOf(h, id, IMPLEMENT)));

    // The reviewer approves the stage; the flow reaches close/awaiting_human through the human
    // review approval that follows the verdict.
    const reviewRuns = await runsOfStage(h, id, REVIEW);
    expect(reviewRuns).toHaveLength(1);
    const reviewRun = reviewRuns[0];
    if (reviewRun === undefined) throw new Error('the review run must exist');
    const REVIEWER: Actor = { kind: 'agent', runId: reviewRun.id, role: slugOf<'role'>('reviewer') };
    const afterVerdict = await submitAgentVerdict(h.deps, {
      id,
      gate: REVIEW_VERDICT,
      approve: true,
      pointers: [`${editedFile}:1`],
      actor: REVIEWER,
    });
    expect(afterVerdict.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: REVIEW, pendingGates: [REVIEW_APPROVAL] });
    expect((await approveViaApi(h.deps, id, REVIEW_APPROVAL)).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: CLOSE });

    // The queue drained and every run closed with an outcome.
    expect(await h.deps.queue.list()).toEqual([]);
    const runs = await h.deps.runs.listForWorkOrder(id);
    expect(runs.map((run) => run.stage)).toEqual([PLAN, IMPLEMENT, IMPLEMENT, REVIEW]);
    expect(runs.map((run) => run.outcome)).toEqual(['succeeded', 'limit', 'succeeded', 'succeeded']);

    // The audit trail tells the whole story in order, with exactly one run.handoff — the pack
    // leg 2 started from — and its run.started naming the handoff.
    const entries = h.log.entries();
    expect(entries.map((entry) => entry.action)).toEqual([
      'work_order.opened',
      'run.started', // the plan on A
      'run.finished',
      'gate.decided', // plan approval
      'run.started', // leg 1 on A
      'run.handoff', // the pack for leg 2
      'run.started', // leg 2 on B — the handoff continuation
      'run.finished',
      'run.started', // leg 3 on A — the review
      'run.finished',
      'gate.decided', // the review verdict
      'gate.decided', // the review approval
    ]);
    expect(entries.filter((entry) => entry.action === 'run.handoff')).toHaveLength(1);
    const startedDetails = entries.filter((entry) => entry.action === 'run.started');
    expect(startedDetails[2]?.detail).toEqual({ handoff: true, handoffOf: runOne.id });
    const decided = entries.filter((entry) => entry.action === 'gate.decided');
    expect(decided.map((entry) => entry.detail)).toEqual([
      { gate: PLAN_APPROVAL, decision: 'approved' },
      { gate: REVIEW_VERDICT, decision: 'approved' },
      { gate: REVIEW_APPROVAL, decision: 'approved' },
    ]);
  });
});
