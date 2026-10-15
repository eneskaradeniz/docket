// definitions/autonomy.ts — the auto-level preconditions (R-169, D-10; the domain addendum of
// docs/v2/domain.md). Pure: the check reads its inputs and answers; callers decide what a refusal
// writes (nothing).
import type { SpendCap } from '../budget';
import { err, ok, type Result } from '../shared';
import type { FlowDef } from './types';

/** Starting or escalating to `auto` requires a spend cap governing the work order and an explicit
 *  onFail (with its maxAttempts) on every stage of the pinned flow; the refusal is typed, never silent. */
export type AutoLevelError = 'auto_requires_spend_cap' | 'auto_requires_max_attempts';

export function checkAutoLevel(input: {
  readonly cap: SpendCap | undefined;
  readonly flow: FlowDef;
}): Result<void, AutoLevelError> {
  if (input.cap === undefined) return err('auto_requires_spend_cap');
  // What `auto` demands is that the bound is written, never implicit: a stage without an onFail
  // would leave an unbounded retry loop no policy actor may steer.
  const unbounded = input.flow.stages.some((stage) => stage.onFail === undefined);
  return unbounded ? err('auto_requires_max_attempts') : ok(undefined);
}
