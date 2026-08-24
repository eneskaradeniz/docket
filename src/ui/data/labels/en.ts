// src/ui/data/labels/en.ts — the ENGLISH bundle (WO-0035): a complete mirror of tr.ts against the
// Labels type derived there — a missing key is a compile error, which is how ADR-0007's "en fallback
// for any missing key" clause now holds (vacuously, by type). Draft wording: the operator's
// vocabulary pass (order.md's spine table) refines it. Boundary constraint: this file lives in
// src/ui, so it must never contain a vendor-name substring (check:boundaries c1) — say "caret" or
// "text insertion point", never an editor's name, and never a model family name.
import type {
  AbsentReason,
  ActionIntent,
  BoardBucket,
  CardAction,
  CardActionKind,
  CardReason,
  EvidenceKind,
  SessionRole,
  SourceKind,
  StepStatus,
  CostSummary,
  StageId,
  WorkOrderId,
  WoEventKind,
  TranscriptLine,
} from '../../../core/types';
import type { LiveSessionStatus } from '../../../core/runner';
import type { PermissionRule } from '../../../core/source';
import type { WoPhase } from '../../../core/derive';
import type { ProviderErrorCode } from '../../../core/runner';
import type { Labels } from './tr';

export const BUCKET_LABELS: Record<BoardBucket, string> = {
  up: 'Your turn',
  working: 'Working',
  closed: 'Closed',
};

export const ROLE_LABELS: Record<SessionRole, string> = {
  implementer: 'Implementer',
  architect: 'Architect',
  verifier: 'Verifier',
};

// WO-0038 role picker — the one-line duty under the name.
export const ROLE_DUTY_LABELS: Record<SessionRole, string> = {
  architect: 'plans · reviews each step',
  implementer: 'implements · writes and runs the code',
  verifier: 'verifies · reports independently',
};

export const STAGE_LABELS: Record<StageId, string> = {
  written: 'Written',
  plan_requested: 'Plan requested',
  plan_ready: 'Plan ready',
  architect_approval: 'Architect approval',
  implementation: 'Implementation',
  verification: 'Verification',
  architect_audit: 'Architect review',
  closure: 'Closure',
  closed: 'Closed',
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  plan_approval: 'plan approval',
  pr_open: 'PR open',
  ci_green: 'CI green',
  verification: 'verifier report',
  closure: 'closure docs',
};

export const ACTION_LABELS: Record<ActionIntent, string> = {
  request_plan: 'Request plan',
  approve_plan: 'Approve plan',
  resume: 'Resume session',
  open_pr: 'Open PR',
  merge_track: 'Merge repo',
  request_verification: 'Request verification',
  audit: 'Run review',
  close: 'Close the work order',
};

export const ABSENT_REASON_LABELS: Record<AbsentReason, string> = {
  awaiting_plan_commit: 'Awaiting plan approval',
  docs_not_updated: 'ROADMAP and tech-debt not yet updated',
  depends_on_open: 'A dependency repo has not merged',
  verifier_report_missing: 'No verifier report yet',
  step_not_resolved: 'A step has an open revise decision — Proceed or re-run',
};

export function cardReasonText(r: CardReason): string {
  switch (r.kind) {
    case 'closed':
      return UI.woPhaseDone;
    case 'stopped_asking':
      return `Stopped at: ${r.gate}`;
    case 'ci_failed':
      return `CI failed: ${r.checkName}`;
    case 'ci_running':
      return 'CI is running';
    case 'in_progress':
      return 'In progress';
    case 'just_written':
      return UI.cardJustWritten;
    case 'session_stopped':
      return 'Session stopped';
    case 'awaiting_plan_commit':
      // WO-0039: the board reads the SAME value as the detail's ActionCard — the "Awaiting plan
      // commit" twin is dead (one state, one sentence; "commit" never reaches the operator).
      return ABSENT_REASON_LABELS.awaiting_plan_commit;
    case 'docs_not_updated':
      return 'Docs not updated';
    case 'awaiting_next_session':
      return 'Awaiting the next session';
  }
}

export const CARD_ACTION_AREA: Record<CardActionKind, string> = {
  permission: 'Permission',
  plan: 'Plan ready',
  closure: 'Closure',
  link: 'Action',
};

export function cardActionText(a: CardAction): string {
  if (a.kind === 'link') return ACTION_LABELS[a.intent];
  return { permission: 'Allow', plan: 'Approve plan', closure: 'Ready to close' }[a.kind];
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Pending',
  active: 'Working',
  done: 'Done',
  blocked: 'Blocked',
};

export const LIVE_STATUS_LABELS: Record<LiveSessionStatus, string> = {
  idle: 'Idle',
  running: 'Working',
  stopped_asking: 'Waiting for you',
  plan_ready: 'Plan ready',
  done: 'Done',
  stopped: 'Stopped',
  error: 'Error',
};


export const TOOL_LABELS: Record<string, string> = {
  Write: 'Write file',
  Edit: 'Edit file',
  MultiEdit: 'Edit files',
  NotebookEdit: 'Edit notebook',
  NotebookEditNew: 'Edit notebook',
  Bash: 'Run command',
  Read: 'Read file',
  Grep: 'Search',
  Glob: 'Find files',
  Task: 'Delegate',
  WebFetch: 'Fetch page',
  WebSearch: 'Search the web',
  ExitPlanMode: 'End plan',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? 'Tool call';
}

// 2026-08-23 (§3): the SADE activity line's progressive verbs (tr's twin).
export const TOOL_VERBS: Record<string, string> = {
  Write: 'Writing file',
  Edit: 'Editing file',
  MultiEdit: 'Editing files',
  NotebookEdit: 'Editing notebook',
  NotebookEditNew: 'Editing notebook',
  Bash: 'Running command',
  Read: 'Reading file',
  Grep: 'Searching',
  Glob: 'Finding files',
  Task: 'Delegating',
  WebFetch: 'Fetching page',
  WebSearch: 'Searching the web',
  ExitPlanMode: 'Finishing plan',
};

export function toolVerb(tool: string): string {
  return TOOL_VERBS[tool] ?? 'Running a tool';
}

export function transcriptLineText(line: TranscriptLine): string {
  switch (line.speaker) {
    case 'assistant':
      return line.text;
    case 'tool_use':
      return line.detail ? `${toolLabel(line.tool)} — ${line.detail}` : toolLabel(line.tool);
    case 'tool_result':
      return `→ ${line.summary}`;
    case 'system':
      return line.text;
    case 'note':
      return UI.noteFor(line.kind, line.detail);
  }
}

/** Mirrors tr's one-line projection (WO-0037): an assistant turn collapses to its first
 *  non-empty line; everything else is the flat transcript line. */
export function transcriptTailText(line: TranscriptLine): string {
  if (line.speaker === 'assistant') {
    const first = line.text.split('\n').find((l) => l.trim().length > 0);
    return first ?? '';
  }
  return transcriptLineText(line);
}

export function permissionPrompt(tool: string, detail: string): string {
  const label = toolLabel(tool);
  return detail ? `${label} — ${detail}` : label;
}

export const MODE_LABELS: Record<'plan' | 'direct', string> = {
  plan: 'Plan',
  direct: 'Direct',
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  adr: 'ADR',
  tech_debt: 'tech debt',
  roadmap: 'ROADMAP',
  contract: 'contract',
};

export function modeText(mode: 'plan' | 'direct'): string {
  return `${MODE_LABELS[mode]} mode`;
}

export function stoppedAtGate(gate: string): string {
  return `stopped · ${gate}`;
}

// en-US decimal point — the mirror of tr's tr-TR comma ("$6.27" vs "$6,27" on the same data).
export function formatUsd(usd: number): string {
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
  return `$${n}`;
}

export function formatTokens(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function formatCost(c: CostSummary): string {
  return `${formatUsd(c.usd)} · ${formatTokens(c.tokensIn)}→${formatTokens(c.tokensOut)}`;
}

export function woIdLabel(id: WorkOrderId): string {
  return id;
}

export const PROVIDER_ERROR_LABELS: Record<ProviderErrorCode, string> = {
  auth_missing: 'Provider identity not found — save a key in Settings → Agent provider, or sign in.',
  auth_failed: 'Provider identity rejected — check the key in Settings → Agent provider.',
  timeout: 'The provider connection timed out — check the network/gateway.',
  executable_missing: 'The provider executable was not found — check the installation.',
};

export const WO_EVENT_LABELS: Record<WoEventKind, string> = {
  created: 'Created',
  plan_saved: 'Plan proposed (pending)',
  plan_save_refused: 'Degenerate plan proposal refused',
  plan_approved: 'Plan approved',
  step_started: 'Step started',
  step_done: 'Step completed',
  step_verdict: 'Architect decision',
  verdict_overridden: 'Verdict overridden (operator)',
  closed: 'Closed',
  wo_edited: 'Work order edited',
  rule_changed: 'Rule changed',
  permission_decision: 'Permission decision',
};

/** Mirrors tr's structural detail → display; the machine tokens ('allowed'/'denied') are already
 *  English, so they pass through where tr translates them. */
export function eventDetailText(kind: WoEventKind, detail: string): string {
  if (!detail) return '';
  switch (kind) {
    case 'plan_saved':
      // 2026-08-23 ("Bitti = kaydet"): the operator's editor save rides the proposal event kind.
      if (detail === 'operator-edit') return 'operator edit';
      if (detail === 'restored-original') return "restored the agent's original proposal";
      return detail;
    case 'plan_approved': {
      const m = /^edited:(\d+)$/.exec(detail);
      return m ? `edited approval · ${m[1]} changes` : detail;
    }
    case 'permission_decision': {
      const sep = detail.indexOf(' · ');
      const head = sep >= 0 ? detail.slice(0, sep) : detail;
      const rest = sep >= 0 ? detail.slice(sep + 3) : '';
      return rest ? `${head} · ${rest}` : head;
    }
    case 'rule_changed':
      return PERMISSION_RULE_LABELS[detail as PermissionRule] ?? detail;
    default:
      return detail;
  }
}

export const PERMISSION_RULE_LABELS: Record<PermissionRule, string> = {
  ask_every: 'Ask every time',
  risky_excluded: 'Risky excluded',
  full_auto: 'Full auto',
};
export const PERMISSION_RULE_SHORT: Record<PermissionRule, string> = {
  ask_every: 'Perm: always ask',
  risky_excluded: 'Perm: auto',
  full_auto: 'Perm: full auto',
};
export const PERMISSION_RULE_TINY: Record<PermissionRule, string> = {
  ask_every: 'Perm: ask',
  risky_excluded: 'Perm: auto',
  full_auto: 'Perm: full',
};

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "15 Aug 17:15" — the audit-row timestamp. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The English UI object — mirrors tr's key-for-key (Labels enforces it). Endonyms stay endonyms:
// the language options are 'Türkçe'/'English' in BOTH bundles.
export const UI = {
  productName: 'Docket',
  backToBoard: '← Work orders',
  evidence: 'Evidence',
  evdPlanApproval: 'awaiting plan approval',
  evdVerification: 'no verifier report',
  evdClosure: 'docs not updated',
  evdPrMissing: (repo: string) => `no PR open · ${repo}`,
  evdCiRed: (repo?: string) => (repo ? `CI not green · ${repo}` : 'CI not green'),
  evdNoPr: 'no PR yet',
  evdPrCi: (ciState: string) => `PR open · ${ciState}`,
  evdCiGreenShort: 'CI green',
  evdMerged: (repo?: string) => (repo ? `✓ Merged · ${repo}` : '✓ Merged'),
  sources: 'Sources',
  ciExempt: 'CI exempt',
  orderDoc: 'order.md',
  planDoc: 'plan.md',
  loading: 'Loading…',
  loadError: 'Work orders failed to load.',
  permissionRequested: 'Permission requested',
  startSession: 'Start session',
  resumeSession: 'Resume',
  promptPlaceholder: 'What should this session do?',
  allow: 'Allow',
  deny: 'Deny',
  interrupt: 'Stop',
  noSession: 'No running session.',
  settings: 'Settings',
  language: 'Language',
  langEn: 'English',
  langTr: 'Türkçe',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  close: 'Close',
  actionNeeded: 'What is needed',
  wsSettings: 'Workspace settings',
  wsCreate: 'New workspace',
  wsNameLabel: 'Name',
  wsReposLabel: 'Repo connections',
  wsRepoAddManual: 'Add',
  wsRepoPick: 'Folder',
  wsRepoPlaceholder: 'local repo path',
  wsErrName: 'Name is required.',
  wsErrRepo: 'Add at least one valid repo path (e.g. /Users/.../project).',
  wsRepoEditAria: 'Edit repo path',
  wsRepoRemoveAria: 'Remove repo',
  wsRepoAdd: 'Add repo',
  wsDsMarker: 'decision store',
  wsDsMake: 'Make the decision store',
  wsNoRepos: 'No repos yet.',
  wsErrPathInvalid: 'Not a full path — it must start with /.',
  wsErrPathName: 'The name cannot change — it is the repo identity. Want a different repo? Remove and re-add.',
  wsErrRepoDup: 'A repo with this name already exists.',
  wsGuardDs: 'Decision store — removable once the pick moves to another repo',
  wsGuardOpenWo: (wo: string) => `${wo} is using it — removable once the work order closes`,
  wsGuardLast: 'The last remaining repo — a workspace needs one',
  wsSave: 'Save',
  wsCreateBtn: 'Create',
  wsListTitle: 'Workspaces',
  wsListFilter: 'search…',
  wsListEmpty: 'No matches.',
  wsListCreate: '▸ New workspace',
  wsAll: 'See all',
  cardJustWritten: 'Work order written — start by requesting a plan',
  newWorkOrder: '▸ New work order',
  woCreate: 'New work order',
  woTitleLabel: 'Title',
  woTitlePlaceholder: 'e.g. Error while uploading the user profile avatar',
  woDescLabel: 'Description / goal (optional)', // WO-0036: minority marker — the one optional free-text field
  woDescPlaceholder: 'What should this work order achieve? It goes to the architect session as the first prompt.',
  woTracksLabel: 'Repos',
  woContextLabel: 'Context files',
  woContextAdd: '▸ Add file',
  woReviewLabel: 'Review',
  woCreateBtn: 'Create',
  requestPlan: 'Request plan',
  planReadyHeader: 'Plan ready',
  object: 'Object',
  objectSend: 'Send',
  objectCancel: 'Cancel',
  architectWaiting: 'The architect is waiting for you',
  replyPlaceholder: 'Write your reply…',
  reply: 'Reply',
  skipReply: "I don't know",
  architectRequest: 'The architect has a request',
  inviteFirstWs: "Let's create your first workspace",
  inviteFirstWo: "Let's open your first work order",
  stepsUnit: 'steps',
  stepReportMissing: '(no report yet)',
  stepBlockedHint: 'scope matches no repo',
  noSteps: 'The approved plan contains no runnable steps — ask the architect for a new plan.',
  deleteWo: 'Delete',
  deleteWoHint: 'This work order is permanently deleted — the work order document, the plan, reports and all session records are removed. Cannot be undone.',
  deleteWoConfirm: 'Yes, delete',
  cancel: 'Cancel',
  stepsAllDone: 'All steps done',
  closeWo: 'Close the work order',
  closeNoteLabel: 'Closure note',
  closeNotePlaceholder: 'A short closure note — written to order.md',
  closeWoConfirm: 'Yes, close',
  closeWoFailed: 'Could not close: preconditions unmet (a step or a review may be missing).',
  closeStatEvidence: 'Evidence',
  closeStatReviews: 'Reviews',
  errorBoundaryTitle: 'Something went wrong',
  errorBoundaryHint: 'An unexpected error occurred. You can reload — persistent records are unaffected; only the open live session stream is lost.',
  reload: 'Reload',
  detailLoadError: 'The work order failed to load.',
  loadRetry: 'Retry',
  saveFailed: 'Could not save — try again.',
  woErrTitle: 'Title is required.',
  asksPending: (n: number) => `${n} request${n === 1 ? '' : 's'} waiting`,
  actionRunning: 'Working',
  closeWoDoneTitle: 'Closed',
  planNoStepsWarn: 'The plan has no steps fence (```steps) — approving it leaves the step flow and reviews inert. Consider objecting.',
  overrideVerdictBtn: 'Proceed (override)',
  overrideVerdictHint: "Overrides the architect's 'revise' verdict with proceed — the architect's original text stays in the verdict file.",
  allowAll: 'Allow all',
  formatDuration: (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const h = Math.floor(min / 60);
    return `${h}h ${min % 60}m`;
  },
  providerStatusOk: 'Ready',
  providerStatusUnknown: 'Status unknown — save a key or run Test',
  providerTest: 'Test',
  reviewHeader: 'Architect review',
  reviewHint: "The architect is reviewing this step's report…",
  verdictCardProceedTitle: 'The architect said proceed',
  verdictCardReviseTitle: 'The architect wants a revision',
  verdictCardUnknown: 'The architect gave no clear verdict — take a look.',
  devamStep: 'Proceed',
  rerunStep: 'Re-run the step',
  stepVerdictMissing: '(no verdict yet)',
  woPhaseJustWritten: 'Work order written — request a plan',
  woPhasePlanning: 'The architect is thinking about the plan…',
  woPhasePlanStopped: 'Plan proposal stopped',
  woPhasePlanReady: 'Plan ready — approve it',
  woPhaseImplementing: 'Implementing',
  woPhaseClosing: 'Closing — update the docs',
  woPhaseDone: 'Completed',
  turnYours: 'Your turn',
  turnRunning: 'Working',
  turnStopped: 'Stopped — resume if you want',
  turnRetry: 'Retry',
  turnDone: 'Closed',
  boardAllDone: 'All work is done',
  boardAwaitingClose: (n: number): string => `${n} work order${n === 1 ? '' : 's'} waiting to be closed`,
  boardCloseCta: 'Go to closure',
  closeShaAria: 'Closure record — copy',
  copyDone: 'Copied',
  codeCopyAria: 'Copy code', // WO-0037 — CodeBlock's header button; confirmation rides copyDone
  stripDuration: 'Duration',
  objectTitle: 'What is your objection?',
  dialogCloseAria: 'close',
  removeAria: 'remove',
  // WO-0037 — guarded strip gate (ADR-0001 2026-08-22 addendum): dimmed in place, tooltip names
  // the unblocking move; the standing reason line died (the header band already says Working).
  stripGateTooltip: 'Editing is closed while a session runs — it opens once you stop the session.',
  stripDeleteGateTooltip: 'Cannot be deleted while a session runs — stop the session first.',
  deleteWoFailed: 'Could not delete — repo write error.',
  reportTitle: (idx: number): string => `Report · Step ${idx}`,
  repOpen: '▸ report',
  repClose: '▾ report',
  stepQueued: 'queued',
  stepRunningShort: 'running',
  streamOpened: 'Session opened — waiting for output',
  // WO-0037 — the chat transcript surface (mirrors tr's block).
  chatAria: 'Session stream',
  chatJumpLatest: 'Jump to latest',
  chatOlderLines: (n: number) => `… ${n} earlier line${n === 1 ? '' : 's'}`,
  toolOutputAria: 'Command output — toggle',
  // WO-0039: the plan-stage invitation line died with the empty-state card (see tr).
  loadWorkOrders: 'Reading work orders…',
  loadSteps: 'Reading steps…',
  loadReport: 'Reading report…',
  closedToggleWord: 'closed',
  objectLinePlaceholder: 'Write one sentence — the architect will fix the plan…',
  // WO-0039 — the rail died: decisions moved to the plan section's decision band (planApprove*),
  // process control to the live pane header (drive*), hints to their target cards.
  planApprove: 'Approve',
  // (the consequence hints died with the 2026-08-23 fourth pass — see tr.)
  closeHint: 'It goes to the archive — you can leave a note.',
  askHint: 'The session stopped — cost is not accruing.',
  driveResume: '▶ Resume',
  driveStopping: 'Stopping…',
  driveRetry: 'Retry',
  secDocs: 'Documents',
  docSections: (n: number) => `${n} section${n === 1 ? '' : 's'}`,
  docOrderLabel: 'Work order',
  docPlanLabel: 'Plan',
  sessionSummary: 'Summary',
  sessionSummaryPlan: (n: number) => `proposed a ${n}-step plan`,
  sessionSummaryProceed: 'Architect: proceed — step approved',
  sessionSummaryRevise: 'Architect: revise — re-run requested',
  secSources: 'Sources',
  noteFor: (
    kind: 'interrupt_sent' | 'session_closed' | 'force_killed' | 'interrupted' | 'session_started' | 'session_done',
    detail?: string,
  ) => {
    const base = {
      interrupt_sent: '⏸ interrupt sent',
      session_closed: '■ session closed',
      force_killed: '■ force-killed',
      interrupted: '⏸ session stopped',
      session_started: '● session started',
      session_done: '■ session ended',
    }[kind];
    // The FOLD's lifecycle notes carry an ISO stamp — the locale's clock renders it. The
    // UI-composed notes pass display-ready detail through untouched.
    if ((kind === 'session_started' || kind === 'session_done' || kind === 'interrupted') && detail) {
      return `${base} — ${UI.auditClock(detail)}`;
    }
    return detail ? `${base} — ${detail}` : base;
  },
  permRuleLabel: 'Permission rule',
  permRuleQuestion: 'Permission rule — when should the agent ask you',
  askRiskyTag: 'risky write',
  askAlwaysAuto: 'Always automatic for this work order',
  reviewModeLabel: 'Review',
  reviewModeGatesShort: 'At gates',
  reviewModeEveryShort: 'Every step',
  woEditAria: 'Edit the work order',
  woEditTitle: 'Edit the work order',
  woEditSave: 'Save',
  editPlan: 'Edit',
  editPlanDone: 'Done',
  editPlanRestore: 'Restore proposal',
  restoreTitle: 'Restore proposal',
  restoreBody: "Returns to the steps the agent proposed — your edits and saves are discarded.",
  restoreConfirm: 'Yes, restore',
  editAddStep: '+ Add step',
  editNewStepAim: 'New step — type…',
  editAimMissing: (idx: number) => `A step's text is empty (row ${idx}) — Approve unlocks once it is filled.`,
  // 2026-08-23 drag-and-drop (see tr): the grip + dnd-kit's announcements/instructions.
  editDragHandleAria: 'Drag the step',
  dragSrInstructions: 'To move a step, focus the grip, press Space to lift, the arrow keys to place, Space to drop.',
  dragAnnounceStart: (idx: number) => `Step ${idx} lifted.`,
  dragAnnounceOver: (idx: number) => `Over step ${idx}.`,
  dragAnnounceEnd: (idx: number) => `Step ${idx} dropped.`,
  dragAnnounceCancel: (idx: number) => `Step ${idx} move cancelled.`,
  editRemoveAria: 'Delete step',
  editRoleAria: (role: SessionRole) => `Choose role · current: ${ROLE_LABELS[role]}`,
  editRoleMenuAria: 'Choose role',
  stepRef: (idx: number) => `step ${idx}`,
  // Vocabulary spine: 'Session log' — the operator deferred to this draft at the WO-0035 gate
  // (2026-08-21); one word here flips it to 'Transcript' if the live app argues otherwise.
  auditTitle: 'Session log',
  auditCostNone: '—',
  auditClock: (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  auditRange: (a: string, b: string) => `${UI.auditClock(a)} – ${UI.auditClock(b)}`,
  auditNamePlan: 'Plan',
  auditNameStep: (idx: number, aim?: string) => (aim ? `Step ${idx} · ${aim}` : `Step ${idx}`),
  auditNameReview: (idx: number) => `Review ${idx}`,
  auditNameUnscoped: 'Unscoped',
  auditNoTranscript: 'No transcript record.',
  stepCostMeta: (duration: string, cost: string) => `done · ⏱ ${duration} · ${cost}`,
  diffPeek: '▸ diff',
  diffPeekHide: '▾ diff',
  diffTruncated: (n: number) => `… ${n} line${n === 1 ? '' : 's'}`,
  diffEmpty: 'No changes',
  driveForceKill: 'Force kill',
  driveStoppedMsg: 'Stopped. The report stays partial.',
  // (planEmptyLine died with the 2026-08-23 ruling — see tr.)
  // 2026-08-23 (canlı panel revizyonu): the SADE state line + the verb toggle + the orphan row.
  actThinking: 'Thinking',
  planClosing: 'Plan ready — closing the session',
  transcriptOpen: 'Show transcript',
  transcriptClose: 'Hide transcript',
  // 2026-08-23 (düzeltme): the SDK ends a plan-mode turn with a synthetic 'User has approved
  // your plan…' pseudo-result — that is the HARNESS accepting the agent's submission, NOT the
  // operator's Docket approval (which records its own plan_approved event). The line speaks
  // PROPOSAL language, like the card's 'N adımlık plan önerdi'.
  planApprovedNote: 'The architect submitted its plan',
  planRejectedNote: "The architect's plan was sent back",
  liveSessionGo: 'Live session',
  toolNoResult: '→ no result',
  orphanResult: 'result — no matching call',
  reviewModeGatesHint: 'The steps run on their own — the architect returns to you at three gates: plan approval, revise calls, closure. Click: Every step',
  reviewModeEveryHint: "After every step the architect's verdict reaches you — the next step runs once you approve. Click: At gates",
  roleDutyTip: (role: SessionRole) => `${ROLE_LABELS[role]} — ${ROLE_DUTY_LABELS[role]}`,
  failTitle: 'The session crashed',
  driveStreamCrashed: 'The stream broke — the record is safe.',
  failSpent: (cost: string) => `Spent: ${cost} — the record is safe.`,
  failDetail: 'Detail',
  failCopy: 'Copy',
  failCopied: 'Copied',
  failLastTitle: 'Last lines',
  toastAskTitle: (wo: string) => `${wo} · waiting for permission`,
  toastAskBody: 'click — opens the detail',
  toastErrTitle: (wo: string) => `${wo} · session crashed`,
  toastRuleSaved: 'Rule saved',
  toastRuleSavedBody: 'full auto for this work order',
  titlePending: (n: number) => `(${n}) waiting for permission`,
  createAndPlan: 'Create and request a plan',
  wsDelete: 'Delete the workspace',
  wsDeleteHint: (n: number) => n > 0
    ? `This workspace and its ${n} work order${n === 1 ? '' : 's'} are permanently deleted — the work order document${n === 1 ? '' : 's'}, the plan${n === 1 ? '' : 's'}, reports and all session records are removed. Cannot be undone.`
    : 'This workspace is permanently deleted. Cannot be undone.',
  wsDeleteConfirm: 'Yes, delete',
  wsDeleteFailed: 'Could not delete — stop the session first.',
  wsDeleteGateReason: 'stop the session first',
};

// English composes its own plurals here (tr rides the numberless stepsUnit; en needs "2/5 steps"
// but "step 2" — the bundle's composer is free to differ, only the SIGNATURE is shared).
export function phaseLabelText(p: WoPhase): string {
  switch (p.kind) {
    case 'just_written':
      return UI.woPhaseJustWritten;
    case 'planning':
      return UI.woPhasePlanning;
    case 'plan_stopped':
      return UI.woPhasePlanStopped;
    case 'plan_ready':
      return UI.woPhasePlanReady;
    case 'implementing':
      return p.total > 0 ? `Implementing · ${p.done}/${p.total} steps` : UI.woPhaseImplementing;
    case 'reviewing':
      return `${UI.reviewHeader} · step ${p.stepIdx}`;
    case 'closing':
      return UI.woPhaseClosing;
    case 'done':
      return UI.woPhaseDone;
  }
}

const en: Labels = {
  UI,
  BUCKET_LABELS,
  ROLE_LABELS,
  ROLE_DUTY_LABELS,
  STAGE_LABELS,
  EVIDENCE_LABELS,
  ACTION_LABELS,
  ABSENT_REASON_LABELS,
  CARD_ACTION_AREA,
  STEP_STATUS_LABELS,
  LIVE_STATUS_LABELS,
  TOOL_LABELS,
  TOOL_VERBS,
  MODE_LABELS,
  SOURCE_KIND_LABELS,
  PROVIDER_ERROR_LABELS,
  WO_EVENT_LABELS,
  PERMISSION_RULE_LABELS,
  PERMISSION_RULE_SHORT,
  PERMISSION_RULE_TINY,
  cardReasonText,
  cardActionText,
  toolLabel,
  toolVerb,
  transcriptLineText,
  transcriptTailText,
  permissionPrompt,
  modeText,
  stoppedAtGate,
  formatUsd,
  formatTokens,
  formatCost,
  woIdLabel,
  eventDetailText,
  formatDateTime,
  phaseLabelText,
};
export default en;
