// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (fixtures now; SQLite/git in M3).
// src/ui reaches data only through this port; it never imports an adapter.
import type { Workspace, WorkOrder, WorkOrderId } from './types';

export interface WorkOrderSource {
  getWorkspaces(): Workspace[];
  getWorkOrders(): WorkOrder[];
  getWorkOrder(id: WorkOrderId): WorkOrder | undefined;
  getWorkOrderDocs(id: WorkOrderId): { order: string; plan: string };
}
