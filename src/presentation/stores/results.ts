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
 * human-gate and proposal decision errors, definitions_invalid from the board/detail reads, and
 * the deploy-gate errors (deploy-gate.ts; confirmation_mismatch is also the detail store's
 * E-8 refusal code for a blocked approve intent).
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
  'not_a_changes_gate',
  'agent_cannot_decide',
  'stale',
  'self_approval',
  'invalid_after',
  'binding_exists',
  // The spend-consent commands' refusals (application use-cases/spend-consent.ts).
  'invalid_model',
  'invalid_cap',
  // A-45: a reserve share outside 0..0.95.
  'invalid_reserve',
  // A-52: the last cap cannot go while a spend consent stands.
  'cap_required',
  'not_a_deploy_gate',
  'no_approval',
  'confirmation_mismatch',
  'promote_prerequisite_missing',
  'unknown_environment',
  'no_repo',
  // project.attach refusals (AttachError).
  'not_a_repo',
  'no_project_yaml',
  'repo_not_in_project',
  // project.create refusals (A-75 … A-77).
  'invalid_name',
  'not_a_folder',
  'folder_exists',
  'docket_folder_exists',
  'io_failed',
  'project_exists',
  // The phase commands' refusals (A-97, A-110).
  'unknown_project',
  'no_roadmap',
  'unknown_phase',
  'phase_not_runnable',
  'not_running',
  'not_paused',
  // saveBinding: a role's account chain cannot be empty (A-14).
  'empty_chain',
  // settings.setDispatch refusals (A-105 … A-107).
  'invalid_limits',
  'unknown_account',
  // The page commands' refusals (A-158): the codes the gate commands do not share.
  'empty_comment',
  'comment_too_long',
  'unknown_version',
  'stale_version',
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
  'task.open': 'success.task.open',
  // The roadmap page words its phase toasts itself (stores/roadmap.ts); these are the plain copy.
  // (The run copy carries a {phase} placeholder only the page fills, so it keeps the plain line.)
  'roadmap.runPhase': 'success.task.open',
  'roadmap.pausePhase': 'roadmap.toast.paused',
  'roadmap.resumePhase': 'roadmap.toast.resumed',
  'project.attach': 'success.project.attach',
  'project.create': 'newProject.created',
  'repo.register': 'success.repo.register',
  'repo.unregister': 'success.repo.unregister',
  'gate.decide': 'success.gate.decide',
  'gate.attest': 'success.gate.attestNoChange',
  'proposal.decide': 'success.proposal.decide',
  'permission.answer': 'success.permission.answer',
  'deploy.approve': 'success.deploy.approve',
  'account.save': 'success.account.save',
  'account.adopt': 'success.account.adopt',
  'account.remove': 'success.account.remove',
  // A cap write is an account edit: it reads back as the account being saved.
  'account.cap.save': 'success.account.save',
  'account.cap.remove': 'success.account.save',
  'account.test': 'success.account.test',
  'account.consent.grant': 'success.account.consent.grant',
  'account.consent.revoke': 'success.account.consent.revoke',
  'binding.save': 'success.binding.save',
  'settings.setDispatch': 'success.settings.setDispatch',
  // No surface issues a refresh yet; it is a read, so it borrows the neutral account copy.
  'quota.refresh': 'success.account.save',
  // The import surface is part 3; the per-identity outcomes ride `results`, the toast is neutral.
  'capabilities.import': 'success.capabilities.import',
  // `page.decide` reads as the approval; the page screen picks the other two lines itself
  // (pageDecideKey) because only it knows the decision and the gate it saw.
  'page.comment': 'page.toast.commented',
  'page.requestApproval': 'page.toast.requested',
  'page.decide': 'page.toast.approved',
  'page.pin': 'editor.saved',
  // The chat commands' own copy lands with the chat UI slice (6e-6), which words its surface
  // itself; until then every chat success borrows the neutral saved line, like quota.refresh.
  'chat.start': 'editor.saved',
  'chat.send': 'editor.saved',
  'chat.cancel': 'editor.saved',
  'chat.pin': 'editor.saved',
  'chat.delete': 'editor.saved',
  'chat.attach': 'editor.saved',
  'chat.draft.confirm': 'editor.saved',
  'chat.draft.drop': 'editor.saved',
  'chat.action.decide': 'editor.saved',
  'chat.action.undo': 'editor.saved',
  'chat.grant': 'editor.saved',
  'chat.revoke': 'editor.saved',
  'app.update.check': 'success.app.update.check',
  'app.update.apply': 'success.app.update.apply',
};

export const failureKey = (code: string): LabelKey => FAILURE_KEYS[code] ?? GENERIC_FAILURE_KEY;

/** Codes the gate commands also return, worded for a page: "the gate is not pending" would be the
 *  wrong sentence under a page. */
const PAGE_FAILURE_KEYS: Readonly<Record<string, LabelKey>> = {
  not_found: 'page.error.not_found',
  not_pending: 'page.error.not_pending',
  self_approval: 'page.error.self_approval',
  too_many_pinned: 'page.error.too_many_pinned',
};

/** The page screen's failure sentence for a code. */
export const pageFailureKey = (code: string): LabelKey => PAGE_FAILURE_KEYS[code] ?? failureKey(code);

/** The toast after a page decision the API confirmed: a rejection never claims the work order
 *  moved; an approval says so only when the page's work order waited on that gate. */
export const pageDecideKey = (decision: 'approved' | 'rejected', gatePending: boolean): LabelKey =>
  decision === 'rejected' ? 'page.toast.rejected' : gatePending ? 'page.toast.approvedAdvanced' : 'page.toast.approved';

export const queryFailureKey = (failure: QueryFailure): LabelKey => failureKey(failure.code);

export const commandResultKey = (command: Command['type'], result: CommandResult): LabelKey =>
  result.ok ? SUCCESS_KEYS[command] : command.startsWith('page.') ? pageFailureKey(result.code) : failureKey(result.code);

/** Narrow a raw query reply (queries resolve to `unknown` at the boundary) to its failure shape. */
export const isQueryFailure = (value: unknown): value is QueryFailure => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value) || value.ok !== false) return false;
  return 'code' in value && typeof value.code === 'string';
};
