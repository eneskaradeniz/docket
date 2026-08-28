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
import type { FazStatus } from '../../../core/roadmap';
import type { RoadmapDiagnosticCode } from '../../../core/roadmap-md';
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
  // WO-0044 tur 2: "Active" — true even for an interrupted step; the live verb lives in the instrument.
  active: 'Active',
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
    case 'operator':
      return `${UI.operatorSpeaker}: ${line.text}`;
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

// WO-0047: the warn/cap line's sentence picker — status × known-spend in one call (card + band
// speak the same sentence). 'ok' never draws the line; the caller holds that condition.
export function budgetLine(status: 'warn' | 'hard_stop', hasUnknown: boolean, monthUsd: number, capUsd: number): string {
  if (status === 'hard_stop') return hasUnknown ? UI.budgetStopLineKnown(monthUsd, capUsd) : UI.budgetStopLine(monthUsd, capUsd);
  return hasUnknown ? UI.budgetWarnLineKnown(monthUsd, capUsd) : UI.budgetWarnLine(monthUsd, capUsd);
}

export function formatTokens(n: number): string {
  // WO-0046: a max-context of 1 000 000 rendered "1000k" on the live readout — the M tier exists
  // for exactly that ceiling (and stays consistent with formatCost's in→out use of this helper).
  if (n >= 1000000) return `${+(n / 1000000).toFixed(1)}M`;
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
  rate_limited: 'The provider usage limit is full — the reset time is unknown.', // WO-0053: the stamp-less degradation tier
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
  steer_queued: 'Steer note queued',
  steer_delivered: 'Steer note delivered',
  steer_retracted: 'Steer note retracted',
  flow_mode_changed: 'Flow mode changed',
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
    case 'flow_mode_changed':
      return detail; // 'manual'/'auto' are already the en words
    case 'steer_queued':
    case 'steer_delivered':
      return detail.startsWith('not: ') ? detail.slice(5) : detail;
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
  // stepQueued died with WO-0044 tur 2: the spine's meta opens with STEP_STATUS_LABELS.pending.
  // stepRunningShort died with WO-0044: the driven row's meta carries its scope only — the state
  // word lives in the row's StepPane header (the activity verb), where it stays true when stopped.
  // streamOpened died with WO-0044 tur 3: StreamLine (the empty-run second line) is dead — the
  // header's activity line is the honest state on every pane.
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
  // WO-0044: the chip names the cadence itself — "At gates" alone begged "whose gates?".
  reviewModeGatesShort: 'Review: at gates',
  reviewModeEveryShort: 'Review: every step',
  // WO-0045 operator tempo — "Akış" is the operator's own surface word; en keeps the tempo sense.
  flowModeLabel: 'Flow',
  flowModeAutoShort: 'Flow: automatic',
  flowModeManualShort: 'Flow: manual',
  flowModeAutoHint: 'Sequencing advances itself — verdicts and steps run back to back.',
  flowModeManualHint: 'No session starts itself — the next step and review start on click.',
  flowPendingBadge: (n: number) => `+${n}`,
  steerPlaceholder: 'Leave a note for the drive — applied at the next boundary',
  steerSend: 'Send',
  steerPendingTitle: 'Queued',
  steerRefused: 'The note did not queue — the drive is not ready yet; try again shortly.',
  steerRetract: 'Retract',
  operatorSpeaker: 'Operator',
  manuelNextStepCard: (idx: number) => `next: step ${idx}`,
  manuelReviewCard: (idx: number) => `next: review ${idx}`,
  manuelStartCard: 'Start',
  // WO-0046 live honesty: the context readout (the costline's own language — text, no motion)
  // and the staleness line (3-minute threshold, the honest heir of the indefinite wait).
  contextReadout: (pct: number, used: number, max: number) => `ctx ${pct}% · ${formatTokens(used)}/${formatTokens(max)}`,
  staleLine: (n: number) => `no new output for ${n} min`,
  // WO-0047 budget gate: warn/cap lines (card + band — known-spend qualifier, no fill bar),
  // the refusal card's two choices, the settings section. Money via formatUsd.
  budgetWarnLine: (m: number, cap: number) => `this month ${formatUsd(m)} / ${formatUsd(cap)} — past the warn level`,
  budgetWarnLineKnown: (m: number, cap: number) => `this month known spend ${formatUsd(m)} / ${formatUsd(cap)} — past the warn level`,
  budgetStopLine: (m: number, cap: number) => `this month ${formatUsd(m)} / ${formatUsd(cap)} — cap reached, new drives refused`,
  budgetStopLineKnown: (m: number, cap: number) => `this month known spend ${formatUsd(m)} / ${formatUsd(cap)} — cap reached, new drives refused`,
  budgetRefusalTitle: 'MONTHLY CAP REACHED',
  budgetRefusalBody: (observed: number, cap: number) => `Known spend this month is ${formatUsd(observed)}; the cap is ${formatUsd(cap)}. No new drive can start.`,
  budgetRefusalRunningNote: 'A running drive is not interrupted; the gate applies to the next drive.',
  budgetBasisNote: 'The figure counts known spend only — interrupted legs carry no recorded cost.',
  budgetRaiseLabel: 'New cap ($)',
  budgetRaiseAction: 'Raise the cap and run',
  budgetKeepAction: 'Keep the cap',
  budgetErrNumber: 'Enter a valid amount ($, e.g. 20 or 20.50).',
  budgetErrRaise: 'The new cap must exceed this month’s spend.',
  budgetLabel: 'Monthly budget',
  budgetCapLabel: 'Cap ($)',
  budgetWarnPercentLabel: 'Warn level (%)',
  budgetSave: 'Save',
  budgetClear: 'Remove',
  budgetErrCap: 'Enter an amount greater than zero.',
  budgetErrWarn: 'Enter a ratio between 1 and 100.',
  budgetMonthReadout: (m: number, cap: number) => `this month ${formatUsd(m)} / ${formatUsd(cap)}`,
  budgetMonthReadoutKnown: (m: number, cap: number) => `this month known spend ${formatUsd(m)} / ${formatUsd(cap)}`,
  // ===== WO-0049 — the roadmap surface (mockup frames 01/02/03/06/07; 04/05 are WO-0050's) =====
  surfaceBoard: 'Board',
  surfaceRoadmap: 'Roadmap',
  roadmapReading: 'Reading the roadmap…',
  roadmapInviteLine: 'This workspace has no roadmap yet.',
  roadmapInviteFile: (root: string) => `File: ${root}/roadmap.md — create it by hand if you want.`,
  roadmapInvalidLine: 'The roadmap could not be read — fix the file by hand:',
  roadmapHeadMeta: (done: number, total: number, open: number, usd: number) =>
    `${done}/${total} phases done · ${open} open work orders · ${formatUsd(usd)}`,
  roadmapHeadMetaKnown: (done: number, total: number, open: number, usd: number) =>
    `${done}/${total} phases done · ${open} open work orders · known ${formatUsd(usd)}`,
  roadmapFazMeta: (done: number, total: number, closedWo: number, closedUsd: number, openWo: number) => {
    let s = `${done}/${total} tasks`;
    if (closedWo > 0) s += ` · ${closedWo} WO${closedWo === 1 ? '' : 's'} closed`;
    if (closedUsd > 0) s += ` · ${formatUsd(closedUsd)}`;
    if (openWo > 0) s += ` · ${openWo} open work order${openWo === 1 ? '' : 's'}`;
    return s;
  },
  roadmapBlokeWord: 'Blocked',
  roadmapBlokeFallback: (blockers: string) => `${blockers} must finish first`,
  roadmapStripLine: 'phase order · click to scroll',
  roadmapDoneFold: (n: number) => `${n} phases done`,
  roadmapDoneFoldMeta: (wo: number, usd: number) => `${wo} WO${wo === 1 ? '' : 's'} · ${formatUsd(usd)}`,
  roadmapTaskFill: (done: number, total: number) => `${done}/${total} tasks`,
  roadmapTaskSpawn: 'Open work order',
  roadmapTaskClosedTail: (n: number) => `${n} WO${n === 1 ? '' : 's'} closed`,
  roadmapTaskOpenMulti: (n: number) => `${n} open WO${n === 1 ? '' : 's'}`,
  roadmapNextTag: 'next',
  roadmapFazAdd: '+ Add phase',
  roadmapFazAddTitle: 'Add phase',
  roadmapFazAimLabel: 'Aim (optional)',
  roadmapFazDependsLabel: 'Dependencies',
  roadmapTaskAdd: '+ add task',
  roadmapTaskAddTitle: 'Add task',
  roadmapErrRepo: 'Pick a repo.',
  roadmapSpawnContext: (faz: string, ord: number, title: string, repo?: string) =>
    repo !== undefined ? `${faz} · TASK ${ord} · ${title} · target: ${repo}` : `${faz} · TASK ${ord} · ${title}`,
  roadmapTaskChip: (faz: string, task: string) => `${faz} · ${task}`,
  roadmapTaskMissing: '(task not in the roadmap)',
  docsRootLabel: 'Structure root',
  docsRootWarn: 'Files never move; work-order numbering restarts under the new root.',
  docsRootErr: 'Enter a safe relative path (e.g. docs or .docket).',
  // ===== WO-0050 — the ✦ draft drive (mockup frames 03/04/05). ONE mechanism: generation and
  // import are the same architect draft session; the source-doc list is the only distinction.
  // (Operator-facing copy stays Turkish in tr; en mirrors the shapes for the compile contract.)
  roadmapDraftAction: '✦ Generate / Import',
  roadmapDraftDialogTitle: 'Roadmap draft',
  roadmapDraftNoteLabel: 'Goal note',
  roadmapDraftNotePlaceholder: 'e.g. extract the roadmap from the existing faz docs; keep the dependencies…',
  roadmapDraftNoteErr: 'The goal note is required — the draft is built from it.',
  roadmapDraftDocsLabel: 'Source documents',
  roadmapDraftDocPick: '+ Add documents',
  roadmapDraftDocRemoveAria: (name: string) => `Remove document: ${name}`,
  roadmapDraftDocMore: (n: number) => `+${n} more`,
  roadmapDraftStart: 'Start the draft',
  roadmapDraftBusy: 'A drive is already running — try again once it ends.',
  roadmapDraftIdentity: 'ARCHITECT — DRAFT',
  roadmapDraftRunning: 'draft running',
  roadmapDraftSourceLine: (n: number) => (n > 0 ? `source: ${n} document(s)` : 'source: the goal note'),
  roadmapDraftCardHead: 'Draft ready — review it',
  roadmapDraftCardSummary: (faz: number, task: number, chain: number, root: string) =>
    `${faz} faz · ${task} tasks${chain > 0 ? ` · ${chain} dependency chain(s)` : ''} — on approval written to ${root}/roadmap.md in the decision store; the commit is yours.`,
  roadmapDraftFazMeta: (n: number, repos: string) => (repos ? `${n} tasks · ${repos}` : `${n} tasks`),
  roadmapDraftWhy: 'It comes alive with the file approval, before the work orders — statuses never show here.',
  roadmapDraftInvalidLine: 'The draft does not parse — no Approve; return to the architect with Object.',
  roadmapDraftSuperseded: 'The new proposal could not be read — the previous valid draft stands.',
  roadmapDraftApprove: 'Approve',
  roadmapDraftApproveFailed: (why: string) => `Not approved — ${why}`,
  roadmapDraftObjectPlaceholder: 'Your note — the architect returns to the same session with it',
  roadmapDraftEditFazTitle: 'Faz title',
  roadmapDraftTaskPlaceholder: 'Task title…',
  roadmapDraftEditEmptyTitle: 'A faz title is empty — Bitti writes once filled.',
  roadmapDraftEditRefused: (why: string) => `Not saved — ${why}`,
  roadmapDraftFazRemoveAria: (title: string) => `Remove faz: ${title}`,
  roadmapDraftTaskRemoveAria: (title: string) => `Remove task: ${title}`,
  roadmapDraftAskToast: 'ARCHITECT — DRAFT is waiting for you',
  // ===== WO-0051 — ✦ source channels: the composition (contract rev 2 · PRESENTATION rev 3) =====
  roadmapDraftStoreLine: (docsRoot: string, found: number, included: number) =>
    included === found ? `${docsRoot}/ · ${found} documents — all included` : `${docsRoot}/ · ${included} / ${found} documents`,
  roadmapDraftScanning: (docsRoot: string) => `scanning ${docsRoot}/…`,
  roadmapDraftNoDocs: (docsRoot: string) => `no documents in ${docsRoot}/ — the draft generates from the note alone.`,
  roadmapDraftGroupLabel: (docsRoot: string, key: string) => (key === '' ? `${docsRoot}/` : `${docsRoot}/${key}/`),
  roadmapDraftGroupCount: (n: number) => `${n} documents`,
  roadmapDraftExclude: 'exclude',
  roadmapDraftExcludeAria: (name: string) => `Exclude: ${name}`,
  roadmapDraftInclude: '↩ restore',
  roadmapDraftIncludeAria: (name: string) => `Restore: ${name}`,
  roadmapDraftMoreAll: (n: number) => `+${n} documents — all included`,
  roadmapDraftPickedSubhead: (n: number) => `added documents · ${n}`,
  roadmapDraftExploreChip: 'Free exploration',
  roadmapDraftExploreInfo:
    'The architect may browse the repo itself — costs tokens; the picked documents still go for sure.',
  roadmapDraftSourceCompose: (store: number, external: number, explore: boolean) =>
    store === 0 && external === 0
      ? 'source: the goal note'
      : `source: ${store} document(s)${external > 0 ? ` · ${external} added` : ''}${explore ? ' · exploration' : ''}`,
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
  // WO-0044 tur 2: the card's first line is the WHO — ROLE readout; the step's aim rides its own line.
  auditNameStep: (idx: number) => `Step ${idx}`,
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
  // liveSessionGo died with WO-0044 (the ledger's live pointer card died; pure history remains).
  toolNoResult: '→ no result',
  orphanResult: 'result — no matching call',
  // WO-0044: the CTA names the chip as it reads on screen (the retired words died with the rename).
  reviewModeGatesHint: 'The steps run on their own — the architect returns to you at three gates: plan approval, revise calls, closure. Click: Review: every step',
  reviewModeEveryHint: "After every step the architect's verdict reaches you — the next step runs once you approve. Click: Review: at gates",
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
      // WO-0044: the stage badge beside this line already names the phase — the line carries the count.
      return p.total > 0 ? `${p.done}/${p.total} steps` : UI.woPhaseImplementing;
    case 'reviewing':
      return `${UI.reviewHeader} · step ${p.stepIdx}`;
    case 'closing':
      return UI.woPhaseClosing;
    case 'done':
      return UI.woPhaseDone;
  }
}

// WO-0049 — the faz status vocabulary (one vocabulary; task statuses are the subset).
export const FAZ_STATUS_LABELS: Record<FazStatus, string> = {
  planli: 'Planned',
  kosuyor: 'Running',
  bekliyor: 'Waiting',
  tamam: 'Done',
};

// WO-0049 — the faz identity's display form: `f4` → `PHASE 4` (the id's own number, verbatim).
export function fazLabel(id: string): string {
  const m = /^f(\d+)$/.exec(id);
  return m !== null ? `PHASE ${m[1]!}` : `PHASE ${id.toUpperCase()}`;
}

// WO-0049 — the fold's `f0 · f3` run rides the woIdLabel pattern (ADR-0007's 2026-08-27 addendum).
export function fazIdLabel(id: string): string {
  return id;
}

// WO-0049 — the invalid surface's named reasons (roadmapDiagnostics' 11 codes).
export const ROADMAP_DIAGNOSTIC_LABELS: Record<RoadmapDiagnosticCode, (detail: string) => string> = {
  no_fence: () => 'no fazlar fence',
  bad_json: (detail) => `broken JSON — ${detail}`,
  bad_element: (detail) => `malformed element — ${detail}`,
  duplicate_id: (detail) => `duplicate id: ${detail}`,
  bad_id_shape: (detail) => `invalid id shape: ${detail}`,
  empty_title: (detail) => `empty title: ${detail}`,
  unknown_blocked_by: (detail) => `unknown dependency: ${detail}`,
  self_blocked_by: (detail) => `blocks itself: ${detail}`,
  cyclic_blocked_by: (detail) => `cyclic dependency: ${detail}`,
  front_matter_mismatch: (detail) => `workspace mismatch: ${detail}`,
  unknown_repo: (detail) => `unknown repo: ${detail}`,
};

const en: Labels = {
  UI,
  budgetLine,
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
  FAZ_STATUS_LABELS,
  ROADMAP_DIAGNOSTIC_LABELS,
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
  fazLabel,
  fazIdLabel,
};
export default en;
