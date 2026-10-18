// submit_verdict — rules A-420 (the tool validates and holds a run's verdict) and A-421 (the held
// verdict is delivered after the run finished succeeded) from docs/v2/application.md, driven over
// the in-memory fakes through the real tool dispatch.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type RoleSlug,
  type RunId,
  type Slug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeRunTokens,
  createFakeWorktrees,
  repoFlowOf,
} from '../ports/fakes';

import { createActionApplier } from './action-appliers';
import { attachDocketCapability } from './mcp-attach';
import { createChatTurnLedger } from './chat-turn-ledger';
import { createDocketTools, DOCKET_TOOL_DEFINITIONS_BY_KIND, type DocketToolResponse } from './docket-tools';
import { createVerdictHolder, deliverHeldVerdict, VERDICT_SUMMARY_MAX_CHARS } from './verdict-holder';

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
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const REVIEWER: RoleSlug = slugOf('reviewer');
const WORKER: RoleSlug = slugOf('worker');
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const POINTER = 'src/main.ts:1';

const FLOWS = [
  {
    id: 'verdict-flow',
    name: 'Verdict',
    stages: [
      {
        id: 'review',
        name: 'Review',
        role: 'reviewer',
        exit: [
          { kind: 'agent_verdict', id: 'review-verdict', role: 'reviewer' },
          { kind: 'human', id: 'review-approval', label: 'Review approval' },
        ],
      },
    ],
  },
  {
    id: 'dev-flow',
    name: 'Dev',
    stages: [{ id: 'build', name: 'Build', role: 'worker', exit: [{ kind: 'human', id: 'build-approval', label: 'Build approval' }] }],
  },
];

const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
    { id: 'reviewer', name: 'Reviewer', instructions: 'reviewer instructions', writeScope: { kind: 'none' }, capabilities: [], active: true },
  ],
  flows: FLOWS,
  capabilities: [],
};

const repoBodyOf = (flowId: string): Record<string, unknown> => {
  const flow = FLOWS.find((candidate) => candidate.id === flowId);
  if (flow === undefined) throw new Error(`fixture flow must exist: ${flowId}`);
  return {
    id: 'ws',
    name: 'Repo',
    flow: repoFlowOf(flow),
    defaultLimitPolicy: 'wait_resume',
    commandSets: {},
    docsRoot: 'docs',
    testGlobs: [],
    budget: { amountUsd: 10, warnPercent: 80 },
  };
};

/** One work order whose current stage has a live run of `role`, the state a reviewer is in when it
 *  calls the tool. */
const setup = async (flow: 'verdict-flow' | 'dev-flow', role: RoleSlug) => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const evidence = createFakeEvidenceChecker();
  const definitions = createFakeDefinitionStore();
  const tokens = createFakeRunTokens();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  definitions.seed({ kind: 'repo', repo: REPO }, 'repo.yaml', JSON.stringify(repoBodyOf(flow)));
  const deps = createFakeDeps({
    clock,
    log,
    evidence,
    definitions,
    runTokens: tokens,
    worktrees: createFakeWorktrees(),
  });
  const flowId = slugOf<'flow'>(flow);
  const stage = slugOf<'stage'>(flow === 'verdict-flow' ? 'review' : 'build');
  await deps.workOrders.create({
    id: WORK_ORDER,
    project: slugOf<'project'>('proj'),
    repo: REPO,
    flow: flowId,
    title: 'Fixture',
    createdAt: clock.now(),
    createdBy: USER,
  });
  await deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: clock.now(), by: USER, flow: flowId });
  await deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_started', at: clock.now(), runId: RUN, stage, attempt: 1 });
  await deps.runs.create({
    id: RUN,
    workOrderId: WORK_ORDER,
    stage,
    attempt: 1,
    role,
    route: { accountId: ACCOUNT },
    startedAt: clock.now(),
    autoResumesUsed: 0,
  });
  const verdicts = createVerdictHolder();
  const tools = createDocketTools(deps, { applyAction: createActionApplier(deps), turnLedger: createChatTurnLedger(), verdicts });
  const token = tokens.mint({ kind: 'run', runId: RUN, workOrderId: WORK_ORDER, role });
  return {
    deps,
    log,
    evidence,
    verdicts,
    call: (args: unknown, using?: string): Promise<DocketToolResponse> =>
      tools.call({ token: using ?? token, tool: 'submit_verdict', args }),
    finishRun: async (outcome: 'succeeded' | 'failed'): Promise<void> => {
      await deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_finished', at: clock.now(), runId: RUN, outcome });
    },
    deliver: (as: RoleSlug = role) => deliverHeldVerdict(deps, verdicts, { runId: RUN, workOrderId: WORK_ORDER, role: as }),
  };
};

const codeOf = (response: DocketToolResponse): string => {
  if (response.ok) throw new Error(`expected failure, got ${JSON.stringify(response.result)}`);
  return response.code;
};

const approve = { verdict: 'approve', summary: 'Read the diff; it matches the stage.', pointers: [POINTER] };

const gateEvents = async (h: Awaited<ReturnType<typeof setup>>) =>
  (await h.deps.workOrders.events(WORK_ORDER)).filter((event) => event.type === 'gate_evaluated');

describe('submit_verdict: the tool validates and holds (A-420)', () => {
  it('A-420: an approve with resolving pointers is held, and nothing is recorded while the run is live', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);

    const response = await h.call(approve);

    expect(response.ok).toBe(true);
    expect(h.verdicts.has(RUN)).toBe(true);
    expect(await gateEvents(h)).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-420: a second call from the same run is already_submitted and never overwrites the held verdict', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);
    expect((await h.call(approve)).ok).toBe(true);

    expect(codeOf(await h.call({ verdict: 'reject', summary: 'changed my mind', pointers: [] }))).toBe('already_submitted');
    expect(h.verdicts.take(RUN)).toMatchObject({ approve: true, summary: approve.summary });
  });

  it('A-420: an approve whose pointers are empty or do not resolve is pointers_unresolved, stores nothing, and the run may call again', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);

    expect(codeOf(await h.call({ ...approve, pointers: [] }))).toBe('pointers_unresolved');
    expect(codeOf(await h.call({ ...approve, pointers: ['src/missing.ts:9'] }))).toBe('pointers_unresolved');
    expect(h.verdicts.has(RUN)).toBe(false);
    expect(h.log.entries()).toEqual([]);

    expect((await h.call(approve)).ok).toBe(true);
    expect(h.verdicts.has(RUN)).toBe(true);
  });

  it('A-420: a reject may send no pointers', async () => {
    const h = await setup('verdict-flow', REVIEWER);

    expect((await h.call({ verdict: 'reject', summary: 'The tests are missing.', pointers: [] })).ok).toBe(true);
    expect(h.verdicts.take(RUN)).toMatchObject({ approve: false, pointers: [] });
  });

  it('A-420: a run on a stage without an agent_verdict gate is refused with no_verdict_gate and stores nothing', async () => {
    const h = await setup('dev-flow', WORKER);
    h.evidence.setResolvable([POINTER]);

    expect(codeOf(await h.call(approve))).toBe('no_verdict_gate');
    expect(h.verdicts.has(RUN)).toBe(false);
    expect(await gateEvents(h)).toEqual([]);
  });

  it('A-420: a run whose role is not the gate\'s role is refused with wrong_role', async () => {
    const h = await setup('verdict-flow', WORKER);
    h.evidence.setResolvable([POINTER]);

    expect(codeOf(await h.call(approve))).toBe('wrong_role');
    expect(h.verdicts.has(RUN)).toBe(false);
  });

  it('A-420: a run that already ended is refused with no_verdict_gate', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);
    await h.deps.runs.update(RUN, { endedAt: 2_000, outcome: 'succeeded' });

    expect(codeOf(await h.call(approve))).toBe('no_verdict_gate');
  });

  it('A-420: the arguments are checked — verdict, summary (non-empty, at most 2000 characters) and pointers (strings)', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);

    expect(codeOf(await h.call({ ...approve, verdict: 'maybe' }))).toBe('bad_input');
    expect(codeOf(await h.call({ ...approve, summary: '   ' }))).toBe('bad_input');
    expect(codeOf(await h.call({ ...approve, summary: 'x'.repeat(VERDICT_SUMMARY_MAX_CHARS + 1) }))).toBe('bad_input');
    expect(codeOf(await h.call({ ...approve, pointers: 'src/main.ts:1' }))).toBe('bad_input');
    expect(codeOf(await h.call({ ...approve, pointers: [3] }))).toBe('bad_input');
    expect(codeOf(await h.call({ verdict: 'approve' }))).toBe('bad_input');
    expect(codeOf(await h.call('approve'))).toBe('bad_input');
    expect(h.verdicts.has(RUN)).toBe(false);

    expect((await h.call({ ...approve, summary: 'x'.repeat(VERDICT_SUMMARY_MAX_CHARS) })).ok).toBe(true);
  });

  it('A-420: a secret-shaped summary is forbidden and stores nothing', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);
    const planted = 'gh' + 'p_' + 'a'.repeat(36);

    expect(codeOf(await h.call({ ...approve, summary: `looks fine, token ${planted}` }))).toBe('forbidden');
    expect(h.verdicts.has(RUN)).toBe(false);
  });

  it('A-420: the run is named by the token, never by an argument — an unknown token is unauthorized', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);

    expect(codeOf(await h.call({ ...approve, runId: RUN }, 'nope'))).toBe('unauthorized');
    expect(h.verdicts.has(RUN)).toBe(false);
  });
});

describe('submit_verdict: delivery after the run finished (A-421)', () => {
  it('A-421: a held approve is delivered after run_finished(succeeded): the gate passes, with the decision and the summary audited', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);
    await h.call(approve);
    await h.finishRun('succeeded');

    await h.deliver();

    expect(await gateEvents(h)).toEqual([
      expect.objectContaining({ gate: 'review-verdict', verdict: { status: 'passed' } }),
    ]);
    const actions = h.log.entries().map((entry) => entry.action);
    expect(actions).toEqual(['gate.decided', 'gate.verdict_summary']);
    expect(h.log.entries()[1]).toMatchObject({
      actor: { kind: 'agent', runId: RUN, role: REVIEWER },
      subject: { kind: 'work_order', id: WORK_ORDER },
      detail: { gate: 'review-verdict', verdict: 'approve', summary: approve.summary },
    });
    expect(h.verdicts.has(RUN)).toBe(false);
  });

  it('A-421: a held reject is delivered and fails the gate', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    await h.call({ verdict: 'reject', summary: 'The tests are missing.', pointers: [] });
    await h.finishRun('succeeded');

    await h.deliver();

    expect(await gateEvents(h)).toEqual([
      expect.objectContaining({ gate: 'review-verdict', verdict: expect.objectContaining({ status: 'failed' }) }),
    ]);
    expect(h.log.entries()[1]).toMatchObject({ action: 'gate.verdict_summary', detail: { verdict: 'reject' } });
  });

  it('A-421: nothing held delivers nothing', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    await h.finishRun('succeeded');

    await h.deliver();

    expect(await gateEvents(h)).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-421: a delivery the gate no longer accepts is audited as undelivered and never throws', async () => {
    const h = await setup('verdict-flow', REVIEWER);
    h.evidence.setResolvable([POINTER]);
    await h.call(approve);
    await h.finishRun('succeeded');

    // The submit use case refuses a role that is not the gate's; the run result is untouched.
    await expect(h.deliver(WORKER)).resolves.toBeUndefined();

    expect(await gateEvents(h)).toEqual([]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['gate.verdict_undelivered']);
    expect(h.log.entries()[0]?.detail).toMatchObject({ gate: 'review-verdict', verdict: 'approve' });
    expect(h.verdicts.has(RUN)).toBe(false);
  });
});

describe('submit_verdict: the tool list and the attachment (A-420)', () => {
  it('A-420: the run kind lists submit_verdict with its three required arguments', () => {
    const tool = DOCKET_TOOL_DEFINITIONS_BY_KIND.run.find((candidate) => candidate.name === 'submit_verdict');
    expect(tool?.inputSchema).toMatchObject({ required: ['verdict', 'summary', 'pointers'] });
    expect(DOCKET_TOOL_DEFINITIONS_BY_KIND.chat.map((candidate) => candidate.name)).not.toContain('submit_verdict');
  });

  it('A-420: every provider whose CLI attaches MCP gets the same run-kind server, so the tool reaches all of them', async () => {
    const attached: string[] = [];
    for (const provider of ['provider-a', 'provider-b']) {
      const deps = createFakeDeps({
        runTokens: createFakeRunTokens(),
        capabilities: createFakeCapabilityCatalog([{ id: `kind-${provider}`, authMode: 'subscription', provider, mcp: true }]),
        mcpEndpoint: { socketPath: '/run/mcp.sock', command: 'docket', args: ['mcp.cjs'], env: {} },
      });
      await deps.accounts.save({ id: ACCOUNT, provider, label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
      const capabilities = await attachDocketCapability(deps, {
        binding: { kind: 'run', runId: RUN, workOrderId: WORK_ORDER, role: REVIEWER },
        accountId: ACCOUNT,
        role: { id: REVIEWER, name: 'Reviewer', instructions: '', writeScope: { kind: 'none' }, capabilities: [], active: true },
        capabilities: [],
      });
      const server = capabilities.find((capability) => capability.id === 'docket-pages');
      if (server === undefined || server.kind !== 'mcp') throw new Error('the docket server must be attached');
      attached.push(JSON.stringify(server.env['DOCKET_MCP_KIND']));
    }
    expect(attached).toEqual(['{"literal":"run"}', '{"literal":"run"}']);
  });
});
