// screens/board.tsx — the workspace board screen (U-3's window): columns mirroring the board
// view's stage order, the done work as its own lane, and the create-work-order form whose intent
// the store validates (title and flow) before `workOrder.open` is issued. A failed board query
// shows the workspace-problem state, never an empty board. Cards do not drag: a work order moves
// only through its gates, so a card's click opens the work order.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkOrderStatus } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { countedLabel } from '../components/counted-label';
import { OutcomeNotice } from '../components/outcome-notice';
import { SectionCard } from '../components/section-card';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import type { BoardStore, CreateOutcome, CreateValidation } from '../stores/board';
import { failureKey } from '../stores/results';

export interface BoardScreenProps {
  readonly store: BoardStore;
  readonly workspace: string;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
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

const VALIDATION_KEY: Readonly<Record<CreateValidation, LabelKey>> = {
  title_required: 'validate.title_required',
  flow_required: 'validate.flow_required',
};

/** A card's status travels as a plain string on the wire; a value outside the closed set renders
 *  as its own dim slug instead of pretending a known state. */
const cardStatus = (status: string, locale: Locale): { readonly tone: BadgeTone; readonly label: string } => {
  const known = (STATUS_KEY as Readonly<Record<string, LabelKey>>)[status];
  if (known === undefined) return { tone: 'dim', label: status };
  return { tone: STATUS_TONE[status as WorkOrderStatus], label: t(locale, known) };
};

/** What the create intent reports, mapped through U-8's discipline: validation refusals show
 *  their own copy, a command failure its code, a success its confirmation. */
const createNotice = (locale: Locale, outcome: CreateOutcome): { readonly ok: boolean; readonly text: string; readonly code?: string } => {
  if (outcome.ok) return { ok: true, text: t(locale, 'success.workOrder.open') };
  if ('validation' in outcome) return { ok: false, text: t(locale, VALIDATION_KEY[outcome.validation]) };
  return { ok: false, text: t(locale, failureKey(outcome.code)), code: outcome.code };
};

export function BoardScreen({ store, workspace, locale, onOpenWorkOrder }: BoardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(workspace);
  }, [store, workspace]);

  // The flow input stands on the board's own flow until the operator types one: the choice the
  // validation needs is then explicit, not silent.
  const [title, setTitle] = useState('');
  const [flow, setFlow] = useState('');
  const view = state.view;
  const flowValue = flow.trim() !== '' ? flow : (view?.flow ?? '');
  const [notice, setNotice] = useState<ReturnType<typeof createNotice> | null>(null);

  const submit = (): void => {
    void store.create({ workspace, title, flow: flowValue }).then((outcome) => {
      setNotice(createNotice(locale, outcome));
      if (outcome.ok) setTitle('');
    });
  };

  return (
    <div className="grid gap-4">
      <header className="grid gap-1.5">
        <h1 className="truncate font-mono text-[15px] font-bold tracking-tight text-ink">{workspace}</h1>
        {view !== null ? (
          <p className="font-mono text-[11.5px] text-inkdim">{view.flow}</p>
        ) : null}
      </header>

      {state.loading && view === null && state.problem === null ? (
        <p className="font-mono text-[12px] text-inkdim">{t(locale, 'board.loading')}</p>
      ) : null}

      {state.problem !== null ? (
        <div role="alert" className="rounded-md border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {notice !== null ? (
        <OutcomeNotice ok={notice.ok} text={notice.text} code={notice.code} />
      ) : null}

      {view !== null ? (
        <>
          <SectionCard title={t(locale, 'board.create.title')}>
            <div className="grid gap-2">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="grid gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">
                    {t(locale, 'board.create.titleLabel')}
                  </span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={t(locale, 'board.create.titlePlaceholder')}
                    className="rounded-md border border-hairline bg-raised px-2 py-1 text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">
                    {t(locale, 'board.create.flowLabel')}
                  </span>
                  <input
                    value={flowValue}
                    onChange={(event) => setFlow(event.target.value)}
                    placeholder={t(locale, 'board.create.flowPlaceholder')}
                    className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
                  />
                </label>
                <ActionButton variant="primary" size="md" onClick={submit}>
                  {t(locale, 'board.create.submit')}
                </ActionButton>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.columns.map((column) => (
              <SectionCard key={column.stage} title={countedLabel(column.name, column.workOrders.length)}>
                {column.workOrders.length === 0 ? null : (
                  <ul className="grid gap-1.5">
                    {column.workOrders.map((card) => {
                      const status = cardStatus(card.status, locale);
                      return (
                        <li key={card.id}>
                          <button
                            type="button"
                            onClick={() => onOpenWorkOrder(card.id)}
                            className="grid w-full gap-1 rounded-md border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:bg-raised"
                          >
                            <span className="truncate text-[13.5px] font-semibold text-ink">{card.title}</span>
                            <span className="flex items-center gap-2">
                              <code className="truncate font-mono text-[11px] text-inkdim">{card.id}</code>
                              <StateBadge tone={status.tone}>{status.label}</StateBadge>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            ))}
          </div>

          <SectionCard title={countedLabel(t(locale, 'board.section.done'), view.done.length)}>
            {view.done.length === 0 ? null : (
              <ul className="grid gap-1.5">
                {view.done.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => onOpenWorkOrder(card.id)}
                      className="flex w-full items-baseline gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:bg-raised"
                    >
                      <code className="flex-none font-mono text-[11px] text-inkdim">{card.id}</code>
                      <span className="truncate text-[13.5px] text-ink">{card.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
