// components/new-work-order-window.tsx — the new-work-order dialog and the shared modal shell the
// Telefon window uses too. The shell is a Window: focus moves in on open and stays trapped, Esc
// and the scrim and the close control all close it, and focus returns to the control that opened
// it. Reduced motion is a fade only. A typed title is kept for the session; an empty one is not,
// so closing never asks. Every open selects `standard` when the project lists it, otherwise the
// first flow it does list — the same id the command sends.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import type { CreateOutcome } from '../stores/board';
import { failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import {
  defaultFlow,
  flowChoices,
  openedWorkOrderForm,
  workOrderDraft,
  workOrderFormReducer,
  workOrderOpenToast,
  type FlowOption,
} from '../stores/work-order-window';
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import { BoardLaunchers } from './launcher-rows';
import { MOTION, motionVars } from './motion';
import { WindowFrame, WindowTitle } from './window-frame';

const INPUT_CLASS =
  'h-8 rounded-control border border-bord bg-raised px-2 text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

/** Flips to true only once `active` has survived a painted frame, so the enter transition has a
 *  hidden start state to chase. */
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
  readonly children: ReactNode;
}

/** The shared dialog shell. Focus returns to the opener on every close — pointer and keyboard —
 *  because the opener is the control the operator just used. */
export function ModalWindow({ open, label, titleId, brand, head, footer, dataMark, scrimMark, onClose, children }: ModalWindowProps) {
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
    if (open && mounted && panel !== null && !panel.contains(document.activeElement)) panel.focus();
  }, [open, mounted]);

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
        if (event.target === event.currentTarget) onClose();
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
        className={[
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
  readonly launchProject: string | null;
  readonly onClose: () => void;
  readonly onCreated: (title: string) => void;
  readonly onCreate: (intent: { readonly title: string; readonly flow: string }) => Promise<CreateOutcome>;
}

export function NewWorkOrderWindow({
  open,
  locale,
  projectName,
  flows,
  launchProject,
  onClose,
  onCreated,
  onCreate,
}: NewWorkOrderWindowProps) {
  const options = flowChoices(flows);
  const optionKey = options.map((option) => option.id).join('\n');
  const [form, dispatch] = useReducer(workOrderFormReducer, openedWorkOrderForm(workOrderDraft.read(), options));
  const titleRef = useRef<HTMLInputElement>(null);
  // The shown value is the one the command sends. A flow the list does not contain falls back to
  // the same default a fresh open would pick, never to an id that is not an option.
  const selected = options.some((option) => option.id === form.flow) ? form.flow : defaultFlow(options);

  // `optionKey` stands in for the list: `options` is a new array on every board render, and
  // depending on it would wipe a selection the operator had just made.
  useLayoutEffect(() => {
    if (!open) return;
    dispatch({ type: 'open', draft: workOrderDraft.read(), options });
    titleRef.current?.focus();
  }, [open, optionKey]);

  const dismiss = (): void => {
    workOrderDraft.remember(form.title);
    onClose();
  };

  const submit = (): void => {
    const title = form.title.trim();
    if (title === '') {
      dispatch({ type: 'invalid', field: 'title_required' });
      return;
    }
    if (selected === '') {
      dispatch({ type: 'invalid', field: 'flow_required' });
      return;
    }
    void onCreate({ title, flow: selected }).then((outcome) => {
      if (!outcome.ok && 'validation' in outcome) {
        dispatch({ type: 'invalid', field: outcome.validation });
        return;
      }
      // Success and a command refusal both leave through the command-result table. A refusal
      // keeps the window up so the same sentence can sit beside the field.
      toastOutcome(locale, workOrderOpenToast(outcome));
      if (outcome.ok) {
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
      <span className="inline-flex [&>button]:h-8">
        <ActionButton variant="neutral" size="md" onClick={dismiss}>
          {t(locale, 'workOrder.new.cancel')}
        </ActionButton>
      </span>
      <BoardLaunchers project={launchProject} onLaunch={dismiss} />
      <span className="ml-auto inline-flex [&>button]:h-8">
        <ActionButton variant="primary" size="md" disabled={options.length === 0} onClick={submit}>
          {t(locale, 'workOrder.new.open')}
        </ActionButton>
      </span>
    </>
  );

  return (
    <ModalWindow
      open={open}
      label={t(locale, 'workOrder.new.title')}
      titleId={titleId}
      brand={t(locale, 'workOrder.new.title')}
      head={head}
      footer={footer}
      dataMark="data-new-work-order"
      scrimMark="data-new-work-order-scrim"
      onClose={dismiss}
    >
      <div className="grid max-w-[36rem] gap-4">
        <p className="text-[13px] text-ink">
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.project')}</span>
          <span className="mt-1 block text-[14px]">{projectName}</span>
        </p>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.titleLabel')}</span>
          <input
            ref={titleRef}
            value={form.title}
            onChange={(event) => {
              dispatch({ type: 'title', value: event.target.value });
              workOrderDraft.remember(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
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
          <span className={LABEL_CLASS}>{t(locale, 'workOrder.new.flowLabel')}</span>
          <select
            value={selected}
            onChange={(event) => dispatch({ type: 'flow', value: event.target.value })}
            className={INPUT_CLASS}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {options.length === 0 ? (
            <p role="alert" className="text-[12px] text-error">
              {t(locale, 'workOrder.new.noFlow')}
            </p>
          ) : null}
          {form.fieldError === 'flow_required' ? (
            <p role="alert" className="text-[12px] text-error">
              {t(locale, 'validate.flow_required')}
            </p>
          ) : null}
        </label>
        {form.failure !== null ? (
          <p role="alert" className="text-[13px] text-error">
            {t(locale, failureKey(form.failure))}
          </p>
        ) : null}
      </div>
    </ModalWindow>
  );
}
