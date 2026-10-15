import type { AutonomyLevel } from './autonomy';
import type { PolicyId, RoleSlug, RunId } from './ids';

export type Actor =
  | { readonly kind: 'user'; readonly id: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly runId: RunId; readonly role: RoleSlug }
  | { readonly kind: 'system'; readonly component: string }
  // The autonomy arm (D-10): a named rule set that decided on the user's behalf under a resolved
  // level. The policy id names the deciding rule set, the level is the one in force when it
  // decided — nothing else about the actor is free-form.
  | { readonly kind: 'policy'; readonly policy: PolicyId; readonly level: AutonomyLevel };
