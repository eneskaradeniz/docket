// screens/page-viewer.tsx — the page viewer (U-75 … U-82) and the work-order detail's Sayfalar
// section. A page opens in place of the detail (‹ Geri returns to it): a header, the version
// selector and the Önizleme / Fark pair, the stage with its always-visible guard strip, the
// approval bar and, beside it, the comments rail. Önizleme is the isolated native view — the stage
// body only reserves its rectangle and tells the host where it is; nothing of the page is ever
// rendered in Docket's own DOM. Fark and every comment are page-derived text and enter the DOM
// only as React text nodes, never as markup and never as a link. All lengths are rem (U-53/U-62);
// radii come from the three tokens; every sized text line carries an explicit leading because
// Tailwind's preflight puts line-height 1.5 on the root.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { ChatScopeInput } from '../../api/commands';
import type { PageListItem } from '../../api/queries';
import { ActionButton } from '../components/action-button';
import { formatAge } from '../components/cockpit-format';
import { PageLaunchers } from '../components/launcher-rows';
import { SectionCard } from '../components/section-card';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  approvalBar,
  approvalChip,
  commentsOfVersion,
  composerPlan,
  COMMENT_MAX,
  diffPlan,
  previewTarget,
  type ApprovalAction,
  type PageListStore,
  type PageViewerStore,
  type PageViewHost,
  type Rect,
} from '../stores/page-viewer';
import { failureKey } from '../stores/results';
import { toastOutcome, toastStore } from '../stores/toasts';

const KIND_KEY: Readonly<Record<PageListItem['kind'], LabelKey>> = {
  html: 'page.kind.html',
  markdown: 'page.kind.markdown',
  diagram: 'page.kind.diagram',
  table: 'page.kind.table',
  image: 'page.kind.image',
  report: 'page.kind.report',
};

/** A keyboard ring in rem: the global sheet sets none, so each control names its own. */
const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-[0.125rem] focus-visible:outline-offset-[0.125rem] focus-visible:outline-signal-soft';

const fill = (text: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);

type ButtonLook = 'primary' | 'neutral' | 'ghost';

const LOOK: Readonly<Record<ButtonLook, string>> = {
  primary: 'border-signal bg-signal text-signal-ink hover:brightness-110',
  neutral: 'border-bord bg-transparent text-ink hover:bg-raised',
  ghost: 'border-transparent bg-transparent text-inkdim hover:text-ink',
};

/** The screen's button: the shared button grammar plus the data hooks the journeys read (the
 *  shared ActionButton carries none). */
function PageButton({
  look,
  size = 'md',
  disabled = false,
  onClick,
  attrs,
  children,
}: {
  readonly look: ButtonLook;
  readonly size?: 'sm' | 'md';
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly attrs?: Readonly<Record<`data-${string}`, string | boolean>>;
  readonly children: ReactNode;
}) {
  const sizing = size === 'md' ? 'h-8 px-4 text-[0.875rem] leading-[1.25rem]' : 'h-7 px-3 text-[0.78125rem] leading-[1rem]';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-control border font-semibold transition-[filter,background-color,color] duration-100 motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${FOCUS} ${LOOK[look]} ${sizing}`}
      {...attrs}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ApprovalChip({
  approval,
  approvedVersion,
  locale,
}: {
  readonly approval: PageListItem['approval'];
  readonly approvedVersion: number | undefined;
  readonly locale: Locale;
}) {
  const chip = approvalChip(approval, approvedVersion);
  const tone: BadgeTone = chip.tone;
  const text = fill(t(locale, chip.labelKey), { n: chip.n ?? 0 });
  return (
    <StateBadge tone={tone}>
      {approval === 'pending' ? <span aria-hidden="true" className="mr-1.5 h-2 w-2 flex-none rounded-full bg-signal" /> : null}
      <span data-page-approval-chip>{text}</span>
    </StateBadge>
  );
}

// --- the detail's Sayfalar section ------------------------------------------------------------------

/** The page rows of one work order: opened by a click, hidden while there are none (U-75). The
 *  amber line counts the operator's own comments the agent has not read yet. */
export function PagesSection({
  store,
  locale,
  onOpenPage,
}: {
  readonly store: PageListStore;
  readonly locale: Locale;
  readonly onOpenPage: (id: string) => void;
}) {
  const items = useSyncExternalStore(store.subscribe, () => store.state().items, () => store.state().items);
  if (items.length === 0) return null;
  return (
    <div data-pages-section className="min-w-0">
      <SectionCard title={t(locale, 'page.section.title')}>
        <ul className="grid gap-2">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                data-page-row={row.id}
                onClick={() => onOpenPage(row.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2 text-left hover:bg-raised ${FOCUS}`}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="block truncate text-[0.84375rem] font-semibold leading-[1.25rem] text-ink" title={row.title}>
                    {row.title}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <StateBadge tone="dim">{t(locale, KIND_KEY[row.kind])}</StateBadge>
                    <span className="font-mono text-[0.6875rem] leading-[1rem] text-inkdim">
                      {fill(t(locale, 'page.list.version'), { n: row.latestVersion })}
                    </span>
                    {row.undeliveredComments > 0 ? (
                      <span data-page-unread className="font-mono text-[0.6875rem] leading-[1rem] text-signal-soft">
                        {row.undeliveredComments === 1
                          ? t(locale, 'page.list.unreadOne')
                          : fill(t(locale, 'page.list.unread'), { n: row.undeliveredComments })}
                      </span>
                    ) : null}
                  </span>
                </span>
                <ApprovalChip approval={row.approval} approvedVersion={row.approvedVersion} locale={locale} />
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

// --- the page screen ---------------------------------------------------------------------------------

export interface PageViewerScreenProps {
  readonly store: PageViewerStore;
  /** The one host of the app's one native view. */
  readonly host: PageViewHost;
  readonly pageId: string;
  readonly locale: Locale;
  /** A settings panel, the search palette or the wizard is up: the native view would paint over it. */
  readonly overlayOpen: boolean;
  /** The clock the ages read against. */
  readonly now: number;
  readonly onBack: () => void;
  /** The scope of the "Yorumlarımı düzelt" launcher — the page's work order, else its project —
   *  or null while the shell does not know it yet. */
  readonly launchScope?: ChatScopeInput | null;
}

const asRect = (box: DOMRect): Rect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

/** The fixed toast stack's rectangle, or null when none shows. A toast card announces itself with
 *  aria-live and its parent is the one fixed stack, so the stack is found by that structure rather
 *  than by the host's own markup hooks (the host is the only place allowed to name those). */
const toastStackRect = (): Rect | null => {
  for (const card of document.querySelectorAll('[aria-live]')) {
    const stack = card.parentElement;
    if (stack !== null && getComputedStyle(stack).position === 'fixed') return asRect(stack.getBoundingClientRect());
  }
  return null;
};

export function PageViewerScreen({ store, host, pageId, locale, overlayOpen, now, onBack, launchScope = null }: PageViewerScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const hostState = useSyncExternalStore(host.subscribe, host.state, host.state);
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.state, toastStore.state);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void store.open(pageId);
    return () => store.close();
  }, [store, pageId]);

  // Every command's report leaves as the one toast (U-50), once per outcome.
  const lastOutcome = state.lastOutcome;
  useEffect(() => {
    if (lastOutcome !== null) toastOutcome(locale, lastOutcome);
  }, [lastOutcome, locale]);

  const detail = state.detail;
  const shown = state.selected ?? detail?.version ?? null;
  const mode = store.viewMode();

  // The native view follows the stage's rectangle (U-76). The host collapses a burst of bounds
  // into one call per frame; the target itself is rebuilt from the live layout on every change.
  const measure = useCallback((): void => {
    const body = bodyRef.current;
    const rect = body === null ? null : asRect(body.getBoundingClientRect());
    const main = body?.closest('main') ?? null;
    host.update(
      previewTarget({
        pageId,
        version: shown,
        mode,
        overlayOpen,
        toastRect: toasts.length > 0 ? toastStackRect() : null,
        rect,
        clip: main === null ? null : asRect(main.getBoundingClientRect()),
      }),
    );
  }, [host, pageId, shown, mode, overlayOpen, toasts]);

  // Every render re-reads the layout (the host ignores an unchanged target); a toast arriving or
  // leaving may start or stop covering the stage, so it is a dependency too.
  useEffect(() => {
    measure();
  }, [toasts, measure, detail]);
  useEffect(() => {
    const body = bodyRef.current;
    const main = body?.closest('main') ?? null;
    const observer = new ResizeObserver(() => measure());
    if (body !== null) observer.observe(body);
    if (main !== null) observer.observe(main);
    window.addEventListener('resize', measure);
    main?.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      main?.removeEventListener('scroll', measure);
    };
  }, [measure, detail === null, mode]);
  // Leaving the screen takes the view away; the host closes it.
  useEffect(() => () => host.update(null), [host]);

  const back = (
    <div>
      <ActionButton variant="ghost" onClick={onBack}>
        {t(locale, 'page.back')}
      </ActionButton>
    </div>
  );

  if (detail === null) {
    return (
      <div data-page-screen className="grid gap-4">
        {back}
        {state.problem !== null ? (
          <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[0.8125rem] leading-[1.25rem] text-error">
            {t(locale, failureKey(state.problem))}
          </div>
        ) : (
          <p className="font-mono text-[0.6875rem] uppercase leading-[1rem] tracking-[0.04em] text-inkdim">{t(locale, 'page.stage.loading')}</p>
        )}
      </div>
    );
  }

  const page = detail.page;
  const latest = page.latestVersion;
  const shownVersion = shown ?? detail.version;
  const isLatest = shownVersion === latest;
  const latestMeta = page.versions[latest - 1];
  const plan = approvalBar({
    approval: page.approval,
    ...(page.approvedVersion === undefined ? {} : { approvedVersion: page.approvedVersion }),
    shown: shownVersion,
    latest,
    gatePending: detail.gate?.pending === true,
  });
  const diff = diffPlan(detail.diff, page.kind);
  const comments = commentsOfVersion(detail, shownVersion);
  const composer = composerPlan({ latest: isLatest, sending: state.busy, text: draft });
  const age = (at: number): string => formatAge(locale, Math.max(0, now - at));

  const act = (action: ApprovalAction): void => {
    if (action === 'request') void store.requestApproval();
    else void store.decide(action === 'approve' ? 'approved' : 'rejected');
  };
  const submit = (): void => {
    void store.comment(draft).then((ok) => {
      if (ok) setDraft('');
    });
  };

  const actionLabel: Readonly<Record<ApprovalAction, LabelKey>> = {
    request: 'page.action.request',
    reject: 'page.action.reject',
    approve: 'page.action.approve',
  };

  return (
    <div data-page-screen className="grid gap-4">
      {back}

      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[0.8125rem] leading-[1.25rem] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      <header data-page-header className="grid items-center gap-3 @[40rem]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid min-w-0 gap-1">
          <h1 className="break-words text-[1.25rem] font-bold leading-[1.75rem] tracking-[-0.01em] text-ink">{page.title}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-[0.78125rem] leading-[1rem] text-inkdim">
            <StateBadge tone="dim">{t(locale, KIND_KEY[page.kind])}</StateBadge>
            <span>{page.createdBy.label}</span>
            <span>
              {fill(t(locale, 'page.header.version'), {
                n: latest,
                age: latestMeta === undefined ? '' : age(latestMeta.createdAt),
              })}
            </span>
            <ApprovalChip approval={page.approval} approvedVersion={page.approvedVersion} locale={locale} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageLaunchers scope={launchScope} openComments={detail.comments.filter((comment) => !comment.delivered).length} />
          <select
            data-page-version
            aria-label={t(locale, 'page.version.label')}
            value={shownVersion}
            onChange={(event) => void store.select(Number(event.target.value))}
            className={`h-7 rounded-control border border-bord bg-raised px-3 text-[0.78125rem] font-semibold leading-[1rem] text-ink ${FOCUS}`}
          >
            {[...page.versions].reverse().map((version) => (
              <option key={version.n} value={version.n}>
                {fill(t(locale, version.n === latest ? 'page.version.latest' : 'page.version.option'), { n: version.n })}
              </option>
            ))}
          </select>
          <span
            role="group"
            aria-label={t(locale, 'page.view.label')}
            className="inline-flex gap-0.5 rounded-control border border-bord bg-band p-0.5"
          >
            {(['preview', 'diff'] as const).map((id) => {
              const off = id === 'diff' && !diff.enabled;
              const button = (
                <button
                  type="button"
                  className={`h-[1.625rem] rounded-control px-3 text-[0.78125rem] font-semibold leading-[1rem] disabled:pointer-events-none disabled:opacity-45 ${FOCUS} ${
                    mode === id ? 'bg-raised text-ink shadow-[inset_0_0_0_0.0625rem_var(--signal)]' : 'bg-transparent text-inkdim hover:text-ink'
                  }`}
                  data-page-view={id}
                  aria-pressed={mode === id}
                  disabled={off}
                  onClick={() => store.setMode(id)}
                >
                  {t(locale, id === 'preview' ? 'page.view.preview' : 'page.view.diff')}
                </button>
              );
              return off && diff.disabledKey !== null ? (
                <span key={id} title={t(locale, diff.disabledKey)} className="inline-flex">
                  {button}
                </span>
              ) : (
                <span key={id} className="inline-flex">
                  {button}
                </span>
              );
            })}
          </span>
        </div>
      </header>

      <div className="grid items-start gap-4 @[56rem]:grid-cols-[minmax(0,1fr)_20rem]">
        <section data-page-stage className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface">
          <div
            data-page-guard
            className="flex items-center gap-2 border-b border-hairline bg-band px-4 py-2 text-[0.75rem] leading-[1rem] text-inkdim"
          >
            <span className="flex-none font-mono text-[0.6875rem] leading-[1rem] text-proceed">{t(locale, 'page.guard.badge')}</span>
            <span className="min-w-0">{t(locale, 'page.guard.text')}</span>
          </div>

          {state.newVersionNote && isLatest ? (
            <div
              data-page-note
              className="m-4 flex items-start gap-2 rounded-control border border-bord bg-raised p-3 text-[0.8125rem] leading-[1.25rem] text-ink"
            >
              <span aria-hidden="true" className="mt-2 h-2 w-2 flex-none rounded-full bg-signal" />
              <span>{t(locale, 'page.note.newVersion')}</span>
            </div>
          ) : null}

          {mode === 'diff' && detail.diff !== undefined ? (
            <div>
              <div
                data-page-diff
                role="region"
                aria-label={t(locale, 'page.diff.region')}
                className="max-h-[28rem] overflow-auto bg-band font-mono text-[0.75rem] leading-[1.25rem]"
              >
                {detail.diff.lines.map((line, index) => (
                  <div
                    key={index}
                    data-diff-line={line.kind}
                    className={`grid min-h-[1.25rem] grid-cols-[1.5rem_1.5rem_minmax(0,1fr)] whitespace-pre ${
                      line.kind === 'add' ? 'bg-proceed/15' : line.kind === 'remove' ? 'bg-error/15' : ''
                    }`}
                  >
                    <span className="text-center text-error">{line.kind === 'remove' ? '−' : ''}</span>
                    <span className="text-center text-proceed">{line.kind === 'add' ? '+' : ''}</span>
                    <span>{line.text}</span>
                  </div>
                ))}
              </div>
              {detail.diff.truncated === true ? (
                <p data-diff-truncated className="border-t border-hairline px-4 py-2 text-[0.75rem] leading-[1rem] text-inkdim">
                  {t(locale, 'page.diff.truncated')}
                </p>
              ) : null}
            </div>
          ) : (
            <div
              ref={bodyRef}
              data-page-stage-body
              role="region"
              aria-label={t(locale, 'page.stage.region')}
              className="relative min-h-[24rem] bg-white"
            >
              {hostState.status === 'error' ? (
                <div
                  data-page-error
                  className="absolute inset-0 grid place-content-center justify-items-center gap-3 bg-surface p-6 text-center"
                >
                  <p className="text-[0.875rem] font-semibold leading-[1.25rem] text-ink">{t(locale, 'page.stage.error')}</p>
                  <PageButton look="neutral" attrs={{ 'data-page-retry': true }} onClick={() => host.retry()}>
                    {t(locale, 'page.stage.retry')}
                  </PageButton>
                </div>
              ) : null}
            </div>
          )}

          <div data-page-bar className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
            <span className="mr-auto text-[0.75rem] leading-[1rem] text-inkdim">{t(locale, plan.reasonKey)}</span>
            {plan.actions.map((action) => (
              <PageButton
                key={action}
                look={plan.emphasis[action] ?? 'neutral'}
                disabled={plan.disabled || state.busy}
                attrs={{ 'data-page-action': action }}
                onClick={() => act(action)}
              >
                {t(locale, actionLabel[action])}
              </PageButton>
            ))}
          </div>
        </section>

        <aside data-page-rail className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface">
          <h2 className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3 text-[0.875rem] font-semibold leading-[1.25rem] text-ink">
            {t(locale, 'page.comments.title')}
            <span className="font-mono text-[0.6875rem] font-medium leading-[1rem] text-inkdim">
              {fill(t(locale, 'page.comments.count'), { n: shownVersion, count: comments.length })}
            </span>
          </h2>
          {comments.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.8125rem] leading-[1.25rem] text-inkdim">
              {t(locale, 'page.comments.empty')}
              <br />
              {t(locale, 'page.comments.emptyHint')}
            </p>
          ) : (
            <ul>
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  data-page-comment={comment.id}
                  data-delivered={String(comment.delivered)}
                  className="grid gap-1 border-t border-hairline px-4 py-3 first:border-t-0"
                >
                  <span className="flex items-center gap-2 text-[0.75rem] leading-[1rem] text-inkdim">
                    <span className="font-mono text-[0.6875rem] leading-[1rem]">
                      {fill(t(locale, 'page.comment.version'), { n: comment.version })}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{fill(t(locale, 'page.comment.by'), { age: age(comment.at) })}</span>
                  </span>
                  <p className="whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.25rem] text-ink">{comment.text}</p>
                  <span
                    data-delivery={String(comment.delivered)}
                    className={`font-mono text-[0.6875rem] leading-[1rem] ${comment.delivered ? 'text-proceed' : 'text-signal-soft'}`}
                  >
                    {t(locale, comment.delivered ? 'page.comment.delivered' : 'page.comment.undelivered')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {composer.visible ? (
            <div data-page-composer className="grid gap-2 border-t border-hairline bg-band px-4 py-3">
              <textarea
                data-page-composer-input
                aria-label={t(locale, 'page.composer.label')}
                placeholder={t(locale, 'page.composer.placeholder')}
                maxLength={COMMENT_MAX}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className={`min-h-[4.5rem] w-full resize-y rounded-control border border-bord bg-raised px-3 py-2 text-[0.8125rem] leading-[1.25rem] text-ink placeholder:text-inkdim ${FOCUS}`}
              />
              <span className="text-[0.75rem] leading-[1rem] text-inkdim">{t(locale, 'page.composer.hint')}</span>
              <div className="flex items-center justify-end gap-2">
                {composer.counter ? (
                  <span data-page-counter className="mr-auto font-mono text-[0.6875rem] leading-[1rem] text-inkdim">
                    {fill(t(locale, 'page.composer.counter'), { n: composer.count, max: COMMENT_MAX })}
                  </span>
                ) : null}
                <PageButton look="neutral" size="sm" disabled={!composer.canSubmit} attrs={{ 'data-page-submit': true }} onClick={submit}>
                  {t(locale, 'page.composer.submit')}
                </PageButton>
              </div>
            </div>
          ) : (
            <div className="border-t border-hairline bg-band px-4 py-3">
              <span className="text-[0.75rem] leading-[1rem] text-inkdim">{t(locale, 'page.composer.old')}</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
