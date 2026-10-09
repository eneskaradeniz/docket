// screens/detail.tsx — the work-order detail screen (U-4's window, opened in place of where the
// work order was reached from — U-19): the back row returns to that screen, the flow strip marks
// the pending gates amber and dashed, the left column carries "bu aşamada senden beklenen" with
// the actions that map U-4's intents and the stage list under it, and the live pane rides beside
// it, sticky, while a run of this work order is still going. The deploy approval's typed
// confirmation mirrors E-8 at the button itself. Every decision is a store intent; the screen
// only renders state and forwards clicks, and every user-visible string arrives through a label
// key (U-1).
// An ask's texts carry no break opportunities to rely on (whole commands, long titles), so every
// box between such text and the ask column must be allowed to shrink below its content
// (`min-w-0`) — intrinsic min-content otherwise widens the column's grids past the track the
// detail layout pins — and the text either wraps anywhere or truncates with the full value on
// its title. The layout audit's L-15 measures the result on the real asking screen.
// The body columnates on main's container (U-55): the live pane is the fixed 22.5 rem second
// column from ≥900, the runs list joins it as the 21.25 rem third column at ≥1700, and below 900
// everything stacks. The screen fills the main column at every width (U-54).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkOrderStatus } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { SectionCard } from '../components/section-card';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import { formatWorkOrderCode } from '../stores/work-order-code';
import type {
  DeployApproveInput,
  DeployGateView,
  GateView,
  StageGates,
  WorkOrderAskView,
  WorkOrderDetailStore,
} from '../stores/work-order-detail';
import { flowChips } from '../stores/work-order-detail';
import { failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import { LivePaneScreen } from './live';

export interface WorkOrderDetailScreenProps {
  readonly store: WorkOrderDetailStore;
  readonly workOrderId: string;
  readonly locale: Locale;
  /** Where the detail was opened from — the back row names it (U-19); null means no previous
   *  entry stands behind it, and the row stays hidden (U-25). */
  readonly backKey: 'detail.back.board' | 'detail.back.cockpit' | 'detail.back.account' | 'detail.back.roadmap' | null;
  readonly onBack: () => void;
}

const STATUS_TONE: Readonly<Record<WorkOrderStatus, BadgeTone>> = {
  ready: 'info',
  running: 'proceed',
  gating: 'info',
  awaiting_human: 'signal',
  limit_waiting: 'info',
  blocked: 'error',
  done: 'proceed',
};

const STATUS_KEY: Readonly<Record<WorkOrderStatus, LabelKey>> = {
  ready: 'wo.status.ready',
  running: 'wo.status.running',
  gating: 'wo.status.gating',
  awaiting_human: 'wo.status.awaiting_human',
  limit_waiting: 'wo.status.limit_waiting',
  blocked: 'wo.status.blocked',
  done: 'wo.status.done',
};

const GATE_KIND_KEY: Readonly<Record<GateView['kind'], LabelKey>> = {
  human: 'gate.kind.human',
  command: 'gate.kind.command',
  changes: 'gate.kind.changes',
  agent_verdict: 'gate.kind.agent_verdict',
  secret_scan: 'gate.kind.secret_scan',
  page_approval: 'gate.kind.page_approval',
  deploy: 'gate.kind.deploy',
  remote_checks: 'gate.kind.remote_checks',
};

const GATE_STATUS_TONE: Readonly<Record<GateView['status'], BadgeTone>> = {
  pending: 'signal',
  passed: 'proceed',
  upcoming: 'dim',
};

const GATE_STATUS_KEY: Readonly<Record<GateView['status'], LabelKey>> = {
  pending: 'gate.state.pending',
  passed: 'gate.state.passed',
  upcoming: 'gate.state.upcoming',
};

const RUN_OUTCOME_TONE: Readonly<Record<'running' | 'succeeded' | 'failed' | 'limit' | 'cancelled', BadgeTone>> = {
  running: 'proceed',
  succeeded: 'proceed',
  failed: 'error',
  limit: 'signal',
  cancelled: 'dim',
};

const RUN_OUTCOME_KEY: Readonly<Record<'running' | 'succeeded' | 'failed' | 'limit' | 'cancelled', LabelKey>> = {
  running: 'detail.run.running',
  succeeded: 'run.outcome.succeeded',
  failed: 'run.outcome.failed',
  limit: 'run.outcome.limit',
  cancelled: 'run.outcome.cancelled',
};

/** The run lamp: green while going or finished well, red failed, amber hit a limit, dim ended by
 *  a person — the row grammar the board and the cockpit already speak. */
const RUN_OUTCOME_LAMP: Readonly<Record<'running' | 'succeeded' | 'failed' | 'limit' | 'cancelled', string>> = {
  running: 'bg-proceed motion-safe:animate-pulse',
  succeeded: 'bg-proceed',
  failed: 'bg-error',
  limit: 'bg-signal',
  cancelled: 'bg-inkdim',
};

const INPUT_CLASS =
  'rounded-control border border-bord bg-raised px-2 py-[0.3125rem] font-mono text-[0.8125rem] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-inkdim';

/** Only a person opens these two kinds; every other gate is machine-evaluated, so only these
 *  carry approve/reject buttons. */
const isHumanDecision = (gate: GateView): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/** The deploy approval form (E-8 at the screen): the commit being deployed, and — for a protected
 *  environment — the typed confirmation that must equal the environment name before the approve
 *  button unlocks. The store re-checks the same equality before issuing the command. */
function DeployApprovalForm({
  gateId,
  deploy,
  locale,
  onApprove,
}: {
  readonly gateId: string;
  readonly deploy: DeployGateView;
  readonly locale: Locale;
  readonly onApprove: (input: DeployApproveInput) => void;
}) {
  const [commit, setCommit] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const commitReady = commit.trim() !== '';
  // The E-8 mirror: an unprotected environment needs no typed confirmation at all.
  const confirmationReady = !deploy.protectedEnvironment || confirmation === deploy.environment;
  const approve = (): void => {
    onApprove({
      gate: gateId,
      commit: commit.trim(),
      ...(deploy.protectedEnvironment ? { confirmedEnvironment: confirmation } : {}),
    });
  };
  return (
    <div className="mt-2 grid gap-2 rounded-card border border-hairline bg-band p-3">
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
          <p className="text-[0.8125rem] text-ink">{t(locale, 'detail.deploy.confirmPrompt')}</p>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={t(locale, 'detail.deploy.confirmPlaceholder')}
            className={INPUT_CLASS}
          />
        </div>
      ) : null}
      <div>
        <ActionButton variant="primary" size="md" disabled={!(commitReady && confirmationReady)} onClick={approve}>
          {t(locale, 'detail.deploy.approve')}
        </ActionButton>
      </div>
    </div>
  );
}

/** One gate row: kind name, slug, state badge — plus, in the current stage, the decision the
 *  gate's kind actually accepts: human gates take approve/reject, deploy gates take the typed
 *  approval form, secret-scan gates show their evidence standing. */
function GateRow({
  gate,
  current,
  locale,
  awaitingHuman,
  onDecide,
  onApproveDeploy,
}: {
  readonly gate: GateView;
  readonly current: boolean;
  readonly locale: Locale;
  /** Whether the work order actually waits for a person — a pre-filled pending gate in `ready`
   *  is listed, but its decision buttons stay hidden until the stage asks. */
  readonly awaitingHuman: boolean;
  readonly onDecide: (gate: string, decision: 'approved' | 'rejected') => void;
  readonly onApproveDeploy: (input: DeployApproveInput) => void;
}) {
  const actionable = current && gate.status === 'pending';
  // A gate that waits on the operator tints its edge amber — the same attention edge the
  // cockpit's rows carry; machine gates keep the plain hairline.
  const edge = actionable && (isHumanDecision(gate) || gate.kind === 'deploy') ? 'border-signal/40' : 'border-hairline';
  return (
    <li className={`rounded-card border bg-surface px-3 py-2 ${edge}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[0.84375rem] font-semibold text-ink">{t(locale, GATE_KIND_KEY[gate.kind])}</span>
          <code className="truncate font-mono text-[0.6875rem] text-inkdim" title={gate.id}>{gate.id}</code>
        </div>
        <div className="flex items-center gap-2">
          {actionable && awaitingHuman && isHumanDecision(gate) ? (
            <>
              <ActionButton variant="neutral" onClick={() => onDecide(gate.id, 'rejected')}>
                {t(locale, 'action.reject')}
              </ActionButton>
              <ActionButton variant="primary" onClick={() => onDecide(gate.id, 'approved')}>
                {t(locale, 'action.approve')}
              </ActionButton>
            </>
          ) : null}
          <StateBadge tone={GATE_STATUS_TONE[gate.status]}>{t(locale, GATE_STATUS_KEY[gate.status])}</StateBadge>
        </div>
      </div>
      {actionable && gate.kind === 'deploy' && gate.deploy !== undefined ? (
        <DeployApprovalForm gateId={gate.id} deploy={gate.deploy} locale={locale} onApprove={onApproveDeploy} />
      ) : null}
      {current && gate.kind === 'secret_scan' && gate.status !== 'upcoming' ? (
        <p className="mt-1.5 border-l-2 border-hairline pl-2.5 text-[0.78125rem] text-inkdim">
          {t(locale, gate.status === 'pending' ? 'detail.secretScan.pending' : 'detail.secretScan.passed')}
        </p>
      ) : null}
    </li>
  );
}

/** The flow strip (U-19): the stages as chips — done ones carry the check, the current is
 *  outlined — with the current stage's pending gates as dashed amber chips right after it. */
function FlowStrip({ stages, locale }: { readonly stages: readonly StageGates[]; readonly locale: Locale }) {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
      {flowChips(stages).map((chip, index) =>
        chip.kind === 'stage' ? (
          <span
            key={`${chip.name}:${index}`}
            className={`inline-flex h-[1.625rem] flex-none items-center gap-[0.3125rem] rounded-control px-2.5 text-[0.78125rem] ${
              chip.standing === 'done' ? 'bg-raised text-ink' : chip.standing === 'current'
              ? 'bg-raised text-ink shadow-[0_0_0_1.5px_var(--signal)]'
              : 'bg-raised text-inkdim'
            }`}
          >
            {chip.standing === 'done' ? (
              <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-proceed font-mono text-[0.5625rem] font-bold leading-4 text-black">
                ✓
              </span>
            ) : null}
            {chip.name}
          </span>
        ) : (
          <span
            key={`gate:${chip.name}:${index}`}
            className="inline-flex h-[1.625rem] flex-none items-center rounded-control border border-dashed border-signal px-2.5 text-[0.71875rem] text-signal"
          >
            {t(locale, 'detail.flow.gate')} · {chip.name}
          </span>
        ),
      )}
    </div>
  );
}

export function WorkOrderDetailScreen({ store, workOrderId, locale, backKey, onBack }: WorkOrderDetailScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  useEffect(() => {
    void store.load(workOrderId);
  }, [store, workOrderId]);
  // Every intent's report leaves as the one toast (U-50) — once per outcome, so a re-render or
  // a reload of the same standing never repeats it.
  const lastOutcome = state.lastOutcome;
  useEffect(() => {
    if (lastOutcome !== null) toastOutcome(locale, lastOutcome);
  }, [lastOutcome, locale]);

  const view = state.view;
  const asks = state.asks;
  // The live pane exists for a run that is still going; a finished work order shows its history
  // in the run list instead.
  const livePaneVisible = view !== null && view.runs.some((run) => run.endedAt === undefined);
  const currentStage = state.stages.find((stage) => stage.current);
  // The environments the flow's deploy gates actually target, in flow order, deduplicated —
  // the read-only promotion facts (E-5) the operator needs before approving anything.
  const environments: DeployGateView[] = [];
  const seen = new Set<string>();
  for (const stage of state.stages) {
    for (const gate of stage.gates) {
      if (gate.deploy === undefined || seen.has(gate.deploy.environment)) continue;
      seen.add(gate.deploy.environment);
      environments.push(gate.deploy);
    }
  }
  // What the expected-of-you card decides on: the current stage's pending human gate, but only
  // while the work order actually waits for a person — the fold pre-fills the stage's gates in
  // `ready` too, and there the card must lose to the start action (U-4).
  const awaitingHuman = view !== null && view.state.status === 'awaiting_human';
  const pendingHumanGate = awaitingHuman
    ? currentStage?.gates.find((gate) => gate.status === 'pending' && isHumanDecision(gate))
    : undefined;
  const canStart = view !== null && view.next.kind === 'start_run';

  const decide = (gate: string, decision: 'approved' | 'rejected'): void => {
    void store.decideGate({ gate, decision });
  };
  const approveDeploy = (input: DeployApproveInput): void => {
    void store.approveDeploy(input);
  };
  const answer = (ask: WorkOrderAskView, decision: 'allow' | 'deny'): void => {
    void store.answerPermission({ runId: ask.runId, askId: ask.askId, decision });
  };

  return (
    <div className="grid gap-5">
      {backKey !== null ? (
        <div className="-mb-2">
          <ActionButton variant="ghost" onClick={onBack}>
            {t(locale, backKey)}
          </ActionButton>
        </div>
      ) : null}

      <header className="grid gap-1">
        {view === null ? (
          state.loading ? (
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'detail.loading')}</p>
          ) : null
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[0.6875rem] text-inkdim">{formatWorkOrderCode(view.number, locale)}</span>
              <h1 className="text-[1.25rem] font-bold tracking-[-0.01em] text-ink">{view.record.title}</h1>
              <StateBadge tone={STATUS_TONE[view.state.status]}>{t(locale, STATUS_KEY[view.state.status])}</StateBadge>
            </div>
            <p className="font-mono text-[0.71875rem] text-inkdim">
              {view.record.repo} · {view.record.flow}
              {currentStage !== undefined ? ` · ${currentStage.name}` : ''}
            </p>
          </>
        )}
      </header>

      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[0.8125rem] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {view !== null ? <FlowStrip stages={state.stages} locale={locale} /> : null}

      <div className="grid items-start gap-5 @[900px]:grid-cols-[minmax(0,1fr)_22.5rem] @[1700px]:grid-cols-[minmax(0,1fr)_22.5rem_21.25rem]">
        <div className="grid min-w-0 gap-5" data-detail-ask>
          {asks.length > 0 ? (
            <SectionCard title={t(locale, 'detail.section.asks')}>
              <ul className="grid min-w-0 gap-2">
                {asks.map((ask) => (
                  <li key={ask.askId} className="min-w-0 flex flex-wrap items-center justify-between gap-2 rounded-card border border-signal/40 bg-surface px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-signal motion-safe:animate-pulse" />
                      <div className="min-w-0">
                        <span className="block truncate font-mono text-[0.8125rem] text-ink" title={ask.tool}>{ask.tool}</span>
                        {ask.target !== null ? (
                          <code className="block truncate font-mono text-[0.6875rem] text-inkdim" title={ask.target}>
                            {ask.target}
                          </code>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ActionButton variant="neutral" onClick={() => answer(ask, 'deny')}>
                        {t(locale, 'action.deny')}
                      </ActionButton>
                      <ActionButton variant="primary" onClick={() => answer(ask, 'allow')}>
                        {t(locale, 'action.allow')}
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <section className="grid gap-2.5">
            <h2 className="text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'detail.section.expected')}</h2>
            {view === null ? null : pendingHumanGate !== undefined ? (
              <div className="rounded-card border border-hairline bg-surface p-4">
                <p className="text-[0.875rem] font-semibold text-ink">{pendingHumanGate.label ?? pendingHumanGate.id}</p>
                <p className="mt-1.5 text-[0.8125rem] text-inkdim">{t(locale, 'detail.expected.body')}</p>
                <div className="mt-3.5 flex gap-2">
                  <ActionButton variant="neutral" size="md" onClick={() => decide(pendingHumanGate.id, 'rejected')}>
                    {t(locale, 'detail.expected.refuse')}
                  </ActionButton>
                  <ActionButton variant="primary" size="md" onClick={() => decide(pendingHumanGate.id, 'approved')}>
                    {t(locale, 'detail.expected.approve')}
                  </ActionButton>
                </div>
              </div>
            ) : canStart ? (
              <div className="rounded-card border border-hairline bg-surface p-4">
                <p className="mt-1.5 text-[0.8125rem] text-inkdim">{t(locale, 'detail.expected.empty')}</p>
                <div className="mt-3.5">
                  <ActionButton variant="primary" size="md" onClick={() => void store.enqueue()}>
                    {t(locale, 'detail.action.startStage')}
                  </ActionButton>
                </div>
              </div>
            ) : (
              <div className="rounded-card border border-hairline bg-surface p-4">
                <p className="mt-1.5 text-[0.8125rem] text-inkdim">
                  {t(locale, view.state.status === 'done' ? 'detail.expected.done' : 'detail.expected.empty')}
                </p>
              </div>
            )}
          </section>

          <SectionCard title={t(locale, 'detail.section.stages')}>
            <ol className="grid gap-3">
              {state.stages.map((stage: StageGates, index: number) => (
                <li key={stage.stage} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-mono text-[0.8125rem] ${stage.current ? 'text-signal' : 'text-inkdim'}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className={`text-[0.875rem] font-semibold ${stage.current ? 'text-ink' : 'text-inkdim'}`}>{stage.name}</span>
                    {stage.current ? <StateBadge tone="signal">{t(locale, 'detail.stage.current')}</StateBadge> : null}
                  </div>
                  {stage.gates.length > 0 ? (
                    <ul className="grid gap-1.5">
                      {stage.gates.map((gate) => (
                        <GateRow
                          key={gate.id}
                          gate={gate}
                          current={stage.current}
                          locale={locale}
                          awaitingHuman={awaitingHuman}
                          onDecide={decide}
                          onApproveDeploy={approveDeploy}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </SectionCard>

          {environments.length > 0 ? (
            <SectionCard title={t(locale, 'detail.section.environments')}>
              <ul className="grid gap-1.5">
                {environments.map((deploy) => (
                  <li key={deploy.environment} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-surface px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info" />
                      <code className="font-mono text-[0.8125rem] text-ink">{deploy.environment}</code>
                      {deploy.protectedEnvironment ? <StateBadge tone="signal">{t(locale, 'gate.deploy.protected')}</StateBadge> : null}
                    </div>
                    {deploy.promoteFromChain.length > 0 ? (
                      <span className="font-mono text-[0.6875rem] text-inkdim">
                        {t(locale, 'gate.deploy.prerequisite')}: {deploy.promoteFromChain.join(' → ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        {livePaneVisible ? (
          <div className="sticky top-0 min-w-0" data-detail-live>
            <LivePaneScreen store={store.pane} locale={locale} />
          </div>
        ) : null}

        {/* U-55: the runs list spans the two columns below 1700 and takes the third column's
            place beside the live pane from ≥1700 — auto placement lands it there through the
            explicit start, with or without a live pane showing. */}
        <div className="grid min-w-0 gap-5 self-start @[900px]:col-span-2 @[1700px]:col-span-1 @[1700px]:col-start-3">
          <SectionCard title={t(locale, 'detail.section.runs')}>
            {view === null || view.runs.length === 0 ? (
              <p className="text-[0.8125rem] text-inkdim">{t(locale, 'detail.run.empty')}</p>
            ) : (
              <ul className="grid gap-1.5">
                {view.runs.map((run) => {
                  const outcome = run.endedAt === undefined ? 'running' : (run.outcome ?? 'running');
                  return (
                    <li key={run.id} className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2">
                      <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${RUN_OUTCOME_LAMP[outcome]}`} />
                      <div className="flex min-w-0 items-baseline gap-2">
                        <code className="truncate font-mono text-[0.75rem] text-ink">{run.id}</code>
                        <code className="truncate font-mono text-[0.6875rem] text-inkdim">{run.stage}</code>
                      </div>
                      <StateBadge tone={RUN_OUTCOME_TONE[outcome]}>{t(locale, RUN_OUTCOME_KEY[outcome])}</StateBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
