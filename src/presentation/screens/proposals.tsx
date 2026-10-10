// screens/proposals.tsx — the Öneriler screen (U-137 … U-150): the assistant's proposed file
// changes as a two-pane view — tabs and the list on the left, the selected proposal's diff and its
// Onayla / Reddet bar on the right. The screen draws the operator-approved prototype
// (docket-tasarim/oneriler) with the app's own tokens. Everything a proposal carries — summary,
// target, scope, author and every diff line — is untrusted text and enters the DOM only as React
// text nodes: no markup is built from it and nothing is linked. All lengths are rem (U-53/U-62;
// the only px-like value is the 1 px hairline border), radii come from the three tokens, and every
// sized text line carries an explicit leading because Tailwind's preflight puts line-height 1.5
// on the root. No class or string names a vendor.
import { useEffect, useSyncExternalStore, type KeyboardEvent } from 'react';

import type { ProposalDetailView, ProposalListItem } from '../../api/queries';
import { formatAge } from '../components/cockpit-format';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  PROPOSAL_TABS,
  effectiveSelection,
  moveSelection,
  proposalCounts,
  proposalFailureKey,
  proposalGroup,
  proposalScopeName,
  shownProposals,
  type ProposalTab,
  type ProposalsState,
  type ProposalsStore,
} from '../stores/proposals';
import { toast } from '../stores/toasts';

export interface ProposalsScreenProps {
  readonly store: ProposalsStore;
  readonly locale: Locale;
  /** The clock the ages read against; the shell re-renders as the stores publish. */
  readonly now: number;
}

const TAB_LABEL: Readonly<Record<ProposalTab, LabelKey>> = {
  pending: 'proposals.tab.pending',
  decided: 'proposals.tab.decided',
  stale: 'proposals.tab.stale',
};

/** A keyboard ring in rem: the global sheet sets none, so each control names its own. */
const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-[0.125rem] focus-visible:outline-offset-[0.125rem] focus-visible:outline-signal-soft';

const CHIP = 'inline-flex h-5 flex-none items-center gap-2 rounded-full border px-2 font-mono text-[0.6875rem] leading-none whitespace-nowrap';

type Standing = 'pending' | 'stale' | 'approved' | 'rejected';

const standingOf = (state: ProposalsState, item: ProposalListItem): Standing => {
  if (item.status === 'approved' || item.status === 'rejected') return item.status;
  return proposalGroup(state, item) === 'stale' ? 'stale' : 'pending';
};

function StatusChip({ standing, locale }: { readonly standing: Standing; readonly locale: Locale }) {
  if (standing === 'pending') {
    return (
      <span data-proposals-chip="pending" className={`${CHIP} border-signal-soft text-signal-soft`}>
        <span data-proposals-lamp="" aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-signal" />
        {t(locale, 'proposals.chip.pending')}
      </span>
    );
  }
  if (standing === 'approved') {
    return (
      <span data-proposals-chip="approved" className={`${CHIP} border-proceed text-proceed`}>
        {t(locale, 'proposals.chip.approved')}
      </span>
    );
  }
  if (standing === 'rejected') {
    return (
      <span data-proposals-chip="rejected" className={`${CHIP} border-bord text-inkdim`}>
        {t(locale, 'proposals.chip.rejected')}
      </span>
    );
  }
  return (
    <span data-proposals-chip="stale" className={`${CHIP} border-error text-error`}>
      {t(locale, 'proposals.chip.stale')}
    </span>
  );
}

const scopeText = (state: ProposalsState, item: ProposalListItem, locale: Locale): string =>
  proposalScopeName(state, item) ?? t(locale, 'proposals.scope.global');

function ProposalRow({
  item,
  state,
  selected,
  locale,
  now,
  onPick,
}: {
  readonly item: ProposalListItem;
  readonly state: ProposalsState;
  readonly selected: boolean;
  readonly locale: Locale;
  readonly now: number;
  readonly onPick: (id: string) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        data-proposals-item={item.id}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onPick(item.id)}
        className={`grid w-full gap-1 rounded-card border px-4 py-3 text-left hover:bg-raised ${selected ? 'border-bord bg-raised' : 'border-hairline bg-surface'} ${FOCUS}`}
      >
        <span className="block text-[0.875rem] font-semibold leading-[1.25rem] text-ink">{item.summary}</span>
        <span className="flex flex-wrap items-center gap-2 text-[0.75rem] leading-[1rem] text-inkdim">
          <span className="font-mono text-[0.6875rem] leading-[1rem]">{item.target}</span>
          <span>{scopeText(state, item, locale)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[0.75rem] leading-[1rem] text-inkdim">
          <StatusChip standing={standingOf(state, item)} locale={locale} />
          <span>{formatAge(locale, Math.max(0, now - item.createdAt))}</span>
          <span>{item.author.label}</span>
        </span>
      </button>
    </li>
  );
}

const LINE_TONE: Readonly<Record<'same' | 'add' | 'remove', string>> = {
  same: '',
  add: 'bg-proceed/15',
  remove: 'bg-error/15',
};

function DiffRegion({ detail, locale }: { readonly detail: ProposalDetailView; readonly locale: Locale }) {
  return (
    <div
      data-proposals-diff=""
      role="region"
      aria-label={t(locale, 'proposals.diff.label')}
      className="max-h-[26rem] overflow-auto bg-band font-mono text-[0.75rem] leading-[1.25rem] whitespace-pre text-ink"
    >
      <div className="min-w-max">
        {detail.lines.map((line, index) => (
          <div key={index} data-proposals-line={line.kind} className={`grid grid-cols-[1.5rem_1.5rem_1fr] ${LINE_TONE[line.kind]}`}>
            <span aria-hidden="true" className="select-none text-center text-error">
              {line.kind === 'remove' ? '−' : ''}
            </span>
            <span aria-hidden="true" className="select-none text-center text-proceed">
              {line.kind === 'add' ? '+' : ''}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
        {detail.truncated ? (
          <div data-proposals-truncated="" className="px-6 py-1 font-sans text-[0.75rem] leading-[1rem] text-inkdim">
            {t(locale, 'proposals.diff.truncated')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const NOTE =
  'mx-4 mt-4 flex items-start gap-2 rounded-control border border-bord bg-raised p-3 text-[0.8125rem] leading-[1.25rem] text-ink';

function Note({ tone, children }: { readonly tone: 'signal' | 'error'; readonly children: string }) {
  return (
    <p data-proposals-note="" role="status" className={NOTE}>
      <span aria-hidden="true" className={`mt-2 h-2 w-2 flex-none rounded-full ${tone === 'error' ? 'bg-error' : 'bg-signal'}`} />
      {children}
    </p>
  );
}

function DetailPane({
  state,
  id,
  store,
  locale,
  now,
}: {
  readonly state: ProposalsState;
  readonly id: string;
  readonly store: ProposalsStore;
  readonly locale: Locale;
  readonly now: number;
}) {
  const detail = state.details[id];
  const item = state.items.find((row) => row.id === id);
  if (detail === undefined || item === undefined) {
    const failed = state.detailFailed[id];
    return (
      <section data-proposals-detail="" className="rounded-card border border-hairline bg-surface">
        <p className="p-4 text-[0.875rem] leading-[1.25rem] text-inkdim">
          {failed === undefined ? t(locale, 'proposals.loading') : t(locale, proposalFailureKey(failed))}
        </p>
      </section>
    );
  }
  const standing = standingOf(state, item);
  const stale = standing === 'stale';
  const busy = state.deciding.includes(id);
  const decide = (decision: 'approved' | 'rejected'): void => {
    void store.decide(id, decision).then((result) => {
      // null: a decision for this proposal was already in flight, so nothing was sent.
      if (result === null) return;
      if (result.ok) toast({ type: 'success', text: t(locale, decision === 'approved' ? 'proposals.toast.approved' : 'proposals.toast.rejected') });
    });
  };
  return (
    <section data-proposals-detail="" className="overflow-hidden rounded-card border border-hairline bg-surface">
      <header data-proposals-header="" className="grid gap-2 border-b border-hairline p-4">
        <h2 className="text-[1rem] font-bold leading-[1.5rem] text-ink">{item.summary}</h2>
        <p className="flex flex-wrap items-center gap-3 text-[0.8125rem] leading-[1rem] text-inkdim">
          <span className="font-mono text-[0.6875rem] leading-[1rem]">{item.target}</span>
          <span>{scopeText(state, item, locale)}</span>
          <span>{item.author.label}</span>
          <span>{formatAge(locale, Math.max(0, now - item.createdAt))}</span>
          <StatusChip standing={standing} locale={locale} />
        </p>
      </header>
      {state.note !== null ? (
        <Note tone="error">{t(locale, proposalFailureKey(state.note))}</Note>
      ) : stale ? (
        <Note tone="signal">{t(locale, 'proposals.note.stale')}</Note>
      ) : null}
      <div className={state.note !== null || stale ? 'mt-4' : ''}>
        <DiffRegion detail={detail} locale={locale} />
      </div>
      {item.status === 'pending' ? (
        <div data-proposals-bar="" className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
          <span className="mr-auto text-[0.75rem] leading-[1rem] text-inkdim">
            {t(locale, stale ? 'proposals.hint.stale' : 'proposals.hint.pending')}
          </span>
          <button
            type="button"
            data-proposals-reject=""
            disabled={busy}
            onClick={() => decide('rejected')}
            className={`h-8 rounded-control border border-transparent px-4 text-[0.875rem] font-semibold leading-[1.25rem] text-inkdim hover:text-ink disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`}
          >
            {t(locale, 'proposals.reject')}
          </button>
          <button
            type="button"
            data-proposals-approve=""
            disabled={stale || busy}
            onClick={() => decide('approved')}
            className={`h-8 rounded-control border border-signal bg-signal px-4 text-[0.875rem] font-semibold leading-[1.25rem] text-signal-ink hover:brightness-110 disabled:pointer-events-none disabled:border-hairline disabled:bg-raised disabled:text-inkdim ${FOCUS}`}
          >
            {t(locale, 'proposals.approve')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function ProposalsScreen({ store, locale, now }: ProposalsScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  // Opening the screen re-reads; the store re-reads again on focus and after its own commands.
  useEffect(() => {
    void store.refresh();
  }, [store]);

  const counts = proposalCounts(state);
  const shown = shownProposals(state);
  const current = effectiveSelection(state);

  const onListKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    // Only the arrows move; Enter and Space stay with the focused button, which only selects.
    const next = moveSelection(
      shown.map((item) => item.id),
      current,
      event.key,
    );
    if (next === null) return;
    event.preventDefault();
    store.select(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-proposals-item="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <div data-proposals-screen="" className="grid gap-4">
      <header>
        <h1 className="text-[1.25rem] font-bold leading-[1.75rem] tracking-[-0.01em] text-ink">{t(locale, 'proposals.title')}</h1>
      </header>

      <div role="group" aria-label={t(locale, 'proposals.tabs.label')} className="inline-flex w-fit gap-1 rounded-control border border-bord bg-band p-1">
        {PROPOSAL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            data-proposals-tab={tab}
            aria-pressed={state.tab === tab}
            onClick={() => store.setTab(tab)}
            className={`h-6 rounded-control px-3 text-[0.78125rem] font-semibold leading-[1rem] ${state.tab === tab ? 'bg-raised text-ink' : 'text-inkdim hover:text-ink'} ${FOCUS}`}
          >
            {t(locale, TAB_LABEL[tab])}
            <span data-proposals-count={tab} className="ml-2 font-mono text-[0.6875rem] leading-[1rem] text-inkdim">
              {counts[tab]}
            </span>
          </button>
        ))}
      </div>

      {state.failed !== null && !state.loaded ? (
        <div role="alert" data-proposals-error="" className="flex flex-wrap items-center gap-4 rounded-card border border-error bg-surface px-4 py-3">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-error" />
          <p className="text-[0.8125rem] leading-[1.25rem] text-ink">{t(locale, 'proposals.error.title')}</p>
          <button
            type="button"
            onClick={() => void store.refresh()}
            className={`ml-auto h-8 rounded-control border border-bord px-4 text-[0.8125rem] font-semibold leading-[1.25rem] text-ink hover:bg-raised ${FOCUS}`}
          >
            {t(locale, 'action.retry')}
          </button>
        </div>
      ) : null}

      {!state.loaded && state.failed === null ? (
        <p role="status" data-proposals-loading="" className="text-[0.875rem] leading-[1.25rem] text-inkdim">
          {t(locale, 'proposals.loading')}
        </p>
      ) : null}

      {state.loaded ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          {shown.length > 0 ? (
            <ul role="list" data-proposals-list="" aria-label={t(locale, 'proposals.list.label')} onKeyDown={onListKey} className="grid gap-2">
              {shown.map((item) => (
                <ProposalRow key={item.id} item={item} state={state} selected={item.id === current} locale={locale} now={now} onPick={store.select} />
              ))}
            </ul>
          ) : (
            <div
              data-proposals-empty=""
              className="rounded-card border border-dashed border-bord px-4 py-8 text-center text-[0.875rem] leading-[1.25rem] text-inkdim"
            >
              {t(locale, state.items.length === 0 ? 'proposals.empty' : 'proposals.empty.tab')}
            </div>
          )}
          {current !== null ? (
            <DetailPane state={state} id={current} store={store} locale={locale} now={now} />
          ) : state.note !== null ? (
            <section data-proposals-detail="" className="rounded-card border border-hairline bg-surface">
              <Note tone="error">{t(locale, proposalFailureKey(state.note))}</Note>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
