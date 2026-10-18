// services/verdict-holder.ts — where a run's agent verdict waits (docs/v2/application.md A-420,
// A-421). The reviewer calls `submit_verdict` while its run is live, and the work-order fold
// ignores a `gate_evaluated` event until the stage is `gating`; the run's own `run_finished` then
// re-pends every gate of the stage. So the tool only holds the verdict here, and the run executor
// delivers it right after it appended `run_finished(succeeded)`. Memory only, like the run token
// the verdict arrived under: a held verdict never outlives its run or the app.
import type { Actor, GateSlug, RoleSlug, RunId, WorkOrderId } from '../../domain/index';

import type { AppDeps } from '../ports';
import { submitAgentVerdict } from '../use-cases/gates';

export const VERDICT_SUMMARY_MAX_CHARS = 2000;

export interface HeldVerdict {
  readonly gate: GateSlug;
  readonly approve: boolean;
  readonly summary: string;
  readonly pointers: readonly string[];
}

/** One slot per run. */
export interface VerdictHolder {
  /** False, and nothing stored, when the run already holds a verdict. */
  hold(run: RunId, verdict: HeldVerdict): boolean;
  has(run: RunId): boolean;
  /** Removes and returns the run's verdict. */
  take(run: RunId): HeldVerdict | undefined;
  /** A run that ends any way but `succeeded` drops what it held; an empty slot is not an error. */
  drop(run: RunId): void;
}

export const createVerdictHolder = (): VerdictHolder => {
  const held = new Map<RunId, HeldVerdict>();
  return {
    hold: (run, verdict) => {
      if (held.has(run)) return false;
      held.set(run, verdict);
      return true;
    },
    has: (run) => held.has(run),
    take: (run) => {
      const verdict = held.get(run);
      held.delete(run);
      return verdict;
    },
    drop: (run) => {
      held.delete(run);
    },
  };
};

type DeliveryDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'worktrees' | 'evidence'>;

/** Hands the run's held verdict to `submitAgentVerdict` as the run's own agent and audits the
 *  summary; a delivery the gate no longer accepts is audited as undelivered. Never throws: the
 *  run's result stands whatever happens here. */
export async function deliverHeldVerdict(
  deps: DeliveryDeps,
  holder: VerdictHolder,
  input: { readonly runId: RunId; readonly workOrderId: WorkOrderId; readonly role: RoleSlug },
): Promise<void> {
  const held = holder.take(input.runId);
  if (held === undefined) return;
  const verdict = held.approve ? 'approve' : 'reject';
  const actor: Actor = { kind: 'agent', runId: input.runId, role: input.role };
  const subject = { kind: 'work_order', id: input.workOrderId } as const;
  try {
    const result = await submitAgentVerdict(deps, {
      id: input.workOrderId,
      gate: held.gate,
      approve: held.approve,
      pointers: held.pointers,
      actor,
    });
    if (!result.ok) {
      await deps.log.append({
        id: deps.ids.next<'audit'>(),
        at: deps.clock.now(),
        actor,
        action: 'gate.verdict_undelivered',
        subject,
        detail: { gate: held.gate, verdict, reason: result.error },
      });
      return;
    }
    await deps.log.append({
      id: deps.ids.next<'audit'>(),
      at: deps.clock.now(),
      actor,
      action: 'gate.verdict_summary',
      subject,
      detail: { gate: held.gate, verdict, summary: held.summary },
    });
  } catch {
    // The audit write may be what failed; nothing more can be recorded, and the run is unaffected.
  }
}
