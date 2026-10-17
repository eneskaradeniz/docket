// api/queries.ts — the read side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts.
import type { ModelMatcher, PageKind, PortFamily, ProposalStatus, RemovalVerdict, UsageSummary, WasteFinding, WaitReason } from '../domain/index';
import type {
  AccountTestView,
  ProposalDetailView,
  ProposalListItem,
  ProviderMark,
  QuotaProbeError,
  RepoStatusView,
  WorkOrderChangesView,
} from '../application';
import type { ChatScopeInput } from './commands';

export type { PageCommentView, PageDetailView, PageLibraryItemView, PageListItem, PageVersionView } from './page-views';
export type {
  ChatAttachmentBytesView,
  ChatAttachmentView,
  ChatConversationSummaryView,
  ChatConversationView,
  ChatReferenceView,
  ChatScopeView,
  ChatUsageView,
} from './chat-views';
export type { AccountTestView, RepoStatusView, ProposalDetailView, ProposalListItem, WorkOrderChangesView };
export type { McpStatusView } from '../application';

export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string } // → detail view incl. gates rows (A-378, A-379), git (A-390) and repoContext (A-392) | not_found | invalid_id
  | { readonly type: 'workOrder.changes'; readonly workOrder: string } // → WorkOrderChangesView | not_found | invalid_id
  | { readonly type: 'workOrder.gitBase'; readonly id: string } // → { ok: true, base } | not_found | forge_unavailable | forge_error | invalid_id (A-391)
  | { readonly type: 'project.tree' }
  | { readonly type: 'repoStatus' } // → RepoStatusView[] (A-341)
  | { readonly type: 'repo.flow'; readonly repo: string } // → RepoFlowView (A-345)
  | { readonly type: 'repo.autonomy'; readonly repo: string } // → { level, source, layerSet, autoUnavailable? } | not_found | definitions_invalid | invalid_autonomy_level (A-407, U-334)
  | { readonly type: 'roadmap.byProject'; readonly project: string }
  | { readonly type: 'roadmap.byRepo'; readonly repo: string }
  | { readonly type: 'repo.board'; readonly repo: string }
  | { readonly type: 'cockpit'; readonly project?: string }
  | { readonly type: 'account.detail'; readonly id: string }
  | { readonly type: 'account.models'; readonly accountId: string; readonly refresh?: boolean }
  | { readonly type: 'project.spend'; readonly project: string }
  | { readonly type: 'settings.accounts'; readonly catalog?: 'read' | 'skip' }
  | { readonly type: 'roles.list' }
  | { readonly type: 'providers.discovered' }
  | { readonly type: 'accounts.candidates'; readonly fresh?: boolean }
  | { readonly type: 'accounts.candidateQuota'; readonly sourcePath: string }
  | { readonly type: 'settings.dispatch' } // → DispatchSettingsView: { global, perRepo, perAccount, mode, suggested?, machine?, status? }
  // The Settings → Entegrasyonlar rows (U-356): manifest data plus the registry's switch state
  // and health — the platform name arrives from the manifest, nothing hard-coded.
  | { readonly type: 'connector.list' } // → readonly ConnectorListView[] (U-356) | not_found | invalid_settings
  | { readonly type: 'providers.marks' }
  | { readonly type: 'run.events'; readonly runId: string }
  | { readonly type: 'permissions.open' }
  | { readonly type: 'app.update' }
  | { readonly type: 'capabilities.candidates' } // no fresh: no cache (A-94)
  | { readonly type: 'capabilities.machine'; readonly providers: readonly string[] } // P-60: on-demand machine scan
  | { readonly type: 'proposals.list'; readonly status?: ProposalStatus } // → readonly ProposalListItem[] (A-128, A-129)
  | { readonly type: 'proposal.detail'; readonly id: string } // → ProposalDetailView | not_found (A-130, A-131)
  | { readonly type: 'pages.list'; readonly workOrder: string } // → readonly PageListItem[] (A-154)
  | { readonly type: 'pages.library'; readonly q?: string; readonly kind?: PageKind; readonly project?: string; readonly workOrder?: string; readonly pinned?: boolean } // → readonly PageLibraryItemView[] (A-202)
  | { readonly type: 'page.detail'; readonly id: string; readonly version?: number } // → PageDetailView | not_found | unknown_version (A-155 … A-157, A-160)
  // The chat read side (6e-5): views from ./chat-views, ids as strings parsed at the edge.
  | { readonly type: 'chat.conversations'; readonly q?: string; readonly scope?: ChatScopeInput; readonly pinned?: boolean; readonly limit?: number; readonly before?: number } // → readonly ChatConversationSummaryView[] (A-251)
  | { readonly type: 'chat.conversation'; readonly id: string } // → ChatConversationView | not_found (A-252)
  | { readonly type: 'chat.references'; readonly q: string; readonly kinds?: readonly ('work_order' | 'page' | 'project' | 'repo')[]; readonly project?: string; readonly limit?: number } // → readonly ChatReferenceView[] (A-253)
  | { readonly type: 'chat.attachment'; readonly conversation: string; readonly id: string } // → ChatAttachmentBytesView | not_found (A-254)
  | { readonly type: 'chat.usage' } // → ChatUsageView (A-255)
  | { readonly type: 'usage.summary'; readonly workOrder?: string; readonly project?: string; readonly sinceMs?: number } // → UsageSummaryView | not_found | bad_input | invalid_id (A-280 … A-283)
  | { readonly type: 'memory.overview' } // → MemoryOverviewView (A-349)
  | { readonly type: 'definitions.list'; readonly kind: 'plugin' | 'mcp' | 'skill' | 'command' | 'hook' } // → readonly DefinitionListItem[] (A-350)
  | { readonly type: 'tracker.linkStatus'; readonly repo: string }
  // The Docket AI setup reads (A-358, A-359): the newest draft for the resume card, the pending
  // read ask of a setup conversation.
  | { readonly type: 'setup.draft' } // → { draft: { id, repoPath, mode, updatedAt } | null } (A-359)
  | { readonly type: 'setup.read.pending'; readonly conversation: string } // → { ask: { path, reason } | null, secrets: number } | not_found (A-358)
  | { readonly type: 'repos.discover'; readonly parent: string } // → { found: DiscoveredRepo[]; truncated: boolean } | not_found | not_a_directory | unreadable (A-382)
  | { readonly type: 'setup.copyProposal'; readonly project: string; readonly source: string; readonly path: string } // → SetupProposal | source_not_in_project | folder_not_found | not_a_git_repo (A-383)
  // The standing of Docket's own MCP listener (A-380): names only — no secret, no token.
  | { readonly type: 'mcp.status' }; // → McpStatusView (A-380)

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
    /** A-401 — the dispatcher's own last wait decision for the item (all 8 reasons of the domain's
     *  `WaitReason`); absent for a running row and for a queued item no tick has considered yet. */
    readonly queuedReason?: WaitReason;
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

export interface RoadmapRepoView {
  readonly milestones: readonly {
    readonly id: string;
    readonly title: string;
    readonly dueAt?: number;
    readonly state: 'open' | 'closed';
    readonly source: { readonly kind: 'local' } | { readonly kind: 'tracker'; readonly tracker: string; readonly externalId: string; readonly url?: string };
  }[];
  readonly issues: readonly {
    readonly id: string;
    readonly title: string;
    readonly body?: string;
    readonly state: 'open' | 'closed';
    readonly milestone?: string;
    readonly labels: readonly string[];
    readonly parent?: string;
    readonly source: { readonly kind: 'local' } | { readonly kind: 'tracker'; readonly tracker: string; readonly externalId: string; readonly url?: string };
  }[];
}

export type RoadmapPhaseItemView =
  | { readonly kind: 'repo_item'; readonly ref: { readonly repo: string; readonly kind: 'milestone' | 'issue'; readonly id: string } }
  | { readonly kind: 'manual'; readonly id: string; readonly title: string; readonly done: boolean };

export interface RoadmapPageView {
  readonly phases: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly progress?: { readonly done: number; readonly total: number };
    /** Repo milestones and issues this phase links to (R-137); read-only on the roadmap page. */
    readonly items?: readonly RoadmapPhaseItemView[];
    /** The ids of the phases that block this one and are not done; empty otherwise (A-127). */
    readonly blockedBy: readonly string[];
    /** Present once the operator started the phase (A-109); `attention` lists work-order ids. */
    readonly autoRun?: { readonly state: string; readonly attention: readonly string[] };
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
  readonly billing: 'pay_per_use' | 'included' | 'mixed' | 'none';
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

// --- connector.list (U-356) --------------------------------------------------------------------------

/** One built-in connector as the Settings → Entegrasyonlar rows see it (U-356): the manifest's
 *  own facts (the platform name is manifest data, never hard-coded), the registry's switch state
 *  and its readiness health. `error` rides only health `invalid` — the manifest law it failed
 *  (R-182) or a probe that threw. `hasSettings` is the one fact the disabled "Hesap ekle"
 *  placeholder row reads (U-357 lands with the first connector that declares fields). */
export interface ConnectorListView {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly provides: readonly PortFamily[];
  /** Remote-host patterns; absent when the manifest declares none (an explicit kind selects then). */
  readonly hostMatch?: readonly string[];
  readonly network: readonly string[];
  readonly requiresCli?: string;
  readonly hasSettings: boolean;
  readonly enabled: boolean;
  readonly health: 'ready' | 'needs_account' | 'needs_cli' | 'invalid';
  readonly error?: string;
}

// --- memory.overview (A-349) -------------------------------------------------------------------------

export interface MemoryOverviewView {
  readonly notes: readonly {
    readonly id: string;
    readonly scope: 'global' | 'project' | 'repo';
    readonly scopeId?: string;
    readonly text: string;
    readonly createdBy: 'user' | 'agent';
    readonly active: boolean;
  }[];
  readonly proposals: readonly {
    readonly id: string;
    readonly scope: 'global' | 'project' | 'repo';
    readonly scopeId?: string;
    readonly text: string;
    readonly sourceRun: string;
    readonly state: 'pending' | 'accepted' | 'rejected';
  }[];
  readonly autoAccept: { readonly global: boolean; readonly project: boolean; readonly repo: boolean };
  readonly truncated: boolean;
}

// --- definitions.list (A-350) ------------------------------------------------------------------------

export interface DefinitionListItem {
  readonly definitionId: string;
  readonly version: number;
  readonly recordedAt: number;
  readonly archived: boolean;
  readonly body: unknown;
  readonly removal: RemovalVerdict;
}

// --- roles.list (A-50) -------------------------------------------------------------------------------

export interface RoleListItem {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly removal: RemovalVerdict;
  readonly pastVersions: readonly {
    readonly version: number;
    readonly recordedAt: number;
    readonly archived: boolean;
  }[];
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

// --- usage.summary (A-280 … A-283) ---------------------------------------------------------------------

/** Folded usage numbers of one work order's or one project's runs: domain aggregates and rule
 *  findings only — never a raw event, transcript or environment value. */
export interface UsageSummaryView {
  readonly summary: UsageSummary;
  readonly findings: readonly WasteFinding[];
  readonly runsWithoutUsage: number;
}

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

// --- capabilities.candidates (A-90 … A-92) -------------------------------------------------------------

export interface CapabilityCandidateView {
  readonly identity: string; // mergeCandidates' canonical form (R-63)
  readonly kind: 'mcp' | 'skill' | 'context';
  readonly name: string;
  readonly sources: readonly string[]; // account ids, sorted, unique — plain strings on the wire
  readonly command?: string; // mcp only
  readonly path?: string; // skill / context; the source file's absolute path
  readonly description?: string; // ≤ 300 code points (CAPABILITY_DESCRIPTION_MAX)
  readonly imported: boolean;
}

export interface CapabilityCandidatesView {
  readonly candidates: readonly CapabilityCandidateView[]; // identity, code-point order
  readonly truncated: boolean; // the scan found more than the cap
}
