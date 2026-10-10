// stores/roadmap.ts — the roadmap page store (U-17): it mirrors the `roadmap.byProject` view,
// opens the first phase on entry with the rest closed, and keeps both kinds of disclosure —
// phase collapse and cross-repo task expansion — for the session. A failed query shows the
// problem state, never an empty page. Work-order changes re-query the bound project; run events
// do not touch the page. The run controls (U-63 … U-68) live here too: which chip and button a
// phase shows, the one open panel (confirmation or attention), and the three phase commands with
// the notices their outcomes become; the page refetches after every command.
import type { Api } from '../../api/api';
import type { Query, RoadmapPageView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { failureKey, isQueryFailure } from './results';
import type { ToastType } from './toasts';

/** Same coarse events the board listens to (docs/v2/ui.md, U-12); the api's `subscribe`
 *  satisfies it as-is. */
export type RoadmapChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type RoadmapChangeSignal = (listener: (change: RoadmapChange) => void) => () => void;

/** The operator's actor, as the app's root issues every command. */
const OPERATOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

export interface RoadmapStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: RoadmapChangeSignal;
  /** Every phase command travels as this actor; the operator when omitted. */
  readonly actor?: Actor;
}

export type RoadmapPhase = RoadmapPageView['phases'][number];

/** The page's one open panel: a phase's start confirmation or its attention list (U-64). */
export interface RoadmapPanel {
  readonly kind: 'confirm' | 'attention';
  readonly phase: string;
}

/** What a phase command's outcome tells the operator: a toast voice, label keys and the values
 *  their `{…}` placeholders take. `copy` carries a refusal's raw code (U-50a), never the text. */
export interface RoadmapNotice {
  readonly type: ToastType;
  readonly key: LabelKey;
  readonly vars?: Readonly<Record<string, string>>;
  readonly subKey?: LabelKey;
  readonly subVars?: Readonly<Record<string, string>>;
  readonly copy?: string;
}

/** What a phase card's header shows (U-63): at most one status chip, at most one button, an
 *  optional hint, and the attention count. */
export interface PhaseControl {
  readonly chip: 'done' | 'running' | 'paused' | null;
  readonly button: 'run' | 'run-disabled' | 'pause' | 'resume' | null;
  readonly hint: 'blocked' | 'paused' | null;
  /** The names of the phases that block this one (U-68), in the roadmap's order. */
  readonly blockedBy: readonly string[];
  readonly attention: number;
}

/** The runnable tasks of a phase: the view's `runnable` ids that belong to it. */
export const runnableTasks = (view: RoadmapPageView, phase: RoadmapPhase): RoadmapPhase['tasks'] =>
  phase.tasks.filter((task) => view.runnable.includes(task.id));

/** The confirmation's counts (U-64): N tasks, and M work orders — the sum of their targets. */
export const phaseRunCounts = (view: RoadmapPageView, phase: RoadmapPhase): { readonly tasks: number; readonly orders: number } => {
  const tasks = runnableTasks(view, phase);
  return { tasks: tasks.length, orders: tasks.reduce((sum, task) => sum + task.targets.length, 0) };
};

/** The state mapping (U-63): the view's phase status plus its optional autoRun record decide the
 *  chip, the button and the hint. Done wins over everything; a paused or running record wins
 *  over the status underneath; the attention count rides along in every case. */
export const phaseControl = (view: RoadmapPageView, phase: RoadmapPhase): PhaseControl => {
  const attention = phase.autoRun?.attention.length ?? 0;
  const none: readonly string[] = [];
  if (phase.status === 'done') return { chip: 'done', button: null, hint: null, blockedBy: none, attention };
  if (phase.autoRun?.state === 'paused') return { chip: 'paused', button: 'resume', hint: 'paused', blockedBy: none, attention };
  if (phase.autoRun?.state === 'running') return { chip: 'running', button: 'pause', hint: null, blockedBy: none, attention };
  if (phase.status === 'waiting') {
    const names = phase.blockedBy.map((id) => view.phases.find((entry) => entry.id === id)?.name ?? id);
    return { chip: null, button: 'run-disabled', hint: 'blocked', blockedBy: names, attention };
  }
  if (phase.status === 'running') return { chip: 'running', button: null, hint: null, blockedBy: none, attention };
  if (phase.status === 'planned' && runnableTasks(view, phase).length > 0) {
    return { chip: null, button: 'run', hint: null, blockedBy: none, attention };
  }
  return { chip: null, button: null, hint: null, blockedBy: none, attention };
};

export interface RoadmapState {
  readonly loading: boolean;
  /** The last successful query's view; null while the problem state shows (U-17). */
  readonly view: RoadmapPageView | null;
  /** The failure code of the latest failed query (e.g. `not_found` for a project without a
   *  roadmap): the problem state, never an empty page. Null while a roadmap is shown. */
  readonly problem: string | null;
  /** The open phases' ids, session state: on entry the first phase only (U-17). */
  readonly openPhases: readonly string[];
  /** The expanded cross-repo tasks' ids, session state (U-17). */
  readonly expanded: readonly string[];
  /** The one open panel of the page (U-64); opening one closes the other. */
  readonly panel: RoadmapPanel | null;
  /** The phase whose command is in flight: a second command waits for the reply. */
  readonly pending: string | null;
}

export interface RoadmapStore {
  load(project: string): Promise<void>;
  /** Flip a phase's collapse; disclosure survives re-queries, not a project change. */
  togglePhase(id: string): void;
  /** Flip a cross-repo task's expansion; disclosure survives re-queries, not a project change. */
  toggleTask(id: string): void;
  /** Open a phase's start confirmation (U-64): the card opens, any other panel closes. */
  askRun(phase: string): void;
  /** Flip a phase's attention list; opening it closes a confirmation. */
  toggleAttention(phase: string): void;
  /** Close the open panel and change nothing else (Vazgeç). */
  closePanel(): void;
  /** The three phase commands; each answers the notices to toast and refetches the page. */
  runPhase(phase: string): Promise<readonly RoadmapNotice[]>;
  pausePhase(phase: string): Promise<readonly RoadmapNotice[]>;
  resumePhase(phase: string): Promise<readonly RoadmapNotice[]>;
  state(): RoadmapState;
  subscribe(listener: () => void): () => void;
}

type PhaseCommandType = 'roadmap.runPhase' | 'roadmap.pausePhase' | 'roadmap.resumePhase';

export const createRoadmapStore = (deps: RoadmapStoreDeps): RoadmapStore => {
  const { api, changes } = deps;
  const actor = deps.actor ?? OPERATOR;

  const initial: RoadmapState = { loading: false, view: null, problem: null, openPhases: [], expanded: [], panel: null, pending: null };
  let state: RoadmapState = initial;
  // The project the store is bound to: change events re-query it, and opening another project
  // resets the disclosure to a fresh entry (first phase open, nothing expanded).
  let project: string | null = null;
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply, as in the cockpit store.
  let attempts = 0;

  const set = (next: RoadmapState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (target: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    // Entry disclosure applies when the project changes (the store's first load included);
    // a re-query of the same project keeps what the operator has opened or expanded.
    const freshProject = project !== target;
    project = target;
    set({
      loading: true,
      view: freshProject ? null : state.view,
      problem: null,
      openPhases: freshProject ? [] : state.openPhases,
      expanded: freshProject ? [] : state.expanded,
      panel: freshProject ? null : state.panel,
      pending: freshProject ? null : state.pending,
    });
    const reply: unknown = await api.query({ type: 'roadmap.byProject', project: target } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The problem state replaces the page: an empty roadmap must not pretend health (U-17).
      set({ ...state, loading: false, view: null, problem: reply.code });
      return;
    }
    // The contract of the roadmap query: a reply that is not a failure is a RoadmapPageView.
    const view = reply as RoadmapPageView;
    const openPhases = state.openPhases.length > 0 ? state.openPhases : [view.phases[0]?.id].filter((id) => id !== undefined);
    set({ ...state, loading: false, view, problem: null, openPhases });
  };

  const phaseName = (phase: string): string => state.view?.phases.find((entry) => entry.id === phase)?.name ?? phase;

  const control = async (type: PhaseCommandType, phase: string): Promise<readonly RoadmapNotice[]> => {
    const target = project;
    if (target === null || state.pending !== null) return [];
    set({ ...state, pending: phase });
    const result = await api.command(actor, { type, project: target, phase });
    // The panel closes whatever the answer was; the refetch below shows the truth either way.
    set({ ...state, pending: null, panel: null });
    const notices: RoadmapNotice[] = [];
    if (!result.ok) {
      notices.push({ type: 'error', key: failureKey(result.code), copy: result.code });
    } else if (type === 'roadmap.runPhase') {
      // The counts are the command's own `phaseRun`; without one the sub-line claims nothing.
      const opened = result.phaseRun?.opened;
      const orders = opened?.reduce((sum, entry) => sum + entry.workOrders.length, 0) ?? 0;
      notices.push({
        type: 'success',
        key: 'roadmap.toast.running',
        vars: { phase: phaseName(phase) },
        ...(opened === undefined ? {} : { subKey: 'roadmap.toast.queued' as const, subVars: { n: String(opened.length), m: String(orders) } }),
      });
      const failed = result.phaseRun?.failed.length ?? 0;
      if (failed > 0) notices.push({ type: 'warn', key: 'roadmap.toast.failed', vars: { k: String(failed) } });
    } else if (type === 'roadmap.pausePhase') {
      notices.push({ type: 'success', key: 'roadmap.toast.paused', subKey: 'roadmap.toast.pausedSub' });
    } else {
      notices.push({ type: 'success', key: 'roadmap.toast.resumed' });
    }
    await load(target);
    return notices;
  };

  changes((change) => {
    // Only work-order changes move a task's status; run events belong to the cockpit.
    if (change.type !== 'workOrders.changed') return;
    if (project === null) return;
    void load(project);
  });

  return {
    load,
    togglePhase: (id) => {
      const open = state.openPhases.includes(id);
      set({
        ...state,
        openPhases: open ? state.openPhases.filter((entry) => entry !== id) : [...state.openPhases, id],
      });
    },
    toggleTask: (id) => {
      const open = state.expanded.includes(id);
      set({
        ...state,
        expanded: open ? state.expanded.filter((entry) => entry !== id) : [...state.expanded, id],
      });
    },
    askRun: (phase) => {
      set({
        ...state,
        panel: { kind: 'confirm', phase },
        openPhases: state.openPhases.includes(phase) ? state.openPhases : [...state.openPhases, phase],
      });
    },
    toggleAttention: (phase) => {
      const open = state.panel?.kind === 'attention' && state.panel.phase === phase;
      set({ ...state, panel: open ? null : { kind: 'attention', phase } });
    },
    closePanel: () => set({ ...state, panel: null }),
    runPhase: (phase) => control('roadmap.runPhase', phase),
    pausePhase: (phase) => control('roadmap.pausePhase', phase),
    resumePhase: (phase) => control('roadmap.resumePhase', phase),
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
