// api/queries.ts — the read side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts.
export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string }
  | { readonly type: 'workspace.board'; readonly workspace: string }
  | { readonly type: 'cockpit' };

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
