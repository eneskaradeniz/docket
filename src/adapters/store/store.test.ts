import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './index';
import { OBSERVED_TABLES } from './schema';
import { woid } from '../ids';
import { workOrderDocs, workOrders, workspaces } from '../fixtures';

const dbPath = join(tmpdir(), `docket-store-${Date.now()}.db`);
const freshDbs: string[] = [];
let freshCounter = 0;
const freshDb = (): string => {
  const p = join(tmpdir(), `docket-store-c${process.pid}-${freshCounter++}.db`);
  freshDbs.push(p);
  return p;
};
afterAll(() => {
  if (existsSync(dbPath)) rmSync(dbPath);
  for (const p of freshDbs) if (existsSync(p)) rmSync(p);
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

describe('SQLite store — seeding respects the observed | owned split (verifier block B)', () => {
  it('C1: a partially-seeded observed half (workspace populated, work_order empty) re-opens without crashing', () => {
    const p = freshDb();
    createStore(p); // seeds both halves
    // Simulate a crash mid-seed: work_order empty, workspace still populated.
    createStore(p).db.exec('DELETE FROM work_order');
    // Re-open: observedEmpty (work_order 0) → seedObserved clears observed and reseeds.
    // Before the fix this raised UNIQUE constraint failed: workspace.id.
    const store = createStore(p);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(workspaces.length);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM work_order').get() as { n: number }).n).toBe(workOrders.length);
  });

  it('C2: observed empty, owned populated — re-open rebuilds observed without duplicating owned', async () => {
    const p = freshDb();
    const store0 = createStore(p); // seeds both halves
    // Record an owned decision, then drop observed, leaving owned populated.
    store0.db
      .prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
    const ownedBefore = (store0.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    for (const t of OBSERVED_TABLES) store0.db.exec(`DELETE FROM ${t}`);

    // Re-open: observed empty → seedObserved; owned populated → seedOwned NOT called.
    const store = createStore(p);
    const ownedAfter = (store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    expect(ownedAfter).toBe(ownedBefore); // no duplicated owned rows
    expect((await store.getWorkOrders()).length).toBe(workOrders.length); // observed rebuilt
  });
});
