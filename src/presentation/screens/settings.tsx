// screens/settings.tsx — the settings panel (U-6's window): a centered, window-style overlay in
// the wizard's frame — the panel's width and height are min() against the window less 64px, so
// it fits the 1024×640 minimum without ever growing; a 200px section menu sits on the left and
// the selected section's content on the right, scrolling inside the panel. ✕, Esc or a click on
// the backdrop closes it; focus moves in on open, is trapped while open, and returns to the
// opener on a keyboard-opened close only (the palette's one rule). The screen renders the
// store's view and forwards clicks; secret values have no surface here — account names only —
// and every user-visible string arrives through a label key (U-1).
// The section is the shell's, not the panel's own: the sidebar's Telefon and Ayarlar rows open
// the panel on a named section and read their current standing from it (U-24), so the panel
// receives the section and reports every move.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { ACTIVE_CLASS } from '../components/active-state';
import { AccountEditor } from '../components/account-editor';
import { DiscoveryBadges } from '../components/discovery-badges';
import { countedLabel } from '../components/counted-label';
import { formatMeterValue, meterUnitLabel } from '../components/meter-value';
import { LocaleSwitcher } from '../components/locale-switcher';
import { motionVars, MOTION } from '../components/motion';
import { OutcomeNotice } from '../components/outcome-notice';
import { ProviderMark, type ProviderMarkProps } from '../components/provider-mark';
import { SectionCard } from '../components/section-card';
import { SourceBadge } from '../components/source-badge';
import { StateBadge } from '../components/state-badge';
import type { LocaleStore } from '../stores/locale';
import { accountStatus, createAccountEditorStore, policyLabelKey, type AccountStatus } from '../stores/account-editor';
import { settingDiffs } from '../stores/recommended';
import type { AccountModelsStore } from '../stores/account-models';
import { focusRestoredOnClose } from '../stores/search-palette';
import type { SettingsPanelOrigin } from '../stores/settings-panel';
import type {
  AccountDisplay,
  BindingSaveInput,
  DiscoveryRow,
  MeterDisplay,
  SettingsStore,
} from '../stores/settings';
import { failureKey } from '../stores/results';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { updateButton, type UpdateStore, type UpdateStatus } from '../stores/update';
import type { SettingsBindingScope } from '../../api/queries';

export interface SettingsPanelProps {
  /** The reducer's open standing — the panel rides over whatever route is current. */
  readonly open: boolean;
  /** Stamped by the open; the close's focus rule reads it. */
  readonly origin: SettingsPanelOrigin;
  /** The selected section — owned by the shell, which names it on open (U-24). */
  readonly section: SettingsSection;
  /** Reports a section move from the menu, so the sidebar's rows follow it. */
  readonly onSection: (section: SettingsSection) => void;
  readonly onClose: () => void;
  readonly store: SettingsStore;
  /** The provider marks the accounts list's badges resolve from (loaded once, session-cached). */
  readonly marks: ProviderMarksStore;
  /** The per-account model list and its spend-consent flow (P-40), fed by `account.models`. */
  readonly models: AccountModelsStore;
  /** The app-update standing the Güncelleme section reads (U-24). */
  readonly update: UpdateStore;
  readonly locale: Locale;
  /** The language control binds straight to the locale store: a selection swaps the bundle for the
   *  whole app through the root's subscription and persists the choice (U-9). */
  readonly localeStore: LocaleStore;
  /** Closes the panel and opens the account's own view ("Hesap görünümünü aç", U-30). */
  readonly onOpenAccount?: (accountId: string) => void;
}

/** The panel's sections — the same list and order the screen's cards have always carried, with
 *  the phone and update sections appended (U-24); the menu walks them, the pane carries the one
 *  that is selected, and the sidebar's rows name them on open. */
export type SettingsSection = 'language' | 'accounts' | 'bindings' | 'discovery' | 'phone' | 'update';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'language',
  'accounts',
  'bindings',
  'discovery',
  'phone',
  'update',
];

const SECTION_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  language: 'settings.language.label',
  accounts: 'settings.section.accounts',
  bindings: 'settings.section.bindings',
  discovery: 'settings.section.discovery',
  phone: 'settings.section.phone',
  update: 'settings.section.update',
};

const SCOPE_KEY: Readonly<Record<SettingsBindingScope['level'], LabelKey>> = {
  global: 'settings.binding.scope.global',
  project: 'settings.binding.scope.project',
  repo: 'settings.binding.scope.workspace',
  workOrder: 'settings.binding.scope.workOrder',
};

/** One status line per UpdateStatus (U-24) — the Güncelleme section's quiet reading of where the
 *  app's own newer version stands; absence is never invented into a status. */
const UPDATE_STATUS_KEY: Readonly<Record<UpdateStatus['kind'], LabelKey>> = {
  none: 'settings.update.status.none',
  available: 'settings.update.status.available',
  downloading: 'settings.update.status.downloading',
  ready: 'settings.update.status.ready',
  error: 'settings.update.status.error',
};

/** The error status's closed reason set — offline or failed, nothing else exists on the wire. */
const UPDATE_ERROR_KEY: Readonly<Record<'offline' | 'failed', LabelKey>> = {
  offline: 'update.error.offline',
  failed: 'update.error.failed',
};

const scopeName = (scope: SettingsBindingScope): string =>
  scope.level === 'project'
    ? scope.project
    : scope.level === 'repo'
      ? scope.repo
      : scope.level === 'workOrder'
        ? scope.workOrderId
        : '';

/** One meter line, in the design's pool grammar: a quiet line under the account's parting
 * hairline — label, mono reading, and the provenance chip at the edge; no box of its own, a
 * pool is a list, not a stack of cards. The store already resolved the meter's naming context;
 * remaining and reset segments render only when the meter carries them — absence is omitted,
 * never faked. */
export function MeterRow({ meter, locale, resetsAt }: { readonly meter: MeterDisplay; readonly locale: Locale; readonly resetsAt: string | null }) {
  const unitLabel = meterUnitLabel(locale, meter.unit);
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="text-[13px] text-ink">{meter.label}</span>
      <span className="font-mono text-[11.5px] text-inkdim">
        {meter.remaining !== null
          ? `${t(locale, 'settings.meter.remaining')} ${formatMeterValue(locale, meter.unit, meter.remaining)}`
          : (unitLabel ?? '')}
        {resetsAt !== null ? ` · ${t(locale, 'settings.meter.resetsAt')} ${resetsAt}` : ''}
      </span>
      <span className="ml-auto">
        <SourceBadge code={meter.source} locale={locale} />
      </span>
    </li>
  );
}

/** One Hesaplar list row (U-30): mark, label · plan, the limit policy, the U-29 diff count, the
 *  status and a chevron; the whole row opens the account sub-page. */
function AccountListRow({
  account,
  mark,
  locale,
  onOpen,
}: {
  readonly account: AccountDisplay;
  readonly mark: ProviderMarkProps['mark'];
  readonly locale: Locale;
  readonly onOpen: () => void;
}) {
  const diffs = settingDiffs(account.detail).length;
  const status = accountStatus(account.detail);
  return (
    <li data-account-row={account.id}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3 text-left hover:bg-raised"
      >
        <ProviderMark mark={mark} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
          {account.label}
          {account.plan !== null ? <span className="font-normal text-inkdim"> · {account.plan}</span> : null}
        </span>
        <span className="text-[12px] text-inkdim">{t(locale, policyLabelKey(account.detail.limitPolicy))}</span>
        {diffs > 0 ? <StateBadge tone="signal">{t(locale, 'editor.row.diffs').replace('{n}', String(diffs))}</StateBadge> : null}
        <StateBadge tone={status === 'reserve' ? 'signal' : status === 'ready' ? 'proceed' : 'dim'}>
          {t(locale, STATUS_KEY[status])}
        </StateBadge>
        <span aria-hidden="true" className="text-inkdim">
          ›
        </span>
      </button>
    </li>
  );
}

const STATUS_KEY: Readonly<Record<AccountStatus, LabelKey>> = {
  ready: 'editor.status.ready',
  reserve: 'editor.status.reserve',
  noData: 'editor.status.noData',
};

/** The account picker behind a binding editor: the checked accounts become the chain, in the
 * order they are saved. */
function AccountPicker({
  accounts,
  selected,
  onToggle,
}: {
  readonly accounts: readonly AccountDisplay[];
  readonly selected: readonly string[];
  readonly onToggle: (accountId: string) => void;
}) {
  return (
    <ul className="grid gap-1">
      {accounts.map((account) => (
        <li key={account.id}>
          <label className="flex w-full items-center gap-2.5 rounded-control border border-hairline bg-raised px-2.5 py-1.5 text-left text-[13px] text-ink">
            <input
              type="checkbox"
              checked={selected.includes(account.id)}
              onChange={() => onToggle(account.id)}
              className="accent-signal"
            />
            <span className="truncate">{account.label}</span>
            <code className="truncate font-mono text-[11px] text-inkdim">{account.provider}</code>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** The bindings editor's save payload: the previous chain's order and per-account model survive,
 * newly picked accounts append in list order — editing the chain never silently rewrites either. */
const chainFor = (
  current: readonly { readonly accountId: string; readonly model: string | null }[] | undefined,
  selected: readonly string[],
): BindingSaveInput['accounts'] => {
  const previous = current ?? [];
  const kept = previous
    .filter((entry) => selected.includes(entry.accountId))
    .map((entry) =>
      entry.model !== null ? { accountId: entry.accountId, model: entry.model } : { accountId: entry.accountId },
    );
  const added = selected
    .filter((id) => !previous.some((entry) => entry.accountId === id))
    .map((accountId) => ({ accountId }));
  return [...kept, ...added];
};

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
    className="block h-3.5 w-3.5"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

/** Flips to true only once `active` has survived a painted frame — the browser needs the
 *  hidden start state on screen before a transition has something to chase. */
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

// The motion numbers as custom properties on the overlay's root — the same constants and the
// same classes the search palette animates with, so the two overlays speak one motion language.
const MOTION_STYLE = motionVars();

export function SettingsPanel({ open, origin, section, onSection, onClose, store, marks, update, locale, localeStore, onOpenAccount }: SettingsPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // The marks land once, after the first paint; the subscription turns them into a re-render.
  useSyncExternalStore(marks.subscribe, marks.state);
  // The update standing is the shell's to load (the title bar reads it from startup); the panel
  // only subscribes.
  const updateState = useSyncExternalStore(update.subscribe, update.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  const view = state.view;
  // The dismissal of a remove warning is panel-transient (the store exposes no dismiss intent):
  // keyed by the account it was about, so a fresh warning for the same account re-shows the card.
  const [warningDismissedFor, setWarningDismissedFor] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editAccounts, setEditAccounts] = useState<readonly string[]>([]);
  const [newRole, setNewRole] = useState('');
  const [newAccounts, setNewAccounts] = useState<readonly string[]>([]);
  // The account whose sub-page is open (U-28/U-30); null shows the list.
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const editor = useMemo(
    () =>
      createAccountEditorStore({
        run: async (command) => {
          const outcome = await store.runCommand(command);
          return { result: outcome.result, labelKey: outcome.labelKey };
        },
        now: () => Date.now(),
      }),
    [store],
  );

  const panelRef = useRef<HTMLElement>(null);
  // Where focus stood before the panel opened — the panel gives it back on close, unless the
  // open was a pointer's: the palette's origin decision (focusRestoredOnClose) settles that.
  const restoreRef = useRef<HTMLElement | null>(null);
  // The overlay's life in the DOM outlives the open standing: `mounted` keeps it in the tree
  // through the exit transition, `entered` is the standing the CSS transitions chase.
  const [mounted, setMounted] = useState(open);
  const entered = usePaintedFlip(mounted && open);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (restoreRef.current !== null) {
      // A pointer-opened panel blurs its opener — focus falls to the body, and the button keeps
      // no keyboard-style ring it never earned.
      if (focusRestoredOnClose(origin)) restoreRef.current.focus();
      else restoreRef.current.blur();
      restoreRef.current = null;
    }
  }, [open]);

  // The panel takes focus only once the overlay is in the DOM — `mounted` lags the open standing
  // by one render, so an effect on `open` alone would find an empty ref.
  useEffect(() => {
    if (open && mounted) panelRef.current?.focus();
  }, [open, mounted]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Safety net for the exit: if the end event never comes (transitions off elsewhere), the
  // overlay still leaves the DOM — after the longest close, so a real transition always wins.
  useEffect(() => {
    if (!mounted || open) return;
    const timer = window.setTimeout(() => setMounted(false), MOTION.close.panelMs + MOTION.close.backdropDelayMs + 120);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  const remove = (accountId: string): void => {
    setWarningDismissedFor(null);
    void store.removeAccount(accountId);
  };
  const confirmRemove = (accountId: string): void => {
    void store.confirmRemoveAccount(accountId);
  };

  const accounts = view?.accounts ?? [];
  const openAccount = openAccountId === null ? undefined : accounts.find((account) => account.id === openAccountId);
  const toggle = (list: readonly string[], id: string): readonly string[] =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  const startEdit = (role: string, selected: readonly string[]): void => {
    setEditRole(role);
    setEditAccounts(selected);
    setNewRole('');
    setNewAccounts([]);
  };
  const saveEdit = (): void => {
    if (editRole === null) return;
    const current = view?.bindings.find((binding) => binding.role === editRole)?.accounts;
    void store.saveBinding({ role: editRole, accounts: chainFor(current, editAccounts) });
    setEditRole(null);
  };
  const saveNew = (): void => {
    const role = newRole.trim();
    if (role === '') return;
    void store.saveBinding({ role, accounts: newAccounts.map((accountId) => ({ accountId })) });
    setNewRole('');
    setNewAccounts([]);
  };

  const removeWarning = state.removeWarning;
  const showRemoveWarning = removeWarning !== null && removeWarning.accountId !== warningDismissedFor;

  if (!mounted) return null;

  /** Traps Tab inside the panel: the menu, the close control and the section's own controls are
   *  the only stops, wrapping both ways. */
  const trapTab = (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const stops = [...panel.querySelectorAll<HTMLElement>('input, button, select, textarea')];
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
      // Esc first leaves the account sub-page, then closes the panel (U-28).
      if (openAccountId !== null) setOpenAccountId(null);
      else onClose();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  return (
    <div
      data-settings-scrim
      style={MOTION_STYLE}
      // A press that begins on the scrim itself (never on the panel it wraps) closes.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTransitionEnd={(event) => {
        // The scrim's own fade ends last on close (the panel leaves first) — that is the
        // moment the overlay's life in the DOM is over.
        if (!open && event.target === event.currentTarget && event.propertyName === 'opacity') {
          setMounted(false);
        }
      }}
      className={[
        'fixed inset-0 z-40 grid place-items-center bg-bg/60 p-8',
        'transition-[opacity,backdrop-filter] [transition-timing-function:var(--motion-ease)]',
        entered
          ? 'opacity-100 backdrop-blur-md duration-[var(--motion-open-backdrop)]'
          : 'opacity-0 backdrop-blur-[0px] duration-[var(--motion-close)] delay-[var(--motion-close-backdrop-delay)]',
        // Reduced motion: a quick fade, no blur travel.
        'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0',
      ].join(' ')}
    >
      <section
        ref={panelRef}
        data-settings-panel
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'nav.settings')}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={[
          // The wizard's frame at the panel's own size: the scrim's 32px padding already holds
          // the 64px the panel keeps clear of the window's edges, so 100% here is the window
          // less that gap and the min() pair only caps the panel at its rest size — together
          // they keep it inside the window down to the 1024×640 minimum, and the columns never
          // let it grow.
          'flex h-[min(580px,100%)] w-[min(880px,100%)] flex-col overflow-hidden rounded-panel border border-bord bg-surface shadow-2xl outline-none',
          'transition-[opacity,translate,scale] [transition-timing-function:var(--motion-ease)]',
          entered
            ? 'opacity-100 translate-y-0 scale-100 duration-[var(--motion-open-panel)] delay-[var(--motion-open-panel-delay)]'
            : 'opacity-0 translate-y-[var(--motion-open-rise)] scale-[var(--motion-open-scale)] duration-[var(--motion-close)]',
          // Reduced motion: a quick fade, the panel rises and scales not at all.
          'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
        ].join(' ')}
      >
        <header className="flex h-12 flex-none items-center justify-between gap-2 border-b border-hairline pl-5 pr-3.5">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{t(locale, 'nav.settings')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(locale, 'settings.close')}
            title={t(locale, 'settings.close')}
            className="grid h-7 w-7 place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
          <div className="flex flex-col gap-1 overflow-y-auto border-r border-hairline p-2.5">
            {SETTINGS_SECTIONS.map((entry) => {
              const current = entry === section;
              return (
                <button
                  key={entry}
                  type="button"
                  onClick={() => onSection(entry)}
                  aria-current={current ? 'true' : undefined}
                  className={`flex h-8 items-center rounded-control border px-2.5 text-left text-[13px] ${
                    current
                      ? `font-semibold text-ink ${ACTIVE_CLASS}`
                      : 'border-transparent text-inkdim hover:bg-raised hover:text-ink'
                  }`}
                >
                  {t(locale, SECTION_KEY[entry])}
                </button>
              );
            })}
          </div>

          <div data-settings-content className="grid content-start gap-5 overflow-y-auto p-5">
            {state.problem !== null ? (
              <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
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

            {showRemoveWarning && removeWarning !== null ? (
              <div role="alert" className="grid gap-2 rounded-card border border-signal/40 bg-signal/10 px-3 py-2.5">
                <p className="text-[13px] text-ink">
                  {t(locale, 'settings.remove.warning')}{' '}
                  <span className="font-mono text-[12.5px] text-signal">{removeWarning.roles.join(', ')}</span>
                </p>
                <div className="flex items-center gap-2">
                  <ActionButton variant="primary" onClick={() => confirmRemove(removeWarning.accountId)}>
                    {t(locale, 'settings.remove.confirm')}
                  </ActionButton>
                  <ActionButton variant="neutral" onClick={() => setWarningDismissedFor(removeWarning.accountId)}>
                    {t(locale, 'settings.remove.cancel')}
                  </ActionButton>
                </div>
              </div>
            ) : null}

            {section === 'language' ? (
              <SectionCard title={t(locale, 'settings.language.label')}>
                <LocaleSwitcher store={localeStore} locale={locale} />
              </SectionCard>
            ) : null}

            {section === 'accounts' && openAccount === undefined ? (
              <SectionCard title={countedLabel(t(locale, 'settings.section.accounts'), accounts.length)}>
                {accounts.length === 0 ? (
                  <p className="text-[13px] text-inkdim">{t(locale, 'settings.accounts.empty')}</p>
                ) : (
                  <ul className="grid gap-2">
                    {accounts.map((account) => (
                      <AccountListRow
                        key={account.id}
                        account={account}
                        mark={marks.markFor(account.provider)}
                        locale={locale}
                        onOpen={() => setOpenAccountId(account.id)}
                      />
                    ))}
                  </ul>
                )}
              </SectionCard>
            ) : null}

            {section === 'accounts' && openAccount !== undefined ? (
              <SectionCard
                title={openAccount.label}
                action={
                  <span className="flex items-center gap-2">
                    {onOpenAccount !== undefined ? (
                      <ActionButton variant="neutral" onClick={() => onOpenAccount(openAccount.id)}>
                        {t(locale, 'editor.openView')}
                      </ActionButton>
                    ) : null}
                    <ActionButton variant="neutral" onClick={() => remove(openAccount.id)}>
                      {t(locale, 'settings.account.remove')}
                    </ActionButton>
                  </span>
                }
              >
                <div className="mb-2">
                  <ActionButton variant="ghost" onClick={() => setOpenAccountId(null)}>
                    {t(locale, 'editor.back')}
                  </ActionButton>
                </div>
                <AccountEditor
                  account={openAccount.detail}
                  locale={locale}
                  store={editor}
                  formatTime={store.resetsAtLabel}
                  onRefresh={() => void store.load()}
                />
              </SectionCard>
            ) : null}

            {section === 'bindings' ? (
              <SectionCard title={countedLabel(t(locale, 'settings.section.bindings'), view?.bindings.length ?? 0)}>
                <div className="grid gap-3">
                  {view === null || view.bindings.length === 0 ? (
                    <p className="text-[13px] text-inkdim">{t(locale, 'settings.binding.empty')}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {view.bindings.map((binding) => {
                        const editable = binding.scope.level === 'global';
                        const editing = editRole === binding.role;
                        return (
                          <li
                            key={`${binding.scope.level}:${binding.role}:${scopeName(binding.scope)}`}
                            className="grid gap-1.5 rounded-card border border-hairline bg-surface px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                                <code className="font-mono text-[13px] text-ink">{binding.role}</code>
                                <StateBadge tone={editable ? 'info' : 'dim'}>{t(locale, SCOPE_KEY[binding.scope.level])}</StateBadge>
                                {binding.scope.level !== 'global' ? (
                                  <code className="truncate font-mono text-[11px] text-inkdim">{scopeName(binding.scope)}</code>
                                ) : null}
                                <span className="font-mono text-[11.5px] text-inkdim">
                                  {binding.accounts
                                    .map((entry) => {
                                      const label = accounts.find((account) => account.id === entry.accountId)?.label ?? entry.accountId;
                                      return entry.model !== null ? `${label} · ${entry.model}` : label;
                                    })
                                    .join(' → ')}
                                </span>
                              </div>
                              {editable ? (
                                editing ? (
                                  <span className="flex items-center gap-2">
                                    <ActionButton variant="primary" disabled={editAccounts.length === 0} onClick={saveEdit}>
                                      {t(locale, 'settings.binding.save')}
                                    </ActionButton>
                                    <ActionButton variant="neutral" onClick={() => setEditRole(null)}>
                                      {t(locale, 'settings.binding.cancel')}
                                    </ActionButton>
                                  </span>
                                ) : (
                                  <ActionButton
                                    variant="neutral"
                                    onClick={() => startEdit(binding.role, binding.accounts.map((entry) => entry.accountId))}
                                  >
                                    {t(locale, 'settings.binding.edit')}
                                  </ActionButton>
                                )
                              ) : null}
                            </div>
                            {editing ? (
                              <AccountPicker
                                accounts={accounts}
                                selected={editAccounts}
                                onToggle={(id) => setEditAccounts(toggle(editAccounts, id))}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {editRole === null ? (
                    <div className="grid gap-2.5 rounded-card border border-hairline bg-band p-3">
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-inkdim">
                        {t(locale, 'settings.binding.add')}
                      </span>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="grid gap-1">
                          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">
                            {t(locale, 'settings.binding.role')}
                          </span>
                          <input
                            value={newRole}
                            onChange={(event) => setNewRole(event.target.value)}
                            placeholder={t(locale, 'settings.binding.rolePlaceholder')}
                            className="rounded-control border border-bord bg-raised px-2 py-[5px] font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
                          />
                        </label>
                        <ActionButton variant="primary" size="md" disabled={newRole.trim() === '' || newAccounts.length === 0} onClick={saveNew}>
                          {t(locale, 'settings.binding.save')}
                        </ActionButton>
                      </div>
                      <AccountPicker
                        accounts={accounts}
                        selected={newAccounts}
                        onToggle={(id) => setNewAccounts(toggle(newAccounts, id))}
                      />
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}

            {section === 'discovery' ? (
              <SectionCard
                title={t(locale, 'settings.section.discovery')}
                action={
                  <ActionButton variant="neutral" disabled={state.discovery.running} onClick={() => void store.discover()}>
                    {t(locale, 'settings.discovery.refresh')}
                  </ActionButton>
                }
              >
                <div className="grid gap-2">
                  {state.discovery.running ? (
                    <p className="flex items-center gap-2 font-mono text-[11px] text-inkdim">
                      <span className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
                      {t(locale, 'settings.discovery.running')}
                    </p>
                  ) : null}
                  {state.discovery.failed ? (
                    <p className="text-[13px] text-error">{t(locale, 'settings.discovery.failed')}</p>
                  ) : null}
                  {state.discovery.rows.length === 0 ? (
                    state.discovery.running || state.discovery.failed ? null : (
                      <p className="text-[13px] text-inkdim">{t(locale, 'settings.discovery.empty')}</p>
                    )
                  ) : (
                    <ul className="grid gap-2">
                      {state.discovery.rows.map((row: DiscoveryRow) => (
                        <li key={row.defId} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-surface px-3 py-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <code className="font-mono text-[13px] text-ink">{row.defId}</code>
                            <DiscoveryBadges binPath={row.binPath} loggedIn={row.loggedIn} locale={locale} />
                            {row.optionalFlags.length > 0 ? (
                              <span className="font-mono text-[11px] text-inkdim">
                                {t(locale, 'settings.discovery.flags')}: {row.optionalFlags.join(', ')}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </SectionCard>
            ) : null}

            {section === 'phone' ? (
              <SectionCard title={t(locale, 'settings.section.phone')}>
                {/* The honest status, no fake data: the phone link feature does not exist yet, so
                    the section says so and offers nothing that pretends otherwise (U-24). */}
                <div className="grid gap-2.5">
                  <p className="text-[13.5px] font-semibold text-ink">{t(locale, 'settings.phone.none')}</p>
                  <p className="max-w-[52ch] text-[13px] text-inkdim">{t(locale, 'settings.phone.explain')}</p>
                  <div className="flex items-center gap-2.5">
                    <ActionButton variant="neutral" disabled>
                      {t(locale, 'settings.phone.pair')}
                    </ActionButton>
                    <StateBadge tone="dim">{t(locale, 'settings.phone.soon')}</StateBadge>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {section === 'update' ? (
              <SectionCard
                title={t(locale, 'settings.section.update')}
                action={
                  <ActionButton variant="neutral" disabled={updateState.checking} onClick={() => void update.check()}>
                    {t(locale, 'settings.update.check')}
                  </ActionButton>
                }
              >
                <div className="grid gap-3" data-settings-update>
                  <p className="font-mono text-[12.5px] text-inkdim">
                    {t(locale, 'settings.update.version')}{' '}
                    <span className="text-ink">{updateState.status?.current ?? '—'}</span>
                  </p>
                  <p className="flex flex-wrap items-baseline gap-2 text-[13px] text-ink">
                    {updateState.status === null ? null : (
                      <>
                        <span>{t(locale, UPDATE_STATUS_KEY[updateState.status.kind])}</span>
                        {updateState.status.kind === 'downloading' ? (
                          <span className="font-mono text-[12px] text-inkdim">%{updateState.status.percent}</span>
                        ) : null}
                        {updateState.status.kind === 'available' || updateState.status.kind === 'ready' ? (
                          <span className="font-mono text-[12px] text-inkdim">{updateState.status.next}</span>
                        ) : null}
                        {updateState.status.kind === 'error' ? (
                          <span className="text-[12.5px] text-error">
                            {t(locale, UPDATE_ERROR_KEY[updateState.status.reason])}
                          </span>
                        ) : null}
                      </>
                    )}
                  </p>
                  {(() => {
                    // The same apply action the bar carries, in the section's own button grammar.
                    if (updateState.status === null) return null;
                    const plan = updateButton(updateState.status);
                    if (!plan.visible) return null;
                    return (
                      <div>
                        <ActionButton variant="primary" disabled={plan.disabled} onClick={() => void update.apply()}>
                          {t(locale, plan.labelKey)}
                          {plan.percent !== null ? ` %${plan.percent}` : ''}
                        </ActionButton>
                      </div>
                    );
                  })()}
                  {updateState.lastOutcome !== null ? (
                    <OutcomeNotice
                      ok={updateState.lastOutcome.result.ok}
                      text={t(locale, updateState.lastOutcome.labelKey)}
                      code={updateState.lastOutcome.result.ok ? undefined : updateState.lastOutcome.result.code}
                    />
                  ) : null}
                </div>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
