import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { ProjectTree, Query } from '../../api/queries';
import type { Actor, RepoFlow, RoleDef, StageSlug, VersionRecord } from '../../domain/index';
import { parseSlug } from '../../domain/index';
import { FlowStageStrip } from '../components/flow-stage-strip';
import { LimitPolicySection } from '../components/limit-policy-section';
import { OverlayEditor } from '../components/overlay-editor';
import { effectiveRole, roleUpdateProposals } from '../../domain/index';
import {
  createRepoSettingsStore,
  flowDraftState,
  limitPolicyDiffs,
  type RepoSettingsStore,
} from './repo-settings';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const stage = (id: string): StageSlug => {
  const parsed = parseSlug<'stage'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};
const role = (id: string) => {
  const parsed = parseSlug<'role'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};

const WORKER: RoleDef = {
  id: role('worker'),
  name: 'Worker',
  instructions: 'Base instructions.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const libraryV1: readonly VersionRecord<RoleDef>[] = [
  { definitionId: WORKER.id, version: 1, body: WORKER, recordedAt: 0, archived: false },
  {
    definitionId: WORKER.id,
    version: 2,
    body: { ...WORKER, instructions: 'Upstream v2.' },
    recordedAt: 1,
    archived: false,
  },
];

const flowSlug = (): RepoFlow['flowId'] => {
  const parsed = parseSlug<'flow'>('standard');
  if (!parsed.ok) throw new Error('flow slug');
  return parsed.value;
};

const sampleFlow = (): RepoFlow => ({
  flowId: flowSlug(),
  version: 1,
  stages: [{ id: stage('implement'), name: 'Implement', role: WORKER.id, exit: [] }],
  bindings: [
    {
      stage: stage('implement'),
      role: { roleId: WORKER.id, version: 1, overlay: { instructions: 'Local tweak.' } },
      accounts: [{ accountId: '01ARZ3NDEKTSV4RRFFQ69G5FB3' as RepoFlow['bindings'][0]['accounts'][0]['accountId'] }],
    },
  ],
});

interface FakeApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: { readonly actor: Actor; readonly command: Command }[];
  setFlow(flow: RepoFlow): void;
  setTree(tree: ProjectTree): void;
  setAutonomyRead(read: unknown): void;
  setAutonomyResult(result: CommandResult): void;
}

const fakeApi = (flow: RepoFlow, tree: ProjectTree): FakeApi => {
  const queries: Query[] = [];
  const commands: { actor: Actor; command: Command }[] = [];
  let currentFlow = flow;
  let currentTree = tree;
  let autonomyRead: unknown = null;
  let autonomyResult: CommandResult = { ok: true };
  return {
    queries,
    commands,
    setFlow: (next) => {
      currentFlow = next;
    },
    setTree: (next) => {
      currentTree = next;
    },
    setAutonomyRead: (next) => {
      autonomyRead = next;
    },
    setAutonomyResult: (next) => {
      autonomyResult = next;
    },
    query: async (query) => {
      queries.push(query);
      if (query.type === 'project.tree') return currentTree;
      if (query.type === 'repo.flow') return { ok: true, flow: currentFlow };
      if (query.type === 'settings.accounts') return { accounts: [], bindings: [] };
      if (query.type === 'repo.autonomy') return autonomyRead;
      return { ok: false, code: 'not_found' };
    },
    command: async (actor, command) => {
      commands.push({ actor, command });
      if (command.type === 'repo.saveFlow') {
        currentFlow = command.flow as RepoFlow;
        return { ok: true };
      }
      if (command.type === 'repo.setAutonomy') {
        if (autonomyResult.ok) {
          autonomyRead =
            command.level === null
              ? { level: 'manual', source: 'builtin', layerSet: false }
              : { level: command.level, source: 'repo', layerSet: true };
        }
        return autonomyResult;
      }
      return { ok: false, code: 'not_found' };
    },
  };
};

const singleRepoTree: ProjectTree = [
  {
    project: 'p1',
    name: 'Proj',
    mainRepo: 'web',
    repos: [{ repo: 'web', name: 'web', main: true, active: 0, running: 0, waiting: 0, status: 'idle' }],
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
  },
];

const multiRepoTree: ProjectTree = [
  {
    project: 'p1',
    name: 'Proj',
    mainRepo: 'api',
    repos: [
      { repo: 'api', name: 'api', main: true, active: 0, running: 0, waiting: 0, status: 'idle' },
      { repo: 'mobile', name: 'mobile', main: false, active: 0, running: 0, waiting: 0, status: 'idle' },
    ],
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
  },
];

const storeWith = (flow: RepoFlow, tree: ProjectTree, library = libraryV1): { store: RepoSettingsStore; api: FakeApi } => {
  const api = fakeApi(flow, tree);
  const store = createRepoSettingsStore({
    api,
    actor: ACTOR,
    now: () => 0,
    roleLibrary: async () => library,
  });
  return { store, api };
};

describe('U-288: repo settings flow and roles', () => {
  it('U-288: repo settings renders Akış stage strip with role and assistant chain per stage', async () => {
    const { store } = storeWith(sampleFlow(), singleRepoTree);
    await store.load('web');
    const html = renderToStaticMarkup(
      createElement(FlowStageStrip, {
        locale: 'tr',
        flow: store.state().draft,
        activeStage: store.state().activeStage,
        accountLabels: { '01ARZ3NDEKTSV4RRFFQ69G5FB3': 'Main' },
        library: store.state().library,
        onSelect: () => {},
      }),
    );
    expect(html).toContain('Implement');
    expect(html).toContain('Main');
    expect(html).toContain('role="list"');
  });

  it('U-288: repo settings renders Roller section with version badges, overlay editor, and Detach action', async () => {
    const { store } = storeWith(sampleFlow(), singleRepoTree);
    await store.load('web');
    const html = renderToStaticMarkup(
      createElement(OverlayEditor, {
        locale: 'tr',
        flow: store.state().draft,
        stage: stage('implement'),
        library: store.state().library,
        proposals: store.proposals(),
        proposalBlocked: store.proposalBlocked(stage('implement')),
        onInstructions: () => {},
        onDetach: () => {},
        onApplyProposal: () => {},
        onClearOverlayField: () => {},
        relinkStage: null,
        relinkNotice: null,
        onRequestRelink: () => {},
        onCancelRelink: () => {},
        onConfirmRelink: () => {},
      }),
    );
    expect(html).toContain('v1');
    expect(html).toContain('>Ayır<');
    expect(html).toContain('textarea');
  });

  it('U-288: roleUpdateProposals render Yeni sürüm var rows', async () => {
    const flow = sampleFlow();
    const { store } = storeWith(flow, singleRepoTree);
    await store.load('web');
    const outdated: RepoFlow = {
      ...flow,
      bindings: flow.bindings.map((binding) =>
        binding.role === undefined ? binding : { ...binding, role: { ...binding.role, version: 1 } },
      ),
    };
    const html = renderToStaticMarkup(
      createElement(OverlayEditor, {
        locale: 'tr',
        flow: outdated,
        stage: stage('implement'),
        library: libraryV1,
        proposals: roleUpdateProposals(outdated, libraryV1),
        proposalBlocked: [],
        onInstructions: () => {},
        onDetach: () => {},
        onApplyProposal: () => {},
        onClearOverlayField: () => {},
        relinkStage: null,
        relinkNotice: null,
        onRequestRelink: () => {},
        onCancelRelink: () => {},
        onConfirmRelink: () => {},
      }),
    );
    expect(html).toContain('Yeni sürüm var');
  });

  it('U-288: single-repo project omits project/repo navigation split', async () => {
    const { store } = storeWith(sampleFlow(), singleRepoTree);
    await store.load('web');
    expect(store.state().singleRepo).toBe(true);
    expect(store.state().repos).toHaveLength(1);
    const multi = storeWith(sampleFlow(), multiRepoTree);
    await multi.store.load('api');
    expect(multi.store.state().singleRepo).toBe(false);
    expect(multi.store.state().repos).toHaveLength(2);
  });
});

describe('U-289: repo limit policy and save controls', () => {
  it('U-289: Limit politikası provides per-stage policy choices (wait_resume, switch_pool, backup_account, ask)', () => {
    const flow = sampleFlow();
    const html = renderToStaticMarkup(
      createElement(LimitPolicySection, {
        locale: 'tr',
        flow,
        stage: stage('implement'),
        defaultPolicy: 'wait_resume',
        onSelect: () => {},
        onReset: () => {},
      }),
    );
    expect(html).toContain('Bekle ve devam');
    expect(html).toContain('Başka havuz');
    expect(html).toContain('Yedek hesap');
    expect(html).toContain('Bildir');
  });

  it('U-289: save bar appears only when dirty, Kaydet disabled when draft equals stored', async () => {
    const { store } = storeWith(sampleFlow(), singleRepoTree);
    await store.load('web');
    expect(flowDraftState(store.state().stored, store.state().draft).isDirty).toBe(false);
    store.setOverlayInstructions(stage('implement'), 'Changed');
    expect(flowDraftState(store.state().stored, store.state().draft).isDirty).toBe(true);
    store.cancelDraft();
    expect(flowDraftState(store.state().stored, store.state().draft).isDirty).toBe(false);
  });

  it('U-289: differs-from-recommended dot and single reset icon button reset draft', () => {
    const flow = {
      ...sampleFlow(),
      bindings: sampleFlow().bindings.map((binding) => ({ ...binding, limitPolicy: 'switch_pool' as const })),
    };
    expect(limitPolicyDiffs(flow, 'wait_resume')).toHaveLength(1);
    const html = renderToStaticMarkup(
      createElement(LimitPolicySection, {
        locale: 'tr',
        flow,
        stage: stage('implement'),
        defaultPolicy: 'wait_resume',
        onSelect: () => {},
        onReset: () => {},
      }),
    );
    expect(html).toContain('rounded-full bg-signal');
    expect(html).toContain('aria-label="Önerilen değere döndür"');
  });
});

describe('re-link a detached role to the library (U-298 … U-300)', () => {
  /** The sample flow after Ayır: the binding owns its copy with a local instructions edit. */
  const detachedSample = (): RepoFlow => {
    const flow = sampleFlow();
    const binding = flow.bindings[0];
    if (binding === undefined || binding.role === undefined) throw new Error('sample binding');
    const detached: RoleDef = { ...WORKER, instructions: 'Local tweak.' };
    return {
      ...flow,
      bindings: [{ ...binding, role: { ...binding.role, version: 1, detached } }],
    };
  };

  it('U-300: requestRelink opens, cancelRelink closes, confirmRelink rewires the draft only', async () => {
    const { store, api } = storeWith(detachedSample(), singleRepoTree);
    await store.load('web');
    const before = store.state().draft?.bindings[0]?.role?.detached;
    expect(before?.instructions).toBe('Local tweak.');

    store.requestRelink(stage('implement'));
    expect(store.state().relinkStage).toBe(stage('implement'));
    store.cancelRelink();
    expect(store.state().relinkStage).toBeNull();
    expect(store.state().draft?.bindings[0]?.role?.detached).toBeDefined();

    store.requestRelink(stage('implement'));
    store.confirmRelink(1, 'overlay');
    expect(store.state().relinkStage).toBeNull();
    const ref = store.state().draft?.bindings[0]?.role;
    expect(ref?.detached).toBeUndefined();
    expect(ref?.version).toBe(1);
    expect(ref?.overlay).toEqual({ instructions: 'Local tweak.' });
    // Lossless: the effective role of the draft binding equals the previous detached body.
    if (ref === undefined) throw new Error('relinked ref');
    expect(effectiveRole(ref, libraryV1)).toEqual({ ok: true, value: before });
    // Nothing is saved before Kaydet: the stored flow is untouched and no command left.
    expect(store.state().stored?.bindings[0]?.role?.detached).toBeDefined();
    expect(api.commands).toHaveLength(0);
    expect(flowDraftState(store.state().stored, store.state().draft).isDirty).toBe(true);
  });

  it('U-300: the library keep drops the overlay and the notice names the stage', async () => {
    const { store } = storeWith(detachedSample(), singleRepoTree);
    await store.load('web');
    store.requestRelink(stage('implement'));
    store.confirmRelink(2, 'library');
    const ref = store.state().draft?.bindings[0]?.role;
    expect(ref?.detached).toBeUndefined();
    expect(ref?.version).toBe(2);
    expect(ref?.overlay).toBeUndefined();
    expect(store.state().relinkNotice).toBe(stage('implement'));
  });
});

describe('U-334: the repo layer of the autonomy chain', () => {
  it('U-334: load reads repo.autonomy beside the flow, and setAutonomy speaks repo.setAutonomy and refreshes the standing', async () => {
    const { store, api } = storeWith(sampleFlow(), singleRepoTree);
    api.setAutonomyRead({ level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' });
    await store.load('web');
    expect(api.queries.some((query) => query.type === 'repo.autonomy' && query.repo === 'web')).toBe(true);
    expect(store.state().autonomy).toEqual({
      level: 'manual',
      source: 'builtin',
      layerSet: false,
      autoUnavailable: 'auto_requires_spend_cap',
    });

    await store.setAutonomy('manual');

    const issued = api.commands[api.commands.length - 1];
    expect(issued.command).toEqual({ type: 'repo.setAutonomy', repo: 'web', level: 'manual' });
    // The refreshed read is the answer: the layer now stands set at the repo.
    expect(store.state().autonomy).toEqual({ level: 'manual', source: 'repo', layerSet: true });
  });

  it('U-334: clearing speaks the null level and the chain falls on to the builtin', async () => {
    const { store, api } = storeWith(sampleFlow(), singleRepoTree);
    api.setAutonomyRead({ level: 'manual', source: 'repo', layerSet: true });
    await store.load('web');
    await store.setAutonomy(null);
    expect(api.commands[api.commands.length - 1]?.command).toEqual({ type: 'repo.setAutonomy', repo: 'web', level: null });
    expect(store.state().autonomy).toEqual({ level: 'manual', source: 'builtin', layerSet: false });
  });

  it('U-334: a refused write keeps the standing exactly as it read — no refresh, no problem line', async () => {
    const { store, api } = storeWith(sampleFlow(), singleRepoTree);
    const standing = { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' };
    api.setAutonomyRead(standing);
    api.setAutonomyResult({ ok: false, code: 'auto_requires_spend_cap' });
    await store.load('web');

    await store.setAutonomy('auto');

    expect(api.commands[api.commands.length - 1]?.command).toEqual({ type: 'repo.setAutonomy', repo: 'web', level: 'auto' });
    expect(store.state().autonomy).toEqual(standing);
    expect(store.state().problem).toBeNull();
    expect(store.state().lastLabelKey).toBeNull();
  });

  it('U-334: an unreadable chain keeps the control quiet — the read failure is not a section problem', async () => {
    const { store, api } = storeWith(sampleFlow(), singleRepoTree);
    api.setAutonomyRead({ ok: false, code: 'definitions_invalid' });
    await store.load('web');
    expect(store.state().autonomy).toBeNull();
    expect(store.state().problem).toBeNull();
  });
});
