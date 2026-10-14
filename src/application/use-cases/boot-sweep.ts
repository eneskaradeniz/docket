// use-cases/boot-sweep.ts — the startup sweep that closes runs a previous instance left open
// (A-400 of docs/v2/application.md). An unclean exit (SIGTERM, a crash) skips the managed quit's
// cancel-all, so its run rows keep no `endedAt` and hold dispatcher slots forever; this sweep
// makes the same writes `cancelActiveRuns` makes at quit, one boot earlier — a swept run reads
// as `cancelled` (a continuing outcome, R-18) and the work order is dispatchable again.
import type { Actor, RunId, RunOutcome } from '../../domain/index';

import type { AppDeps, AuditAction, AuditEntry, AuditSubject } from '../ports';
import type { BoardHooks } from '../services/permission-board';
import type { RunControl } from '../services/run-control';
import type { WorkOrdersChangedNotify } from '../services/run-executor';

// The sweep is machine-written, like every other run end the executor writes.
const SWEEP_ACTOR: Actor = { kind: 'system', component: 'boot-sweep' };

type SweepDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'runs' | 'workOrders' | 'runTokens'>;

/** Closes every still-open run record that has no live process in this instance: the record's
 *  `endedAt`/`outcome`, the work order's `run_finished` event, the run token revoked, the board
 *  entry (any open ask of that run) dropped — the writes the quit sweep and the executor's end
 *  path make, so the freed slots and the resumable state need no path of their own. */
export async function sweepOrphanedRuns(
  deps: SweepDeps,
  liveRuns: Pick<RunControl, 'active'>,
  board?: BoardHooks,
  workOrdersChanged?: WorkOrdersChangedNotify,
): Promise<readonly RunId[]> {
  const live = new Set(liveRuns.active());
  const closed: RunId[] = [];
  for (const run of await deps.runs.listActive()) {
    // A run this instance started is the executor's to end; the sweep never races it.
    if (live.has(run.id)) continue;
    const endedAt = deps.clock.now();
    await deps.runs.update(run.id, { endedAt, outcome: 'cancelled' satisfies RunOutcome });
    await deps.workOrders.appendEvent(run.workOrderId, {
      type: 'run_finished',
      at: endedAt,
      runId: run.id,
      outcome: 'cancelled',
    });
    deps.runTokens.revoke(run.id);
    board?.unregister(run.id);
    const entry: AuditEntry = {
      id: deps.ids.next<'audit'>(),
      at: endedAt,
      actor: SWEEP_ACTOR,
      action: 'run.finished' satisfies AuditAction,
      subject: { kind: 'run', id: run.id } satisfies AuditSubject,
      detail: { outcome: 'cancelled', reason: 'startup_sweep' },
    };
    await deps.log.append(entry);
    closed.push(run.id);
  }
  // After the last append: a store re-querying at delivery time already sees every closure.
  if (closed.length > 0) workOrdersChanged?.();
  return closed;
}
