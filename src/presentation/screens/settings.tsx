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
import { CandidateList } from '../components/candidate-list';
import { ACTIVE_CLASS } from '../components/active-state';
import { AccountEditor } from '../components/account-editor';
import { ChainSection, RoleRowView } from '../components/role-row';
import { ProviderList } from '../components/provider-list';
import { countedLabel } from '../components/counted-label';
import { formatMeterValue, meterUnitLabel } from '../components/meter-value';
import { LocaleSwitcher } from '../components/locale-switcher';
import { motionVars, MOTION } from '../components/motion';
import { OutcomeNotice } from '../components/outcome-notice';
import { ProviderMark, type ProviderMarkProps } from '../components/provider-mark';
import { SegmentedControl } from '../components/segmented-control';
import { SettingRow } from '../components/setting-row';
import { SourceBadge } from '../components/source-badge';
import { StatusLamp } from '../components/status-lamp';
import { candidateDot, type CandidatesStore } from '../stores/candidates';
import type { ProvidersStore } from '../stores/providers';
import type { LocaleStore } from '../stores/locale';
import {
  accountHeadMeta,
  accountStatus,
  accountStatusTone,
  createAccountEditorStore,
  diffCountText,
  policyLabelKey,
  roleChipTarget,
  rolesOfAccount,
  type AccountStatus,
  type EditorTab,
} from '../stores/account-editor';
import { providerDisplayName } from '../stores/providers';
import { settingDiffs } from '../stores/recommended';
import type { AccountModelsStore } from '../stores/account-models';
import type { RolesStore } from '../stores/roles';
import { focusRestoredOnClose } from '../stores/search-palette';
import {
  SETTINGS_MENU,
  SETTINGS_SECTIONS,
  type SettingsMenuGroup,
  type SettingsOpenTarget,
  type SettingsPanelOrigin,
  type SettingsSection,
} from '../stores/settings-panel';
import { THEME_PREFERENCES, type ThemePreference, type ThemeStore } from '../stores/theme';
import type {
  AccountDisplay,
  MeterDisplay,
  SettingsStore,
} from '../stores/settings';
import { failureKey } from '../stores/results';
import { providerUnverified, type TestRefusal } from '../stores/account-test';
import { AccountTest } from '../components/account-test';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { updateButton, updateStatusTone, type UpdateStore, type UpdateStatus } from '../stores/update';

export interface SettingsPanelProps {
  /** The reducer's open standing — the panel rides over whatever route is current. */
  readonly open: boolean;
  /** Stamped by the open; the close's focus rule reads it. */
  readonly origin: SettingsPanelOrigin;
  /** The selected section — owned by the shell, which names it on open (U-24). */
  readonly section: SettingsSection;
  /** The open sub-page (an account or role id) inside the section, or null (U-28). */
  readonly subPage: string | null;
  /** The editor tab an open asked for (U-37), or null. */
  readonly tab: EditorTab | null;
  /** The role whose "İnce ayar" opens on Roller (U-37), or null. */
  readonly fineTune: string | null;
  /** Opens the panel on a target — the role chips on Genel move it to Roller. */
  readonly onOpenTarget: (target: SettingsOpenTarget) => void;
  /** Reports a section move from the menu, so the sidebar's rows follow it. */
  readonly onSection: (section: SettingsSection) => void;
  /** The back row: leaves the sub-page. */
  readonly onBack: () => void;
  /** Opens a sub-page of the section (an account id in Hesaplar). */
  readonly onEnterSubPage: (id: string) => void;
  /** Esc: leaves the sub-page first, then closes (the reducer decides). */
  readonly onEscape: () => void;
  readonly onClose: () => void;
  /** Whether Hesaplar carries the amber dot — discovery holds an account not yet added. */
  readonly candidateDot: boolean;
  /** The discovered accounts under Hesaplar → "Eklenmemiş" (U-34). */
  readonly candidates: CandidatesStore;
  /** The Sağlayıcılar section's discovered providers (U-38). */
  readonly providers: ProvidersStore;
  /** Tema (U-36) binds straight to the theme store. */
  readonly themeStore: ThemeStore;
  readonly store: SettingsStore;
  /** The provider marks the accounts list's badges resolve from (loaded once, session-cached). */
  readonly marks: ProviderMarksStore;
  /** The per-account model list and its spend-consent flow (P-40), fed by `account.models`. */
  readonly models: AccountModelsStore;
  /** The Roller section's roles, shared chain and work styles (U-33). */
  readonly roles: RolesStore;
  /** The app-update standing the Güncelleme section reads (U-24). */
  readonly update: UpdateStore;
  readonly locale: Locale;
  /** The language control binds straight to the locale store: a selection swaps the bundle for the
   *  whole app through the root's subscription and persists the choice (U-9). */
  readonly localeStore: LocaleStore;
  /** Closes the panel and opens the account's own view ("Hesap görünümünü aç", U-30). */
  readonly onOpenAccount?: (accountId: string) => void;
}

// The sections and their menu groups are the store's (U-28); the type stays importable from here.
export type { SettingsSection };
export { SETTINGS_SECTIONS };

const SECTION_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  accounts: 'settings.section.accounts',
  roles: 'settings.section.roles',
  capabilities: 'settings.section.capabilities',
  providers: 'settings.section.providers',
  appearance: 'settings.section.appearance',
  phone: 'settings.section.phone',
  update: 'settings.section.update',
};

const GROUP_KEY: Readonly<Record<SettingsMenuGroup['id'], LabelKey>> = {
  work: 'settings.group.work',
  app: 'settings.group.app',
};

const THEME_KEY: Readonly<Record<ThemePreference, LabelKey>> = {
  system: 'settings.theme.system',
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
};

/** Tema — Sistem · Koyu · Açık as a segment control (U-36), beside Dil. */
function ThemeSwitcher({ store, locale }: { readonly store: ThemeStore; readonly locale: Locale }) {
  const preference = useSyncExternalStore(store.subscribe, store.preference);
  return (
    <SegmentedControl<ThemePreference>
      label={t(locale, 'settings.theme.label')}
      value={preference}
      options={THEME_PREFERENCES.map((option) => ({ id: option, text: t(locale, THEME_KEY[option]) }))}
      onPick={(option) => store.set(option)}
    />
  );
}

/** A section's opening: its plain 20/700 title (U-28) with an optional action at the right edge;
 *  the rows follow directly under it — no boxed header, no card around the list. */
function SectionBlock({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3" data-settings-section>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

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
      <span className="text-[12.5px] text-inkdim">
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
  unverified,
  testing,
  refusal,
  onTest,
  onOpenModels,
}: {
  readonly account: AccountDisplay;
  readonly mark: ProviderMarkProps['mark'];
  readonly locale: Locale;
  readonly onOpen: () => void;
  /** The provider reads Doğrulanamadı (U-38): the row carries the inline "Test et" (U-39). */
  readonly unverified: boolean;
  readonly testing: boolean;
  readonly refusal: TestRefusal | undefined;
  readonly onTest: () => void;
  readonly onOpenModels: () => void;
}) {
  const diffs = settingDiffs(account.detail).length;
  const status = accountStatus(account.detail);
  return (
    <li data-account-row={account.id} className="grid gap-1">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-[52px] w-full items-center gap-3 rounded-card border border-hairline bg-surface px-4 text-left hover:border-bord hover:bg-raised"
      >
        <ProviderMark provider={account.provider} mark={mark} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
          {account.label}
          {account.plan !== null ? <span className="font-normal text-inkdim"> · {account.plan}</span> : null}
        </span>
        <span className="text-[12px] text-inkdim">{t(locale, policyLabelKey(account.detail.limitPolicy))}</span>
        {diffs > 0 ? <span className="flex-none text-[12px] text-signal-soft">{diffCountText(locale, diffs)}</span> : null}
        <StatusLamp tone={accountStatusTone(status)}>{t(locale, STATUS_KEY[status])}</StatusLamp>
        <span aria-hidden="true" className="text-inkdim">
          ›
        </span>
      </button>
      {unverified || account.detail.test !== null || refusal !== undefined ? (
        <div className="px-4">
          <AccountTest
            locale={locale}
            test={account.detail.test}
            showButton={unverified}
            testing={testing || account.detail.test?.state === 'running'}
            refusal={refusal}
            onTest={onTest}
            onOpenModels={onOpenModels}
          />
        </div>
      ) : null}
    </li>
  );
}

const STATUS_KEY: Readonly<Record<AccountStatus, LabelKey>> = {
  ready: 'editor.status.ready',
  reserve: 'editor.status.reserve',
  noData: 'editor.status.noData',
  modelError: 'editor.status.modelError',
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

export function SettingsPanel({ open, origin, section, subPage, tab, fineTune, onOpenTarget, onSection, onBack, onEscape, onClose, candidateDot: candidateDotMirror, candidates, providers, models, themeStore, store, marks, roles, update, locale, localeStore, onEnterSubPage, onOpenAccount }: SettingsPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const candidateState = useSyncExternalStore(candidates.subscribe, candidates.state);
  // The marks land once, after the first paint; the subscription turns them into a re-render.
  useSyncExternalStore(marks.subscribe, marks.state);
  // The update standing is the shell's to load (the title bar reads it from startup); the panel
  // only subscribes.
  const updateState = useSyncExternalStore(update.subscribe, update.state);
  useEffect(() => {
    void store.load();
  }, [store]);
  // The Eklenmemiş list reads (cached) whenever Hesaplar is on screen.
  useEffect(() => {
    if (open && section === 'accounts') void candidates.load();
  }, [open, section, candidates]);
  // Sağlayıcılar scans whenever the section opens.
  useEffect(() => {
    if (open && section === 'providers') void providers.load();
  }, [open, section, providers]);

  const view = state.view;
  const rolesState = useSyncExternalStore(roles.subscribe, roles.state);
  // The Roller rows load whenever the section is on screen, and for the role chips on an
  // account's Genel tab.
  useEffect(() => {
    if (open && (section === 'roles' || (section === 'accounts' && subPage !== null))) void roles.load();
  }, [open, section, subPage, roles]);
  // The dismissal of a remove warning is panel-transient (the store exposes no dismiss intent):
  // keyed by the account it was about, so a fresh warning for the same account re-shows the card.
  const [warningDismissedFor, setWarningDismissedFor] = useState<string | null>(null);
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
  // An open that named a tab (U-37: "Ayarlar'da düzenle" lands on Limitler) moves the editor
  // there once its sub-page is up.
  useEffect(() => {
    if (open && section === 'accounts' && subPage !== null && tab !== null) editor.setTab(tab);
  }, [open, section, subPage, tab, editor]);

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
  const openAccount = subPage === null ? undefined : accounts.find((account) => account.id === subPage);
  const removeWarning = state.removeWarning;
  const showRemoveWarning = removeWarning !== null && removeWarning.accountId !== warningDismissedFor;
  // An account's provider reads by the display name discovery reports (A-67), by id only when unknown.
  const providerName = (id: string): string | null =>
    providerDisplayName(
      candidateState.providers.map((row) => ({ defId: row.id, name: row.name })),
      id,
    );

  if (!mounted) return null;

  // A sub-page replaces the section's list; only Hesaplar and Roller open one (U-28).
  const listSection: SettingsSection | null =
    subPage !== null && (section === 'accounts' || section === 'roles') ? null : section;

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
      onEscape();
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
            {SETTINGS_MENU.map((group) => (
              <div key={group.id} role="group" aria-label={t(locale, GROUP_KEY[group.id])} className="grid gap-1">
                <p className="px-2.5 pb-0.5 pt-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-inkdim">
                  {t(locale, GROUP_KEY[group.id])}
                </p>
                {group.sections.map((entry) => {
                  const current = entry === section;
                  return (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => onSection(entry)}
                      aria-current={current ? 'true' : undefined}
                      className={`flex h-8 items-center justify-between gap-2 rounded-control border px-2.5 text-left text-[13px] ${
                        current
                          ? `font-semibold text-ink ${ACTIVE_CLASS}`
                          : 'border-transparent text-inkdim hover:bg-raised hover:text-ink'
                      }`}
                    >
                      {t(locale, SECTION_KEY[entry])}
                      {entry === 'accounts' && candidateDot(candidateState, candidateDotMirror) ? (
                        <span
                          role="img"
                          aria-label={t(locale, 'settings.accounts.dot')}
                          title={t(locale, 'settings.accounts.dot')}
                          className="h-2 w-2 flex-none rounded-full bg-signal"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
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

            {subPage !== null && listSection === null && section === 'accounts' ? (
              openAccount === undefined ? null : (
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={onBack}
                    className="flex h-7 w-fit items-center gap-1 rounded-control px-2 text-[13px] text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
                  >
                    {t(locale, 'editor.back')}
                  </button>
                  <header className="flex items-center gap-3" data-account-head={openAccount.id}>
                    <ProviderMark provider={openAccount.provider} mark={marks.markFor(openAccount.provider)} size={20} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[20px] font-bold tracking-[-0.01em] text-ink">{openAccount.label}</h2>
                      <p className="truncate text-[12.5px] text-inkdim">{accountHeadMeta(locale, openAccount.detail, providerName(openAccount.provider))}</p>
                    </div>
                    <StatusLamp tone={accountStatusTone(accountStatus(openAccount.detail))}>
                      {t(locale, STATUS_KEY[accountStatus(openAccount.detail)])}
                    </StatusLamp>
                    {onOpenAccount !== undefined ? (
                      <button
                        type="button"
                        onClick={() => onOpenAccount(openAccount.id)}
                        className="flex-none rounded-control text-[13px] text-ink underline decoration-bord underline-offset-4 hover:decoration-ink"
                      >
                        {t(locale, 'editor.openView')}
                      </button>
                    ) : null}
                  </header>
                  <AccountEditor
                    account={openAccount.detail}
                    locale={locale}
                    store={editor}
                    models={models}
                    formatTime={store.resetsAtLabel}
                    resetLine={store.resetLine}
                    onRefresh={() => void store.load()}
                    roleChips={rolesOfAccount(rolesState.rows, openAccount.id)}
                    onOpenRole={(roleId) => onOpenTarget(roleChipTarget(roleId))}
                    providerName={providerName(openAccount.provider)}
                    accountTest={{
                      testing: state.testing.includes(openAccount.id),
                      refusal: state.testRefusals[openAccount.id],
                      onTest: () => void store.testAccount(openAccount.id),
                    }}
                    onRemove={() => remove(openAccount.id)}
                    {...(showRemoveWarning && removeWarning !== null && removeWarning.accountId === openAccount.id
                      ? {
                          removeWarning: {
                            roles: removeWarning.roles,
                            onConfirm: () => confirmRemove(removeWarning.accountId),
                            onDismiss: () => setWarningDismissedFor(removeWarning.accountId),
                          },
                        }
                      : {})}
                  />
                </div>
              )
            ) : null}

            {subPage !== null && listSection === null && section !== 'accounts' ? (
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  className="flex h-7 w-fit items-center gap-1 rounded-control px-2 text-[13px] text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
                >
                  <span aria-hidden="true">‹</span>
                  {t(locale, SECTION_KEY[section])}
                </button>
                <p className="text-[13px] text-inkdim">{t(locale, 'settings.subpage.placeholder')}</p>
              </div>
            ) : null}

            {listSection === 'appearance' ? (
              <SectionBlock title={t(locale, 'settings.section.appearance')}>
                <div>
                  <SettingRow locale={locale} title={t(locale, 'settings.language.label')} control={<LocaleSwitcher store={localeStore} locale={locale} />} />
                  <SettingRow locale={locale} title={t(locale, 'settings.theme.label')} control={<ThemeSwitcher store={themeStore} locale={locale} />} />
                </div>
              </SectionBlock>
            ) : null}

            {listSection === 'capabilities' ? (
              <SectionBlock title={t(locale, 'settings.section.capabilities')}>
                <p className="text-[13px] text-inkdim">{t(locale, 'settings.capabilities.placeholder')}</p>
              </SectionBlock>
            ) : null}

            {listSection === 'accounts' ? (
              <SectionBlock title={countedLabel(t(locale, 'settings.section.accounts'), accounts.length)}>
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
                        onOpen={() => onEnterSubPage(account.id)}
                        unverified={providerUnverified(candidateState.providers, account.provider)}
                        testing={state.testing.includes(account.id)}
                        refusal={state.testRefusals[account.id]}
                        onTest={() => void store.testAccount(account.id)}
                        onOpenModels={() => onOpenTarget({ section: 'accounts', subPage: account.id, tab: 'models' })}
                      />
                    ))}
                  </ul>
                )}
              </SectionBlock>
            ) : null}

            {/* Eklenmemiş (U-34): the discovered accounts, a titled block of its own under the account list. */}
            {listSection === 'accounts' ? (
              <section className="grid gap-3" data-settings-section>
                <h3 className="text-[14px] font-semibold text-ink">{t(locale, 'candidates.title')}</h3>
                <CandidateList store={candidates} marks={marks} locale={locale} />
              </section>
            ) : null}

            {listSection === 'roles' ? (
              <SectionBlock title={t(locale, 'settings.section.roles')}>
                {rolesState.unsetCount > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3" data-roles-unset>
                    <span className="text-[12.5px] text-inkdim">{t(locale, 'roles.unset.line').replace('{n}', String(rolesState.unsetCount))}</span>
                    <ActionButton variant="neutral" onClick={() => void roles.applyRecommended()}>
                      {t(locale, 'roles.unset.apply')}
                    </ActionButton>
                  </div>
                ) : null}
                <ChainSection store={roles} locale={locale} markFor={marks.markFor} />
                {rolesState.rows === null || rolesState.rows.length === 0 ? (
                  <p className="text-[13px] text-inkdim">{t(locale, 'roles.empty')}</p>
                ) : (
                  <div>
                    {rolesState.rows.map((row) => (
                      <RoleRowView key={row.id} row={row} store={roles} locale={locale} markFor={marks.markFor} fineTuneOpen={fineTune === row.id} />
                    ))}
                  </div>
                )}
              </SectionBlock>
            ) : null}

            {listSection === 'providers' ? (
              <SectionBlock title={t(locale, 'settings.section.providers')}>
                <ProviderList store={providers} marks={marks} locale={locale} />
              </SectionBlock>
            ) : null}

            {listSection === 'phone' ? (
              <SectionBlock title={t(locale, 'settings.section.phone')}>
                {/* The honest status, no fake data: the phone link feature does not exist yet, so
                    the section says so and offers nothing that pretends otherwise (U-24). */}
                <div className="grid gap-2.5">
                  <p className="text-[14px] font-semibold text-ink">{t(locale, 'settings.phone.none')}</p>
                  <p className="max-w-[52ch] text-[13px] text-inkdim">{t(locale, 'settings.phone.explain')}</p>
                  <div className="flex items-center gap-3">
                    <ActionButton variant="neutral" disabled>
                      {t(locale, 'settings.phone.pair')}
                    </ActionButton>
                    <StatusLamp tone="dim">{t(locale, 'settings.phone.soon')}</StatusLamp>
                  </div>
                </div>
              </SectionBlock>
            ) : null}

            {listSection === 'update' ? (
              <SectionBlock
                title={t(locale, 'settings.section.update')}
                action={
                  <ActionButton variant="neutral" disabled={updateState.checking} onClick={() => void update.check()}>
                    {t(locale, 'settings.update.check')}
                  </ActionButton>
                }
              >
                <div className="grid gap-3" data-settings-update>
                  <p className="text-[13px] text-inkdim">
                    {t(locale, 'settings.update.version')}{' '}
                    <span className="font-mono text-[12.5px] text-ink">{updateState.status?.current ?? '—'}</span>
                  </p>
                  {updateState.status === null ? null : (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink">
                      <StatusLamp tone={updateStatusTone(updateState.status.kind)}>{t(locale, UPDATE_STATUS_KEY[updateState.status.kind])}</StatusLamp>
                      {updateState.status.kind === 'downloading' ? (
                        <span className="text-[12.5px] text-inkdim">%{updateState.status.percent}</span>
                      ) : null}
                      {updateState.status.kind === 'available' || updateState.status.kind === 'ready' ? (
                        <span className="font-mono text-[12px] text-inkdim">{updateState.status.next}</span>
                      ) : null}
                      {updateState.status.kind === 'error' ? (
                        <span className="text-[12.5px] text-error">{t(locale, UPDATE_ERROR_KEY[updateState.status.reason])}</span>
                      ) : null}
                    </p>
                  )}
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
              </SectionBlock>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
