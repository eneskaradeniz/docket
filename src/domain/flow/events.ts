// flow/events.ts — exact contract from docs/v2/domain.md section 5.
import type { CheckRunStatus, GateVerdict } from '../gates';
import type { Actor, EnvSlug, EpochMs, FlowSlug, GateSlug, RunId, RunOutcome, StageSlug } from '../shared';

/** R-165: the check list a `remote_checks` verdict was reduced from — names and statuses only,
 *  so the detail can later show what the gate actually saw. No url, no environment value. */
export interface RemoteChecksEvidence {
  readonly checks: readonly { readonly name: string; readonly status: CheckRunStatus }[];
}

/** R-165: at most this many checks ride a `gate_evaluated` event. */
export const REMOTE_CHECKS_EVENT_MAX = 30;

/** R-165: the evidence a writer may attach — the first `REMOTE_CHECKS_EVENT_MAX` checks in forge
 *  order, each reduced to name and status. Inputs are never mutated. */
export const remoteChecksEvidence = (
  checks: readonly { readonly name: string; readonly status: CheckRunStatus }[],
): RemoteChecksEvidence => ({
  checks: checks
    .slice(0, REMOTE_CHECKS_EVENT_MAX)
    .map((check) => ({ name: check.name, status: check.status })),
});

/** The append-only history a work order's state is derived from. Events are facts; derive
 *  walks them in order and assumes they are sorted by `at`. */
export type WorkOrderEvent =
  | { readonly type: 'created'; readonly at: EpochMs; readonly by: Actor; readonly flow: FlowSlug }
  | { readonly type: 'run_started'; readonly at: EpochMs; readonly runId: RunId; readonly stage: StageSlug; readonly attempt: number }
  | { readonly type: 'run_finished'; readonly at: EpochMs; readonly runId: RunId; readonly outcome: RunOutcome }
  | { readonly type: 'gate_evaluated'; readonly at: EpochMs; readonly stage: StageSlug; readonly gate: GateSlug; readonly verdict: GateVerdict;
      /** R-165: recorded only by a `remote_checks` verdict; absent on every older event. */
      readonly remoteChecks?: RemoteChecksEvidence }
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
  | { readonly type: 'closed'; readonly at: EpochMs; readonly by: Actor };
