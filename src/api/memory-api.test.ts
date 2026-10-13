// memory-api.test.ts — memory and library-definition boundary (#1072, A-348 … A-352).
import { describe, expect, it } from 'vitest';

import type { Actor, CapabilitySlug, FlowSlug, RepoSlug, StageSlug } from '../domain/index';
import { MEMORY_INJECTION_CAP_CHARS, parseSlug } from '../domain/index';

import type { AppDeps } from '../application';
import type { FakeDefinitionStore } from '../application/ports/fakes';
import { createFakeDeps } from '../application/ports/fakes';

import { createApi } from './api';
import type { Command } from './commands';
import { COMMAND_REGISTRY, QUERY_REGISTRY } from './registry';
import type { DefinitionListItem, MemoryOverviewView } from './queries';

const USER: Actor = { kind: 'user', id: 'operator' };

const repoSlug = (value: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(value);
  if (!parsed.ok) throw new Error(`fixture repo: ${value}`);
  return parsed.value;
};
const flowSlug = (value: string): FlowSlug => {
  const parsed = parseSlug<'flow'>(value);
  if (!parsed.ok) throw new Error(`fixture flow: ${value}`);
  return parsed.value;
};
const stageSlug = (value: string): StageSlug => {
  const parsed = parseSlug<'stage'>(value);
  if (!parsed.ok) throw new Error(`fixture stage: ${value}`);
  return parsed.value;
};

const REPO = repoSlug('acme');
const FLOW = flowSlug('standard');
const STAGE = stageSlug('plan');

const seedRepo = async (deps: AppDeps): Promise<void> => {
  await deps.repos.register({
    repoId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: REPO,
    path: '/tmp/acme',
    fingerprint: { rootCommit: 'abc123' },
  });
  (deps.definitions as FakeDefinitionStore).setRepoDef(REPO, {
    id: REPO,
    name: 'Acme',
    flows: [FLOW],
    defaultFlow: FLOW,
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
    flow: {
      flowId: FLOW,
      version: 1,
      stages: [{ id: STAGE, name: 'Plan', role: null, exit: [] }],
      bindings: [],
    },
  });
};

describe('memory and definitions api (#1072)', () => {
  it('A-352: registry rows exist for every new query and command', () => {
    expect(QUERY_REGISTRY['memory.overview'].input).toBe('no input');
    expect(QUERY_REGISTRY['definitions.list'].input).toContain('kind');
    const commands: readonly Command['type'][] = [
      'memory.acceptProposal',
      'memory.rejectProposal',
      'memory.setAutoAccept',
      'memory.addNote',
      'definitions.save',
    ];
    for (const name of commands) {
      expect(COMMAND_REGISTRY[name].input.trim().length).toBeGreaterThan(0);
    }
  });

  it('A-348: memory.overview lists all notes, pending proposals, auto-accept flags and global truncation', async () => {
    const deps = createFakeDeps();
    const api = createApi(deps);

    await api.command(USER, { type: 'memory.addNote', text: 'Inactive note', scope: 'global' });
    await api.command(USER, { type: 'memory.setAutoAccept', scope: 'project', enabled: true });

    const longText = 'x'.repeat(MEMORY_INJECTION_CAP_CHARS + 50);
    await api.command(USER, { type: 'memory.addNote', text: longText, scope: 'global' });

    const overview = (await api.query({ type: 'memory.overview' })) as MemoryOverviewView;
    expect(overview.notes).toHaveLength(2);
    expect(overview.notes.some((n) => !n.active)).toBe(false);
    expect(overview.autoAccept).toEqual({ global: false, project: true, repo: false });
    expect(overview.truncated).toBe(true);
    expect(overview.proposals).toEqual([]);
  });

  it('A-350: memory.acceptProposal on a non-pending proposal answers not_pending', async () => {
    const deps = createFakeDeps();
    const api = createApi(deps);

    await deps.memory.saveProposal({
      id: 'mem-prop-x',
      scope: 'global',
      text: 'A rule',
      sourceRun: 'run-1',
      state: 'pending',
    });
    expect(await api.command(USER, { type: 'memory.acceptProposal', id: 'mem-prop-x' })).toEqual({ ok: true });
    expect(await api.command(USER, { type: 'memory.acceptProposal', id: 'mem-prop-x' })).toEqual({
      ok: false,
      code: 'not_pending',
    });
  });

  it('A-349: definitions.list never returns mcp env secret values', async () => {
    const deps = createFakeDeps();
    const secretRef = 'stg-api-token-value';
    const literal = 'eu-west-1';
    await deps.definitions.installCapabilities([
      {
        kind: 'mcp',
        id: 'db-tools' as CapabilitySlug,
        name: 'Db Tools',
        command: 'npx',
        args: ['db-mcp'],
        env: {
          REGION: { literal },
          API_TOKEN: { secretRef },
        },
      },
    ]);
    await seedRepo(deps);

    const api = createApi(deps);
    const list = (await api.query({ type: 'definitions.list', kind: 'mcp' })) as readonly DefinitionListItem[];
    expect(list).toHaveLength(1);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(secretRef);
    expect(serialized).toContain(literal);
    expect(list[0]?.body).toMatchObject({
      env: {
        REGION: { literal },
        API_TOKEN: { secretRef: true },
      },
    });
  });

  it('A-351: definitions.save returns definition issue codes unchanged on failure', async () => {
    const deps = createFakeDeps();
    await seedRepo(deps);
    const api = createApi(deps);

    const refused = await api.command(USER, {
      type: 'definitions.save',
      kind: 'command',
      definition: {
        kind: 'command',
        id: 'bad-cmd',
        name: 'Bad',
        template: 'Do {{what}}',
        arguments: [],
      },
    });
    expect(refused).toMatchObject({ ok: false, code: 'definitions_invalid' });
    if (!refused.ok && refused.definitionIssues !== undefined) {
      expect(refused.definitionIssues.some((issue) => issue.code === 'unknown_argument')).toBe(true);
    }
    expect(await deps.definitions.listVersions('capabilities', 'bad-cmd')).toEqual([]);
  });

  it('A-351: definitions.save appends a new library version on success', async () => {
    const deps = createFakeDeps();
    await seedRepo(deps);
    const api = createApi(deps);

    const body = {
      kind: 'hook' as const,
      id: 'fmt-hook' as CapabilitySlug,
      name: 'Format',
      event: 'after_write' as const,
      command: 'npm run fmt',
    };
    expect(await api.command(USER, { type: 'definitions.save', kind: 'hook', definition: body })).toEqual({
      ok: true,
      version: 1,
    });
    const history = await deps.definitions.listVersions('capabilities', 'fmt-hook');
    expect(history).toHaveLength(1);
    expect(history[0]?.body).toMatchObject(body);
  });
});
