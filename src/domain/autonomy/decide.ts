// autonomy/decide.ts — decidePermission, the axis-1 permission policy (D-10; the domain addendum
// of docs/v2/domain.md): who may answer a tool ask. The carve-out asks the human at every level
// before the risk table is consulted (R-168); no level below auto auto-answers; auto allows
// exactly the asks the risk-rule table rates low, and the allow names the deciding policy. Pure —
// a decision is made under the level it is given and never rewritten (R-170: the executor
// re-resolves the chain per ask).
import type { AutonomyLevel, PolicyId, UserOnlyGate } from '../shared';
import { USER_ONLY_GATES } from '../shared';

import { classifyRisk, type RiskAsk, type RiskContext } from './risk';

const asPolicyId = (id: string): PolicyId => id as PolicyId;

/** The named rule set behind every policy allow: the risk-rule table of this module. */
export const PERMISSION_RULES_POLICY: PolicyId = asPolicyId('permission-rules');

export type PermissionDecision =
  | { readonly kind: 'allow-by-policy'; readonly policy: PolicyId; readonly level: AutonomyLevel }
  | { readonly kind: 'ask-human' };

const ASK_HUMAN: PermissionDecision = { kind: 'ask-human' };

export function decidePermission(input: {
  readonly level: AutonomyLevel;
  readonly ask: RiskAsk;
  readonly context: RiskContext;
  readonly action?: UserOnlyGate;
}): PermissionDecision {
  // R-168: the carve-out asks the human at every level, before the table is consulted — the check
  // reads the named constant, never a copy of the list.
  if (input.action !== undefined && (USER_ONLY_GATES as readonly string[]).includes(input.action)) {
    return ASK_HUMAN;
  }
  // `balanced` reaches here only as defense in depth — R-167 resolves it to `manual` before it
  // can arrive; no level below auto may auto-allow.
  if (input.level !== 'auto') return ASK_HUMAN;
  const verdict = classifyRisk(input.ask, input.context);
  return verdict.verdict === 'low'
    ? { kind: 'allow-by-policy', policy: PERMISSION_RULES_POLICY, level: input.level }
    : ASK_HUMAN;
}
