// labels/keys.ts — the closed set of user-visible copy keys (U-1). Every string a component or
// store renders goes through one of these keys; a literal user-visible string outside a bundle is
// a defect (codes, ids and slugs excluded). Initial key set: every failure code the current api
// can return (docs/v2/application.md § 4), the generic failure key, the attention kinds, and one
// success confirmation per command.
export const LABEL_KEYS = [
  // Failure codes — commands and queries report failure the same way (api/api.ts).
  'error.invalid_id',
  'error.definitions_invalid',
  'error.unknown_flow',
  'error.flow_not_enabled',
  'error.unknown_task',
  'error.empty_title',
  'error.not_found',
  'error.already_done',
  'error.not_blocked',
  'error.not_ready',
  'error.unknown_role',
  'error.no_binding',
  'error.no_account',
  'error.not_current_stage',
  'error.not_pending',
  'error.not_a_human_gate',
  'error.agent_cannot_decide',
  'error.stale',
  'error.self_approval',
  'error.invalid_after',
  // Deploy-gate errors (application deploy-gate.ts; confirmation_mismatch also reports the
  // detail store's E-8 refusal, U-4).
  'error.not_a_deploy_gate',
  'error.no_approval',
  'error.confirmation_mismatch',
  'error.promote_prerequisite_missing',
  'error.unknown_environment',
  'error.no_repo',
  // Generic failure for an unknown code (U-8).
  'error.unknown',
  // Attention kinds (api/queries.ts AttentionItem).
  'attention.permission_ask',
  'attention.awaiting_human',
  'attention.limit_waiting',
  'attention.blocked',
  // Store-side create-intent validation reasons (U-3, stores/board.ts).
  'validate.title_required',
  'validate.flow_required',
  // Gate states on the work-order detail (U-4, stores/work-order-detail.ts).
  'gate.state.pending',
  'gate.state.passed',
  'gate.state.upcoming',
  // Deploy-gate copy (U-4): protection marker and the read-only promotion chain (E-5).
  'gate.deploy.protected',
  'gate.deploy.prerequisite',
  // Success confirmations, one per command type (U-8).
  'success.workOrder.open',
  'success.workOrder.block',
  'success.workOrder.unblock',
  'success.workOrder.close',
  'success.workOrder.enqueue',
  'success.gate.decide',
  'success.proposal.decide',
  'success.permission.answer',
  'success.deploy.approve',
] as const;

export type LabelKey = (typeof LABEL_KEYS)[number];

export type LabelBundle = Readonly<Record<LabelKey, string>>;
