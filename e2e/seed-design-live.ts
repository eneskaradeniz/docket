// seed-design-live.ts — the second half of the design seed: the running orders' live runs,
// written AFTER the launched app has booted. The boot sweep (A-400) closes every open run
// record a fresh instance cannot own, so a run row written before launch (the seed's old shape)
// is cancelled before the first screen renders — the detail walk loses its live pane and the
// cockpit's rows shift. The harness therefore boots the app on the sweep-clean world, then runs
// this writer: the run rows, their live streams and the run_started events land after the sweep
// has passed, restoring exactly the standing the audits walk.
//
// Run with `npx tsx e2e/seed-design-live.ts <dataDir>` and the payload JSON on stdin — the
// seed manifest's `liveRuns`. Prints `LIVE=ok` once every write is in and every addressed order
// derives `running` again; any mismatch throws, so a half-seeded world never reaches a walk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import assert from 'node:assert';

import type { AgentEvent, RepoSlug, RunId, StageSlug, WorkOrderId } from '../src/domain/index';
import { deriveWorkOrderState } from '../src/domain/index';
import { openDatabase } from '../src/infrastructure/storage/sqlite/database';
import { createYamlDefinitionStore } from '../src/infrastructure/storage/definitions-yaml/index';
import { createSqliteRunRepo } from '../src/infrastructure/storage/sqlite/run-repo';
import { createSqliteWorkOrderRepo } from '../src/infrastructure/storage/sqlite/work-order-repo';

interface LiveWrite {
  readonly workOrderId: string;
  readonly repo: string;
  readonly flowId: string;
  readonly run: {
    readonly id: string;
    readonly workOrderId: string;
    readonly stage: StageSlug;
    readonly attempt: number;
    readonly role: string;
    readonly route: { readonly accountId: string };
    readonly startedAt: number;
    readonly autoResumesUsed: number;
  };
  readonly events: readonly AgentEvent[];
  readonly startEvent: { readonly type: 'run_started'; readonly at: number; readonly runId: string; readonly stage: StageSlug; readonly attempt: number };
}

const [dataDir] = process.argv.slice(2);
if (dataDir === undefined) throw new Error('usage: npx tsx e2e/seed-design-live.ts <dataDir> — payload JSON on stdin');
const payload = JSON.parse(readFileSync(0, 'utf8')) as readonly LiveWrite[];
assert.ok(payload.length > 0, 'the payload carries no live run');

const opened = openDatabase(join(dataDir, 'docket.db'));
if (!opened.ok) throw new Error(`the data dir did not open: ${opened.error.code}`);
const db = opened.value;
try {
  const runs = createSqliteRunRepo(db);
  const workOrders = createSqliteWorkOrderRepo(db);
  const definitions = createYamlDefinitionStore({ globalRoot: dataDir });
  // Idempotence: refuse an order that already stands open — a double apply would double its
  // stream. Other open runs (the live ask's run, once the dispatcher started it) are none of
  // this writer's business.
  const alreadyOpen = new Set((await runs.listActive()).map((run) => run.workOrderId));
  for (const write of payload) {
    assert.ok(!alreadyOpen.has(write.workOrderId), `${write.workOrderId} already stands open; the live seed may not run twice`);
  }
  for (const write of payload) {
    // The payload rides the manifest as plain JSON; the ids are the branded ones the seed minted.
    await runs.create({ ...write.run, id: write.run.id as RunId, workOrderId: write.workOrderId as WorkOrderId });
    await runs.appendEvents(write.run.id as RunId, write.events);
    await workOrders.appendEvent(write.workOrderId as WorkOrderId, write.startEvent);
  }
  // The same self-check the seed runs over its world, now over the restored one: every
  // addressed order derives `running` at its stage, and exactly one open run stands for it.
  for (const write of payload) {
    const loaded = await definitions.load(write.repo as RepoSlug);
    assert.ok(loaded.ok, `${write.workOrderId}: definitions did not load`);
    const flow = loaded.value.flows.find((candidate) => candidate.id === write.flowId);
    assert.ok(flow !== undefined, `${write.workOrderId}: the standard flow is missing`);
    const state = deriveWorkOrderState(flow, await workOrders.events(write.workOrderId as WorkOrderId));
    assert.equal(state.status, 'running', `${write.workOrderId} must derive running once its live run is in`);
    assert.equal(state.stage, write.run.stage, `${write.workOrderId} stage`);
    const mine = (await runs.listActive()).filter((run) => run.workOrderId === write.workOrderId);
    assert.equal(mine.length, 1, `${write.workOrderId} must stand on exactly one open run`);
  }
} finally {
  db.close();
}
console.log('LIVE=ok');
