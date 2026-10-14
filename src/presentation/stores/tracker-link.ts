// stores/tracker-link.ts — Depo ayarları › İş takibi (U-320 … U-323): reads tracker.linkStatus,
// applies link/mode/unlink outside the flow draft, sync and conflict resolution inline.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor, ModeClampReason, RepoSlug, SyncConflict, SyncMode } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

export const TRACKER_MODES: readonly SyncMode[] = ['docket_only', 'read_only_mirror', 'limited_write', 'two_way'];
export const TRACKER_RECOMMENDED_MODE: SyncMode = 'read_only_mirror';

export type TrackerUiState =
  | 'loading'
  | 'error'
  | 'unlinked'
  | 'connected'
  | 'syncing'
  | 'clamped'
  | 'disconnected';

export interface TrackerLinkView {
  readonly repo: RepoSlug;
  readonly scope: string;
  readonly connection: string;
  readonly configuredMode: SyncMode;
  readonly effectiveMode: SyncMode;
  readonly clamped: boolean;
  readonly clampReason?: ModeClampReason;
  readonly probed?: { readonly read: boolean; readonly comment: boolean; readonly transition: boolean; readonly edit: boolean };
  readonly conflicts: readonly SyncConflict[];
}

export interface TrackerLinkStoreState {
  readonly repo: RepoSlug | null;
  readonly ui: TrackerUiState;
  readonly view: TrackerLinkView | null;
  readonly draftMode: SyncMode;
  readonly formOpen: boolean;
  readonly formScope: string;
  readonly unlinkOpen: boolean;
  readonly busy: boolean;
  readonly inlineKey: LabelKey | null;
}

export interface TrackerLinkStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
}

export interface TrackerLinkStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly state: () => TrackerLinkStoreState;
  readonly load: (repo: RepoSlug) => Promise<void>;
  readonly openConnectForm: () => void;
  readonly openChangeForm: () => void;
  readonly closeForm: () => void;
  readonly setFormScope: (scope: string) => void;
  readonly setDraftMode: (mode: SyncMode) => void;
  readonly resetDraftMode: () => void;
  readonly applyLink: () => Promise<void>;
  readonly applyMode: () => Promise<void>;
  readonly requestUnlink: () => void;
  readonly cancelUnlink: () => void;
  readonly confirmUnlink: () => Promise<void>;
  readonly syncNow: () => Promise<void>;
  readonly resolveConflict: (conflict: SyncConflict, resolution: 'keep_remote' | 'keep_local') => Promise<void>;
}

const modeLabelKey = (mode: SyncMode): LabelKey => `tracker.mode.${mode}.title` as LabelKey;
const clampLabelKey = (reason: ModeClampReason): LabelKey => `tracker.clamp.${reason}` as LabelKey;

export const trackerModeLabelKey = modeLabelKey;
export const trackerClampLabelKey = clampLabelKey;

export const trackerCommandErrorKey = (code: string): LabelKey => {
  if (code === 'connection_unavailable') return 'tracker.error.connection';
  if (code === 'tracker_unreachable') return 'tracker.error.tracker';
  if (code === 'bad_input') return 'tracker.error.badInput';
  return 'error.unknown';
};

const empty: TrackerLinkStoreState = {
  repo: null,
  ui: 'loading',
  view: null,
  draftMode: TRACKER_RECOMMENDED_MODE,
  formOpen: false,
  formScope: '',
  unlinkOpen: false,
  busy: false,
  inlineKey: null,
};

const parseStatus = (reply: unknown): { readonly ui: TrackerUiState; readonly view: TrackerLinkView | null; readonly draftMode: SyncMode } => {
  if (isQueryFailure(reply)) {
    if (reply.code === 'not_found') return { ui: 'unlinked', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
    if (reply.code === 'tracker_unavailable') return { ui: 'disconnected', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
    return { ui: 'error', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
  }
  const body = reply as {
    readonly ok: boolean;
    readonly repo?: RepoSlug;
    readonly link?: { readonly scope: string; readonly connection: string; readonly mode: SyncMode };
    readonly configuredMode?: SyncMode;
    readonly effectiveMode?: SyncMode;
    readonly clamped?: boolean;
    readonly clampReason?: ModeClampReason;
    readonly probed?: TrackerLinkView['probed'];
    readonly conflicts?: readonly SyncConflict[];
    readonly code?: string;
  };
  if (!body.ok) {
    if (body.code === 'not_found') return { ui: 'unlinked', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
    if (body.code === 'tracker_unavailable') return { ui: 'disconnected', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
    return { ui: 'error', view: null, draftMode: TRACKER_RECOMMENDED_MODE };
  }
  const configured = body.configuredMode ?? body.link?.mode ?? TRACKER_RECOMMENDED_MODE;
  const view: TrackerLinkView = {
    repo: body.repo ?? ('' as RepoSlug),
    scope: body.link?.scope ?? '',
    connection: body.link?.connection ?? '',
    configuredMode: configured,
    effectiveMode: body.effectiveMode ?? configured,
    clamped: body.clamped === true,
    ...(body.clampReason === undefined ? {} : { clampReason: body.clampReason }),
    ...(body.probed === undefined ? {} : { probed: body.probed }),
    conflicts: body.conflicts ?? [],
  };
  const ui: TrackerUiState = view.clamped ? 'clamped' : 'connected';
  return { ui, view, draftMode: configured };
};

export const createTrackerLinkStore = (deps: TrackerLinkStoreDeps): TrackerLinkStore => {
  const listeners = new Set<() => void>();
  let state: TrackerLinkStoreState = empty;

  const publish = (next: TrackerLinkStoreState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const runCommand = async (command: Command): Promise<CommandResult> =>
    deps.api.command(deps.actor, command) as Promise<CommandResult>;

  const refresh = async (repo: RepoSlug): Promise<void> => {
    const reply = await deps.api.query({ type: 'tracker.linkStatus', repo } satisfies Query);
    const parsed = parseStatus(reply);
    publish({
      ...state,
      repo,
      ui: parsed.ui,
      view: parsed.view,
      draftMode: parsed.draftMode,
      formScope: parsed.view?.scope ?? state.formScope,
      busy: false,
    });
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => state,

    load: async (repo) => {
      publish({ ...state, repo, ui: 'loading', inlineKey: null, busy: false, formOpen: false, unlinkOpen: false });
      await refresh(repo);
    },

    openConnectForm: () => {
      publish({ ...state, formOpen: true, formScope: state.view?.scope ?? state.formScope, inlineKey: null });
    },

    openChangeForm: () => {
      publish({
        ...state,
        formOpen: true,
        formScope: state.view?.scope ?? '',
        draftMode: state.view?.configuredMode ?? state.draftMode,
        inlineKey: null,
      });
    },

    closeForm: () => publish({ ...state, formOpen: false }),

    setFormScope: (scope) => publish({ ...state, formScope: scope }),

    setDraftMode: (mode) => publish({ ...state, draftMode: mode }),

    resetDraftMode: () => publish({ ...state, draftMode: TRACKER_RECOMMENDED_MODE }),

    applyLink: async () => {
      if (state.repo === null) return;
      publish({ ...state, busy: true, inlineKey: null });
      const result = await runCommand({
        type: 'tracker.link',
        repo: state.repo,
        tracker: 'github',
        scope: state.formScope,
        mode: state.draftMode,
      });
      if (!result.ok) {
        publish({ ...state, busy: false, inlineKey: trackerCommandErrorKey(result.code) });
        return;
      }
      publish({ ...state, formOpen: false, busy: false });
      await refresh(state.repo);
    },

    applyMode: async () => {
      if (state.repo === null || state.view === null) return;
      publish({ ...state, busy: true, inlineKey: null });
      const result = await runCommand({
        type: 'tracker.link',
        repo: state.repo,
        tracker: 'github',
        scope: state.view.scope,
        mode: state.draftMode,
      });
      if (!result.ok) {
        publish({ ...state, busy: false, inlineKey: trackerCommandErrorKey(result.code) });
        return;
      }
      publish({ ...state, busy: false });
      await refresh(state.repo);
    },

    requestUnlink: () => publish({ ...state, unlinkOpen: true }),

    cancelUnlink: () => publish({ ...state, unlinkOpen: false }),

    confirmUnlink: async () => {
      if (state.repo === null) return;
      publish({ ...state, busy: true, unlinkOpen: false, inlineKey: null });
      const result = await runCommand({ type: 'tracker.unlink', repo: state.repo });
      if (!result.ok) {
        publish({ ...state, busy: false, inlineKey: trackerCommandErrorKey(result.code) });
        return;
      }
      await refresh(state.repo);
    },

    syncNow: async () => {
      if (state.repo === null) return;
      publish({ ...state, ui: 'syncing', busy: true, inlineKey: null });
      const result = await runCommand({ type: 'tracker.sync', repo: state.repo });
      if (!result.ok) {
        publish({ ...state, busy: false, inlineKey: trackerCommandErrorKey(result.code) });
        await refresh(state.repo);
        return;
      }
      await refresh(state.repo);
    },

    resolveConflict: async (conflict, resolution) => {
      if (state.repo === null) return;
      publish({ ...state, busy: true, inlineKey: null });
      const result = await runCommand({ type: 'tracker.resolveConflict', repo: state.repo, conflict, resolution });
      if (!result.ok) {
        publish({ ...state, busy: false, inlineKey: commandResultKey('tracker.resolveConflict', result) });
        return;
      }
      await refresh(state.repo);
    },
  };
};
