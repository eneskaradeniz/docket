// use-cases/handoff.test.ts — rules A-61 … A-63 from docs/v2/application.md (P-38): the pack
// builder over the failed run's stored state, sized for the candidate routes, rendered for the
// continuation, with the run.handoff audit entry.
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  AccountRoute,
  Actor,
  AgentEvent,
  CatalogModel,
  EpochMs,
  RepoSlug,
  RunId,
  StageSlug,
  WorkOrderId,
} from '../../domain/index';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  PACK_CHARS_PER_TOKEN,
  definitionsDigest,
  parseSlug,
  parseUlid,
  renderHandoffPrompt,
  stageBrief,
} from '../../domain/index';

import type { AccountRecord, RunRecord } from '../ports';
import type {
  FakeCheckpointCommitter,
  FakeClock,
  FakeDefinitionStore,
  FakeEventLog,
  FakeIdGen,
  FakeRunRepo,
} from '../ports/fakes';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeCheckpointCommitter,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  createFakeInstructionFiles,
  createFakeModelCatalog,
  createFakeRunRepo,
  createFakeWorkOrderRepo,
  type FakeRouteKind,
} from '../ports/fakes';

import { buildHandoff } from './handoff';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf<'repo'>('acme');
const WORK_ORDER: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const FAILED_RUN: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const MISSING_RUN: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const ACCOUNT_X: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const ACCOUNT_Y: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA3');
const ACCOUNT_MISSING: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const STAGE: StageSlug = slugOf<'stage'>('implement');
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const T0: EpochMs = 1_700_000_000_000;

const CWD = '/wt/acme/wo-1';
const STAGE_BASE = 'sha-stage-base';
const WORKTREE_BASE = 'sha-worktree-base';

/** X reads CLAUDE.md natively; Y reads AGENTS.md natively and does not read CLAUDE.md — the
 *  §7-leg-2 shape: a pack for Y must inline CLAUDE.md and never AGENTS.md. */
const ROUTE_KINDS: readonly FakeRouteKind[] = [
  { id: 'rk-x', authMode: 'subscription', provider: 'prov-x', instructionFiles: ['CLAUDE.md'] },
  { id: 'rk-y', authMode: 'subscription', provider: 'prov-y', instructionFiles: ['AGENTS.md'] },
];

const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Ship the change.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};
const STAGE_JSON = {
  id: 'implement',
  name: 'Implement',
  role: 'worker',
  exit: [{ kind: 'command', id: 'checks', commandSet: 'check' }, { kind: 'secret_scan', id: 'secrets' }],
};
const FLOW_JSON = { id: 'standard', name: 'Standart', stages: [STAGE_JSON] };
const REPO_JSON = {
  id: 'acme',
  name: 'Acme',
  flows: ['standard'],
  defaultFlow: 'standard',
  commandSets: { check: ['npm test'] },
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: [],
};
const DEFS_JSON = JSON.stringify({ roles: [ROLE_JSON], flows: [FLOW_JSON], capabilities: [], repo: REPO_JSON });

const WORK_ORDER_RECORD = {
  id: WORK_ORDER,
  project: slugOf<'project'>('atolye'),
  repo: REPO,
  flow: slugOf<'flow'>('standard'),
  title: 'Continue the work elsewhere',
  createdAt: T0,
  createdBy: USER,
};

const accountRecord = (id: AccountId, provider: string): AccountRecord => ({
  id,
  provider,
  label: `Account ${provider}`,
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const CLAUDE_MD = '# Repo rules\n\nReview every change against the acceptance criteria.';
const AGENTS_MD = '# Agent guide\n\nRun the tests before finishing.';

const PATCH = 'diff --git a/src/a.ts b/src/a.ts\n+hello from leg one';
const DIFF = { files: ['src/a.ts'], patch: PATCH };

const failedRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: FAILED_RUN,
  workOrderId: WORK_ORDER,
  stage: STAGE,
  attempt: 1,
  role: slugOf<'role'>('worker'),
  route: { accountId: ACCOUNT_X },
  startedAt: T0 - 1_000,
  autoResumesUsed: 0,
  // The previous provider's session must never travel (A-61/A-62).
  sessionRef: 'sess-LEAK-REF',
  ...overrides,
});

const FAILED_EVENTS: readonly AgentEvent[] = [
  { type: 'session_started', at: T0, sessionRef: 'sess-LEAK-REF' },
  { type: 'text', at: T0 + 1, delta: 'leg one narration' },
  { type: 'tool_call', at: T0 + 2, id: 'c1', name: 'Edit', target: 'src/a.ts' },
  { type: 'tool_result', at: T0 + 3, id: 'c1', ok: true },
  // Raw lines never enter the pack (R-55) — planted so a leak would show.
  { type: 'raw', at: T0 + 4, line: 'RAW-LEAK-LINE' },
];

interface Harness {
  readonly deps: Parameters<typeof buildHandoff>[0];
  readonly definitions: FakeDefinitionStore;
  readonly log: FakeEventLog;
  readonly ids: FakeIdGen;
  readonly clock: FakeClock;
  readonly runs: FakeRunRepo;
  readonly checkpoints: FakeCheckpointCommitter;
}

const harness = async (options: {
  readonly run?: RunRecord;
  readonly note?: { readonly text: string; readonly capped: boolean };
  readonly stageBase?: string;
  readonly diffs?: Readonly<Record<string, { files: readonly string[]; patch: string }>>;
  readonly bases?: Readonly<Record<string, string>>;
  readonly models?: Readonly<Record<string, readonly CatalogModel[]>>;
  readonly routeKinds?: readonly FakeRouteKind[];
} = {}): Promise<Harness> => {
  const clock = createFakeClock(T0);
  const ids = createFakeIdGen();
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const accounts = createFakeAccountRepo();
  const checkpoints = createFakeCheckpointCommitter({ diffs: options.diffs, bases: options.bases });

  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFS_JSON);

  await workOrders.create({ ...WORK_ORDER_RECORD });
  await accounts.save(accountRecord(ACCOUNT_X, 'prov-x'));
  await accounts.save(accountRecord(ACCOUNT_Y, 'prov-y'));
  const run = options.run ?? failedRun();
  await runs.create(run);
  for (const event of FAILED_EVENTS) await runs.appendEvents(run.id, [event]);
  if (options.note !== undefined) await runs.saveHandoffNote(run.id, options.note);
  if (options.stageBase !== undefined) await runs.saveStageBase(run.id, options.stageBase);

  const models = createFakeModelCatalog(options.models ?? {});
  const deps = {
    clock,
    ids,
    log,
    definitions,
    workOrders,
    runs,
    accounts,
    capabilities: createFakeCapabilityCatalog(options.routeKinds ?? ROUTE_KINDS),
    instructionFiles: createFakeInstructionFiles({
      [CWD]: [
        { name: 'CLAUDE.md', content: CLAUDE_MD },
        { name: 'AGENTS.md', content: AGENTS_MD },
      ],
    }),
    checkpoints,
    modelCatalog: models,
  };

  return { deps, definitions, log, ids, clock, runs, checkpoints };
};

const NOTE = { text: 'leg one summary tail', capped: false };
const ROUTE_Y: AccountRoute = { accountId: ACCOUNT_Y };

const model = (over: Partial<CatalogModel>): CatalogModel => ({
  id: 'model-y1',
  displayName: 'Y One',
  source: 'bundled',
  thinking: 'unknown',
  billing: 'included',
  contextWindow: null,
  ...over,
});

/** The brief over the fixture definitions — derived, not restated (the A-53 test's precedent). */
const expectedBrief = async (h: Harness): Promise<string> => {
  const loaded = await h.deps.definitions.load(REPO);
  if (!loaded.ok) throw new Error('fixture definitions must load');
  const flowDef = loaded.value.flows.find((candidate) => candidate.id === slugOf<'flow'>('standard'));
  const stageDef = flowDef?.stages.find((candidate) => candidate.id === STAGE);
  const roleDef = loaded.value.roles.find((candidate) => candidate.id === slugOf<'role'>('worker'));
  if (flowDef === undefined || stageDef === undefined || roleDef === undefined) {
    throw new Error('fixture flow, stage or role missing');
  }
  return stageBrief(flowDef, stageDef, roleDef, { id: WORK_ORDER, title: WORK_ORDER_RECORD.title });
};

const handoffActions = (log: FakeEventLog): readonly string[] =>
  log.entries().filter((entry) => entry.action === 'run.handoff').map((entry) => entry.action);

// --- the pack ---------------------------------------------------------------------------------------

describe('buildHandoff', () => {
  it('A-62: assembles P-38 items 1–6 in the pack field order from the failed run’s stored state', async () => {
    const h = await harness({ note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });
    const brief = await expectedBrief(h);

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    const { pack, prompt } = result.value;

    // Item 1 — recomputed from the current definitions, never stored on the run.
    expect(pack.stagePrompt).toBe(brief);
    expect(pack.acceptance).toEqual([
      'Command set "check" passes (npm test)',
      'Secret scan of the worktree reports no findings',
    ]);
    // Item 2 — for the TARGET provider: Y reads AGENTS.md natively, so CLAUDE.md is inlined.
    expect(pack.instructionPlan.native).toEqual(['AGENTS.md']);
    expect(pack.instructionPlan.inlined).toEqual([{ name: 'CLAUDE.md', content: CLAUDE_MD }]);
    // Item 3 — deterministic from stored events plus the diff's file list.
    expect(pack.taskState.lastCommand).toEqual({ name: 'Edit', target: 'src/a.ts', ok: true });
    expect(pack.taskState.toolCalls).toBe(1);
    expect(pack.taskState.filesTouched).toEqual(['src/a.ts']);
    // Item 4 — the diff since the stage base; item 5 — the rolling note.
    expect(pack.codeState).toEqual(DIFF);
    expect(pack.summary).toEqual(NOTE);
    expect(pack.definitionsChanged).toBe(false);
    // The rendered prompt is exactly the rendered pack — checks-first preamble included (R-57).
    expect(prompt).toBe(renderHandoffPrompt(pack));
    expect(prompt.split('\n')[0].toLowerCase()).toContain("first run the stage's checks");
  });

  it('A-62: with no stage base the code state diffs from the worktree base ref', async () => {
    const h = await harness({
      note: NOTE,
      bases: { [WORK_ORDER]: WORKTREE_BASE },
      diffs: { [WORKTREE_BASE]: DIFF },
    });

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    expect(result.value.pack.codeState).toEqual(DIFF);
  });

  it('A-62: definitionsChanged is set when the recorded rev differs from the current layers’ digest — and the prompt carries the note', async () => {
    const h = await harness({
      run: failedRun({ definitionsRev: definitionsDigest('stale first-leg layers') }),
      note: NOTE,
      stageBase: STAGE_BASE,
      diffs: { [STAGE_BASE]: DIFF },
    });

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    expect(result.value.pack.definitionsChanged).toBe(true);
    expect(result.value.prompt).toContain('Definition changed since the first leg');
  });

  it('A-62: a recorded rev equal to the current layers’ digest leaves the pack unchanged-flagged', async () => {
    const h = await harness({ note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });
    const brief = await expectedBrief(h);
    const withRev = failedRun({ definitionsRev: definitionsDigest(brief) });
    const seeded = await harness({ run: withRev, note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });
    void h;

    const result = await buildHandoff(seeded.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    expect(result.value.pack.definitionsChanged).toBe(false);
    expect(result.value.prompt.toLowerCase()).not.toContain('definition changed since the first leg');
  });

  it('A-62: a run with no recorded rev counts as unchanged', async () => {
    const h = await harness({ note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    expect(result.value.pack.definitionsChanged).toBe(false);
  });

  it('A-61: the session ref and raw transcript lines never enter the pack or the prompt', async () => {
    const h = await harness({ note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    const serialized = JSON.stringify(result.value.pack);
    expect(serialized).not.toContain('sess-LEAK-REF');
    expect(serialized).not.toContain('RAW-LEAK-LINE');
    expect(result.value.prompt).not.toContain('sess-LEAK-REF');
    expect(result.value.prompt).not.toContain('RAW-LEAK-LINE');
  });

  it('A-63: null windows size the pack to the fixed ceilings alone — nothing is cut under them', async () => {
    const withinCeilings = 'x'.repeat(20_000);
    const h = await harness({
      note: { text: 'n'.repeat(8_000), capped: true },
      stageBase: STAGE_BASE,
      diffs: { [STAGE_BASE]: { files: ['src/big.ts'], patch: withinCeilings } },
      models: { [ACCOUNT_Y]: [model({ id: 'model-y1', contextWindow: null })] },
    });

    const result = await buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    // The stand-in window sits above the ceilings (A-63), so the patch survives whole.
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS * PACK_CHARS_PER_TOKEN).toBeGreaterThan(20_000 + 8_000);
    expect(result.value.pack.codeState.patch).toBe(withinCeilings);
    expect(result.value.prompt).not.toContain('patch truncated');
  });

  it('A-63: a known window only tightens — the min over the candidates’ known windows; the Docket layers never truncate (R-56)', async () => {
    const bigPatch = 'x'.repeat(20_000);
    const h = await harness({
      note: NOTE,
      stageBase: STAGE_BASE,
      diffs: { [STAGE_BASE]: { files: ['src/big.ts'], patch: bigPatch } },
      // The target knows a 3_000-token window; the second candidate knows none — the min over the
      // known windows is the target's, so 12_000 chars govern the pack.
      models: { [ACCOUNT_Y]: [model({ id: 'model-y1', contextWindow: 3_000 })] },
    });
    const brief = await expectedBrief(h);

    const result = await buildHandoff(h.deps, {
      runId: FAILED_RUN,
      cwd: CWD,
      candidates: [{ accountId: ACCOUNT_Y, model: 'model-y1' }, { accountId: ACCOUNT_MISSING }],
    });
    if (!result.ok) throw new Error(`the pack must build: ${result.error}`);
    // The patch was cut to fit the window-derived budget, marker in place of the cut; the stage
    // prompt and the inlined Docket-bound block survive whole.
    expect(result.value.pack.codeState.patch).not.toBe(bigPatch);
    expect(result.value.pack.codeState.patch).toContain('patch truncated');
    expect(result.value.pack.stagePrompt).toBe(brief);
    expect(result.value.pack.instructionPlan.inlined[0]?.content).toBe(CLAUDE_MD);
  });

  // --- errors ----------------------------------------------------------------------------------------

  it('answers not_found when the failed run is missing', async () => {
    const h = await harness();
    await expect(buildHandoff(h.deps, { runId: MISSING_RUN, cwd: CWD, candidates: [ROUTE_Y] })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('answers definitions_invalid when the definitions do not load', async () => {
    const h = await harness({});
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', '{ not json');
    await expect(buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] })).resolves.toEqual({
      ok: false,
      error: 'definitions_invalid',
    });
  });

  it('answers unknown_account when the target candidate’s account is missing', async () => {
    const h = await harness({ stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });
    await expect(
      buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [{ accountId: ACCOUNT_MISSING }] }),
    ).resolves.toEqual({ ok: false, error: 'unknown_account' });
  });

  it('answers no_repo when the checkpoint adapter reports the cwd is not a git working tree (the base cannot resolve)', async () => {
    // No stage base and no scripted worktree base: the adapter's base call is the first git
    // touch, and its failure is the not-a-working-tree verdict (a handoff never recreates one).
    const h = await harness({});
    h.checkpoints.failNext();
    await expect(buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] })).resolves.toEqual({
      ok: false,
      error: 'no_repo',
    });
  });

  it('answers git_failed when the diff itself fails', async () => {
    const h = await harness({});
    await h.runs.saveStageBase(FAILED_RUN, STAGE_BASE);
    h.checkpoints.failNext();
    await expect(buildHandoff(h.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] })).resolves.toEqual({
      ok: false,
      error: 'git_failed',
    });
  });

  // --- audit -----------------------------------------------------------------------------------------

  it('appends exactly one run.handoff audit entry with detail { fromRun, candidates } — success and failure alike', async () => {
    const ok = await harness({ note: NOTE, stageBase: STAGE_BASE, diffs: { [STAGE_BASE]: DIFF } });
    const built = await buildHandoff(ok.deps, {
      runId: FAILED_RUN,
      cwd: CWD,
      candidates: [ROUTE_Y, { accountId: ACCOUNT_X }],
    });
    if (!built.ok) throw new Error('the pack must build');
    expect(handoffActions(ok.log)).toEqual(['run.handoff']);
    const entry = ok.log.entries()[0];
    expect(entry.subject).toEqual({ kind: 'run', id: FAILED_RUN });
    expect(entry.detail).toEqual({ fromRun: FAILED_RUN, candidates: 2 });

    // A failed pack leaves the same single entry as its only write (A-64 builds on this).
    const failed = await harness({});
    failed.checkpoints.failNext();
    const refused = await buildHandoff(failed.deps, { runId: FAILED_RUN, cwd: CWD, candidates: [ROUTE_Y] });
    expect(refused).toEqual({ ok: false, error: 'no_repo' });
    expect(handoffActions(failed.log)).toEqual(['run.handoff']);
    expect(failed.log.entries()).toHaveLength(1);
  });
});
