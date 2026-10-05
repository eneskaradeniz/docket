// api/queries.ts — the read side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts.
import type { ModelMatcher } from '../domain/index';
import type { AccountTestView, ProviderMark, QuotaProbeError } from '../application';

export type { AccountTestView };

export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string }
  | { readonly type: 'project.tree' }
  | { readonly type: 'roadmap.byProject'; readonly project: string }
  | { readonly type: 'repo.board'; readonly repo: string }
  | { readonly type: 'cockpit'; readonly project?: string }
  | { readonly type: 'account.detail'; readonly id: string }
  | { readonly type: 'account.models'; readonly accountId: string; readonly refresh?: boolean }
  | { readonly type: 'project.spend'; readonly project: string }
  | { readonly type: 'repos.list' }
  | { readonly type: 'settings.accounts'; readonly catalog?: 'read' | 'skip' }
  | { readonly type: 'roles.list' }
  | { readonly type: 'providers.discovered' }
  | { readonly type: 'accounts.candidates'; readonly fresh?: boolean }
  | { readonly type: 'accounts.candidateQuota'; readonly sourcePath: string }
  | { readonly type: 'providers.marks' }
  | { readonly type: 'run.events'; readonly runId: string }
  | { readonly type: 'permissions.open' }
  | { readonly type: 'app.update' };

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
  // The optional fields below (A-35 … A-37, A-40) are optional in the type only so consumers
  // written before they existed keep compiling; the cockpit query itself always fills them.
  readonly running: readonly {
    readonly workOrderId: string;
    readonly number: number;
    readonly stage: string;
    readonly accountId: string;
    readonly provider?: string;
    readonly startedAt: number;
    readonly title?: string;
    readonly stageIndex?: number;
    readonly stageCount?: number;
    readonly queued?: boolean;
    readonly queuedReason?: 'limit' | 'queue';
    readonly limitResetsAt?: number | null;
  }[];
  /** K-4:B — cockpit cards; one per attached project, always the full list (A-28). */
  readonly projects: readonly {
    readonly project: string;
    readonly name: string;
    readonly mainRepo: string;
    readonly repoCount: number;
    readonly active: number;
    readonly waiting: number;
    /** A-38 — the project's latest work-order status change; null when it has no work orders. */
    readonly lastActivityAt?: number | null;
  }[];
  readonly recentlyClosed: readonly {
    readonly workOrderId: string;
    readonly number: number;
    readonly title: string;
    readonly project: string;
    readonly repo: string;
    readonly closedAt: number;
    /** A-39 — how the work order ended: its flow completed, or a person closed it. */
    readonly outcome?: 'merged' | 'cancelled';
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
    readonly tasks: readonly {
      readonly id: string;
      readonly title: string;
      readonly status: string;
      readonly targets: readonly string[];
      /** The task's linked work orders, per the task's `targets` order then `number` ascending. */
      readonly workOrders: readonly { readonly repo: string; readonly id: string; readonly number: number; readonly title: string; readonly status: string }[];
    }[];
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
  /** `account` (A-30): the run's account label, null when there never was one; `since` (A-31):
   *  the ISO-8601 UTC instant of the last status change. The done strip carries neither. */
  readonly workOrders: readonly { readonly id: string; readonly number: number; readonly title: string; readonly status: string; readonly account: string | null; readonly since: string }[];
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
  /** The class R-49 puts the meter in (`reserveClassOf`). */
  readonly reserveClass: 'short' | 'long' | 'larger';
  /** The share that governs the meter (`reserveFor` with the account's reserve); 0 = none. */
  readonly reserveShare: number;
}

/** A pool without its accountId: the owning account is the view entry it sits in. */
export interface SettingsPoolView {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly appliesTo: readonly ModelMatcher[] | 'all' | 'unknown';
}

/** The quota a discovered account would show, read before adoption (A-82); ids are synthetic. */
export type CandidateQuotaView =
  | { readonly ok: true; readonly pools: readonly SettingsPoolView[]; readonly meters: readonly SettingsMeterView[] }
  | { readonly ok: false; readonly code: QuotaProbeError | 'needs_account' | 'not_found' };

export interface SettingsAccountView {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly authMode: string;
  /** The account's billing view (P-51): default billing, settled by the account's own pools. */
  readonly billing: 'included' | 'metered' | 'unknown';
  readonly plan: string | null;
  readonly limitPolicy: 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';
  readonly reserve: { readonly short: number | null; readonly long: number | null };
  readonly caps: readonly { readonly scope: 'account_day' | 'account_week' | 'account_month'; readonly amountUsd: number; readonly warnPercent: number }[];
  /** '*' = the route's default model (P-40). */
  readonly consentedModels: readonly string[];
  readonly routeKind: string | null;
  /** The stored path verbatim. */
  readonly identityDir: string | null;
  /** The host of `endpoint`, never the URL's path or query. */
  readonly endpointHost: string | null;
  /** `secretRef` is present; never the value. */
  readonly hasSecret: boolean;
  /** null = never tested since the app started or since the last reset (A-73). */
  readonly test: AccountTestView | null;
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
  readonly thinking: { readonly level: 'fast' | 'balanced' | 'deep' } | { readonly effort: string } | null;
  readonly tier: 'strong' | 'balanced' | 'fast' | null;
  readonly accounts: readonly { readonly accountId: string; readonly model: string | null }[];
}

export interface SettingsAccountsView {
  readonly accounts: readonly SettingsAccountView[];
  readonly bindings: readonly SettingsBindingView[];
}

// --- roles.list (A-50) -------------------------------------------------------------------------------

export interface RoleListItem {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly {
    readonly flow: string;
    readonly flowName: string;
    readonly stage: string;
    readonly stageName: string;
    readonly tier: 'strong' | 'balanced' | 'fast' | null;
    readonly thinking: { readonly level: string } | { readonly effort: string } | null;
    readonly reviewOf: string | null;
    readonly sameProviderReview: boolean;
  }[];
}

// --- account.models (P-29, P-40) -----------------------------------------------------------------

/** One model of the account's merged catalog as the surface sees it: registry capabilities where
 *  known, unknown-but-selectable otherwise. `stale` marks the last good list kept after a failed
 *  refresh; `autoClassified` marks a tier that came from a family-id pattern, not the registry. */
export interface ModelView {
  readonly id: string;
  readonly displayName?: string;
  readonly tier?: 'strong' | 'balanced' | 'fast';
  readonly thinking:
    | { readonly kind: 'none' }
    | { readonly kind: 'levels'; readonly levels: readonly string[] }
    | { readonly kind: 'unknown' };
  readonly billing: 'included' | 'metered' | 'unknown';
  readonly source: 'live' | 'bundled';
  readonly stale: boolean;
  readonly autoClassified: boolean;
  /** This account's recorded per-model consent (P-40); the account-level marker never lands here. */
  readonly consented: boolean;
}

export interface AccountModelsView {
  readonly models: readonly ModelView[];
  /** True when the account-level marker `'*'` sits in the account's consents (P-40): the route's
   *  own default model is consented. */
  readonly defaultConsented: boolean;
  /** The billing an unpinned run on this account would take (P-40). */
  readonly defaultBilling: 'included' | 'metered' | 'unknown';
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

// --- providers.marks ----------------------------------------------------------------------------------

/** The marks of every composed provider def (A-41): def id → its mark, `null` when it has none. */
export type ProviderMarksView = Record<string, ProviderMark | null>;
