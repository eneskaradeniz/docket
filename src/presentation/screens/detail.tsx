// screens/detail.tsx — the work-order detail screen (U-4's window): the stage list with gate
// states, the deploy approval flow whose typed confirmation mirrors E-8 at the button itself (the
// store already blocks the intent — the screen keeps the button disabled so the refusal is never
// the first feedback), permission asks with allow/deny, the secret-scan evidence view, the run
// list and the environments section. Every decision is a store intent; the screen only renders
// state and forwards clicks, and every user-visible string arrives through a label key (U-1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkOrderStatus } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { OutcomeNotice } from '../components/outcome-notice';
import { SectionCard } from '../components/section-card';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import type {
  DeployApproveInput,
  DeployGateView,
  GateView,
  StageGates,
  WorkOrderDetailStore,
} from '../stores/work-order-detail';
import { failureKey } from '../stores/results';

/** A permission ask this work order's run is waiting on. The store carries only the answer
 *  intent; composition feeds the asks from whatever stream it trusts (the live pane's fold or a
 *  later query). Rendering them topmost: an unanswered ask stops a run cold. */
export interface WorkOrderAskView {
  readonly runId: string;
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
}

export interface WorkOrderDetailScreenProps {
  readonly store: WorkOrderDetailStore;
  readonly workOrderId: string;
  readonly locale: Locale;
  readonly asks?: readonly WorkOrderAskView[];
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
    <div className="mt-2 grid gap-2 rounded-md border border-hairline bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[13px] text-ink">{deploy.environment}</code>
        {deploy.protectedEnvironment ? <StateBadge tone="signal">{t(locale, 'gate.deploy.protected')}</StateBadge> : null}
        {deploy.promoteFromChain.length > 0 ? (
          <span className="font-mono text-[11px] text-inkdim">
            {t(locale, 'gate.deploy.prerequisite')}: {deploy.promoteFromChain.join(' → ')}
          </span>
        ) : null}
      </div>
      <label className="grid gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'detail.deploy.commitLabel')}</span>
        <input
          value={commit}
          onChange={(event) => setCommit(event.target.value)}
          placeholder={t(locale, 'detail.deploy.commitPlaceholder')}
          className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
        />
      </label>
      {deploy.protectedEnvironment ? (
        <div className="grid gap-1">
          <p className="text-[13px] text-ink">{t(locale, 'detail.deploy.confirmPrompt')}</p>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={t(locale, 'detail.deploy.confirmPlaceholder')}
            className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
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
  onDecide,
  onApproveDeploy,
}: {
  readonly gate: GateView;
  readonly current: boolean;
  readonly locale: Locale;
  readonly onDecide: (gate: string, decision: 'approved' | 'rejected') => void;
  readonly onApproveDeploy: (input: DeployApproveInput) => void;
}) {
  const actionable = current && gate.status === 'pending';
  return (
    <li className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-ink">{t(locale, GATE_KIND_KEY[gate.kind])}</span>
          <code className="truncate font-mono text-[11px] text-inkdim">{gate.id}</code>
        </div>
        <div className="flex items-center gap-2">
          {actionable && isHumanDecision(gate) ? (
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
        <p className="mt-1.5 border-l-2 border-hairline pl-2.5 text-[12.5px] text-inkdim">
          {t(locale, gate.status === 'pending' ? 'detail.secretScan.pending' : 'detail.secretScan.passed')}
        </p>
      ) : null}
    </li>
  );
}

export function WorkOrderDetailScreen({ store, workOrderId, locale, asks = [] }: WorkOrderDetailScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(workOrderId);
  }, [store, workOrderId]);

  const view = state.view;
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
    <div className="grid gap-4">
      <header className="grid gap-1.5">
        {view === null ? (
          state.loading ? (
            <p className="font-mono text-[12px] text-inkdim">{t(locale, 'detail.loading')}</p>
          ) : null
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[19px] font-bold tracking-tight text-ink">{view.record.title}</h1>
              <StateBadge tone={STATUS_TONE[view.state.status]}>{t(locale, STATUS_KEY[view.state.status])}</StateBadge>
            </div>
            <p className="font-mono text-[11.5px] text-inkdim">
              {view.record.workspace} · {view.record.flow}
              {currentStage !== undefined ? ` · ${currentStage.name}` : ''}
            </p>
          </>
        )}
      </header>

      {state.problem !== null ? (
        <div role="alert" className="rounded-md border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {state.lastOutcome !== null ? (
        <OutcomeNotice
          ok={state.lastOutcome.result.ok}
          text={t(locale, state.lastOutcome.labelKey)}
          code={state.lastOutcome.result.ok ? undefined : state.lastOutcome.result.code}
        />
      ) : null}

      {asks.length > 0 ? (
        <SectionCard title={t(locale, 'detail.section.asks')}>
          <ul className="grid gap-2">
            {asks.map((ask) => (
              <li key={ask.askId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-signal/40 bg-surface px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2 w-2 flex-none rounded-full bg-signal motion-safe:animate-pulse" />
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] text-ink">{ask.tool}</span>
                    {ask.target !== null ? <code className="block truncate font-mono text-[11px] text-inkdim">{ask.target}</code> : null}
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

      <SectionCard
        title={t(locale, 'detail.section.stages')}
        action={
          view !== null && view.next.kind === 'start_run' ? (
            <ActionButton variant="primary" onClick={() => void store.enqueue()}>
              {t(locale, 'detail.action.startStage')}
            </ActionButton>
          ) : null
        }
      >
        <ol className="grid gap-3">
          {state.stages.map((stage: StageGates, index: number) => (
            <li key={stage.stage} className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-inkdim">{String(index + 1).padStart(2, '0')}</span>
                <span className={`text-[14px] font-semibold ${stage.current ? 'text-ink' : 'text-inkdim'}`}>{stage.name}</span>
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

      <SectionCard title={t(locale, 'detail.section.runs')}>
        {view === null || view.runs.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'detail.run.empty')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {view.runs.map((run) => {
              const outcome = run.endedAt === undefined ? 'running' : (run.outcome ?? 'running');
              return (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <code className="font-mono text-[12px] text-ink">{run.id}</code>
                    <code className="font-mono text-[11px] text-inkdim">{run.stage}</code>
                  </div>
                  <StateBadge tone={RUN_OUTCOME_TONE[outcome]}>{t(locale, RUN_OUTCOME_KEY[outcome])}</StateBadge>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {environments.length > 0 ? (
        <SectionCard title={t(locale, 'detail.section.environments')}>
          <ul className="grid gap-1.5">
            {environments.map((deploy) => (
              <li key={deploy.environment} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <code className="font-mono text-[13px] text-ink">{deploy.environment}</code>
                  {deploy.protectedEnvironment ? <StateBadge tone="signal">{t(locale, 'gate.deploy.protected')}</StateBadge> : null}
                </div>
                {deploy.promoteFromChain.length > 0 ? (
                  <span className="font-mono text-[11px] text-inkdim">
                    {t(locale, 'gate.deploy.prerequisite')}: {deploy.promoteFromChain.join(' → ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
