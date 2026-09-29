// api/queries.ts — the read side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts.
import type { ModelMatcher } from '../domain/index';

export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string }
  | { readonly type: 'project.tree' }
  | { readonly type: 'roadmap.byProject'; readonly project: string }
  | { readonly type: 'repo.board'; readonly repo: string }
  | { readonly type: 'cockpit'; readonly project?: string }
  | { readonly type: 'account.detail'; readonly id: string }
  | { readonly type: 'project.spend'; readonly project: string }
  | { readonly type: 'repos.list' }
  | { readonly type: 'settings.accounts' }
  | { readonly type: 'providers.discovered' }
  | { readonly type: 'run.events'; readonly runId: string }
  | { readonly type: 'permissions.open' };

export interface AttentionItem {
  readonly workOrderId: string;
  /** The work order's A-29 display number. */
  readonly number: number;
  readonly project: string;
  readonly repo: string;
  readonly title: string;
  readonly kind: 'awaiting_human' | 'permission_ask' | 'limit_waiting' | 'blocked';
  readonly stage: string | null;
  readonly since: number;
}

export interface CockpitView {
  readonly attention: readonly AttentionItem[];
  readonly running: readonly {
    readonly workOrderId: string;
    readonly number: number;
    readonly stage: string;
    readonly accountId: string;
    readonly startedAt: number;
  }[];
  /** K-4:B — cockpit cards; one per attached project, always the full list (A-28). */
  readonly projects: readonly {
    readonly project: string;
    readonly name: string;
    readonly mainRepo: string;
    readonly repoCount: number;
    readonly active: number;
    readonly waiting: number;
  }[];
  readonly recentlyClosed: readonly {
    readonly workOrderId: string;
    readonly number: number;
    readonly title: string;
    readonly project: string;
    readonly repo: string;
    readonly closedAt: number;
  }[]; // closedAt desc, max 5
}

export interface RepoNode {
  readonly repo: string;
  readonly name: string;
  readonly main: boolean;
  readonly active: number;
  readonly running: number;
  readonly waiting: number;
  readonly status: 'running' | 'waiting' | 'idle';
}

export interface ProjectTreeItem {
  readonly project: string;
  readonly name: string;
  readonly mainRepo: string;
  readonly repos: readonly RepoNode[];
  readonly active: number;
  readonly running: number;
  readonly waiting: number;
  readonly status: 'running' | 'waiting' | 'idle';
}

export type ProjectTree = readonly ProjectTreeItem[];

export interface RoadmapPageView {
  readonly phases: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly tasks: readonly { readonly id: string; readonly title: string; readonly status: string; readonly targets: readonly string[] }[];
  }[];
  readonly runnable: readonly string[];
}

export interface AccountDetailView {
  readonly account: { readonly id: string; readonly provider: string; readonly label: string; readonly authMode: string; readonly plan?: string; readonly limitPolicy: string };
  readonly windows: readonly { readonly label?: string; readonly unit: string; readonly used?: number; readonly limit?: number; readonly remaining?: number; readonly resetsAt?: number; readonly resetPrecision: string; readonly source: string }[];
  readonly activeWork: readonly { readonly workOrderId: string; readonly number: number; readonly title: string; readonly stage: string | null; readonly status: string }[]; // non-done work orders with a run on this account, oldest active first
}

export interface ProjectSpendView {
  readonly totalUsd: number;
  readonly perRepo: readonly { readonly repo: string; readonly usd: number }[];
  readonly cap?: { readonly amountUsd: number; readonly warnPercent: number };
}

export interface BoardColumn {
  readonly stage: string;
  readonly name: string;
  readonly workOrders: readonly { readonly id: string; readonly number: number; readonly title: string; readonly status: string }[];
}

export interface BoardView {
  readonly repo: string;
  readonly flow: string;
  readonly columns: readonly BoardColumn[];
  readonly done: readonly { readonly id: string; readonly number: number; readonly title: string }[];
}

// --- repos.list --------------------------------------------------------------------------------

/** A repo this machine knows: the registry's row with the slug as a plain string id. `path`
 *  is the checkout root the registry holds — the fact that makes the row machine-local rather than
 *  merely a repo some work order once named. */
export interface RepoListItem {
  readonly id: string;
  readonly path: string;
}

// --- settings.accounts (U-13) -----------------------------------------------------------------------

/** A meter as the settings surface sees it: absent optionals read null, never undefined. */
export interface SettingsMeterView {
  readonly id: string;
  readonly poolId: string;
  readonly label: string | null;
  readonly cadence: string;
  readonly durationMs: number | null;
  readonly unit: string;
  readonly used: number | null;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetsAt: number | null;
  readonly resetPrecision: string;
  readonly observedAt: number;
  readonly source: string;
  readonly staleAfterMs: number | null;
}

/** A pool without its accountId: the owning account is the view entry it sits in. */
export interface SettingsPoolView {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly appliesTo: readonly ModelMatcher[] | 'all';
}

export interface SettingsAccountView {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly authMode: string;
  readonly plan: string | null;
  readonly pools: readonly SettingsPoolView[];
  readonly meters: readonly SettingsMeterView[];
}

export type SettingsBindingScope =
  | { readonly level: 'global' }
  | { readonly level: 'project'; readonly project: string }
  | { readonly level: 'repo'; readonly repo: string }
  | { readonly level: 'workOrder'; readonly workOrderId: string };

export interface SettingsBindingView {
  readonly scope: SettingsBindingScope;
  readonly role: string;
  readonly accounts: readonly { readonly accountId: string; readonly model: string | null }[];
}

export interface SettingsAccountsView {
  readonly accounts: readonly SettingsAccountView[];
  readonly bindings: readonly SettingsBindingView[];
}

// --- run.events ---------------------------------------------------------------------------------------

/** The tail bound of `run.events`: a store re-queries on every `run.updated`, so an unbounded
 *  reply would ship a long run's whole history per event. The pane renders the recent past. */
export const RUN_EVENTS_TAIL_LIMIT = 500;

// --- permissions.open ---------------------------------------------------------------------------------

/** An ask still waiting for a human decision, as the feed surfaces it: the board's own row plus
 *  the owning work order's title when the asking run still resolves to one (null when it does
 *  not). */
export interface OpenAskView {
  readonly runId: string;
  readonly askId: string;
  readonly since: number;
  readonly title: string | null;
}
