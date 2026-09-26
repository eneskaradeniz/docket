// flow/events.ts — exact contract from docs/v2/domain.md section 5.
import type { GateVerdict } from '../gates';
import type { Actor, EpochMs, FlowSlug, GateSlug, RunId, RunOutcome, StageSlug } from '../shared';

/** The append-only history a work order's state is derived from. Events are facts; derive
 *  walks them in order and assumes they are sorted by `at`. */
export type WorkOrderEvent =
  | { readonly type: 'created'; readonly at: EpochMs; readonly by: Actor; readonly flow: FlowSlug }
  | { readonly type: 'run_started'; readonly at: EpochMs; readonly runId: RunId; readonly stage: StageSlug; readonly attempt: number }
  | { readonly type: 'run_finished'; readonly at: EpochMs; readonly runId: RunId; readonly outcome: RunOutcome }
  | { readonly type: 'gate_evaluated'; readonly at: EpochMs; readonly stage: StageSlug; readonly gate: GateSlug; readonly verdict: GateVerdict }
  | { readonly type: 'blocked'; readonly at: EpochMs; readonly by: Actor; readonly reason: string }
  | { readonly type: 'unblocked'; readonly at: EpochMs; readonly by: Actor }
  | { readonly type: 'closed'; readonly at: EpochMs; readonly by: Actor };
