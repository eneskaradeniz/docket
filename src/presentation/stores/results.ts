// stores/results.ts — the CommandResult → copy mapping (U-8): every failure code the UI can
// receive has a label key, an unknown code falls back to the generic failure key (never a raw or
// empty string reaches the user), and a success maps to the command's confirmation key.
import type { Command, CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';

/** Queries report failure exactly the way commands do (api/api.ts). */
export type QueryFailure = Extract<CommandResult, { readonly ok: false }>;

export const GENERIC_FAILURE_KEY: LabelKey = 'error.unknown';

/**
 * Every failure code the current api can return, per docs/v2/application.md § 4:
 * invalid_id from the boundary parse (A-21); the work-order open/control/enqueue errors, the
 * human-gate and proposal decision errors, and definitions_invalid from the board/detail reads.
 */
export const KNOWN_FAILURE_CODES: readonly string[] = [
  'invalid_id',
  'definitions_invalid',
  'unknown_flow',
  'flow_not_enabled',
  'unknown_task',
  'empty_title',
  'not_found',
  'already_done',
  'not_blocked',
  'not_ready',
  'unknown_role',
  'no_binding',
  'no_account',
  'not_current_stage',
  'not_pending',
  'not_a_human_gate',
  'agent_cannot_decide',
  'stale',
  'self_approval',
  'invalid_after',
];

const FAILURE_KEYS: Readonly<Record<string, LabelKey>> = Object.fromEntries(
  KNOWN_FAILURE_CODES.map((code) => [code, `error.${code}` as LabelKey]),
);

/** Success copy is per command: the store knows which command it issued alongside the result. */
const SUCCESS_KEYS: Readonly<Record<Command['type'], LabelKey>> = {
  'workOrder.open': 'success.workOrder.open',
  'workOrder.block': 'success.workOrder.block',
  'workOrder.unblock': 'success.workOrder.unblock',
  'workOrder.close': 'success.workOrder.close',
  'workOrder.enqueue': 'success.workOrder.enqueue',
  'gate.decide': 'success.gate.decide',
  'proposal.decide': 'success.proposal.decide',
  'permission.answer': 'success.permission.answer',
  'deploy.approve': 'success.deploy.approve',
};

export const failureKey = (code: string): LabelKey => FAILURE_KEYS[code] ?? GENERIC_FAILURE_KEY;

export const queryFailureKey = (failure: QueryFailure): LabelKey => failureKey(failure.code);

export const commandResultKey = (command: Command['type'], result: CommandResult): LabelKey =>
  result.ok ? SUCCESS_KEYS[command] : failureKey(result.code);

/** Narrow a raw query reply (queries resolve to `unknown` at the boundary) to its failure shape. */
export const isQueryFailure = (value: unknown): value is QueryFailure => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value) || value.ok !== false) return false;
  return 'code' in value && typeof value.code === 'string';
};
