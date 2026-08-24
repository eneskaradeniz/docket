// Fixture data — workspaces seed the store's reseed helper (WO-0009); the work-order constants
// are the contract data for core tests (derive.test.ts reads them directly).
import { workOrderById, workOrders } from './work-orders';
import { workspaces } from './workspaces';

// Re-exported so the store seed and core tests share one definition.
export { workOrderById, workOrders, workspaces };
