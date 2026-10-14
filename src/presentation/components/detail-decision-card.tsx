// components/detail-decision-card.tsx — the “Bu aşamada senden beklenen” zone (U-226): one card
// per pending decision, stacked 12 px apart (U-227), or the single quiet line when nothing is
// expected. The approve card names what it approves (the changed-files count and the pending
// page — “Onaylanacak çıktı yok” offers only a rerun when there is neither); its reject opens
// the inline reason box whose note travels to gate.decide (#978); parallel approvals carry no
// primary button — none of them outranks the other. The failed card quotes the run's own last
// words; the deploy card mirrors E-8's typed confirmation; the permission card folds the run's
// already-allowed asks into one line.
import { useState } from 'react';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import { ActionButton } from './action-button';
import { StateBadge } from './state-badge';
import { InlineDialog } from './detail-dialog';
import { formatDurationMs } from './detail-format';
import type {
  DecisionZone,
  DeployApproveInput,
  GateView,
  GitBaseRead,
  GitCardModel,
  GitDoor,
  GitOpenPrInput,
  IntentOutcome,
  WorkOrderAskView,
} from '../stores/work-order-detail';

const INPUT_CLASS =
  'rounded-control border border-bord bg-raised px-2 py-[0.3125rem] font-mono text-[0.8125rem] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-inkdim';

export interface DecisionEvidence {
  /** The changed-files count the approve card names; null while the changes read has not landed
   *  — an unread list is not an empty one, so the card keeps its normal shape. */
  readonly files: number | null;
  /** The pending page the approval covers, opened into the page viewer. */
  readonly pendingPage: { readonly id: string; readonly title: string } | null;
}

/** Nothing to approve only when the list landed empty and no page waits — a missing read never
 *  counts as “no output” (#979 made the true empty standing rare). */
const hasEvidenceToApprove = (evidence: DecisionEvidence): boolean =>
  evidence.files === null || evidence.files > 0 || evidence.pendingPage !== null;

export interface DecisionZoneProps {
  readonly zone: DecisionZone;
  readonly locale: Locale;
  /** True while two or more approvals wait: no card in the zone carries a primary button. */
  readonly parallel: boolean;
  readonly evidence: DecisionEvidence;
  readonly lastErrorLine: string | null;
  readonly failedRunCode: string | null;
  readonly autoAllowed: number;
  readonly onDecide: (gate: string, decision: 'approved' | 'rejected', note?: string) => void;
  readonly onAttest: (gate: string, noChangeNeeded: boolean) => void;
  readonly onAnswer: (ask: WorkOrderAskView, decision: 'allow' | 'deny') => void;
  readonly onDeployApprove: (input: DeployApproveInput) => void;
  /** Stops the live run (U-302); the card reads the outcome to place the calm line. */
  readonly onStop: (runId: string) => Promise<IntentOutcome>;
  /** Sends the live run a steering note (U-303); bad_input keeps the note dialog open. */
  readonly onSteer: (runId: string, note: string) => Promise<IntentOutcome>;
  readonly onEnqueue: () => void;
  /** The failed card's “İş emrini kapat…” asks the screen for its confirm dialog. */
  readonly onCloseRequest: () => void;
  readonly onReviewChanges: () => void;
  readonly onOpenFailedRun: () => void;
  readonly onOpenPage: (id: string) => void;
}

const gateName = (gate: GateView): string => gate.label ?? gate.id;

/** The approve card: what is being approved, said out loud, and the two ways to answer. */
function ApproveCard({
  gate,
  locale,
  parallel,
  evidence,
  onDecide,
  onEnqueue,
  onReviewChanges,
  onOpenPage,
}: {
  readonly gate: GateView;
  readonly locale: Locale;
  readonly parallel: boolean;
  readonly evidence: DecisionEvidence;
  readonly onDecide: DecisionZoneProps['onDecide'];
  readonly onEnqueue: () => void;
  readonly onReviewChanges: () => void;
  readonly onOpenPage: (id: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const hasEvidence = hasEvidenceToApprove(evidence);
  return (
    <li
      data-decision-card="approve"
      className={`grid min-w-0 gap-3 rounded-card px-5 py-4 ${parallel ? 'border border-dashed border-signal bg-surface' : 'border border-hairline bg-surface'}`}
    >
      <h3 className="text-[0.875rem] font-semibold text-ink">
        {t(locale, 'detail.zone.approveTitle').replace('{gate}', gateName(gate))}
      </h3>
      <p className="m-0 text-[0.8125rem] text-inkdim">
        {parallel ? t(locale, 'detail.zone.multiBody') : t(locale, 'detail.zone.approveBody')}
      </p>
      {hasEvidence ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.8125rem] text-inkdim">
          {(evidence.files ?? 0) > 0 ? (
            <span>{t(locale, 'detail.zone.evidence.files').replace('{n}', String(evidence.files))}</span>
          ) : null}
          {(evidence.files ?? 0) > 0 ? <ActionButton onClick={onReviewChanges}>{t(locale, 'detail.zone.reviewChanges')}</ActionButton> : null}
          {evidence.pendingPage !== null ? (
            <ActionButton onClick={() => onOpenPage(evidence.pendingPage?.id ?? '')}>{evidence.pendingPage.title}</ActionButton>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.zone.approveNone')}</p>
          <div>
            <ActionButton variant="neutral" size="md" onClick={onEnqueue}>
              {t(locale, 'detail.zone.rerunStage')}
            </ActionButton>
          </div>
        </div>
      )}
      {hasEvidence ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton variant="neutral" onClick={() => setRejecting(true)}>
              {t(locale, 'detail.zone.rejectOpen')}
            </ActionButton>
            <ActionButton variant={parallel ? 'neutral' : 'primary'} size="md" onClick={() => onDecide(gate.id, 'approved')}>
              {t(locale, 'action.approve')}
            </ActionButton>
          </div>
          {!parallel ? <p className="m-0 text-[0.78125rem] text-inkdim">{t(locale, 'detail.zone.approveHint')}</p> : null}
          <InlineDialog active={rejecting} onClose={() => setRejecting(false)}>
            {rejecting ? (
              <div className="grid gap-2 border-t border-hairline pt-3">
                <label htmlFor={`rej-${gate.id}`} className="text-[0.8125rem] font-semibold text-ink">
                  {t(locale, 'detail.zone.rejectNoteLabel')} <span className="font-normal text-inkdim">{t(locale, 'detail.zone.rejectNoteOptional')}</span>
                </label>
                <textarea
                  id={`rej-${gate.id}`}
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t(locale, 'detail.zone.rejectNotePlaceholder')}
                  className="min-h-[4.5rem] w-full resize-y rounded-control border border-bord bg-raised px-3 py-2 text-[0.8125rem] text-ink placeholder:text-inkdim focus:border-signal"
                />
                <div className="flex gap-2">
                  <ActionButton
                    variant="primary"
                    onClick={() => {
                      setRejecting(false);
                      onDecide(gate.id, 'rejected', note.trim() === '' ? undefined : note);
                    }}
                  >
                    {t(locale, 'action.reject')}
                  </ActionButton>
                  <ActionButton onClick={() => setRejecting(false)}>{t(locale, 'detail.action.cancel')}</ActionButton>
                </div>
              </div>
            ) : null}
          </InlineDialog>
        </>
      ) : null}
    </li>
  );
}

/** The attestation pair (U-61): both answers are equals — the operator attests, neither is the
 *  “go on” default. */
function AttestCard({
  gate,
  locale,
  onAttest,
}: {
  readonly gate: GateView;
  readonly locale: Locale;
  readonly onAttest: DecisionZoneProps['onAttest'];
}) {
  return (
    <li data-decision-card="attest" className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4">
      <h3 className="text-[0.875rem] font-semibold text-ink">{t(locale, 'detail.zone.attestTitle')}</h3>
      <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.zone.attestBody')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton variant="neutral" onClick={() => onAttest(gate.id, false)}>
          {t(locale, 'detail.changes.attestRerun')}
        </ActionButton>
        <ActionButton variant="neutral" onClick={() => onAttest(gate.id, true)}>
          {t(locale, 'detail.changes.attestNoChange')}
        </ActionButton>
      </div>
    </li>
  );
}

/** The deploy approval (E-8 mirrored at the card): the commit, and — for a protected
 *  environment — the typed name that must equal it before the primary unlocks. */
function DeployCard({
  gate,
  locale,
  onDeployApprove,
}: {
  readonly gate: GateView;
  readonly locale: Locale;
  readonly onDeployApprove: DecisionZoneProps['onDeployApprove'];
}) {
  const [commit, setCommit] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const deploy = gate.deploy;
  if (deploy === undefined) return null;
  const commitReady = commit.trim() !== '';
  const confirmationReady = !deploy.protectedEnvironment || confirmation === deploy.environment;
  return (
    <li data-decision-card="deploy" className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4">
      <h3 className="text-[0.875rem] font-semibold text-ink">
        {t(locale, 'detail.zone.deployTitle').replace('{env}', deploy.environment)}
      </h3>
      <p className="m-0 text-[0.8125rem] text-inkdim">
        {t(locale, deploy.protectedEnvironment ? 'detail.zone.deployBody' : 'detail.zone.deployBodyPlain')}
      </p>
      <InlineDialog active onClose={() => undefined}>
        <div className="grid gap-3 rounded-card border border-hairline bg-band p-4">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[0.8125rem] text-ink">{deploy.environment}</code>
            {deploy.protectedEnvironment ? <StateBadge tone="signal">{t(locale, 'gate.deploy.protected')}</StateBadge> : null}
            {deploy.promoteFromChain.length > 0 ? (
              <span className="font-mono text-[0.6875rem] text-inkdim">
                {t(locale, 'gate.deploy.prerequisite')}: {deploy.promoteFromChain.join(' → ')}
              </span>
            ) : null}
          </div>
          <label className="grid gap-1">
            <span className={LABEL_CLASS}>{t(locale, 'detail.deploy.commitLabel')}</span>
            <input
              value={commit}
              onChange={(event) => setCommit(event.target.value)}
              placeholder={t(locale, 'detail.deploy.commitPlaceholder')}
              className={INPUT_CLASS}
            />
          </label>
          {deploy.protectedEnvironment ? (
            <div className="grid gap-1">
              <p className="m-0 text-[0.8125rem] text-ink">{t(locale, 'detail.deploy.confirmPrompt')}</p>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={t(locale, 'detail.deploy.confirmPlaceholder')}
                className={INPUT_CLASS}
              />
            </div>
          ) : null}
          <div>
            <ActionButton
              variant="primary"
              size="md"
              disabled={!(commitReady && confirmationReady)}
              onClick={() =>
                onDeployApprove({
                  gate: gate.id,
                  commit: commit.trim(),
                  ...(deploy.protectedEnvironment ? { confirmedEnvironment: confirmation } : {}),
                })
              }
            >
              {t(locale, 'detail.deploy.approve')}
            </ActionButton>
          </div>
        </div>
      </InlineDialog>
    </li>
  );
}

/** The permission card: the pending question, the command in its code box, the two answers, and
 *  the asking run's already-allowed asks folded into one line. */
function PermissionCard({
  ask,
  locale,
  autoAllowed,
  onAnswer,
}: {
  readonly ask: WorkOrderAskView;
  readonly locale: Locale;
  readonly autoAllowed: number;
  readonly onAnswer: DecisionZoneProps['onAnswer'];
}) {
  return (
    <li data-decision-card="permission" className="grid min-w-0 gap-3 rounded-card border border-signal/45 bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-control border border-bord px-2 py-px font-mono text-[0.75rem] font-bold text-inkdim">
          {t(locale, 'detail.zone.permissionChip')}
        </span>
      </div>
      <pre className="m-0 min-w-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-control border border-hairline bg-band px-3 py-2 font-mono text-[0.6875rem] leading-[1.6] text-ink">
        {ask.tool}
      </pre>
      <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.zone.permissionBody')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton variant="neutral" onClick={() => onAnswer(ask, 'deny')}>
          {t(locale, 'action.deny')}
        </ActionButton>
        <ActionButton variant="primary" size="md" onClick={() => onAnswer(ask, 'allow')}>
          {t(locale, 'action.allow')}
        </ActionButton>
      </div>
      {autoAllowed > 0 ? (
        <p className="m-0 text-[0.78125rem] text-inkdim">
          {t(locale, 'detail.zone.autoAllowed').replace('{n}', String(autoAllowed))}
        </p>
      ) : null}
    </li>
  );
}

/** The failure card: the run's own last words as the one mono line, the door to the failed run,
 *  and the retry the fold's budget still allows — or the way out when it does not. */
function FailedCard({
  retry,
  locale,
  lastErrorLine,
  failedRunCode,
  onOpenFailedRun,
  onEnqueue,
  onCloseRequest,
}: {
  readonly retry: boolean;
  readonly locale: Locale;
  readonly lastErrorLine: string | null;
  readonly failedRunCode: string | null;
  readonly onOpenFailedRun: () => void;
  readonly onEnqueue: () => void;
  readonly onCloseRequest: () => void;
}) {
  return (
    <li data-decision-card="failed" className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4">
      <h3 className="text-[0.875rem] font-semibold text-ink">
        {t(locale, retry ? 'detail.zone.failedRetryTitle' : 'detail.zone.failedOutTitle')}
      </h3>
      <p className="m-0 text-[0.8125rem] text-inkdim">
        {t(locale, retry ? 'detail.zone.failedRetryBody' : 'detail.zone.failedOutBody')}
      </p>
      <blockquote className="m-0 border-l-2 border-bord pl-3 font-mono text-[0.75rem] text-inkdim [overflow-wrap:anywhere]">
        {lastErrorLine ?? failedRunCode ?? ''}
      </blockquote>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton variant="neutral" onClick={onOpenFailedRun}>
          {t(locale, 'detail.zone.openFailedRun')}
        </ActionButton>
        {retry ? (
          <ActionButton variant="primary" size="md" onClick={onEnqueue}>
            {t(locale, 'action.retry')}
          </ActionButton>
        ) : (
          <ActionButton variant="neutral" size="md" onClick={onCloseRequest}>
            {t(locale, 'detail.close.open')}
          </ActionButton>
        )}
      </div>
    </li>
  );
}

/** The running card (U-301): the quiet line, the stage and the elapsed time of the live run,
 *  and the two secondary doors. The stop confirm (U-302) and the steer note (U-303) are the
 *  card's own inline dialogs — the same A3 trap the reject box uses. Nothing is optimistic
 *  here: the card leaves only when the work order's changed event shows the ended run, and a
 *  stop that lands late says so with the calm line. */
function RunningCard({
  runId,
  stageName,
  startedAt,
  canSteer,
  locale,
  onStop,
  onSteer,
}: {
  readonly runId: string;
  readonly stageName: string;
  readonly startedAt: number;
  readonly canSteer: boolean | 'unknown';
  readonly locale: Locale;
  readonly onStop: DecisionZoneProps['onStop'];
  readonly onSteer: DecisionZoneProps['onSteer'];
}) {
  const [stopping, setStopping] = useState(false);
  const [steering, setSteering] = useState(false);
  const [note, setNote] = useState('');
  const [noteRejected, setNoteRejected] = useState(false);
  const [alreadyEnded, setAlreadyEnded] = useState(false);
  const elapsed = formatDurationMs(locale, Math.max(Date.now() - startedAt, 0));
  const steerDisabled = canSteer !== true;
  const sendNote = (): void => {
    void onSteer(runId, note).then((outcome) => {
      // Only the field's own verdict keeps the dialog open (U-303); anything else is the toast's.
      if (!outcome.result.ok && outcome.result.code === 'bad_input') setNoteRejected(true);
      else {
        setSteering(false);
        setNote('');
      }
    });
  };
  return (
    <li data-decision-card="running" className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[0.8125rem] text-inkdim">
        <span className="font-semibold text-ink">{t(locale, 'detail.stop.card')}</span>
        <span>{stageName}</span>
        <span>{t(locale, 'detail.meta.duration').replace('{n}', elapsed)}</span>
      </p>
      {/* U-304: both doors are the secondary outline — there is no danger token, the confirm
          dialog carries the weight. */}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton variant="neutral" onClick={() => setStopping(true)}>
          {t(locale, 'detail.stop.open')}
        </ActionButton>
        <ActionButton
          variant="neutral"
          disabled={steerDisabled}
          onClick={() => {
            setNoteRejected(false);
            setSteering(true);
          }}
        >
          {t(locale, 'detail.steer.open')}
        </ActionButton>
      </div>
      {steerDisabled ? (
        <p className="m-0 text-[0.78125rem] text-inkdim">{t(locale, 'detail.steer.unsupported')}</p>
      ) : null}
      {alreadyEnded ? (
        <p className="m-0 text-[0.78125rem] text-inkdim">{t(locale, 'detail.stop.alreadyEnded')}</p>
      ) : null}
      <InlineDialog active={stopping} onClose={() => setStopping(false)}>
        {stopping ? (
          <div data-detail-stop className="grid gap-2 border-t border-hairline pt-3">
            <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'detail.stop.title')}</p>
            <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.stop.body')}</p>
            <div className="flex gap-2">
              <ActionButton
                variant="primary"
                size="md"
                onClick={() => {
                  setStopping(false);
                  void onStop(runId).then((outcome) => {
                    if (!outcome.result.ok && outcome.result.code === 'not_active') setAlreadyEnded(true);
                  });
                }}
              >
                {t(locale, 'detail.stop.confirm')}
              </ActionButton>
              <ActionButton onClick={() => setStopping(false)}>{t(locale, 'detail.action.cancel')}</ActionButton>
            </div>
          </div>
        ) : null}
      </InlineDialog>
      <InlineDialog active={steering} onClose={() => setSteering(false)}>
        {steering ? (
          <div data-detail-steer className="grid gap-2 border-t border-hairline pt-3">
            <label htmlFor={`steer-${runId}`} className="text-[0.8125rem] font-semibold text-ink">
              {t(locale, 'detail.steer.noteLabel')}
            </label>
            <textarea
              id={`steer-${runId}`}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter adds a line — the reject box's own grammar.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendNote();
                }
              }}
              placeholder={t(locale, 'detail.steer.notePlaceholder')}
              className="min-h-[4.5rem] w-full resize-y rounded-control border border-bord bg-raised px-3 py-2 text-[0.8125rem] text-ink placeholder:text-inkdim focus:border-signal"
            />
            {noteRejected ? (
              <p role="alert" className="m-0 text-[0.78125rem] text-error">
                {t(locale, 'detail.steer.error')}
              </p>
            ) : null}
            <p className="m-0 text-[0.75rem] text-inkdim">{t(locale, 'detail.steer.hint')}</p>
            <div className="flex gap-2">
              <ActionButton onClick={sendNote}>{t(locale, 'detail.steer.send')}</ActionButton>
              <ActionButton onClick={() => setSteering(false)}>{t(locale, 'detail.action.cancel')}</ActionButton>
            </div>
          </div>
        ) : null}
      </InlineDialog>
    </li>
  );
}

/** The start card: the stage's own door into the run. */
function StartCard({
  stageName,
  locale,
  onEnqueue,
}: {
  readonly stageName: string;
  readonly locale: Locale;
  readonly onEnqueue: () => void;
}) {
  return (
    <li data-decision-card="start" className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4">
      <h3 className="text-[0.875rem] font-semibold text-ink">
        {t(locale, 'detail.zone.startTitle').replace('{stage}', stageName)}
      </h3>
      <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.zone.startBody')}</p>
      <div>
        <ActionButton variant="primary" size="md" onClick={onEnqueue}>
          {t(locale, 'detail.action.startStage')}
        </ActionButton>
      </div>
    </li>
  );
}

/** The door labels in the card's fixed order (U-349). */
const GIT_DOOR_LABEL: Readonly<Record<GitDoor['kind'], LabelKey>> = {
  push: 'detail.git.push',
  openPr: 'detail.git.openPr',
  merge: 'detail.git.mergeOpen',
  release: 'detail.git.release',
};

export interface GitDoorsCardProps {
  readonly model: GitCardModel;
  readonly locale: Locale;
  /** The forge default-branch read (A-391): the PR dialog's prefill on success, its visible
   *  hint on failure — the operator can always type a base. */
  readonly gitBase: GitBaseRead | null;
  /** The names of the remote checks currently failing (GI-3's rows) — the merge confirm's quiet
   *  warning line; it never blocks the human's decision (decision 5). */
  readonly failedChecks: readonly string[];
  readonly onPush: () => Promise<IntentOutcome>;
  readonly onOpenPr: (input: GitOpenPrInput) => Promise<IntentOutcome>;
  readonly onMerge: (number: number) => Promise<IntentOutcome>;
  readonly onRelease: () => Promise<IntentOutcome>;
}

/** The git doors card (U-344 … U-349): the branch line as selectable text, the pull request the
 *  ledger holds as plain text, and the four doors in their fixed order — every closed door says
 *  its one quiet line. The merge confirm is the explicit human step's own surface (İ1): it
 *  restates the PR number, head and base it captured when it opened, Vazgeç is the first stop so
 *  the refusal owns the default focus, and the confirm carries the captured number — a stale
 *  dialog can only ever be refused, never merge the wrong PR. Nothing here is optimistic: the
 *  card follows `workOrders.changed` alone. */
export function GitDoorsCard(props: GitDoorsCardProps) {
  const { model, locale } = props;
  const [prForm, setPrForm] = useState(false);
  const [base, setBase] = useState('');
  const [title, setTitle] = useState('');
  const [prRejected, setPrRejected] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ readonly number: number; readonly head: string; readonly base: string } | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);

  const openPrForm = (): void => {
    // The prefill is the read's own word; a failed read leaves the field empty with its hint.
    setBase(props.gitBase !== null && props.gitBase.ok ? props.gitBase.base : '');
    setTitle('');
    setPrRejected(false);
    setPrForm(true);
  };
  const sendPr = (): void => {
    void props.onOpenPr({ base, ...(title.trim() !== '' ? { title } : {}) }).then((outcome) => {
      // Only the field's own verdict keeps the dialog open (the steer note's grammar); anything
      // else — an opened PR, the stored one a pr_exists answers — leaves the reporting to the
      // card and the toast.
      if (!outcome.result.ok && outcome.result.code === 'bad_input') setPrRejected(true);
      else setPrForm(false);
    });
  };

  return (
    <section
      data-decision-card="git"
      aria-label={t(locale, 'detail.git.branchLabel')}
      className="grid min-w-0 gap-3 rounded-card border border-hairline bg-surface px-5 py-4"
    >
      {/* U-344: the branch line is selectable text, never a control. */}
      <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem] text-inkdim">
        <span className="font-semibold text-ink">{t(locale, 'detail.git.branchLabel')}</span>
        <code className="min-w-0 font-mono text-[0.75rem] text-ink [overflow-wrap:anywhere]">{model.branch}</code>
      </p>
      {model.pr !== null ? (
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem] text-inkdim">
          <span className="font-semibold text-ink">{t(locale, 'detail.git.prLabel')}</span>
          <span className="min-w-0 font-mono text-[0.75rem] text-ink [overflow-wrap:anywhere]">
            #{model.pr.number} · {model.pr.url}
          </span>
          {model.pr.merged ? <span className="text-[0.75rem] text-proceed">{t(locale, 'detail.git.prMerged')}</span> : null}
        </p>
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {model.doors.map((door) => (
          <li key={door.kind} data-git-door={door.kind} className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionButton
              variant="neutral"
              disabled={!door.available}
              onClick={() => {
                if (door.kind === 'push') void props.onPush();
                else if (door.kind === 'openPr') openPrForm();
                else if (door.kind === 'merge') {
                  const pr = model.pr;
                  // The capture is the restatement: the dialog freezes what it will send.
                  if (pr !== null) setMergeTarget({ number: pr.number, head: pr.head, base: pr.base });
                } else setReleaseTarget(model.branch);
              }}
            >
              {t(locale, GIT_DOOR_LABEL[door.kind])}
            </ActionButton>
            {!door.available && door.reasonKey !== undefined ? (
              <span className="text-[0.78125rem] text-inkdim">{t(locale, door.reasonKey)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <InlineDialog active={prForm} onClose={() => setPrForm(false)}>
        {prForm ? (
          <div data-detail-git-pr className="grid gap-2 border-t border-hairline pt-3">
            <label htmlFor="git-pr-base" className="text-[0.8125rem] font-semibold text-ink">
              {t(locale, 'detail.git.openPr.baseLabel')}
            </label>
            <input
              id="git-pr-base"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              placeholder={t(locale, 'detail.git.openPr.basePlaceholder')}
              className={INPUT_CLASS}
            />
            {props.gitBase !== null && !props.gitBase.ok ? (
              <p className="m-0 text-[0.78125rem] text-inkdim">{t(locale, 'detail.git.openPr.baseHint')}</p>
            ) : null}
            <label htmlFor="git-pr-title" className="text-[0.8125rem] font-semibold text-ink">
              {t(locale, 'detail.git.openPr.titleLabel')}
            </label>
            <input
              id="git-pr-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t(locale, 'detail.git.openPr.titlePlaceholder')}
              className={INPUT_CLASS}
            />
            {prRejected ? (
              <p role="alert" className="m-0 text-[0.78125rem] text-error">
                {t(locale, 'detail.git.openPr.error')}
              </p>
            ) : null}
            <div className="flex gap-2">
              <ActionButton onClick={() => setPrForm(false)}>{t(locale, 'detail.action.cancel')}</ActionButton>
              <ActionButton variant="primary" size="md" disabled={base.trim() === ''} onClick={sendPr}>
                {t(locale, 'detail.git.openPr')}
              </ActionButton>
            </div>
          </div>
        ) : null}
      </InlineDialog>
      <InlineDialog active={mergeTarget !== null} onClose={() => setMergeTarget(null)}>
        {mergeTarget !== null ? (
          <div data-detail-git-merge className="grid gap-2 border-t border-hairline pt-3">
            <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'detail.git.merge.title')}</p>
            <p className="m-0 font-mono text-[0.75rem] text-inkdim [overflow-wrap:anywhere]">
              #{mergeTarget.number} · {mergeTarget.head} → {mergeTarget.base}
            </p>
            {props.failedChecks.length > 0 ? (
              <p className="m-0 text-[0.78125rem] text-inkdim">
                {t(locale, 'detail.git.merge.warning').replace('{names}', props.failedChecks.join(', '))}
              </p>
            ) : null}
            <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.git.merge.body')}</p>
            {/* Vazgeç comes first on purpose: the trap focuses the first stop, so the refusal —
                not the merge — is the dialog's default answer (İ1). */}
            <div className="flex gap-2">
              <ActionButton onClick={() => setMergeTarget(null)}>{t(locale, 'detail.action.cancel')}</ActionButton>
              <ActionButton
                variant="primary"
                size="md"
                onClick={() => {
                  const target = mergeTarget;
                  setMergeTarget(null);
                  // The command carries the number this dialog showed, nothing fresher.
                  void props.onMerge(target.number);
                }}
              >
                {t(locale, 'detail.git.merge.confirm')}
              </ActionButton>
            </div>
          </div>
        ) : null}
      </InlineDialog>
      <InlineDialog active={releaseTarget !== null} onClose={() => setReleaseTarget(null)}>
        {releaseTarget !== null ? (
          <div data-detail-git-release className="grid gap-2 border-t border-hairline pt-3">
            <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'detail.git.release.title')}</p>
            <p className="m-0 font-mono text-[0.75rem] text-inkdim [overflow-wrap:anywhere]">{releaseTarget}</p>
            <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.git.release.body')}</p>
            <div className="flex gap-2">
              <ActionButton onClick={() => setReleaseTarget(null)}>{t(locale, 'detail.action.cancel')}</ActionButton>
              <ActionButton
                variant="primary"
                size="md"
                onClick={() => {
                  setReleaseTarget(null);
                  void props.onRelease();
                }}
              >
                {t(locale, 'detail.git.release')}
              </ActionButton>
            </div>
          </div>
        ) : null}
      </InlineDialog>
    </section>
  );
}

export function DecisionZoneCards(props: DecisionZoneProps) {
  const { zone, locale } = props;
  return (
    <section id="detail-expected" data-detail-ask className="grid min-w-0 gap-3">
      <h2 id="detail-expected-heading" tabIndex={-1} className="m-0 text-[0.78125rem] font-semibold text-inkdim">
        {t(locale, 'detail.section.expected')}
      </h2>
      {zone.kind === 'quiet' ? (
        <p className="m-0 rounded-card border border-hairline bg-surface px-4 py-3 text-[0.8125rem] text-inkdim">
          {t(locale, zone.done ? 'detail.expected.done' : 'detail.expected.empty')}
        </p>
      ) : (
        <ul data-decision-stack className="m-0 grid min-w-0 list-none gap-3 p-0">
          {zone.cards.map((card) => {
            switch (card.kind) {
              case 'approve':
                return (
                  <ApproveCard
                    key={`approve:${card.gate.id}`}
                    gate={card.gate}
                    locale={locale}
                    parallel={props.parallel}
                    evidence={props.evidence}
                    onDecide={props.onDecide}
                    onEnqueue={props.onEnqueue}
                    onReviewChanges={props.onReviewChanges}
                    onOpenPage={props.onOpenPage}
                  />
                );
              case 'attest':
                return <AttestCard key={`attest:${card.gate.id}`} gate={card.gate} locale={locale} onAttest={props.onAttest} />;
              case 'deploy':
                return <DeployCard key={`deploy:${card.gate.id}`} gate={card.gate} locale={locale} onDeployApprove={props.onDeployApprove} />;
              case 'permission':
                return (
                  <PermissionCard key={`permission:${card.ask.askId}`} ask={card.ask} locale={locale} autoAllowed={props.autoAllowed} onAnswer={props.onAnswer} />
                );
              case 'failed':
                return (
                  <FailedCard
                    key="failed"
                    retry={card.retry}
                    locale={locale}
                    lastErrorLine={props.lastErrorLine}
                    failedRunCode={props.failedRunCode}
                    onOpenFailedRun={props.onOpenFailedRun}
                    onEnqueue={props.onEnqueue}
                    onCloseRequest={props.onCloseRequest}
                  />
                );
              case 'running':
                return (
                  <RunningCard
                    key={`running:${card.runId}`}
                    runId={card.runId}
                    stageName={card.stageName}
                    startedAt={card.startedAt}
                    canSteer={card.canSteer}
                    locale={locale}
                    onStop={props.onStop}
                    onSteer={props.onSteer}
                  />
                );
              case 'start':
                return <StartCard key="start" stageName={card.stageName} locale={locale} onEnqueue={props.onEnqueue} />;
            }
          })}
        </ul>
      )}
    </section>
  );
}
