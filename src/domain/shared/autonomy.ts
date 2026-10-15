// shared/autonomy.ts — the autonomy scale and the user-only carve-out (D-10; the domain addendum
// of docs/v2/domain.md). Nothing here decides anything: the levels name who may decide, the
// carve-out names what no policy actor may ever decide.
import { err, ok, type Result } from './result';

export const AUTONOMY_LEVELS = ['manual', 'balanced', 'auto'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** The closed carve-out (D-10 answers 1 and 3): the `deploy` and `page_approval` gate kinds, the
 *  merge action (a forge merge and a local merge alike) and the delete action — no `policy` actor
 *  decides any of them at any level. */
export const USER_ONLY_GATES = ['deploy', 'merge', 'delete', 'page_approval'] as const;
export type UserOnlyGate = (typeof USER_ONLY_GATES)[number];

const isAutonomyLevel = (value: unknown): value is AutonomyLevel =>
  (AUTONOMY_LEVELS as readonly unknown[]).includes(value);

/** The one (de)serialization parse of a stored level: a member answers itself, anything else —
 *  non-strings included — is the typed error, never a silent `manual`. Absence is the caller's
 *  concern: an absent value stays absent and the chain falls on. */
export function parseAutonomyLevel(input: unknown): Result<AutonomyLevel, 'invalid_autonomy_level'> {
  return isAutonomyLevel(input) ? ok(input) : err('invalid_autonomy_level');
}
