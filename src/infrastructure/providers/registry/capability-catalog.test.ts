// The CapabilityCatalog port over the registry data (A-43/A-44): the default mapping for accounts
// that name no route kind, and the fixed surface saveAccount validates endpoints against.
import { describe, expect, it } from 'vitest';

import { composeRunPrompt } from '../../../application/use-cases/instructions';
import type { AccountId, AccountRoute, RepoSlug, WorkOrderId } from '../../../domain/index';
import { parseSlug, parseUlid } from '../../../domain/index';
import type { AccountRecord } from '../../../application/ports';
import {
  createFakeAccountRepo,
  createFakeDefinitionStore,
  createFakeInstructionFiles,
  createFakeWorkOrderRepo,
  repoFlowOf,
} from '../../../application/ports/fakes';
import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
import { CAPABILITY_REGISTRY } from './capability-registry';
import { createCapabilityCatalog } from './capability-catalog';
import { findRouteKind } from './capability-registry';

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
const CWD = '/wt/acme';
const CLAUDE_MARKER = 'P37-CLAUDE-INLINE-MARKER-1165';
const CLAUDE_MD = `# Repo rules\n\n${CLAUDE_MARKER}`;

const accountRecord = (id: AccountId, provider: string): AccountRecord => ({
  id,
  provider,
  label: provider,
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const ROUTE = (accountId: AccountId): AccountRoute => ({ accountId });

const FLOW_JSON = {
  id: 'standard',
  name: 'Standart',
  stages: [{ id: 'implement', name: 'Implement', role: 'worker', exit: [] }],
};
const REPO_JSON = {
  id: 'acme',
  name: 'Acme',
  flow: repoFlowOf(FLOW_JSON),
  defaultLimitPolicy: 'wait_resume',
  commandSets: {},
  docsRoot: 'docs',
  testGlobs: [],
};
const DEFS_JSON = JSON.stringify({
  roles: [
    {
      id: 'worker',
      name: 'Worker',
      instructions: 'Ship it.',
      writeScope: { kind: 'repo' },
      capabilities: [],
      active: true,
    },
  ],
  flows: [FLOW_JSON],
  capabilities: [],
  repo: REPO_JSON,
});

const seedPromptDeps = async (provider: string, accountId: AccountId) => {
  const accounts = createFakeAccountRepo();
  await accounts.save(accountRecord(accountId, provider));
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFS_JSON);
  const workOrders = createFakeWorkOrderRepo();
  await workOrders.create({
    id: WORK_ORDER,
    project: slugOf<'project'>('atolye'),
    repo: REPO,
    flow: slugOf<'flow'>('standard'),
    title: 'P-37 registry prompt',
    createdAt: 1,
    createdBy: { kind: 'user', id: 'u1', label: 'Op' },
  });
  return {
    definitions,
    workOrders,
    accounts,
    capabilities: createCapabilityCatalog(),
    instructionFiles: createFakeInstructionFiles({ [CWD]: [{ name: 'CLAUDE.md', content: CLAUDE_MD }] }),
  };
};

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let index = 0;
  while (true) {
    const at = haystack.indexOf(needle, index);
    if (at === -1) return count;
    count += 1;
    index = at + needle.length;
  }
};

describe('createCapabilityCatalog', () => {
  it('A-44: an absent routeKind resolves to the provider defaults for the authMode', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription' })).toBe('anthropic-subscription');
    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'api_key' })).toBe('anthropic-api');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'subscription' })).toBe('codex-subscription');
    expect(catalog.routeKindOf({ provider: 'copilot', authMode: 'subscription' })).toBe('copilot-subscription');
    expect(catalog.routeKindOf({ provider: 'cursor', authMode: 'subscription' })).toBe('cursor-subscription');
    expect(catalog.routeKindOf({ provider: 'opencode', authMode: 'subscription' })).toBe('opencode-subscription');
  });

  it('A-44: an explicit routeKind wins over the default; an unknown provider resolves no kind', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription', routeKind: 'compatible' })).toBe('compatible');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'api_key' })).toBeUndefined();
  });

  it('A-44: every default names a route kind the registry knows', () => {
    const catalog = createCapabilityCatalog();

    for (const authMode of ['subscription', 'api_key'] as const) {
      const id = catalog.routeKindOf({ provider: 'claude-code', authMode });
      expect(id).toBeDefined();
      expect(findRouteKind(id ?? '')).toBeDefined();
    }
  });

  it('P-28: every built-in provider with a subscription route kind resolves exactly that kind as its default, and every resolved default names a registry kind of the same provider', () => {
    // The default mapping must stay in lockstep with the built-in definitions: a new provider
    // whose registry kind carries authMode 'subscription' cannot be added without its default
    // route, or account adoption and operator runs resolve no route for it and fail.
    const catalog = createCapabilityCatalog();

    for (const def of BUILTIN_PROVIDER_DEFS) {
      const own = CAPABILITY_REGISTRY.routeKinds.find(
        (kind) => kind.providerId === def.id && kind.authMode === 'subscription',
      );
      if (own === undefined) continue;
      expect(catalog.routeKindOf({ provider: def.id, authMode: 'subscription' }), def.id).toBe(own.id);
    }

    // And every entry the mapping carries (read back over the built-ins) names a registry route
    // kind belonging to that same provider — never a kind of another provider.
    for (const authMode of ['subscription', 'api_key'] as const) {
      for (const def of BUILTIN_PROVIDER_DEFS) {
        const id = catalog.routeKindOf({ provider: def.id, authMode });
        if (id === undefined) continue;
        expect(findRouteKind(id), `${def.id} ${authMode}`).toMatchObject({ providerId: def.id });
      }
    }
  });

  it('routeKind returns the registry surface; an unknown id resolves to undefined', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKind('anthropic-subscription')).toMatchObject({ id: 'anthropic-subscription', authMode: 'subscription' });
    expect(catalog.routeKind('anthropic-subscription')?.endpointHost).toBeUndefined();
    expect(catalog.routeKind('anthropic-api')).toMatchObject({ id: 'anthropic-api', authMode: 'api_key' });
    expect(catalog.routeKind('no-such-route-kind')).toBeUndefined();
  });

  it('P-37: native instruction sets come from the registry rows; an unknown provider has none', () => {
    const catalog = createCapabilityCatalog();

    // The documented sets, each cited to the CLI's own documentation in the data rows. claude-code
    // names its automatic project memory per P-37 — it lives outside the repo, so it never matches
    // a repo file and is never an inline candidate.
    expect(catalog.nativeInstructionFiles('claude-code')).toEqual(['~/.claude/projects/<project>/memory/']);
    expect(catalog.nativeInstructionFiles('claude-code')).not.toContain('CLAUDE.md');
    // opencode reads AGENTS.md natively and does not read a repo CLAUDE.md — the handoff
    // scenario's Y leg; cursor reads both root files natively.
    expect(catalog.nativeInstructionFiles('opencode')).toEqual(['AGENTS.md']);
    expect(catalog.nativeInstructionFiles('cursor')).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(catalog.nativeInstructionFiles('never-heard-of')).toEqual([]);
  });

  it('P-61: steeringSupport follows the registry per provider; an unknown provider reads unknown', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.steeringSupport('claude-code')).toBe(true);
    expect(catalog.steeringSupport('codex')).toBe(true);
    expect(catalog.steeringSupport('agy')).toBe(false);
    expect(catalog.steeringSupport('copilot')).toBe(false);
    expect(catalog.steeringSupport('cursor')).toBe(false);
    expect(catalog.steeringSupport('opencode')).toBe(false);
    expect(catalog.steeringSupport('never-heard-of')).toBe('unknown');
  });

  it('P-37: instructionFileNames is the deduplicated union of the rows in registry order', () => {
    const names = createCapabilityCatalog().instructionFileNames();

    expect(names[0]).toBe('~/.claude/projects/<project>/memory/');
    expect(names).toContain('CLAUDE.md');
    expect(names).toContain('AGENTS.md');
    expect(new Set(names).size).toBe(names.length);
    for (const expected of ['AGENTS.override.md', 'GEMINI.md', '.github/copilot-instructions.md']) {
      expect(names).toContain(expected);
    }
  });

  it('P-37 (#1165): claude-code inlines repo CLAUDE.md once in the effective prompt', async () => {
    const accountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5CC1');
    const deps = await seedPromptDeps('claude-code', accountId);
    const composed = await composeRunPrompt(deps, {
      repo: REPO,
      workOrderId: WORK_ORDER,
      cwd: CWD,
      stage: slugOf<'stage'>('implement'),
      role: slugOf<'role'>('worker'),
      route: ROUTE(accountId),
    });
    if (!composed.ok) throw new Error(composed.error);
    expect(composed.value.plan.native).toEqual(['~/.claude/projects/<project>/memory/']);
    expect(composed.value.plan.inlined.map((file) => file.name)).toEqual(['CLAUDE.md']);
    expect(countOccurrences(composed.value.prompt, CLAUDE_MARKER)).toBe(1);
  });

  it('P-37 (#1165): copilot still reads CLAUDE.md natively — present file is not inlined', async () => {
    const accountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5CP1');
    const deps = await seedPromptDeps('copilot', accountId);
    const composed = await composeRunPrompt(deps, {
      repo: REPO,
      workOrderId: WORK_ORDER,
      cwd: CWD,
      stage: slugOf<'stage'>('implement'),
      role: slugOf<'role'>('worker'),
      route: ROUTE(accountId),
    });
    if (!composed.ok) throw new Error(composed.error);
    expect(deps.capabilities.nativeInstructionFiles('copilot')).toContain('CLAUDE.md');
    expect(composed.value.plan.inlined.map((file) => file.name)).not.toContain('CLAUDE.md');
    expect(composed.value.prompt).not.toContain(CLAUDE_MARKER);
  });
});
