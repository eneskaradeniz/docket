// components/new-work-order-window.tsx — the new-work-order dialog and the shared modal shell the
// Telefon window uses too. U-290: fixed read-only flow strip, no flow selector. U-291: planner
// stage-skip card when a proposal is supplied.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import {
  defaultFlow,
  flowChoices,
  openedWorkOrderForm,
  workOrderCreateIntent,
  workOrderCreateToasts,
  workOrderDraft,
  workOrderFormReducer,
  type FlowOption,
  type PinnedFlowView,
  type StageSkipDraftDecision,
  type StageSkipProposalCard,
  type WorkOrderCreateMode,
  type WorkOrderWindowCreateOutcome,
} from '../stores/work-order-window';
import { fill } from './chat-style';
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import { BoardLaunchers } from './launcher-rows';
import { FlowStrip } from './flow-strip';
import { MOTION, motionVars } from './motion';
import { StageSkipProposalCardView } from './stage-skip-proposal-card';
import { WindowFrame, WindowTitle } from './window-frame';

const INPUT_CLASS =
  'h-8 rounded-control border border-bord bg-raised px-2 text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

function usePaintedFlip(active: boolean): boolean {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlipped(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setFlipped(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active]);
  return flipped;
}

export interface ModalWindowProps {
  readonly open: boolean;
  readonly label: string;
  readonly titleId: string;
  readonly brand: string;
  readonly head: ReactNode;
  readonly footer?: ReactNode;
  readonly dataMark: string;
  readonly scrimMark: string;
  readonly onClose: () => void;
  readonly scrimCloses?: boolean;
  readonly compact?: boolean;
  readonly initialFocusRef?: { readonly current: HTMLElement | null };
  readonly children: ReactNode;
}

export function ModalWindow({ open, label, titleId, brand, head, footer, dataMark, scrimMark, onClose, scrimCloses = true, compact = false, initialFocusRef, children }: ModalWindowProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [mounted, setMounted] = useState(open);
  const entered = usePaintedFlip(mounted && open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (!open && wasOpen.current && restoreRef.current !== null) {
      restoreRef.current.focus();
      restoreRef.current = null;
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !mounted || panel === null) return;
    if (panel.contains(document.activeElement)) return;
    const start = initialFocusRef?.current ?? null;
    if (start !== null) start.focus();
    else panel.focus();
  }, [open, mounted, initialFocusRef]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted || open) return;
    const timer = window.setTimeout(() => setMounted(false), MOTION.close.panelMs + MOTION.close.backdropDelayMs + 120);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  if (!mounted) return null;

  const trapTab = (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const stops = [...panel.querySelectorAll<HTMLElement>('input, button:not([disabled]), select, textarea, [tabindex="0"]')];
    if (stops.length === 0) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = active === null ? -1 : stops.indexOf(active);
    const next =
      current === -1
        ? stops[event.shiftKey ? stops.length - 1 : 0]
        : stops[(current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  return (
    <div
      {...{ [scrimMark]: '' }}
      style={motionVars()}
      onMouseDown={(event) => {
        if (scrimCloses && event.target === event.currentTarget) onClose();
      }}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget && event.propertyName === 'opacity') setMounted(false);
      }}
      className={[
        'fixed inset-0 z-40 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center bg-bg/60 p-8',
        open ? '' : 'pointer-events-none',
        'transition-[opacity,backdrop-filter] [transition-timing-function:var(--motion-ease)]',
        entered
          ? 'opacity-100 backdrop-blur-md duration-[var(--motion-open-backdrop)]'
          : 'opacity-0 backdrop-blur-[0px] duration-[var(--motion-close)] delay-[var(--motion-close-backdrop-delay)]',
        'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0',
      ].join(' ')}
    >
      <WindowFrame
        frameRef={panelRef}
        label={label}
        labelledBy={titleId}
        brand={brand}
        rail={null}
        head={head}
        footer={footer}
        onKeyDown={onKeyDown}
        dataMark={dataMark}
        compact={compact}
        className={[
          compact ? '' : 'w-[32.5rem] max-w-[calc(100vw-4rem)]',
          'transition-[opacity,translate,scale] [transition-timing-function:var(--motion-ease)]',
          entered
            ? 'opacity-100 translate-y-0 scale-100 duration-[var(--motion-open-panel)] delay-[var(--motion-open-panel-delay)]'
            : 'opacity-0 translate-y-[var(--motion-open-rise)] scale-[var(--motion-open-scale)] duration-[var(--motion-close)]',
          'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
        ].join(' ')}
      >
        {children}
      </WindowFrame>
    </div>
  );
}

export interface NewWorkOrderWindowProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly projectName: string;
  readonly flows: readonly FlowOption[];
  readonly pinnedFlow: PinnedFlowView | null;
  readonly skipProposal: StageSkipProposalCard | null;
  readonly launchProject: string | null;
  readonly activeWorkOrderCount?: number;
  readonly onClose: () => void;
  readonly onCreated: (title: string) => void;
  readonly onCreate: (intent: {
    readonly title: string;
    readonly description: string;
    readonly flow: string;
    readonly mode: WorkOrderCreateMode;
    readonly skipProposal?: StageSkipProposalCard | null;
    readonly skipDecision?: StageSkipDraftDecision;
  }) => Promise<WorkOrderWindowCreateOutcome>;
}

export function NewWorkOrderWindow({
  open,
  locale,
  projectName,
  flows,
  pinnedFlow,
  skipProposal,
  launchProject,
  activeWorkOrderCount,
  onClose,
  onCreated,
  onCreate,
}: NewWorkOrderWindowProps) {
  const options = flowChoices(flows);
  const optionKey = options.map((option) => option.id).join('\n');
  const session = workOrderDraft.read();
  const [form, dispatch] = useReducer(workOrderFormReducer, openedWorkOrderForm(session, options));
  const titleRef = useRef<HTMLInputElement>(null);
  const selected = options.some((option) => option.id === form.flow) ? form.flow : defaultFlow(options);
  const flowReady = pinnedFlow !== null && pinnedFlow.stages.length > 0;
  const createDisabled = form.title.trim() === '' || !flowReady || form.submitting;

  useLayoutEffect(() => {
    if (!open) return;
    dispatch({ type: 'open', draft: workOrderDraft.read(), options });
  }, [open, optionKey]);

  const dismiss = (): void => {
    workOrderDraft.remember(form.title, form.description);
    onClose();
  };

  const submit = (mode: WorkOrderCreateMode): void => {
    const title = form.title.trim();
    if (title === '') {
      dispatch({ type: 'invalid', field: 'title_required' });
      return;
    }
    if (selected === '') {
      dispatch({ type: 'invalid', field: 'flow_required' });
      return;
    }
    dispatch({ type: 'submitting' });
    const intent = workOrderCreateIntent(form, selected, skipProposal);
    void onCreate({
      title: intent.title,
      description: intent.description,
      flow: intent.flow,
      mode,
      skipProposal: intent.skipProposal,
      skipDecision: intent.skipDecision,
    }).then((outcome) => {
      dispatch({ type: 'submit_done' });
      if (!outcome.ok && 'validation' in outcome) {
        dispatch({ type: 'invalid', field: outcome.validation });
        return;
      }
      if (outcome.ok) {
        for (const toast of workOrderCreateToasts(outcome)) {
          toastOutcome(locale, toast);
        }
        workOrderDraft.clear();
        dispatch({ type: 'created', options });
        onCreated(title);
        onClose();
        return;
      }
      dispatch({ type: 'failed', code: outcome.code });
    });
  };

  const titleId = 'new-work-order-title';
  const head = (
    <div className="flex items-start gap-3">
      <div id={titleId} className="min-w-0">
        <WindowTitle title={t(locale, 'workOrder.new.title')} />
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t(locale, 'workOrder.new.close')}
        title={t(locale, 'workOrder.new.close')}
        className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
      >
        <CloseIcon />
      </button>
    </div>
  );

  const footer = (
    <>
      <BoardLaunchers project={launchProject} onLaunch={dismiss} />
      <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-2 [&>button]:h-8">
        <ActionButton variant="neutral" size="md" onClick={dismiss}>
          {t(locale, 'workOrder.new.cancel')}
        </ActionButton>
        <ActionButton variant="neutral" size="md" disabled={createDisabled} onClick={() => submit('open')}>
          {form.submitting ? '…' : t(locale, 'workOrder.new.open')}
        </ActionButton>
        <ActionButton variant="primary" size="md" disabled={createDisabled} onClick={() => submit('open_and_start')}>
          {form.submitting ? '…' : t(locale, 'workOrder.new.openAndStart')}
        </ActionButton>
      </span>
    </>
  );

  const stageLabels =
    pinnedFlow === null ? [] : pinnedFlow.stages.map((stage) => ({ id: stage.stageId, name: stage.stageName }));

  return (
    <ModalWindow
      open={open}
      compact
      label={t(locale, 'workOrder.new.title')}
      titleId={titleId}
      brand={t(locale, 'workOrder.new.title')}
      head={head}
      footer={footer}
      dataMark="data-new-work-order"
      scrimMark="data-new-work-order-scrim"
      onClose={dismiss}
      initialFocusRef={titleRef}
    >
      <div className="grid gap-4">
        <p className="text-[13px] text-ink">
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.project')}</span>
          <span className="mt-1 block text-[14px]">{projectName}</span>
        </p>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.titleLabel')}</span>
          <input
            ref={titleRef}
            role="textbox"
            aria-label={t(locale, 'workOrder.new.titleLabel')}
            value={form.title}
            onChange={(event) => {
              dispatch({ type: 'title', value: event.target.value });
              workOrderDraft.remember(event.target.value, form.description);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit('open');
              }
            }}
            placeholder={t(locale, 'workOrder.new.titlePlaceholder')}
            className={INPUT_CLASS}
          />
          {form.fieldError === 'title_required' ? (
            <p role="alert" className="text-[12px] text-error">
              {t(locale, 'validate.title_required')}
            </p>
          ) : null}
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.descriptionLabel')}</span>
          <textarea
            role="textbox"
            aria-label={t(locale, 'workOrder.new.descriptionLabel')}
            value={form.description}
            onChange={(event) => {
              dispatch({ type: 'description', value: event.target.value });
              workOrderDraft.remember(form.title, event.target.value);
            }}
            rows={4}
            className={`${INPUT_CLASS} resize-y py-1.5`}
          />
          <p className="text-[12px] text-inkdim">{t(locale, 'workOrder.new.descriptionHint')}</p>
        </label>
        {flowReady && pinnedFlow !== null ? (
          <div className="grid gap-1.5">
            <FlowStrip locale={locale} flow={pinnedFlow} skippedStageIds={form.skippedStageIds} />
            {pinnedFlow.humanGateCount !== null ? (
              <p className="text-[12px] text-inkdim">
                {fill(t(locale, 'workOrder.flowStrip.gateCount'), { count: pinnedFlow.humanGateCount })}
              </p>
            ) : null}
          </div>
        ) : (
          <p role="alert" className="text-[12px] text-error">{t(locale, 'workOrder.new.noFlow')}</p>
        )}
        {skipProposal !== null && form.skipDecision === null ? (
          <StageSkipProposalCardView
            locale={locale}
            proposal={skipProposal}
            stageLabels={stageLabels}
            decided={false}
            onSkip={() => dispatch({ type: 'skip_approve', stages: skipProposal.stages })}
            onDoNotSkip={() => dispatch({ type: 'skip_reject' })}
          />
        ) : null}
        {form.failure !== null ? (
          <p role="alert" className="text-[13px] text-error">
            {t(locale, failureKey(form.failure))}
          </p>
        ) : null}
        {activeWorkOrderCount !== undefined && activeWorkOrderCount > 0 ? (
          <p data-new-work-order-branch-hint="" className="m-0 text-[0.75rem] text-inkdim">
            {t(locale, 'workOrder.new.openBranchesHint')}
          </p>
        ) : null}
      </div>
    </ModalWindow>
  );
}
