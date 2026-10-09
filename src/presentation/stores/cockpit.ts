// stores/cockpit.ts — the cockpit store (U-2 + U-21): it mirrors the `cockpit` query's view with
// the api's attention order untouched (the rank is the api's, A-22), ages items from `since`
// through an injected clock, and re-queries on the coarse change events. A failed query keeps the
// previous view and surfaces `retry` — an error never blanks the cockpit. U-21 adds the four
// sections' own facts: for a permission-ask row the asking run and the earliest ask still open in
// its stream (the row's inline answer needs both), the inline answer intent itself, and the
// project cards' default-view rule.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { AgentEvent } from '../../domain/index';
import type { Actor } from '../../domain/index';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. The wiring lands with U-12;
 *  tests inject a fake, so the type lives here until then. */
export type CockpitChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type CockpitChangeSignal = (listener: (change: CockpitChange) => void) => () => void;

/** The ask a permission-ask row carries: the run that asked and the earliest ask of its stream
 *  still open (U-21) — the pair `permission.answer` needs. */
export interface CockpitAsk {
  readonly runId: string;
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
}

/** Where a project card leads (K-4:B): a multi-repo project's default view is its roadmap, a
 *  single-repo project's the main repo's board. */
export type ProjectCardTarget =
  | { readonly kind: 'roadmap'; readonly project: string }
  | { readonly kind: 'board'; readonly repo: string };

/** The sections the operator can fold. Senden bekleyenler is not among them: what waits on the
 *  operator is never hidden (U-10). */
export type CockpitSection = 'running' | 'projects' | 'closed';
const FOLDABLE: readonly CockpitSection[] = ['running', 'projects', 'closed'];

export const COCKPIT_COLLAPSED_STORAGE_KEY = 'docket.cockpit.collapsed';

/** The structural slice of DOM storage the folds persist through; localStorage satisfies it. */
export interface CockpitPersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CockpitStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: CockpitChangeSignal;
  /** Wall clock, injected: the store never reads `Date` itself. */
  readonly now: () => number;
  /** Every issued answer travels as this actor — the cockpit acts as the user. */
  readonly actor: Actor;
  /** The folded sections persist here; without it they last for the session. */
  readonly persistence?: CockpitPersistence;
}

export interface CockpitState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen (U-2). */
  readonly view: CockpitView | null;
  /** True when the latest finished query failed: components surface the retry intent. */
  readonly failed: boolean;
  /** The permission ask of each waiting row that carries one, keyed by work order id (U-21);
   *  a row without a derivable ask renders its own kind copy instead. */
  readonly asks: Readonly<Record<string, CockpitAsk>>;
  /** The clock reading of the last successful load; null before the first one. A failed reload
   *  keeps it, so the screen can say how old the view it still shows is. */
  readonly loadedAt: number | null;
  /** The folded sections, in the order they were folded. */
  readonly collapsed: readonly CockpitSection[];
}

export interface AnswerIntentInput {
  readonly runId: string;
  readonly askId: string;
  readonly decision: 'allow' | 'deny';
}

export interface CockpitStore {
  load(): Promise<void>;
  /** The retry intent a failed query surfaces (U-2); a plain reload of the same query. */
  retry(): Promise<void>;
  state(): CockpitState;
  /** Elapsed milliseconds since the item started waiting, never negative. Rendering the age
   *  in the active locale is the component's job. */
  ageMs(item: AttentionItem): number;
  /** Elapsed milliseconds since any stamped moment (a run's start, a close), never negative. */
  sinceMs(at: number): number;
  /** The inline answer of a permission-ask row (U-21): `permission.answer` plus the re-query
   *  that must drop the answered row. */
  answerPermission(input: AnswerIntentInput): Promise<CommandResult>;
  /** Folds an open section and opens a folded one; the choice persists. */
  toggleSection(section: CockpitSection): void;
  subscribe(listener: () => void): () => void;
}

/** The ask facts without the run that owns them; the cockpit joins the run id on. */
export type OpenAskFacts = Omit<CockpitAsk, 'runId'>;

/** The earliest permission ask of a stream still open — the same openness notion as the domain's
 *  run fold (R-44): an ask is open until a tool_result or a permission_answered of its id arrives.
 *  Pure (U-21). */
export const earliestOpenAsk = (events: readonly AgentEvent[]): OpenAskFacts | null => {
  const closed = new Set(
    events
      .filter((event) => event.type === 'tool_result' || event.type === 'permission_answered')
      .map((event) => (event as { readonly id: string }).id),
  );
  const ask = events.find(
    (event): event is Extract<AgentEvent, { readonly type: 'permission_ask' }> =>
      event.type === 'permission_ask' && !closed.has(event.id),
  );
  return ask === undefined ? null : { askId: ask.id, tool: ask.tool, target: ask.target ?? null };
};

/** The card's default view (K-4:B, U-21): multi-repo → roadmap, single-repo → the main repo's
 *  board. Pure. */
export const projectCardTarget = (card: Extract<CockpitView['projects'][number], { readonly project: string }>): ProjectCardTarget =>
  card.repoCount > 1
    ? { kind: 'roadmap', project: card.project }
    : { kind: 'board', repo: card.mainRepo };

/** How many rows each list shows before its fold; Son kapananlar is capped by the api too (A-28),
 *  the store re-asserts it so a longer reply never stretches the screen. */
export const COCKPIT_LIMITS = { attention: 5, running: 6, closed: 5 } as const;

type RunRow = CockpitView['running'][number];

/** A queued row waits for a slot or a limit; every other row is an actually running stage (A-36). */
export const isQueued = (run: RunRow): boolean => run.queued === true;

/** The head's counts. `attention` is every attention item — the number the title bar's badge
 *  shows (U-10); `waiting` are those the operator or a clock holds, `blocked` the stopped ones.
 *  `running` counts rows actually running, `queued` the ones waiting for their turn (A-36). */
export const cockpitSummary = (
  view: CockpitView,
): {
  readonly attention: number;
  readonly waiting: number;
  readonly blocked: number;
  readonly running: number;
  readonly queued: number;
} => {
  const blocked = view.attention.filter((item) => item.kind === 'blocked').length;
  const queued = view.running.filter(isQueued).length;
  return {
    attention: view.attention.length,
    waiting: view.attention.length - blocked,
    blocked,
    running: view.running.length - queued,
    queued,
  };
};

/** The progress strip of a run row (A-35): the stage's 1-based position in its flow and the flow's
 *  length; null when the api could not place the stage (both 0) or does not say. Pure. */
export const stageStrip = (run: RunRow): { readonly index: number; readonly count: number } | null => {
  const { stageIndex, stageCount } = run;
  if (stageIndex === undefined || stageCount === undefined || stageIndex <= 0 || stageCount <= 0) return null;
  return { index: Math.min(stageIndex, stageCount), count: stageCount };
};

/** Whether a project card shows "last activity": only a card with no active work and a known
 *  stamp (A-38) — a busy card already says what is going on. Pure. */
export const showsLastActivity = (card: CockpitView['projects'][number]): boolean =>
  card.active === 0 && card.lastActivityAt !== undefined && card.lastActivityAt !== null;

/** The rows a list shows and how many its fold hides; expanded shows everything. Pure. */
export const limitRows = <T>(
  rows: readonly T[],
  limit: number,
  expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number } =>
  expanded || rows.length <= limit
    ? { shown: rows, hidden: 0 }
    : { shown: rows.slice(0, limit), hidden: rows.length - limit };

/** Son kapananlar: the most recent closes, `closedAt` descending, at most five. Pure. */
export const recentClosed = (
  closed: CockpitView['recentlyClosed'],
): CockpitView['recentlyClosed'] =>
  [...closed].sort((a, b) => b.closedAt - a.closedAt).slice(0, COCKPIT_LIMITS.closed);

export type CockpitPhase = 'loading' | 'failed-empty' | 'first-run' | 'ready';

/** What the screen shows as a whole: a failed reload over an existing view stays `ready` — an
 *  error never blanks the cockpit (U-2); a view with no project, work and history is a first run. */
export const cockpitPhase = (state: CockpitState): CockpitPhase => {
  const view = state.view;
  if (view === null) return state.failed ? 'failed-empty' : 'loading';
  const empty =
    view.projects.length === 0 &&
    view.attention.length === 0 &&
    view.running.length === 0 &&
    view.recentlyClosed.length === 0;
  return empty ? 'first-run' : 'ready';
};

/** Anything unreadable in storage means every section open; unknown names are dropped. */
const readCollapsed = (persistence: CockpitPersistence | undefined): readonly CockpitSection[] => {
  try {
    const raw = persistence?.getItem(COCKPIT_COLLAPSED_STORAGE_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return FOLDABLE.filter((section) => parsed.includes(section)).sort((a, b) => parsed.indexOf(a) - parsed.indexOf(b));
  } catch {
    return [];
  }
};

export const createCockpitStore = (deps: CockpitStoreDeps): CockpitStore => {
  const { api, changes, now, actor, persistence } = deps;

  let state: CockpitState = { loading: false, view: null, failed: false, asks: {}, loadedAt: null, collapsed: readCollapsed(persistence) };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: CockpitState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** The asking run of a work order: the newest still-active one of its detail view — the same
   *  rule the detail store's live pane mounts by. */
  const askingRunOf = async (
    item: AttentionItem,
  ): Promise<{ readonly runId: string; readonly events: readonly AgentEvent[] } | null> => {
    const detail: unknown = await api.query({ type: 'workOrder.detail', id: item.workOrderId } satisfies Query);
    if (isQueryFailure(detail) || detail === null || typeof detail !== 'object') return null;
    const runs = (detail as { readonly runs?: unknown }).runs;
    if (!Array.isArray(runs)) return null;
    let newest: { readonly id: string; readonly startedAt: number } | undefined;
    for (const run of runs) {
      const record = run as { readonly id?: unknown; readonly startedAt?: unknown; readonly endedAt?: unknown };
      if (record.endedAt !== undefined || typeof record.id !== 'string' || typeof record.startedAt !== 'number') {
        continue;
      }
      if (newest === undefined || record.startedAt > newest.startedAt) {
        newest = { id: record.id, startedAt: record.startedAt };
      }
    }
    if (newest === undefined) return null;
    const events: unknown = await api.query({ type: 'run.events', runId: newest.id } satisfies Query);
    if (isQueryFailure(events) || !Array.isArray(events)) return null;
    return { runId: newest.id, events: events as readonly AgentEvent[] };
  };

  /** Reads every permission-ask row's ask. A row whose ask cannot be derived stays askless —
   *  its kind copy carries the row, never a guessed command. Only the newest load's reads may
   *  apply, so stacked reloads cannot resurrect an answered row's ask. */
  const loadAsks = async (view: CockpitView, attempt: number): Promise<void> => {
    const asking = view.attention.filter((item) => item.kind === 'permission_ask');
    if (asking.length === 0) {
      set({ ...state, asks: {} });
      return;
    }
    const asks: Record<string, CockpitAsk> = {};
    for (const item of asking) {
      const askingRun = await askingRunOf(item);
      if (askingRun === null) continue;
      const ask = earliestOpenAsk(askingRun.events);
      if (ask !== null) asks[item.workOrderId] = { ...ask, runId: askingRun.runId };
    }
    if (attempt !== attempts) return;
    set({ ...state, asks });
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ ...state, loading: true, failed: false });
    const reply: unknown = await api.query({ type: 'cockpit' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view stays exactly as it was; only the retry intent appears (U-2).
      set({ ...state, loading: false, failed: true });
      return;
    }
    // The contract of the cockpit query: a reply that is not a failure is a CockpitView.
    const view = reply as CockpitView;
    set({ ...state, loading: false, view, failed: false, asks: {}, loadedAt: now() });
    void loadAsks(view, attempt);
  };

  // Work-order and run events both concern the cockpit, so they trigger the same re-query; the
  // update channel does not — its state belongs to the settings surface.
  changes((change) => {
    if (change.type === 'update.changed') return;
    void load();
  });

  return {
    load,
    retry: () => load(),
    state: () => state,
    ageMs: (item) => Math.max(0, now() - item.since),
    sinceMs: (at) => Math.max(0, now() - at),
    answerPermission: async (input) => {
      const result = await api.command(actor, {
        type: 'permission.answer',
        runId: input.runId,
        askId: input.askId,
        decision: input.decision,
      });
      // The cockpit mirrors its own mutation: the re-query drops the answered row when the api
      // agrees, or keeps it when the ask was already gone.
      void load();
      return result;
    },
    toggleSection: (section) => {
      const collapsed = state.collapsed.includes(section)
        ? state.collapsed.filter((each) => each !== section)
        : [...state.collapsed, section];
      set({ ...state, collapsed });
      try {
        persistence?.setItem(COCKPIT_COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
      } catch {
        // Storage refused the write: the fold still holds for the session.
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
