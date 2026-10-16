// stores/repo-settings.ts — repository flow, role overlays, and per-stage limit policy (U-288, U-289):
// local draft over repo.flow, save through repo.saveFlow, proposals from roleUpdateProposals.
import type { Api } from '../../api/api';
import type { ProjectTree, ProjectTreeItem, Query, SettingsAccountsView } from '../../api/queries';
import type { Actor, LimitPolicy, RepoFlow, RoleDef, RoleOverlay, RelinkKeep, StageSlug, VersionRecord } from '../../domain/index';
import {
  BUILTIN_ROLES,
  effectiveRole,
  limitPolicyFor,
  relinkRole,
  roleUpdateProposals,
  type RoleUpdateProposal,
} from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { RECOMMENDED } from './recommended';
import { commandResultKey, isQueryFailure } from './results';
import { SAVED_FLAG_MS } from './account-editor';

export type RepoLimitPolicyChoice = LimitPolicy;

export const REPO_LIMIT_POLICIES: readonly RepoLimitPolicyChoice[] = [
  'wait_resume',
  'switch_pool',
  'fallback_account',
  'ask',
];

const LIMIT_POLICY_LABEL: Readonly<Record<RepoLimitPolicyChoice, LabelKey>> = {
  wait_resume: 'repoSettings.limit.waitResume',
  switch_pool: 'repoSettings.limit.switchPool',
  fallback_account: 'repoSettings.limit.backupAccount',
  ask: 'repoSettings.limit.ask',
};

export const limitPolicyLabelKey = (policy: RepoLimitPolicyChoice): LabelKey => LIMIT_POLICY_LABEL[policy];

export interface SettingDraftState<T> {
  readonly stored: T;
  readonly draft: T;
  readonly isDirty: boolean;
}

export const flowDraftState = (stored: RepoFlow | null, draft: RepoFlow | null): SettingDraftState<RepoFlow | null> => ({
  stored,
  draft,
  isDirty: stored !== null && draft !== null && !sameFlow(stored, draft),
});

const sameFlow = (left: RepoFlow, right: RepoFlow): boolean => JSON.stringify(left) === JSON.stringify(right);

export const cloneRepoFlow = (flow: RepoFlow): RepoFlow => JSON.parse(JSON.stringify(flow)) as RepoFlow;

export interface RepoTab {
  readonly repo: string;
  readonly name: string;
}

export interface LimitPolicyFieldDiff {
  readonly stage: StageSlug;
  readonly current: LimitPolicy;
  readonly recommended: LimitPolicy;
}

/** Per-stage limit policy differs from the repo default (U-282 data for limit radios). */
export const limitPolicyDiffs = (flow: RepoFlow, defaultPolicy: LimitPolicy): readonly LimitPolicyFieldDiff[] => {
  const diffs: LimitPolicyFieldDiff[] = [];
  for (const binding of flow.bindings) {
    const effective = limitPolicyFor(flow, binding.stage, defaultPolicy);
    if (effective !== defaultPolicy) {
      diffs.push({ stage: binding.stage, current: effective, recommended: defaultPolicy });
    }
  }
  return diffs;
};

export interface OverlayFieldDiff {
  readonly stage: StageSlug;
  readonly field: keyof RoleOverlay;
  readonly current: string;
  readonly recommended: string;
}

export const overlayInstructionDiff = (
  flow: RepoFlow,
  stage: StageSlug,
  library: readonly VersionRecord<RoleDef>[],
): OverlayFieldDiff | null => {
  const binding = flow.bindings.find((row) => row.stage === stage);
  const ref = binding?.role;
  if (ref === undefined) return null;
  const resolved = effectiveRole(ref, library);
  if (!resolved.ok) return null;
  const recommended = resolved.value.instructions;
  const overlayText = ref.overlay?.instructions;
  const current = overlayText ?? recommended;
  if (current === recommended) return null;
  return { stage, field: 'instructions', current, recommended };
};

export interface RepoSettingsStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly now: () => number;
  readonly roleLibrary: () => Promise<readonly VersionRecord<RoleDef>[]>;
}

export interface RepoSettingsState {
  readonly loading: boolean;
  readonly problem: string | null;
  readonly repo: string | null;
  readonly repos: readonly RepoTab[];
  readonly singleRepo: boolean;
  readonly stored: RepoFlow | null;
  readonly draft: RepoFlow | null;
  readonly defaultLimitPolicy: LimitPolicy;
  readonly library: readonly VersionRecord<RoleDef>[];
  readonly activeStage: StageSlug | null;
  readonly detachStage: StageSlug | null;
  /** The stage whose re-link confirm dialog stands open (U-299); null when closed. */
  readonly relinkStage: StageSlug | null;
  /** The stage whose re-link the polite region last announced (U-300); null before the first one. */
  readonly relinkNotice: StageSlug | null;
  readonly confirmDiscard: boolean;
  readonly saving: boolean;
  readonly justSaved: boolean;
  readonly accountLabels: Readonly<Record<string, string>>;
  readonly lastLabelKey: LabelKey | null;
  /** The repo layer's chain standing (U-334/A-407): null until the read answers — the control
   *  stays quiet rather than guessing a level. */
  readonly autonomy: RepoAutonomyRead | null;
}

/** The `repo.autonomy` reply narrowed to what the control renders (plain strings on the wire). */
export interface RepoAutonomyRead {
  readonly level: 'manual' | 'balanced' | 'auto';
  readonly source: string;
  readonly layerSet: boolean;
  readonly autoRefusal?: string;
}

const isRepoAutonomyRead = (value: unknown): value is RepoAutonomyRead => {
  if (typeof value !== 'object' || value === null) return false;
  const read = value as { readonly level?: unknown; readonly source?: unknown; readonly layerSet?: unknown };
  return (
    (read.level === 'manual' || read.level === 'balanced' || read.level === 'auto') &&
    typeof read.source === 'string' &&
    typeof read.layerSet === 'boolean'
  );
};

export interface RepoSettingsStore {
  load(initialRepo?: string): Promise<void>;
  selectRepo(repo: string): Promise<void>;
  selectStage(stage: StageSlug): void;
  /** Sets (or clears, with `null`) the repo layer of the autonomy chain (U-334, A-403) and
   *  re-reads the standing; the refreshed control is the answer, never a toast. */
  setAutonomy(level: 'manual' | 'auto' | null): Promise<void>;
  setOverlayInstructions(stage: StageSlug, instructions: string): void;
  setStageLimitPolicy(stage: StageSlug, policy: LimitPolicy): void;
  resetStageLimitPolicy(stage: StageSlug): void;
  requestDetach(stage: StageSlug): void;
  cancelDetach(): void;
  confirmDetach(): void;
  requestRelink(stage: StageSlug): void;
  cancelRelink(): void;
  confirmRelink(version: number, keep: RelinkKeep): void;
  applyProposal(stage: StageSlug): void;
  clearOverlayField(stage: StageSlug, field: keyof RoleOverlay): void;
  cancelDraft(): void;
  save(): Promise<void>;
  requestLeave(): boolean;
  confirmDiscardLeave(): void;
  cancelDiscardLeave(): void;
  state(): RepoSettingsState;
  subscribe(listener: () => void): () => void;
  proposals(): readonly RoleUpdateProposal[];
  proposalBlocked(stage: StageSlug): readonly (keyof RoleOverlay)[];
}

export const builtinRoleLibrary = (): readonly VersionRecord<RoleDef>[] =>
  BUILTIN_ROLES.map((body) => ({
    definitionId: body.id,
    version: 1,
    body,
    recordedAt: 0,
    archived: false,
  }));

const projectRepos = (tree: ProjectTree, projectId: string | null): readonly RepoTab[] => {
  if (projectId === null) return [];
  const item = tree.find((row) => row.project === projectId);
  if (item === undefined) return [];
  return item.repos.map((node) => ({ repo: node.repo, name: node.repo }));
};

const firstRepoOfTree = (tree: ProjectTree): string | null => {
  for (const item of tree) {
    if (item.repos.length > 0) return item.repos[0]?.repo ?? null;
  }
  return null;
};

const projectForRepo = (tree: ProjectTree, repo: string): ProjectTreeItem | null =>
  tree.find((item) => item.repos.some((node) => node.repo === repo)) ?? null;

const accountLabelMap = (view: SettingsAccountsView): Readonly<Record<string, string>> => {
  const map: Record<string, string> = {};
  for (const account of view.accounts) map[account.id] = account.label;
  return map;
};

const updateBinding = (
  flow: RepoFlow,
  stage: StageSlug,
  patch: (binding: RepoFlow['bindings'][number]) => RepoFlow['bindings'][number],
): RepoFlow => ({
  ...flow,
  bindings: flow.bindings.map((binding) => (binding.stage === stage ? patch(binding) : binding)),
});

export const createRepoSettingsStore = (deps: RepoSettingsStoreDeps): RepoSettingsStore => {
  const listeners = new Set<() => void>();
  let state: RepoSettingsState = {
    loading: false,
    problem: null,
    repo: null,
    repos: [],
    singleRepo: true,
    stored: null,
    draft: null,
    defaultLimitPolicy: RECOMMENDED.limitPolicy,
    library: [],
    activeStage: null,
    detachStage: null,
    relinkStage: null,
    relinkNotice: null,
    confirmDiscard: false,
    saving: false,
    justSaved: false,
    accountLabels: {},
    lastLabelKey: null,
    autonomy: null,
  };

  const publish = (next: RepoSettingsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** The repo layer's chain standing (U-334): read beside the flow; a failed read keeps the
   *  control quiet — an unreadable chain is its own typed read's surface. Only the newest
   *  requested repo may land its read: a slow answer from a tab just left never speaks. */
  let autonomyRepo: string | null = null;
  const loadAutonomy = async (repo: string): Promise<void> => {
    autonomyRepo = repo;
    const reply: unknown = await deps.api.query({ type: 'repo.autonomy', repo } satisfies Query);
    if (autonomyRepo !== repo) return;
    publish({ ...state, autonomy: isQueryFailure(reply) ? null : isRepoAutonomyRead(reply) ? reply : null });
  };

  const loadFlow = async (repo: string): Promise<void> => {
    publish({ ...state, loading: true, problem: null, justSaved: false });
    const [flowReply, accountsReply, library] = await Promise.all([
      deps.api.query({ type: 'repo.flow', repo } satisfies Query),
      deps.api.query({ type: 'settings.accounts', catalog: 'skip' } satisfies Query),
      deps.roleLibrary(),
    ]);
    void loadAutonomy(repo);
    if (isQueryFailure(flowReply)) {
      publish({ ...state, loading: false, problem: flowReply.code, stored: null, draft: null });
      return;
    }
    const flowView = flowReply as { readonly ok: boolean; readonly flow?: RepoFlow; readonly code?: string };
    if (!flowView.ok || flowView.flow === undefined) {
      publish({ ...state, loading: false, problem: flowView.code ?? 'not_found', stored: null, draft: null });
      return;
    }
    const accounts = isQueryFailure(accountsReply) ? { accounts: [], bindings: [] } : (accountsReply as SettingsAccountsView);
    const flow = flowView.flow;
    const activeStage = flow.stages[0]?.id ?? null;
    publish({
      ...state,
      loading: false,
      problem: null,
      repo,
      stored: flow,
      draft: cloneRepoFlow(flow),
      library,
      activeStage,
      defaultLimitPolicy: RECOMMENDED.limitPolicy,
      accountLabels: accountLabelMap(accounts),
      detachStage: null,
      relinkStage: null,
      relinkNotice: null,
    });
  };

  const load = async (initialRepo?: string): Promise<void> => {
    publish({ ...state, loading: true, problem: null });
    const treeReply: unknown = await deps.api.query({ type: 'project.tree' } satisfies Query);
    if (isQueryFailure(treeReply)) {
      publish({ ...state, loading: false, problem: treeReply.code });
      return;
    }
    const tree = treeReply as ProjectTree;
    const repo = initialRepo ?? state.repo ?? firstRepoOfTree(tree);
    if (repo === null) {
      publish({ ...state, loading: false, problem: 'no_repo', repos: [], singleRepo: true, stored: null, draft: null });
      return;
    }
    const owner = projectForRepo(tree, repo);
    const repos = owner === null ? [{ repo, name: repo }] : projectRepos(tree, owner.project);
    const singleRepo = repos.length <= 1;
    publish({ ...state, repos, singleRepo });
    await loadFlow(repo);
  };

  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    load,
    selectRepo: async (repo) => {
      if (state.repo === repo) return;
      await loadFlow(repo);
    },
    selectStage: (stage) => {
      publish({ ...state, activeStage: stage });
    },
    setOverlayInstructions: (stage, instructions) => {
      if (state.draft === null) return;
      const next = updateBinding(state.draft, stage, (binding) => {
        const ref = binding.role;
        if (ref === undefined) return binding;
        const overlay = { ...(ref.overlay ?? {}), instructions };
        return { ...binding, role: { ...ref, overlay } };
      });
      publish({ ...state, draft: next, justSaved: false });
    },
    setStageLimitPolicy: (stage, policy) => {
      if (state.draft === null) return;
      const next = updateBinding(state.draft, stage, (binding) => ({ ...binding, limitPolicy: policy }));
      publish({ ...state, draft: next, justSaved: false });
    },
    resetStageLimitPolicy: (stage) => {
      if (state.draft === null) return;
      const next = updateBinding(state.draft, stage, (binding) => {
        const { limitPolicy: _drop, ...rest } = binding;
        return rest;
      });
      publish({ ...state, draft: next, justSaved: false });
    },
    requestDetach: (stage) => {
      publish({ ...state, detachStage: stage });
    },
    cancelDetach: () => {
      publish({ ...state, detachStage: null });
    },
    confirmDetach: () => {
      const stage = state.detachStage;
      if (stage === null || state.draft === null) return;
      const next = updateBinding(state.draft, stage, (binding) => {
        const ref = binding.role;
        if (ref === undefined) return binding;
        const resolved = effectiveRole(ref, state.library);
        if (!resolved.ok) return binding;
        return {
          ...binding,
          role: { ...ref, detached: resolved.value, overlay: undefined },
        };
      });
      publish({ ...state, draft: next, detachStage: null, justSaved: false });
    },
    requestRelink: (stage) => {
      publish({ ...state, relinkStage: stage, relinkNotice: null });
    },
    cancelRelink: () => {
      publish({ ...state, relinkStage: null });
    },
    confirmRelink: (version, keep) => {
      const stage = state.relinkStage;
      if (stage === null || state.draft === null) return;
      const ref = state.draft.bindings.find((row) => row.stage === stage)?.role;
      if (ref === undefined) {
        publish({ ...state, relinkStage: null });
        return;
      }
      const relinked = relinkRole(ref, state.library, version, keep);
      if (!relinked.ok) {
        publish({ ...state, relinkStage: null });
        return;
      }
      const next = updateBinding(state.draft, stage, (binding) => ({ ...binding, role: relinked.value }));
      publish({ ...state, draft: next, relinkStage: null, relinkNotice: stage, justSaved: false });
    },
    applyProposal: (stage) => {
      if (state.draft === null) return;
      const proposal = roleUpdateProposals(state.draft, state.library).find((row) => row.stage === stage);
      if (proposal === undefined) return;
      if (proposalBlocked(state.draft, state.library, stage).length > 0) return;
      const next = updateBinding(state.draft, stage, (binding) => {
        const ref = binding.role;
        if (ref === undefined) return binding;
        let overlay = ref.overlay;
        if (overlay !== undefined) {
          const cleaned = { ...overlay };
          for (const field of proposal.overlayFieldsChangedUpstream) {
            if (cleaned[field] !== undefined) delete cleaned[field];
          }
          overlay = Object.keys(cleaned).length === 0 ? undefined : cleaned;
        }
        return { ...binding, role: { ...ref, version: proposal.to, overlay } };
      });
      publish({ ...state, draft: next, justSaved: false });
    },
    clearOverlayField: (stage, field) => {
      if (state.draft === null) return;
      const next = updateBinding(state.draft, stage, (binding) => {
        const ref = binding.role;
        if (ref === undefined || ref.overlay === undefined) return binding;
        const overlay = { ...ref.overlay };
        delete overlay[field];
        const cleaned = Object.keys(overlay).length === 0 ? undefined : overlay;
        return { ...binding, role: { ...ref, overlay: cleaned } };
      });
      publish({ ...state, draft: next, justSaved: false });
    },
    cancelDraft: () => {
      if (state.stored === null) return;
      publish({ ...state, draft: cloneRepoFlow(state.stored), justSaved: false, confirmDiscard: false, relinkNotice: null });
    },
    save: async () => {
      if (state.repo === null || state.draft === null || state.stored === null) return;
      if (sameFlow(state.stored, state.draft)) return;
      publish({ ...state, saving: true, lastLabelKey: null });
      const result = await deps.api.command(deps.actor, { type: 'repo.saveFlow', repo: state.repo, flow: state.draft });
      const labelKey = commandResultKey('repo.saveFlow', result);
      if (result.ok) {
        publish({
          ...state,
          saving: false,
          stored: cloneRepoFlow(state.draft),
          justSaved: true,
          lastLabelKey: labelKey,
        });
        if (savedTimer !== null) clearTimeout(savedTimer);
        savedTimer = setTimeout(() => publish({ ...state, justSaved: false }), SAVED_FLAG_MS);
      } else {
        publish({ ...state, saving: false, problem: result.code, lastLabelKey: labelKey });
      }
    },
    setAutonomy: async (level) => {
      if (state.repo === null) return;
      // Never a toast and never the section's problem line: a refusal changed nothing, and the
      // re-read's reason line words the standing (U-334).
      const result = await deps.api.command(deps.actor, { type: 'repo.setAutonomy', repo: state.repo, level });
      if (!result.ok) return;
      await loadAutonomy(state.repo);
    },
    requestLeave: () => {
      const dirty = flowDraftState(state.stored, state.draft).isDirty;
      if (!dirty) return true;
      publish({ ...state, confirmDiscard: true });
      return false;
    },
    confirmDiscardLeave: () => {
      if (state.stored === null) {
        publish({ ...state, confirmDiscard: false });
        return;
      }
      publish({ ...state, draft: cloneRepoFlow(state.stored), confirmDiscard: false, justSaved: false });
    },
    cancelDiscardLeave: () => {
      publish({ ...state, confirmDiscard: false });
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    proposals: () => (state.draft === null ? [] : roleUpdateProposals(state.draft, state.library)),
    proposalBlocked: (stage) => proposalBlocked(state.draft, state.library, stage),
  };
};

const proposalBlocked = (
  draft: RepoFlow | null,
  library: readonly VersionRecord<RoleDef>[],
  stage: StageSlug,
): readonly (keyof RoleOverlay)[] => {
  if (draft === null) return [];
  const proposal = roleUpdateProposals(draft, library).find((row) => row.stage === stage);
  if (proposal === undefined) return [];
  const binding = draft.bindings.find((row) => row.stage === stage);
  const overlay = binding?.role?.overlay;
  if (overlay === undefined) return [];
  return proposal.overlayFieldsChangedUpstream.filter((field) => overlay[field] !== undefined);
};
