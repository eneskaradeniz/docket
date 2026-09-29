// screens/board.tsx — the repo board screen (U-3's window): columns mirroring the board
// view's stage order, the done work as its own lane, and the create-work-order form whose intent
// the store validates (title and flow) before `workOrder.open` is issued. A failed board query
// shows the repo-problem state, never an empty board. Cards do not drag: a work order moves
// only through its gates, so a card's click opens the work order. The layout speaks the design's
// kanban grammar: one open column per stage under a mono sample header, each card a bordered work
// row with a lamp naming its state — no boxed sections around the columns.
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
  readonly repo: string;
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

/** The card lamp's hue: amber asks for the operator, green runs or is finished, blue waits on a
 *  machine condition, red is stopped, dim is idle — the same grammar as the cockpit's rows. */
const STATUS_LAMP: Readonly<Record<WorkOrderStatus, string>> = {
  ready: 'bg-inkdim',
  running: 'bg-proceed',
  gating: 'bg-info',
  awaiting_human: 'bg-signal',
  limit_waiting: 'bg-info',
  blocked: 'bg-error',
  done: 'bg-inkdim',
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

const INPUT_CLASS =
  'rounded-sm border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

/** A card's status travels as a plain string on the wire; a value outside the closed set renders
 *  as its own dim slug instead of pretending a known state. */
const cardStatus = (status: string, locale: Locale): { readonly tone: BadgeTone; readonly lamp: string; readonly label: string } => {
  const known = (STATUS_KEY as Readonly<Record<string, LabelKey>>)[status];
  if (known === undefined) return { tone: 'dim', lamp: 'bg-inkdim', label: status };
  return { tone: STATUS_TONE[status as WorkOrderStatus], lamp: STATUS_LAMP[status as WorkOrderStatus], label: t(locale, known) };
};

/** What the create intent reports, mapped through U-8's discipline: validation refusals show
 *  their own copy, a command failure its code, a success its confirmation. */
const createNotice = (locale: Locale, outcome: CreateOutcome): { readonly ok: boolean; readonly text: string; readonly code?: string } => {
  if (outcome.ok) return { ok: true, text: t(locale, 'success.workOrder.open') };
  if ('validation' in outcome) return { ok: false, text: t(locale, VALIDATION_KEY[outcome.validation]) };
  return { ok: false, text: t(locale, failureKey(outcome.code)), code: outcome.code };
};

export function BoardScreen({ store, repo, locale, onOpenWorkOrder }: BoardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(repo);
  }, [store, repo]);

  // The flow input stands on the board's own flow until the operator types one: the choice the
  // validation needs is then explicit, not silent.
  const [title, setTitle] = useState('');
  const [flow, setFlow] = useState('');
  const view = state.view;
  const flowValue = flow.trim() !== '' ? flow : (view?.flow ?? '');
  const [notice, setNotice] = useState<ReturnType<typeof createNotice> | null>(null);

  const submit = (): void => {
    void store.create({ repo, title, flow: flowValue }).then((outcome) => {
      setNotice(createNotice(locale, outcome));
      if (outcome.ok) setTitle('');
    });
  };

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="truncate font-mono text-[15px] font-bold tracking-tight text-ink">{repo}</h1>
        {view !== null ? (
          <p className="font-mono text-[11.5px] text-inkdim">{view.flow}</p>
        ) : null}
      </header>

      {state.loading && view === null && state.problem === null ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'board.loading')}</p>
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
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="grid gap-1">
                <span className={LABEL_CLASS}>{t(locale, 'board.create.titleLabel')}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t(locale, 'board.create.titlePlaceholder')}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1">
                <span className={LABEL_CLASS}>{t(locale, 'board.create.flowLabel')}</span>
                <input
                  value={flowValue}
                  onChange={(event) => setFlow(event.target.value)}
                  placeholder={t(locale, 'board.create.flowPlaceholder')}
                  className={`${INPUT_CLASS} font-mono`}
                />
              </label>
              <ActionButton variant="primary" size="md" onClick={submit}>
                {t(locale, 'board.create.submit')}
              </ActionButton>
            </div>
          </SectionCard>

          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            {/* The column count is the flow's own stage count, so the track is laid out inline:
                one row of equal columns, each never narrower than a card, scrolling as a whole —
                a kanban never wraps into rows. */}
            <div
              className="grid min-w-[720px] items-start gap-2.5"
              style={{ gridTemplateColumns: `repeat(${view.columns.length}, minmax(150px, 1fr))` }}
            >
              {view.columns.map((column) => (
                <section key={column.stage} className="grid content-start gap-1.5">
                  <h2 className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-inkdim">
                    {countedLabel(column.name, column.workOrders.length)}
                  </h2>
                  {column.workOrders.length === 0 ? null : (
                    <ul className="grid gap-2">
                      {column.workOrders.map((card) => {
                        const status = cardStatus(card.status, locale);
                        return (
                          <li key={card.id}>
                            <button
                              type="button"
                              onClick={() => onOpenWorkOrder(card.id)}
                              className="grid w-full grid-cols-[10px_minmax(0,1fr)] gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:bg-raised"
                            >
                              <span aria-hidden="true" className={`mt-1 h-2 w-2 flex-none rounded-full ${status.lamp}`} />
                              <span className="grid min-w-0 gap-1">
                                <span className="truncate text-[13.5px] font-semibold text-ink">{card.title}</span>
                                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                  <code className="truncate font-mono text-[11px] text-inkdim">{card.id}</code>
                                  <StateBadge tone={status.tone}>{status.label}</StateBadge>
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </div>

          <section className="grid content-start gap-1.5">
            <h2 className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-inkdim">
              {countedLabel(t(locale, 'board.section.done'), view.done.length)}
            </h2>
            {view.done.length === 0 ? null : (
              <ul className="grid gap-2 md:grid-cols-2">
                {view.done.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => onOpenWorkOrder(card.id)}
                      className="grid w-full grid-cols-[10px_minmax(0,1fr)] items-baseline gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:bg-raised"
                    >
                      <span aria-hidden="true" className="h-2 w-2 flex-none translate-y-px rounded-full bg-inkdim" />
                      <span className="flex min-w-0 items-baseline gap-2">
                        <code className="flex-none font-mono text-[11px] text-inkdim">{card.id}</code>
                        <span className="truncate text-[13.5px] text-ink">{card.title}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
