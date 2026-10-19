// autonomy/decide.ts — decidePermission, the axis-1 permission policy (D-10; the domain addendum
// of docs/v2/domain.md): who may answer a tool ask. The carve-out asks the human at every level
// before the risk table is consulted (R-168); no level below auto auto-answers, save the one
// publish row R-191 opens to `balanced`; auto allows exactly the asks the risk-rule table rates
// low, and the allow names the deciding policy. Pure —
// a decision is made under the level it is given and never rewritten (R-170: the executor
// re-resolves the chain per ask).
import type { AutonomyLevel, PolicyId, UserOnlyGate } from '../shared';
import { USER_ONLY_GATES } from '../shared';

import { classifyRisk, type RiskAsk, type RiskContext, type RiskRuleId } from './risk';

const asPolicyId = (id: string): PolicyId => id as PolicyId;

/** The named rule set behind every policy allow: the risk-rule table of this module. */
export const PERMISSION_RULES_POLICY: PolicyId = asPolicyId('permission-rules');

/** The named rule set behind the write-scope guard's denials (R-159): the rule set the audit's
 *  policy actor names when the executor refuses a write certainly outside the role's scope. */
export const WRITE_SCOPE_POLICY: PolicyId = asPolicyId('write-scope');

export type PermissionDecision =
  | { readonly kind: 'allow-by-policy'; readonly policy: PolicyId; readonly level: AutonomyLevel }
  | { readonly kind: 'deny-by-policy'; readonly policy: PolicyId; readonly level: AutonomyLevel; readonly rule: RiskRuleId }
  | { readonly kind: 'ask-human' };

const ASK_HUMAN: PermissionDecision = { kind: 'ask-human' };

/** The one row `balanced` may answer too (R-191): the run's own page publish pair, where the
 *  level's "deterministic rules only" promise holds by name alone — publishing a page is not
 *  approving it, and the approval itself stays R-168's carve-out. */
const BALANCED_RULES: readonly RiskRuleId[] = ['allow-own-pages'];

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
  // A deny row is level-independent and never reaches a human: it is consulted before the level.
  const verdict = classifyRisk(input.ask, input.context);
  if (verdict.verdict === 'deny') {
    return { kind: 'deny-by-policy', policy: PERMISSION_RULES_POLICY, level: input.level, rule: verdict.rule };
  }
  // `balanced` reaches here only as defense in depth — R-157, clause 2, resolves it to `manual`
  // before it can arrive — and R-191 opens exactly one row to it. Every other low row keeps the
  // auto-only gate.
  const levelLicenses =
    input.level === 'auto' ||
    (input.level === 'balanced' && verdict.verdict === 'low' && BALANCED_RULES.includes(verdict.rule));
  if (!levelLicenses) return ASK_HUMAN;
  return verdict.verdict === 'low'
    ? { kind: 'allow-by-policy', policy: PERMISSION_RULES_POLICY, level: input.level }
    : ASK_HUMAN;
}
