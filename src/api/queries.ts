// api/queries.ts — the read side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts.
import type { ModelMatcher } from '../domain/index';

export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string }
  | { readonly type: 'workspace.board'; readonly workspace: string }
  | { readonly type: 'workspaces.list' }
  | { readonly type: 'cockpit' }
  | { readonly type: 'settings.accounts' }
  | { readonly type: 'providers.discovered' };

export interface AttentionItem {
  readonly workOrderId: string;
  readonly workspace: string;
  readonly title: string;
  readonly kind: 'awaiting_human' | 'permission_ask' | 'limit_waiting' | 'blocked';
  readonly stage: string | null;
  readonly since: number;
}

export interface CockpitView {
  readonly attention: readonly AttentionItem[];
  readonly running: readonly {
    readonly workOrderId: string;
    readonly stage: string;
    readonly accountId: string;
    readonly startedAt: number;
  }[];
}

export interface BoardColumn {
  readonly stage: string;
  readonly name: string;
  readonly workOrders: readonly { readonly id: string; readonly title: string; readonly status: string }[];
}

export interface BoardView {
  readonly workspace: string;
  readonly flow: string;
  readonly columns: readonly BoardColumn[];
  readonly done: readonly { readonly id: string; readonly title: string }[];
}

// --- workspaces.list --------------------------------------------------------------------------------

/** A workspace this machine knows: the registry's row with the slug as a plain string id. `path`
 *  is the checkout root the registry holds — the fact that makes the row machine-local rather than
 *  merely a workspace some work order once named. */
export interface WorkspaceListItem {
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
  | { readonly level: 'workspace'; readonly workspace: string }
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
