// Fixture adapter — implements the WorkOrderSource port declared in core (ADR-0006).
// This is the only module the composition root imports; ui never imports it.
import type { WorkOrderSource } from '../../core/source';
import { workOrderDocs } from './docs';
import { workOrderById, workOrders } from './work-orders';
import { workspaces } from './workspaces';

export function createFixtureSource(): WorkOrderSource {
  return {
    getWorkspaces: () => workspaces,
    getWorkOrders: () => workOrders,
    getWorkOrder: (id) => workOrderById.get(id),
    getWorkOrderDocs: (id) => workOrderDocs[id] ?? { order: '', plan: '' },
  };
}

// Re-exported so core tests (AC9 relaxed) and the composition root share one definition.
export { workOrderDocs, workOrderById, workOrders, workspaces };
