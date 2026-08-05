// Fixture data — the seed for the SQLite store (WO-0009) and the source for core tests.
// The createFixtureSource port impl is gone: the SQLite store (src/adapters/store) is the
// data source now, seeded from these constants.
import { workOrderDocs } from './docs';
import { workOrderById, workOrders } from './work-orders';
import { workspaces } from './workspaces';

// Re-exported so the store seed and core tests share one definition.
export { workOrderDocs, workOrderById, workOrders, workspaces };
