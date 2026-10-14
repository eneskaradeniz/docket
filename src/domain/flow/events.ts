// flow/events.ts — exact contract from docs/v2/domain.md section 5.
import type { GateVerdict } from '../gates';
import type { Actor, EnvSlug, EpochMs, FlowSlug, GateSlug, RunId, RunOutcome, StageSlug } from '../shared';

/** The append-only history a work order's state is derived from. Events are facts; derive
 *  walks them in order and assumes they are sorted by `at`. */
export type WorkOrderEvent =
  | { readonly type: 'created'; readonly at: EpochMs; readonly by: Actor; readonly flow: FlowSlug }
  | { readonly type: 'run_started'; readonly at: EpochMs; readonly runId: RunId; readonly stage: StageSlug; readonly attempt: number }
  | { readonly type: 'run_finished'; readonly at: EpochMs; readonly runId: RunId; readonly outcome: RunOutcome }
  | { readonly type: 'gate_evaluated'; readonly at: EpochMs; readonly stage: StageSlug; readonly gate: GateSlug; readonly verdict: GateVerdict }
  | { readonly type: 'blocked'; readonly at: EpochMs; readonly by: Actor; readonly reason: string }
  | { readonly type: 'unblocked'; readonly at: EpochMs; readonly by: Actor }
  | { readonly type: 'deployment_attempted'; readonly at: EpochMs;
      readonly stage: StageSlug; readonly gate: GateSlug;
      readonly environment: EnvSlug; readonly commit: string;
      readonly approvedBy: Actor;
      readonly result: 'success' | 'failed';
      readonly outputTail?: string }
  | { readonly type: 'stage_skip_proposed'; readonly at: EpochMs; readonly stages: readonly StageSlug[]; readonly reason: string }
  | { readonly type: 'stage_skip_decided'; readonly at: EpochMs; readonly approved: boolean }
  // The git lifecycle pair the operator's actions append (R-160 … R-164). They never move the
  // machine fold; deriveGitLifecycle walks them beside it.
  | { readonly type: 'branch_pushed'; readonly at: EpochMs; readonly branch: string; readonly head: string }
  | { readonly type: 'pr_opened'; readonly at: EpochMs; readonly number: number; readonly url: string; readonly head: string; readonly base: string }
  | { readonly type: 'pr_merged'; readonly at: EpochMs; readonly number: number }
  | { readonly type: 'branch_released'; readonly at: EpochMs }
  | { readonly type: 'closed'; readonly at: EpochMs; readonly by: Actor };
