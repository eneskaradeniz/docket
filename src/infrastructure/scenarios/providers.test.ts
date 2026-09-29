// infrastructure/scenarios/providers.test.ts — the Phase 3 acceptance (docs/v2/providers.md → "Acceptance
// (P-24)"): the same work order runs to completion three times through the three real
// transports — the sdk transport over a scripted SDK session, the app-server transport against
// its checked-in fake server, and the acp transport against its checked-in fake agent. The
// engine and use-case path is identical in every leg (open → plan → implement → review → close
// through the api boundary and the application services); only the transport wiring differs, and
// every run delivers the same common event kinds with exactly one `finished`.
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type DispatchLimits,
  type EpochMs,
  type GateSlug,
  type QueueItem,
  type RoleSlug,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import { createApi } from '../../api/index';
import type { AccountRecord, AgentTransport, AppDeps } from '../../application/index';
import {
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
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeTransportResolver,
  type FakeClock,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeEvidenceChecker,
  type FakeTransportResolver,
} from '../../application/ports/fakes/index';
import { createSdkTransport, type QueryFn } from '../providers/index';
import { createAppServerTransport } from '../providers/transports/app-server/index';
import { createAcpTransport } from '../providers/transports/acp/index';
import type { ProviderDef } from '../providers/defs/index';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// --- fixtures ---------------------------------------------------------------------------------------

const APP_SERVER_FIXTURE = fileURLToPath(
  new URL('../providers/transports/app-server/fixtures/fake-app-server.cjs', import.meta.url),
);
const ACP_AGENT_BIN = fileURLToPath(
  new URL('../providers/transports/acp/fake-agent.cjs', import.meta.url),
);

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-providers-scenario-'));
  // The ACP fixture launches through its shebang; the executable bit must survive every checkout.
  chmodSync(ACP_AGENT_BIN, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

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

const MAIN: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** Opens a work order through the api boundary and returns its parsed id. */
const openViaApi = async (deps: AppDeps, title: string): Promise<WorkOrderId | undefined> => {
  const result = await createApi(deps).command(USER, { type: 'workOrder.open', repo: REPO, title });
  if (!result.ok || result.id === undefined) return undefined;
  const parsed = parseUlid<'work-order'>(result.id);
  return parsed.ok ? parsed.value : undefined;
};

/** Approves a human gate through the api boundary. */
const approveViaApi = (deps: AppDeps, id: WorkOrderId, gate: GateSlug) =>
  createApi(deps).command(USER, { type: 'gate.decide', workOrderId: id, gate, decision: 'approved' });

// The standard flow's stages and gates, as slugs the inputs below are typed with.
const PLAN: StageSlug = slugOf<'stage'>('plan');
const IMPLEMENT: StageSlug = slugOf<'stage'>('implement');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const PLAN_APPROVAL: GateSlug = slugOf<'gate'>('plan-approval');
const REVIEW_VERDICT: GateSlug = slugOf<'gate'>('review-verdict');
const REVIEW_APPROVAL: GateSlug = slugOf<'gate'>('review-approval');
const CLOSURE: GateSlug = slugOf<'gate'>('closure');

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

const TEST_COMMAND = 'npm test';

/** The whole definitions body the fake store serves for the repo: the built-in library's
 *  `standard` flow plus a repo that enables it and defines the `tests` command set. */
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

const account = (id: AccountId): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: `account ${id}`,
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const bindRole = async (deps: AppDeps, role: RoleSlug, accountId: AccountId): Promise<void> => {
  await deps.bindings.save({ level: 'global' }, { role, accounts: [{ accountId }] });
};

// --- the three transport wirings --------------------------------------------------------------------

const SESSION_ID = 'sess_scenario_sdk';
const UUID_A = '00000000-0000-4000-8000-000000000000';

// --- SDK message fixtures (shapes read off the SDK's own declarations) ---

type AssistantMessageBody = Extract<SDKMessage, { type: 'assistant' }>['message'];
type ResultUsage = Extract<SDKMessage, { type: 'result' }>['usage'];

function betaUsage(): AssistantMessageBody['usage'] {
  return {
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: { status: { type: 'redeemed' } },
    inference_geo: null,
    input_tokens: 10,
    iterations: [],
    output_tokens: 5,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: 'standard',
    speed: 'standard',
  };
}

function systemInit(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '2.0.0',
    cwd: '/tmp/docket-providers-scenario',
    tools: [],
    mcp_servers: [],
    model: 'test-model',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function assistantText(delta: string): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_1',
      container: null,
      content: [{ type: 'text', text: delta, citations: null }],
      context_management: null,
      diagnostics: null,
      model: 'test-model',
      role: 'assistant',
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      type: 'message',
      usage: betaUsage(),
    },
    parent_tool_use_id: null,
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function resultUsage(inputTokens: number, outputTokens: number): ResultUsage {
  return {
    cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 2 },
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 4,
    fallback_credit: { status: { type: 'redeemed' } },
    inference_geo: 'eu',
    input_tokens: inputTokens,
    iterations: [],
    output_tokens: outputTokens,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: 'standard',
    speed: 'standard',
  };
}

function successResult(totalCostUsd: number): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1200,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 3,
    result: 'done',
    stop_reason: null,
    total_cost_usd: totalCostUsd,
    usage: resultUsage(120, 45),
    modelUsage: {},
    permission_denials: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

/** Minimal Query: the generator drives the messages, every control request is explicitly unsupported. */
function asQuery(generator: AsyncGenerator<SDKMessage, void>): Query {
  const unsupported = (): Promise<never> => Promise.reject(new Error('fake query: control request not scripted'));
  const query: Query = Object.assign(generator, {
    interrupt: (): Promise<undefined> => Promise.resolve(undefined),
    setPermissionMode: (): Promise<void> => Promise.resolve(),
    setMcpPermissionModeOverride: (): Promise<{ warning?: string }> => Promise.resolve({}),
    setModel: (): Promise<void> => Promise.resolve(),
    setMaxThinkingTokens: (): Promise<void> => Promise.resolve(),
    applyFlagSettings: (): Promise<void> => Promise.resolve(),
    initializationResult: unsupported,
    reinitialize: unsupported,
    supportedCommands: unsupported,
    supportedModels: unsupported,
    supportedAgents: unsupported,
    mcpServerStatus: unsupported,
    getContextUsage: unsupported,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: unsupported,
    readFile: unsupported,
    reloadPlugins: unsupported,
    reloadSkills: unsupported,
    accountInfo: unsupported,
    rewindFiles: unsupported,
    seedReadState: (): Promise<void> => Promise.resolve(),
    reconnectMcpServer: (): Promise<void> => Promise.resolve(),
    toggleMcpServer: (): Promise<void> => Promise.resolve(),
    setMcpServers: unsupported,
    streamInput: (): Promise<void> => Promise.resolve(),
    stopTask: (): Promise<void> => Promise.resolve(),
    backgroundTasks: (): Promise<boolean> => Promise.resolve(false),
    // Required by a module augmentation active in this program, not by the SDK's own declarations;
    // an extra member is harmless here because Object.assign's intersection is never fresh.
    cancelAsyncMessage: (): Promise<boolean> => Promise.resolve(false),
    close: (): void => {},
  });
  return query;
}

/** The scripted SDK session every sdk-leg run answers with: the same common event kinds the two
 *  protocol fakes deliver — a session, one visible answer line, usage, and a successful finish. */
const scenarioQuery: QueryFn = () =>
  asQuery(
    (async function* generate(): AsyncGenerator<SDKMessage, void> {
      yield systemInit();
      yield assistantText('all done');
      yield successResult(0.01);
    })(),
  );

const appServerDef = (logPath: string): ProviderDef => ({
  id: 'fake-app-server',
  displayName: 'Fake App Server',
  // The fixture rides on the node binary: a checked-in script cannot carry a portable exec bit.
  bins: [process.execPath],
  versionArgs: ['--version'],
  transport: 'app-server',
  config: { mechanism: 'env-var', name: 'FAKE_APP_SERVER_HOME' },
  buildLaunch: () => ({ args: [APP_SERVER_FIXTURE, 'happy', logPath], env: {}, stdin: 'none' }),
  resume: 'protocol',
  capabilities: {
    structuredStream: true,
    permissionAsk: true,
    resume: true,
    mcp: false,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'query',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-app-server' },
});

const acpDef = (logPath: string): ProviderDef => ({
  id: 'fake-acp',
  displayName: 'Fake ACP Agent',
  bins: [ACP_AGENT_BIN],
  versionArgs: ['--version'],
  transport: 'acp',
  config: { mechanism: 'env-var', name: 'FAKE_ACP_HOME' },
  // The scenario and the log path are how the test scripts its fake agent.
  buildLaunch: () => ({ args: ['happy', logPath], env: {}, stdin: 'none' }),
  resume: 'protocol',
  capabilities: {
    structuredStream: true,
    permissionAsk: 'unknown',
    resume: true,
    mcp: true,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-acp' },
});

/** One leg's transport, built exactly as the composition root would wire it for that provider. */
interface LegWiring {
  readonly name: 'sdk' | 'app-server' | 'acp';
  /** A real directory: the protocol transports spawn their fake against this cwd. */
  readonly runCwd: string;
  readonly transport: (deps: AppDeps) => AgentTransport;
}

const legWirings = (): readonly LegWiring[] => {
  const sdkCwd = join(root, 'sdk');
  const appServerCwd = join(root, 'app-server');
  const acpCwd = join(root, 'acp');
  for (const dir of [sdkCwd, appServerCwd, acpCwd]) mkdirSync(dir, { recursive: true });
  return [
    {
      name: 'sdk',
      runCwd: sdkCwd,
      transport: (deps) =>
        createSdkTransport({
          clock: { now: (): EpochMs => deps.clock.now() },
          accounts: deps.accounts,
          secrets: deps.secrets,
          baseEnv: {},
          query: scenarioQuery,
        }),
    },
    {
      name: 'app-server',
      runCwd: appServerCwd,
      transport: () => createAppServerTransport(appServerDef(join(appServerCwd, 'rpc.log'))),
    },
    {
      name: 'acp',
      runCwd: acpCwd,
      transport: () => createAcpTransport(acpDef(join(acpCwd, 'agent-log.jsonl'))),
    },
  ];
};

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly commands: FakeCommandRunner;
  readonly evidence: FakeEvidenceChecker;
  readonly transports: FakeTransportResolver;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(T0);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(definitionsBody()));
  const commands = createFakeCommandRunner();
  const evidence = createFakeEvidenceChecker();
  const transports = createFakeTransportResolver();
  const deps = createFakeDeps({ clock, log, definitions, commands, evidence, transports });
  return { deps, clock, log, definitions, commands, evidence, transports };
};

const allowAll: PermissionGate = { onAsk: async () => 'allow' };

const viewOf = async (deps: AppDeps, id: WorkOrderId) => {
  const view = await getWorkOrder(deps, id);
  if (!view.ok) throw new Error(`work order must load: ${view.error}`);
  return view.value;
};

/** Enqueues the current stage, ticks the dispatcher so it starts, and runs the started item to
 *  completion in the leg's own directory — the cwd the fake CLI is spawned against. */
const runCurrentStage = async (h: Harness, id: WorkOrderId, runCwd: string): Promise<ExecuteOutcome> => {
  const view = await viewOf(h.deps, id);
  if (view.next.kind !== 'start_run') throw new Error(`expected start_run, got ${view.next.kind}`);

  const routed = await resolveRoute(h.deps, { repo: REPO, workOrderId: id, role: view.next.role });
  if (!routed.ok) throw new Error(`route must resolve: ${JSON.stringify(routed.error)}`);

  const queued = await enqueueStage(h.deps, { id });
  if (!queued.ok) throw new Error(`enqueue must succeed: ${queued.error}`);

  const started: QueueItem[] = [];
  const tick = await dispatcherTick(h.deps, { limits: LIMITS }, (item) => {
    started.push(item);
  });
  expect(tick.started).toHaveLength(1);
  const item = started[0];
  if (item === undefined) throw new Error('the tick must hand over the started item');

  return executeRun(h.deps, allowAll, {
    item,
    role: routed.value.role,
    prompt: `run stage ${item.stage}`,
    cwd: runCwd,
    capabilities: [],
  });
};

/** What one leg proves: the shape of its three stage runs and the trail the engine left. */
interface LegResult {
  readonly name: string;
  /** The common-stream event kinds of each stage run, in order — plan, implement, review. */
  readonly runKinds: readonly (readonly string[])[];
  readonly finishedReasons: readonly string[];
  readonly outcomes: readonly (string | undefined)[];
  readonly auditActions: readonly string[];
  readonly finalStatus: string;
}

/** The kinds every transport must deliver over the common AgentEvent stream; a transport may add
 *  its own richer kinds around them, but these must arrive, in this order, in every run. */
const COMMON_KINDS: readonly string[] = ['session_started', 'text', 'usage', 'finished'];

const commonKindsOf = (events: readonly AgentEvent[]): readonly string[] =>
  events.map((event) => event.type).filter((kind) => COMMON_KINDS.includes(kind));

/** Walks the whole standard flow once, through the one transport of the given leg. */
const runLeg = async (wiring: LegWiring): Promise<LegResult> => {
  const h = makeHarness();
  await h.deps.accounts.save(account(MAIN));
  h.transports.register(MAIN, wiring.transport(h.deps));
  await bindRole(h.deps, slugOf<'role'>('planner'), MAIN);
  await bindRole(h.deps, slugOf<'role'>('developer'), MAIN);
  await bindRole(h.deps, slugOf<'role'>('reviewer'), MAIN);
  // The implement stage's command gate passes: the command set's one command exits 0, and the
  // scanner (0 findings by default) clears the secret scan gate.
  h.commands.script(TEST_COMMAND, { exitCode: 0, durationMs: 12, outputTail: 'ok' });
  h.evidence.setResolvable(['src/main.ts:1']);

  // 1. open → plan; run; approve → implement; run; machine gates → review; run; verdict and
  //    approvals → close; closure → done. Identical steps for every leg.
  const id = await openViaApi(h.deps, 'One work order, three transports');
  expect(id).toBeDefined();
  if (id === undefined) throw new Error('the work order must open');
  h.clock.advance(1_000);

  const planRun = await runCurrentStage(h, id, wiring.runCwd);
  expect(planRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
  expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
  h.clock.advance(1_000);

  const implementRun = await runCurrentStage(h, id, wiring.runCwd);
  expect(implementRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
  expect((await evaluateMachineGates(h.deps, { id })).ok).toBe(true);

  const reviewRun = await runCurrentStage(h, id, wiring.runCwd);
  expect(reviewRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
  const reviewerRun = (await h.deps.runs.listForWorkOrder(id)).find((run) => run.stage === REVIEW);
  if (reviewerRun === undefined) throw new Error('the review run must exist');
  const REVIEWER: Actor = { kind: 'agent', runId: reviewerRun.id, role: slugOf<'role'>('reviewer') };
  expect(
    (
      await submitAgentVerdict(h.deps, {
        id,
        gate: REVIEW_VERDICT,
        approve: true,
        pointers: ['src/main.ts:1'],
        actor: REVIEWER,
      })
    ).ok,
  ).toBe(true);
  expect((await approveViaApi(h.deps, id, REVIEW_APPROVAL)).ok).toBe(true);
  expect((await approveViaApi(h.deps, id, CLOSURE)).ok).toBe(true);

  // 2. the leg's evidence: every stage run's stored events and the trail the engine left.
  const runs = await h.deps.runs.listForWorkOrder(id);
  expect(runs.map((run) => run.stage)).toEqual([PLAN, IMPLEMENT, REVIEW]);
  const runKinds: string[][] = [];
  const finishedReasons: string[] = [];
  for (const run of runs) {
    const events = await h.deps.runs.events(run.id);
    const finished = events.filter((event): event is Extract<AgentEvent, { readonly type: 'finished' }> => {
      return event.type === 'finished';
    });
    expect(finished).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe('finished');
    finishedReasons.push(finished[0]?.reason ?? 'missing');
    runKinds.push([...commonKindsOf(events)]);
  }

  const view = await viewOf(h.deps, id);
  expect(await h.deps.queue.list()).toEqual([]);

  return {
    name: wiring.name,
    runKinds,
    finishedReasons,
    outcomes: runs.map((run) => run.outcome),
    auditActions: h.log.entries().map((entry) => entry.action),
    finalStatus: view.state.status,
  };
};

// --- the Phase 3 acceptance scenario ----------------------------------------------------------------

describe('the same work order through the three transports, headless end to end', () => {
  it('P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run', async () => {
    const legs: LegResult[] = [];
    for (const wiring of legWirings()) legs.push(await runLeg(wiring));
    const [sdk, appServer, acp] = legs;
    if (sdk === undefined || appServer === undefined || acp === undefined) {
      throw new Error('the three transport legs must all run');
    }

    // Every leg drove the work order to the same terminal state with three succeeded stage runs.
    for (const leg of legs) {
      expect(leg.finalStatus).toBe('done');
      expect(leg.outcomes).toEqual(['succeeded', 'succeeded', 'succeeded']);
      // Every single stage run finished exactly once, with the run completed.
      expect(leg.finishedReasons).toEqual(['completed', 'completed', 'completed']);
    }

    // The engine and use-case path is identical: the audit trail tells the same story per leg.
    expect(appServer.auditActions).toEqual(sdk.auditActions);
    expect(acp.auditActions).toEqual(sdk.auditActions);

    // Only the transport differs: each leg's three runs delivered the same common event kinds.
    expect(appServer.runKinds).toEqual(sdk.runKinds);
    expect(acp.runKinds).toEqual(sdk.runKinds);
    // And those common kinds are the stream the engine consumes, in the order it consumes them.
    expect(sdk.runKinds).toEqual([
      COMMON_KINDS,
      COMMON_KINDS,
      COMMON_KINDS,
    ]);
  });
});
