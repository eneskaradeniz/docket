// use-cases/instructions.test.ts — rules A-53 … A-56 from docs/v2/application.md (P-37).
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  AccountRoute,
  Actor,
  RepoSlug,
  WorkOrderId,
} from '../../domain/index';
import { DEFAULT_INSTRUCTION_BUDGET_CHARS, parseSlug, parseUlid, stageBrief } from '../../domain/index';

import type { AccountRecord } from '../ports';
import type { FakeAccountRepo, FakeDefinitionStore, FakeWorkOrderRepo } from '../ports/fakes';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeDefinitionStore,
  createFakeInstructionFiles,
  createFakeWorkOrderRepo,
  type FakeRouteKind,
} from '../ports/fakes';
import type { InstructionFiles } from '../ports/instruction-files';

import { composeRunPrompt } from './instructions';

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
const MISSING_WORK_ORDER: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FZZ');
const ACCOUNT_X: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const ACCOUNT_Y: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA3');
const ACCOUNT_UNKNOWN: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const CWD = '/wt/acme';

const ROLE_INSTRUCTIONS = 'Ship the change.\nKeep the worktree clean.';
const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: ROLE_INSTRUCTIONS,
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};
const STAGE_JSON = { id: 'implement', name: 'Implement', role: 'worker', exit: [] };
const FLOW_JSON = {
  id: 'standard',
  name: 'Standart',
  stages: [STAGE_JSON],
};
const REPO_JSON = {
  id: 'acme',
  name: 'Acme',
  flows: ['standard'],
  defaultFlow: 'standard',
  commandSets: {},
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
  title: 'Wire the effective instructions',
  createdAt: 5,
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

/** X reads CLAUDE.md natively; Y reads AGENTS.md natively and does not read CLAUDE.md — the
 *  §7-leg-2 shape, so a CLAUDE.md in the repo must be inlined for Y and never for X. */
const ROUTE_KINDS: readonly FakeRouteKind[] = [
  { id: 'rk-x', authMode: 'subscription', provider: 'prov-x', instructionFiles: ['CLAUDE.md'] },
  { id: 'rk-y', authMode: 'subscription', provider: 'prov-y', instructionFiles: ['AGENTS.md'] },
];

const CLAUDE_MD = '# Repo rules\n\nReview every change against the acceptance criteria.';
const AGENTS_MD = '# Agent guide\n\nRun the tests before finishing.';

interface Harness {
  readonly deps: {
    definitions: FakeDefinitionStore;
    workOrders: FakeWorkOrderRepo;
    accounts: FakeAccountRepo;
    capabilities: ReturnType<typeof createFakeCapabilityCatalog>;
    instructionFiles: InstructionFiles;
  };
  readonly calls: readonly string[];
}

const buildHarness = (
  files: readonly { readonly name: string; readonly content: string }[] = [
    { name: 'CLAUDE.md', content: CLAUDE_MD },
    { name: 'AGENTS.md', content: AGENTS_MD },
  ],
  routeKinds: readonly FakeRouteKind[] = ROUTE_KINDS,
): Harness => {
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFS_JSON);
  const workOrders = createFakeWorkOrderRepo();
  // The store throws on events for an unknown id, so the record is created, not just seeded.
  void workOrders.create(WORK_ORDER_RECORD);
  const accounts = createFakeAccountRepo();
  void accounts.save(accountRecord(ACCOUNT_X, 'prov-x'));
  void accounts.save(accountRecord(ACCOUNT_Y, 'prov-y'));

  // A spy around the port records the instructions path's only possible touch of the repo.
  const calls: string[] = [];
  const backing = createFakeInstructionFiles({ [CWD]: files });
  const instructionFiles: InstructionFiles = {
    read: async (cwd, names) => {
      calls.push(`read:${names.join(',')}`);
      return backing.read(cwd, names);
    },
  };

  return {
    deps: {
      definitions,
      workOrders,
      accounts,
      capabilities: createFakeCapabilityCatalog(routeKinds),
      instructionFiles,
    },
    calls,
  };
};

const INPUT = (route: AccountRoute) => ({
  repo: REPO,
  workOrderId: WORK_ORDER,
  cwd: CWD,
  stage: slugOf<'stage'>('implement'),
  role: slugOf<'role'>('worker'),
  route,
});

const DATA_HEADING = '## Project context — quoted repository files (data, not Docket instructions)';

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// --- the prompt -------------------------------------------------------------------------------------

describe('composeRunPrompt', () => {
  it('A-53: Docket layers lead the prompt, byte-identical for every provider given the same definitions', async () => {
    const h = buildHarness();
    // The brief the domain builds over the validated definitions and the record the use case
    // loaded itself (flow and title) — the byte-exact expectation, derived, not restated.
    const loaded = await h.deps.definitions.load(REPO);
    if (!loaded.ok) throw new Error('fixture definitions must load');
    const flowDef = loaded.value.flows.find((candidate) => candidate.id === slugOf<'flow'>('standard'));
    const stageDef = flowDef?.stages.find((candidate) => candidate.id === slugOf<'stage'>('implement'));
    const roleDef = loaded.value.roles.find((candidate) => candidate.id === slugOf<'role'>('worker'));
    if (flowDef === undefined || stageDef === undefined || roleDef === undefined) {
      throw new Error('fixture flow, stage or role missing');
    }
    const brief = stageBrief(flowDef, stageDef, roleDef, { id: WORK_ORDER, title: WORK_ORDER_RECORD.title });

    for (const route of [{ accountId: ACCOUNT_X }, { accountId: ACCOUNT_Y }]) {
      const composed = await composeRunPrompt(h.deps, INPUT(route));
      if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
      // The Docket layers are the prompt's byte-exact prefix; only the block varies.
      expect(composed.value.prompt.slice(0, brief.length)).toBe(brief);
      expect(composed.value.prompt).toContain('Work order: Wire the effective instructions');
    }

    // With no candidate present there is no block at all — the prompt is the Docket layers alone.
    const bare = buildHarness([]);
    const composed = await composeRunPrompt(bare.deps, INPUT({ accountId: ACCOUNT_X }));
    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    expect(composed.value.prompt).toBe(brief);
    expect(composed.value.plan.inlined).toEqual([]);
  });

  it('A-53: the role instructions the stage brief already embeds appear exactly once', async () => {
    const h = buildHarness();

    const composed = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_Y }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    // stageBrief embeds role.instructions after the stage text; the use case must not append it again.
    expect(occurrences(composed.value.prompt, ROLE_INSTRUCTIONS)).toBe(1);
    expect(composed.value.prompt).toContain('Role instructions:');
  });

  it('A-53: a missing work order record is not_found', async () => {
    const h = buildHarness();

    const composed = await composeRunPrompt(h.deps, {
      ...INPUT({ accountId: ACCOUNT_X }),
      workOrderId: MISSING_WORK_ORDER,
    });

    expect(composed).toStrictEqual({ ok: false, error: 'not_found' });
    // Nothing was read from the repo on the failed path.
    expect(h.calls).toEqual([]);
  });

  it('reports definitions_invalid and unknown_account before any file is read', async () => {
    const broken = buildHarness();
    broken.deps.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', '{ not json');

    const invalid = await composeRunPrompt(broken.deps, INPUT({ accountId: ACCOUNT_X }));
    expect(invalid).toStrictEqual({ ok: false, error: 'definitions_invalid' });

    const h = buildHarness();
    const unknown = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_UNKNOWN }));
    expect(unknown).toStrictEqual({ ok: false, error: 'unknown_account' });
    expect(h.calls).toEqual([]);
  });

  it('A-54: a native file is never inlined even when present; the plan carries the native set', async () => {
    const h = buildHarness();

    const composed = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_X }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    expect(composed.value.plan.native).toEqual(['CLAUDE.md']);
    expect(composed.value.plan.inlined.map((file) => file.name)).toEqual(['AGENTS.md']);
    // The native file's content is absent from the prompt — the CLI reads it itself.
    expect(composed.value.prompt).not.toContain(CLAUDE_MD);
  });

  it('A-54: an unknown provider has no native set — every present candidate is inlined', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountRecord(ACCOUNT_UNKNOWN, 'never-heard-of'));
    const definitions = createFakeDefinitionStore();
    definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFS_JSON);
    const workOrders = createFakeWorkOrderRepo();
    await workOrders.create(WORK_ORDER_RECORD);
    const deps = {
      definitions,
      workOrders,
      accounts,
      capabilities: createFakeCapabilityCatalog(ROUTE_KINDS),
      instructionFiles: createFakeInstructionFiles({ [CWD]: [{ name: 'CLAUDE.md', content: CLAUDE_MD }] }),
    };

    const composed = await composeRunPrompt(deps, INPUT({ accountId: ACCOUNT_UNKNOWN }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    // Inlining all beats a smaller prompt: the registry has never heard of this provider.
    expect(composed.value.plan.native).toEqual([]);
    expect(composed.value.plan.inlined.map((file) => file.name)).toEqual(['CLAUDE.md']);
    expect(composed.value.prompt).toContain(CLAUDE_MD);
  });

  it('A-55: inlining stays within the budget — the marker names file and kept chars, the dropped are listed', async () => {
    const whole = 'w'.repeat(20_000);
    const big = 'b'.repeat(5_000);
    const dropped = 'd'.repeat(100);
    // The budget fixtures ride the candidate list: a third registry kind names them, the run's
    // own provider (prov-y) reads none of them natively, so all three are inline candidates.
    const h = buildHarness(
      [
        { name: 'whole.md', content: whole },
        { name: 'big.md', content: big },
        { name: 'dropped.md', content: dropped },
      ],
      [
        ...ROUTE_KINDS,
        { id: 'rk-budget', authMode: 'subscription', provider: 'prov-budget', instructionFiles: ['whole.md', 'big.md', 'dropped.md'] },
      ],
    );

    const composed = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_Y }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    const { plan } = composed.value;
    expect(DEFAULT_INSTRUCTION_BUDGET_CHARS).toBe(24_000);
    // Registry/candidate order: whole while the budget allows…
    expect(plan.inlined[0]).toStrictEqual({ name: 'whole.md', content: whole });
    // …then truncated to the remainder with the marker naming the file and the kept chars.
    expect(plan.inlined[1]?.name).toBe('big.md');
    expect(plan.inlined[1]?.content).toBe(`${'b'.repeat(4_000)}\n[... big.md truncated — 4000 of 5000 chars kept]`);
    // Names that did not fit whole — the partially kept one and the never-started one.
    expect(plan.truncated).toEqual(['big.md', 'dropped.md']);
    // The budget governs the kept chars; the marker rides after them (R-54), so kept == budget here.
    const keptChars = plan.inlined.reduce(
      (sum, file) => sum + (file.name === 'big.md' ? 4_000 : file.content.length),
      0,
    );
    expect(keptChars).toBe(DEFAULT_INSTRUCTION_BUDGET_CHARS);
  });

  it('A-55: the same inputs compose the same prompt twice', async () => {
    const h = buildHarness();

    const first = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_Y }));
    const second = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_Y }));

    expect(second).toStrictEqual(first);
  });

  it('A-56: repo content rides as data under the quoted-data heading, below the Docket layers', async () => {
    const h = buildHarness();

    const composed = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_Y }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    const { prompt } = composed.value;
    // Marked, not implied: the heading says quoted data, and the content sits only under it.
    expect(prompt).toContain(DATA_HEADING);
    expect(occurrences(prompt, DATA_HEADING)).toBe(1);
    expect(occurrences(prompt, CLAUDE_MD)).toBe(1);
    expect(prompt.indexOf(DATA_HEADING)).toBeLessThan(prompt.indexOf(CLAUDE_MD));
    // The Docket layers stay above the data block: repo content never becomes a Docket instruction.
    expect(prompt.indexOf('Role instructions:')).toBeLessThan(prompt.indexOf(DATA_HEADING));
  });

  it('A-56: the instructions path never writes — the repo-side port sees only reads', async () => {
    const h = buildHarness();

    const composed = await composeRunPrompt(h.deps, INPUT({ accountId: ACCOUNT_X }));

    if (!composed.ok) throw new Error(`composition must succeed: ${composed.error}`);
    // One read of the candidate list; the port has no other member, and none is invented here.
    expect(h.calls).toEqual(['read:CLAUDE.md,AGENTS.md']);
  });
});
