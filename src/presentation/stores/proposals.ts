// stores/proposals.ts — the Öneriler screen's store (U-136 … U-146): `proposals.list` with each
// pending proposal's `proposal.detail` (the list rows carry no staleness, only the detail does),
// the three tabs' grouping, the selection and its fallback, the decision command with its
// one-in-flight guard, and the refresh story — on open, on window focus and after its own
// commands; nothing polls. A proposal's summary, target, scope, author and diff text are
// untrusted: the store only carries them to the screen.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { ProposalDetailView, ProposalListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { isQueryFailure } from './results';

export type ProposalTab = 'pending' | 'decided' | 'stale';

export const PROPOSAL_TABS: readonly ProposalTab[] = ['pending', 'decided', 'stale'];

export interface ProposalsState {
  readonly items: readonly ProposalListItem[];
  /** Whether a list has ever landed. */
  readonly loaded: boolean;
  /** The failure code of a read that failed before any list stood; null otherwise. */
  readonly failed: string | null;
  /** Detail views by id: every pending proposal (for its staleness) and the selected one. */
  readonly details: Readonly<Record<string, ProposalDetailView>>;
  /** The failure code of a detail read, by id. */
  readonly detailFailed: Readonly<Record<string, string>>;
  readonly tab: ProposalTab;
  /** The operator's choice; the shown selection falls back to the tab's first item. */
  readonly selected: string | null;
  /** Project and repo names by slug, from the sidebar tree's own query. */
  readonly projectNames: Readonly<Record<string, string>>;
  readonly repoNames: Readonly<Record<string, string>>;
  /** Proposals whose decision is in flight. */
  readonly deciding: readonly string[];
  /** The failure code of the last refused decision, shown in the detail's note row. */
  readonly note: string | null;
}

type Group = ProposalTab;

/** A proposal the api saved as stale, or a pending one whose file moved, is Bayat. */
export const proposalGroup = (state: ProposalsState, item: ProposalListItem): Group => {
  if (item.status === 'approved' || item.status === 'rejected') return 'decided';
  if (item.status === 'stale') return 'stale';
  return state.details[item.id]?.currentlyStale === true ? 'stale' : 'pending';
};

export const shownProposals = (state: ProposalsState): readonly ProposalListItem[] =>
  state.items.filter((item) => proposalGroup(state, item) === state.tab);

export const proposalCounts = (state: ProposalsState): Readonly<Record<ProposalTab, number>> => {
  const counts = { pending: 0, decided: 0, stale: 0 };
  for (const item of state.items) counts[proposalGroup(state, item)] += 1;
  return counts;
};

/** The sidebar's count: pending proposals that can still be approved. */
export const proposalBadge = (state: ProposalsState): number => proposalCounts(state).pending;

/** The chosen item when the tab holds it, else the tab's first item, else nothing. */
export const effectiveSelection = (state: ProposalsState): string | null => {
  const shown = shownProposals(state);
  if (state.selected !== null && shown.some((item) => item.id === state.selected)) return state.selected;
  return shown[0]?.id ?? null;
};

/** The scope's display name: null for global, the resolved name, the slug when unresolved. */
export const proposalScopeName = (state: ProposalsState, item: ProposalListItem): string | null => {
  if (item.scopeKind === 'global' || item.scopeId === undefined) return null;
  const names = item.scopeKind === 'project' ? state.projectNames : state.repoNames;
  return names[item.scopeId] ?? item.scopeId;
};

/** ↑ / ↓ move within the list and stop at its ends; any other key claims nothing. */
export const moveSelection = (ids: readonly string[], current: string | null, key: string): string | null => {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return ids[0] ?? null;
  const next = key === 'ArrowDown' ? Math.min(ids.length - 1, at + 1) : Math.max(0, at - 1);
  return ids[next] ?? null;
};

/** The refused decision's sentence: stale and not_found have their own, the rest one generic line. */
export const proposalFailureKey = (code: string): LabelKey =>
  code === 'stale' ? 'proposals.fail.stale' : code === 'not_found' ? 'proposals.fail.not_found' : 'proposals.fail.generic';

export interface ProposalsStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  /** The window's focus signal; a focus re-reads. Absent in tests that never fire it. */
  readonly focus?: (listener: () => void) => () => void;
}

export interface ProposalsStore {
  state(): ProposalsState;
  subscribe(listener: () => void): () => void;
  /** Re-reads the list, the pending proposals' details and the selection's. */
  refresh(): Promise<void>;
  setTab(tab: ProposalTab): void;
  select(id: string): void;
  /** Sends the decision; null when one is already in flight for that proposal. */
  decide(id: string, decision: 'approved' | 'rejected'): Promise<CommandResult | null>;
}

const INITIAL: ProposalsState = {
  items: [],
  loaded: false,
  failed: null,
  details: {},
  detailFailed: {},
  tab: 'pending',
  selected: null,
  projectNames: {},
  repoNames: {},
  deciding: [],
  note: null,
};

const isDetail = (reply: unknown): reply is ProposalDetailView =>
  typeof reply === 'object' && reply !== null && !isQueryFailure(reply) && 'lines' in reply;

export const createProposalsStore = (deps: ProposalsStoreDeps): ProposalsStore => {
  const { api, actor } = deps;
  let state: ProposalsState = INITIAL;
  const listeners = new Set<() => void>();
  // Only the newest refresh may land: a slow older reply must not overwrite a fresher one.
  let seq = 0;

  const set = (next: ProposalsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const readDetail = async (id: string): Promise<{ readonly view?: ProposalDetailView; readonly code?: string }> => {
    const reply: unknown = await api.query({ type: 'proposal.detail', id } satisfies Query);
    if (isDetail(reply)) return { view: reply };
    return { code: isQueryFailure(reply) ? reply.code : 'unknown' };
  };

  const readNames = async (): Promise<Pick<ProposalsState, 'projectNames' | 'repoNames'> | null> => {
    const reply: unknown = await api.query({ type: 'project.tree' } satisfies Query);
    if (!Array.isArray(reply)) return null;
    const projectNames: Record<string, string> = {};
    const repoNames: Record<string, string> = {};
    for (const project of reply as readonly {
      readonly project: string;
      readonly name: string;
      readonly repos?: readonly { readonly repo: string; readonly name: string }[];
    }[]) {
      projectNames[project.project] = project.name;
      for (const repo of project.repos ?? []) repoNames[repo.repo] = repo.name;
    }
    return { projectNames, repoNames };
  };

  const refresh = async (): Promise<void> => {
    const mine = ++seq;
    const [listReply, names] = await Promise.all([api.query({ type: 'proposals.list' } satisfies Query) as Promise<unknown>, readNames()]);
    if (mine !== seq) return;
    if (!Array.isArray(listReply)) {
      // A read that fails after a list stands keeps the list; before the first list it is shown.
      if (!state.loaded) set({ ...state, failed: isQueryFailure(listReply) ? listReply.code : 'unknown' });
      return;
    }
    const items = listReply as readonly ProposalListItem[];
    // The selection's detail is wanted too: it may be a decided proposal the pending reads skip.
    const base: ProposalsState = { ...state, items, loaded: true, failed: null, ...(names ?? {}) };
    const wanted = new Set(items.filter((item) => item.status === 'pending').map((item) => item.id));
    const sel = effectiveSelection({ ...base, details: {} });
    // Grouping needs staleness only for pending items, so the fallback selection is computed
    // against pending-as-current and corrected once the details are in.
    if (sel !== null) wanted.add(sel);
    if (state.selected !== null && items.some((item) => item.id === state.selected)) wanted.add(state.selected);
    const reads = await Promise.all([...wanted].map(async (id) => [id, await readDetail(id)] as const));
    if (mine !== seq) return;
    const details: Record<string, ProposalDetailView> = {};
    const detailFailed: Record<string, string> = {};
    for (const [id, read] of reads) {
      if (read.view !== undefined) details[id] = read.view;
      else if (read.code !== undefined) detailFailed[id] = read.code;
    }
    set({ ...base, details, detailFailed });
    await ensureDetail();
  };

  const omit = (record: Readonly<Record<string, string>>, id: string): Record<string, string> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));

  /** Reads the detail of what is now selected when it is not held yet. */
  const ensureDetail = async (): Promise<void> => {
    const id = effectiveSelection(state);
    if (id === null || state.details[id] !== undefined) return;
    const read = await readDetail(id);
    if (read.view !== undefined) {
      set({ ...state, details: { ...state.details, [id]: read.view }, detailFailed: omit(state.detailFailed, id) });
    } else if (read.code !== undefined) {
      set({ ...state, detailFailed: { ...state.detailFailed, [id]: read.code } });
    }
  };

  deps.focus?.(() => {
    void refresh();
  });

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    setTab: (tab) => {
      set({ ...state, tab, note: null });
      void ensureDetail();
    },
    select: (id) => {
      set({ ...state, selected: id, note: null });
      void ensureDetail();
    },
    decide: async (id, decision) => {
      if (state.deciding.includes(id)) return null;
      set({ ...state, deciding: [...state.deciding, id], note: null });
      const result = await api.command(actor, { type: 'proposal.decide', id, decision });
      const rest = state.deciding.filter((other) => other !== id);
      if (result.ok) {
        // The decided proposal is where the operator looks next: its tab, selected.
        set({ ...state, deciding: rest, tab: 'decided', selected: id, note: null });
        await refresh();
        return result;
      }
      set({ ...state, deciding: rest, note: result.code });
      if (result.code === 'stale' || result.code === 'not_found') {
        await refresh();
        // A proposal that went stale stays in front of the operator, under its note.
        const item = state.items.find((row) => row.id === id);
        if (item !== undefined && proposalGroup(state, item) === 'stale') set({ ...state, tab: 'stale', selected: id });
        await ensureDetail();
      }
      return result;
    },
  };
};
