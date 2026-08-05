import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './index';
import { woid } from '../ids';
import { workOrderDocs, workOrders, workspaces } from '../fixtures';

const dbPath = join(tmpdir(), `docket-store-${Date.now()}.db`);
afterAll(() => {
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SQLite store — seed + hydration', () => {
  it('seeds workspaces and work orders from fixtures', async () => {
    const store = createStore(dbPath);
    expect((await store.getWorkspaces()).length).toBe(workspaces.length);
    expect((await store.getWorkOrders()).length).toBe(workOrders.length);
  });

  it('hydrates a work order with DERIVED stage, tracks, sessions, sources', async () => {
    const store = createStore(dbPath);
    const wo = await store.getWorkOrder(woid('WO-1001'));
    expect(wo).toBeDefined();
    expect(wo!.stage).toBe('implementation'); // derived (deriveStage), not a stored column
    expect(wo!.tracks).toHaveLength(1);
    expect(wo!.sessions.some((s) => s.status === 'stopped_asking')).toBe(true);
  });

  it('serves document text from fixtures (never stored)', async () => {
    const store = createStore(dbPath);
    const docs = await store.getWorkOrderDocs(woid('WO-1001'));
    expect(docs.order).toBe(workOrderDocs[woid('WO-1001')].order);
  });
});

describe('SQLite store — reseed loses no decision, only time (ADR-0010)', () => {
  it('dropping every observed table + re-seeding preserves owned rows', async () => {
    const store = createStore(dbPath);
    // An owned decision: an extra session recorded for WO-1001 (a verifier session).
    store.db
      .prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);

    store.reseedObserved(); // drops + rebuilds every observed table; owned untouched

    const wo = await store.getWorkOrder(woid('WO-1001'));
    // Observed was rebuilt: the work order and its track are back, stage re-derived.
    expect(wo).toBeDefined();
    expect(wo!.title).toBe('Token refresh on resume');
    expect(wo!.tracks).toHaveLength(1);
    expect(wo!.stage).toBe('implementation');
    // Owned survived: the seeded implementer session AND the extra verifier session.
    expect(wo!.sessions.filter((s) => s.role === 'implementer')).toHaveLength(1);
    expect(wo!.sessions.filter((s) => s.role === 'verifier')).toHaveLength(1);
  });
});
