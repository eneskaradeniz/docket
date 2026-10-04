// screens/settings.tsx — the settings panel in the wizard's language (U-43): the same Window with a
// menu in place of the steps and a × in the head. Hesaplar draws the same AccountGroups over
// `settings.accounts`, with "Yeniden tara", Test et (U-39), ✎ and below it "Eklenmemiş · n hesap"
// with an Ekle button per candidate; Roller shows Asistan sırası as the same DragOrderList and one
// SettingRow per role with a work-style Listbox; Görünüm is the wizard's two rows; Sağlayıcılar keeps
// U-38's rows in the same card style; Yetenekler is one dashed empty state until the capability
// source lands. ✎ opens the AccountEditor dialog (components/account-editor-dialog.tsx), which saves
// on commit here (U-29). ✕, Esc or a click on the backdrop closes the panel; focus moves in on open,
// is trapped while open, and returns to the opener on a keyboard-opened close only (the palette's one
// rule). Secret values have no surface — account names only — and every user-visible string arrives
// through a label key (U-1).
// The section is the shell's, not the panel's own: the sidebar's Telefon and Ayarlar rows open the
// panel on a named section and read their current standing from it (U-24), so the panel receives
// the section and reports every move; an open sub-page in Hesaplar is the account editor dialog.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { AccountEditorDialog } from '../components/account-editor-dialog';
import { AccountGroups, candidateRowView, type AccountRowView } from '../components/account-groups';
import { AccountTest } from '../components/account-test';
import { ActionButton } from '../components/action-button';
import { AppearanceRows } from '../components/appearance-rows';
import { KeyMoveCard } from '../components/key-move-card';
import { MOTION, motionVars } from '../components/motion';
import { ProviderList } from '../components/provider-list';
import { ProviderMark } from '../components/provider-mark';
import { ChainSection, RoleRowView } from '../components/role-row';
import { SettingRow, SettingRows } from '../components/setting-row';
import { StatusLamp } from '../components/status-lamp';
import { WindowFrame, WindowTitle } from '../components/window-frame';
import {
  accountStatus,
  createAccountEditorStore,
  roleChipTarget,
  rolesOfAccount,
  type AccountStatus,
  type EditorTab,
} from '../stores/account-editor';
import { SECTION_OPEN_INITIAL, groupAccountRows, groupTotals, toggleSection, type AccountGroup } from '../stores/account-groups';
import { candidateDot, type CandidatesStore } from '../stores/candidates';
import type { LocaleStore } from '../stores/locale';
import { providerDisplayName, type ProvidersStore } from '../stores/providers';
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
import { settingsAccountRows, settingsStanding, type SettingsAccountRow } from '../stores/settings-accounts';
import type { ThemeStore } from '../stores/theme';
import { toastOutcome } from '../stores/toasts';
import type { SettingsStore } from '../stores/settings';
import { failureKey } from '../stores/results';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { updateButton, updateStatusTone, type UpdateStore, type UpdateStatus } from '../stores/update';

export interface SettingsPanelProps {
  /** The reducer's open standing — the panel rides over whatever route is current. */
  readonly open: boolean;
  /** Stamped by the open; the close's focus rule reads it. */
  readonly origin: SettingsPanelOrigin;
  /** The selected section — owned by the shell, which names it on open (U-24). */
  readonly section: SettingsSection;
  /** The open sub-page (an account id) inside Hesaplar — the editor dialog — or null (U-28). */
  readonly subPage: string | null;
  /** The editor tab an open asked for (U-37), or null. */
  readonly tab: EditorTab | null;
  /** The role whose "İnce ayar" opens on Roller (U-37), or null. */
  readonly fineTune: string | null;
  /** Opens the panel on a target — the role chips on Genel move it to Roller. */
  readonly onOpenTarget: (target: SettingsOpenTarget) => void;
  /** Reports a section move from the menu, so the sidebar's rows follow it. */
  readonly onSection: (section: SettingsSection) => void;
  /** Leaves the sub-page (closes the account editor). */
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

const SECTION_HINT_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  accounts: 'settings.hint.accounts',
  roles: 'settings.hint.roles',
  capabilities: 'settings.hint.capabilities',
  providers: 'settings.hint.providers',
  appearance: 'settings.hint.appearance',
  phone: 'settings.hint.phone',
  update: 'settings.hint.update',
};

const GROUP_KEY: Readonly<Record<SettingsMenuGroup['id'], LabelKey>> = {
  work: 'settings.group.work',
  app: 'settings.group.app',
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

const STATUS_KEY: Readonly<Record<AccountStatus, LabelKey>> = {
  ready: 'editor.status.ready',
  reserve: 'editor.status.reserve',
  noData: 'editor.status.noData',
  modelError: 'editor.status.modelError',
};

/** A sub-heading inside a section ("Eklenmemiş · 2 hesap"). */
function SubHeading({ title, note }: { readonly title: string; readonly note?: string }) {
  return (
    <h2 className="mb-2 mt-[22px] flex items-baseline gap-2 text-[13px] font-bold text-ink first:mt-0">
      {title}
      {note !== undefined ? <span className="font-medium text-inkdim">{note}</span> : null}
    </h2>
  );
}

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <path d="m4 4 8 8M12 4 4 12" />
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
  // Every intent's report — the panel's own, the Eklenmemiş adoption's, the update apply's —
  // leaves as the one toast (U-50), once per outcome so a reopened panel never repeats it.
  const lastOutcome = state.lastOutcome;
  const candidateOutcome = candidateState.lastOutcome;
  const updateOutcome = updateState.lastOutcome;
  useEffect(() => {
    if (lastOutcome !== null) toastOutcome(locale, lastOutcome);
  }, [lastOutcome, locale]);
  useEffect(() => {
    if (candidateOutcome !== null) toastOutcome(locale, candidateOutcome);
  }, [candidateOutcome, locale]);
  useEffect(() => {
    if (updateOutcome !== null) toastOutcome(locale, updateOutcome);
  }, [updateOutcome, locale]);
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
  // The accounts sections' open standing is this screen's: a "Yeniden tara" re-renders it, never
  // resets it (U-45).
  const [sectionOpen, setSectionOpen] = useState(SECTION_OPEN_INITIAL);
  // One editor store per open account: the tab starts on Genel each time the dialog opens.
  const editor = useMemo(
    () =>
      createAccountEditorStore({
        run: async (command) => {
          const outcome = await store.runCommand(command);
          return { result: outcome.result, labelKey: outcome.labelKey };
        },
        now: () => Date.now(),
      }),
    // A new store per open account keeps the tab from carrying over from the previous one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, subPage],
  );
  // An open that named a tab (U-37: "Ayarlar'da düzenle" lands on Limitler) moves the editor
  // there once its dialog is up.
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
  const groupProviders = candidateState.providers.map((provider) => ({ id: provider.id, name: provider.name, installed: false }));
  const remove = (accountId: string): void => {
    setWarningDismissedFor(null);
    void store.removeAccount(accountId);
  };
  const confirmRemove = (accountId: string): void => {
    void store.confirmRemoveAccount(accountId);
  };
  const closeEditor = (): void => {
    onBack();
    panelRef.current?.focus();
  };

  if (!mounted) return null;

  /** Traps Tab inside the panel: the menu, the close control and the section's own controls are
   *  the only stops, wrapping both ways. */
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
      onEscape();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  const accountRows: readonly SettingsAccountRow[] = settingsAccountRows(accounts, candidateState.providers);
  const accountView = (row: SettingsAccountRow): AccountRowView & { readonly source: SettingsAccountRow } => ({
    id: row.id,
    providerId: row.providerId,
    standing: settingsStanding(row.status),
    label: row.label,
    billing: row.billing,
    viaKey: row.viaKey,
    path: row.path,
    host: row.host,
    status: { tone: row.tone, text: t(locale, STATUS_KEY[row.status]) },
    source: row,
  });
  const addedGroups = groupAccountRows(accountRows.map(accountView), groupProviders);
  const addedTotals = groupTotals(addedGroups);
  const groupName = <R extends AccountRowView>(group: AccountGroup<R>): string =>
    group.name ?? (group.providerId === null ? null : providerName(group.providerId)) ?? group.providerId ?? t(locale, 'accountGroups.unknownProvider');
  const unaddedViews = candidateState.rows.map((row) => {
    const name = row.provider === null ? null : providerName(row.provider);
    // The label of a candidate not yet added: its folder's name without the leading dots, as adoption names it.
    const label = (row.displayPath.split('/').filter((part) => part !== '').pop() ?? row.displayPath).replace(/^\.+/, '');
    return candidateRowView(row, locale, label, name);
  });
  const unaddedGroups = groupAccountRows(unaddedViews, groupProviders);

  const rail = (
    <div className="grid gap-0.5">
      {SETTINGS_MENU.map((group) => (
        <div key={group.id} role="group" aria-label={t(locale, GROUP_KEY[group.id])}>
          <p className="px-2 pb-1 pt-2.5 text-[12px] font-bold text-inkdim">{t(locale, GROUP_KEY[group.id])}</p>
          {group.sections.map((entry) => {
            const current = entry === section;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => onSection(entry)}
                aria-current={current ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[13px] font-semibold ${
                  current ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--signal)]' : 'text-inkdim hover:bg-raised'
                }`}
              >
                {t(locale, SECTION_KEY[entry])}
                {entry === 'accounts' && candidateDot(candidateState, candidateDotMirror) ? (
                  <span
                    role="img"
                    aria-label={t(locale, 'settings.accounts.dot')}
                    title={t(locale, 'settings.accounts.dot')}
                    className="ml-auto h-[7px] w-[7px] flex-none rounded-full bg-signal"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const head = (
    <div className="flex items-start gap-3">
      <WindowTitle title={t(locale, SECTION_KEY[section])} lead={t(locale, SECTION_HINT_KEY[section])} />
      <button
        type="button"
        onClick={onClose}
        aria-label={t(locale, 'settings.close')}
        title={t(locale, 'settings.close')}
        className="ml-auto grid h-[30px] w-[30px] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
      >
        <CloseIcon />
      </button>
    </div>
  );

  const accountsSection = (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="font-bold text-ink">
          {t(locale, 'accountGroups.added')}{' '}
          <span className="font-medium text-inkdim">
            · {t(locale, 'accountGroups.counts').replace('{accounts}', String(addedTotals.accounts)).replace('{assistants}', String(addedTotals.assistants))}
          </span>
        </span>
        <span className="ml-auto">
          <ActionButton disabled={candidateState.loading} onClick={() => void candidates.rescan()}>
            {t(locale, candidateState.loading ? 'candidates.status.scanning' : 'candidates.rescan')}
          </ActionButton>
        </span>
      </div>
      {candidateState.loading ? (
        <div className="-mt-1.5 mb-2.5 h-0.5 overflow-hidden rounded-full bg-hairline" role="progressbar" aria-label={t(locale, 'candidates.status.scanning')}>
          <i className="block h-full w-[30%] animate-[scan_1s_linear_infinite] bg-signal motion-reduce:animate-none" />
        </div>
      ) : null}
      {accounts.length === 0 ? <p className="text-[13px] text-inkdim">{t(locale, 'settings.accounts.empty')}</p> : null}
      <AccountGroups
        locale={locale}
        groups={addedGroups}
        markFor={marks.markFor}
        nameOf={groupName}
        onEdit={(row) => onEnterSubPage(row.id)}
        sections={{ open: sectionOpen, onToggle: (kind) => setSectionOpen(toggleSection(sectionOpen, kind)) }}
        below={(row) => {
          const account = accounts.find((entry) => entry.id === row.id);
          if (account === undefined) return null;
          const testing = state.testing.includes(account.id) || account.detail.test?.state === 'running';
          const refusal = state.testRefusals[account.id];
          if (!row.source.unverified && account.detail.test === null && refusal === undefined) return null;
          return (
            <div className="px-3.5 pb-3">
              <AccountTest
                locale={locale}
                test={account.detail.test}
                showButton={row.source.unverified}
                testing={testing}
                refusal={refusal}
                onTest={() => void store.testAccount(account.id)}
                onOpenModels={() => onOpenTarget({ section: 'accounts', subPage: account.id, tab: 'models' })}
              />
            </div>
          );
        }}
      />

      {/* Eklenmemiş (U-34, U-43): the discovered accounts, a group of their own under the added ones. */}
      {candidateState.rows.length > 0 ? (
        <div data-unadded="">
          <SubHeading title={t(locale, 'candidates.title')} note={t(locale, 'accountGroups.count').replace('{n}', String(candidateState.rows.length))} />
          <AccountGroups
            locale={locale}
            groups={unaddedGroups}
            markFor={marks.markFor}
            nameOf={groupName}
            trailing={(row) => (
              <ActionButton variant="neutral" disabled={candidateState.adopting || row.disabled === true} onClick={() => void candidates.add(row.id)}>
                {t(locale, 'candidates.add')}
              </ActionButton>
            )}
            below={(row) =>
              row.source.keyMoveCard ? <KeyMoveCard locale={locale} on={candidateState.importToken} onChange={(on) => candidates.setImportToken(on)} /> : null
            }
          />
        </div>
      ) : null}
    </div>
  );

  const rolesSection = (
    <div>
      {rolesState.unsetCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3" data-roles-unset>
          <span className="text-[12.5px] text-inkdim">{t(locale, 'roles.unset.line').replace('{n}', String(rolesState.unsetCount))}</span>
          <ActionButton variant="neutral" onClick={() => void roles.applyRecommended()}>
            {t(locale, 'roles.unset.apply')}
          </ActionButton>
        </div>
      ) : null}
      <SubHeading title={t(locale, 'roles.chain.title')} note={t(locale, 'roles.chain.purpose')} />
      <ChainSection store={roles} locale={locale} markFor={marks.markFor} />
      <SubHeading title={t(locale, 'roles.style.title')} />
      {rolesState.rows === null || rolesState.rows.length === 0 ? (
        <p className="text-[13px] text-inkdim">{t(locale, 'roles.empty')}</p>
      ) : (
        <SettingRows>
          {rolesState.rows.map((row) => (
            <RoleRowView key={row.id} row={row} store={roles} locale={locale} markFor={marks.markFor} fineTuneOpen={fineTune === row.id} />
          ))}
        </SettingRows>
      )}
    </div>
  );

  const updateSection = (
    <div data-settings-update>
      <SettingRows>
        <SettingRow
          framed
          locale={locale}
          title={t(locale, 'settings.update.version')}
          control={
            <ActionButton variant="neutral" size="md" disabled={updateState.checking} onClick={() => void update.check()}>
              {t(locale, 'settings.update.check')}
            </ActionButton>
          }
          below={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink">
              <span className="font-mono text-[12.5px] text-ink">{updateState.status?.current ?? '—'}</span>
              {updateState.status === null ? null : (
                <StatusLamp tone={updateStatusTone(updateState.status.kind)}>{t(locale, UPDATE_STATUS_KEY[updateState.status.kind])}</StatusLamp>
              )}
              {updateState.status?.kind === 'downloading' ? <span className="text-[12.5px] text-inkdim">%{updateState.status.percent}</span> : null}
              {updateState.status?.kind === 'available' || updateState.status?.kind === 'ready' ? (
                <span className="font-mono text-[12px] text-inkdim">{updateState.status.next}</span>
              ) : null}
              {updateState.status?.kind === 'error' ? <span className="text-[12.5px] text-error">{t(locale, UPDATE_ERROR_KEY[updateState.status.reason])}</span> : null}
            </div>
          }
        />
      </SettingRows>
      {(() => {
        // The same apply action the bar carries, in the section's own button grammar.
        if (updateState.status === null) return null;
        const plan = updateButton(updateState.status);
        if (!plan.visible) return null;
        return (
          <div className="mt-3">
            <ActionButton variant="primary" disabled={plan.disabled} onClick={() => void update.apply()}>
              {t(locale, plan.labelKey)}
              {plan.percent !== null ? ` %${plan.percent}` : ''}
            </ActionButton>
          </div>
        );
      })()}
    </div>
  );

  return (
    <>
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
        <WindowFrame
          frameRef={panelRef}
          label={t(locale, 'nav.settings')}
          brand={t(locale, 'nav.settings')}
          rail={rail}
          head={head}
          onKeyDown={onKeyDown}
          className={[
            'transition-[opacity,translate,scale] [transition-timing-function:var(--motion-ease)]',
            entered
              ? 'opacity-100 translate-y-0 scale-100 duration-[var(--motion-open-panel)] delay-[var(--motion-open-panel-delay)]'
              : 'opacity-0 translate-y-[var(--motion-open-rise)] scale-[var(--motion-open-scale)] duration-[var(--motion-close)]',
            // Reduced motion: a quick fade, the panel rises and scales not at all.
            'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
          ].join(' ')}
        >
          {state.problem !== null ? (
            <div role="alert" className="mb-3 rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
              {t(locale, failureKey(state.problem))}
            </div>
          ) : null}

          {section === 'accounts' ? accountsSection : null}
          {section === 'roles' ? rolesSection : null}
          {section === 'capabilities' ? (
            <div className="max-w-[520px] rounded-card border border-dashed border-bord p-[22px] text-inkdim" data-capabilities-empty="">
              <b className="mb-1 block text-ink">{t(locale, 'settings.capabilities.soonTitle')}</b>
              {t(locale, 'settings.capabilities.soonBody')}
            </div>
          ) : null}
          {section === 'providers' ? <ProviderList store={providers} marks={marks} locale={locale} /> : null}
          {section === 'appearance' ? <AppearanceRows locale={locale} localeStore={localeStore} themeStore={themeStore} /> : null}
          {section === 'phone' ? (
            // The honest status, no fake data: the phone link feature does not exist yet, so the section
            // says so and offers nothing that pretends otherwise (U-24).
            <SettingRows>
              <SettingRow
                framed
                locale={locale}
                title={t(locale, 'settings.phone.none')}
                purpose={t(locale, 'settings.phone.explain')}
                control={
                  <span className="flex items-center gap-3">
                    <StatusLamp tone="dim">{t(locale, 'settings.phone.soon')}</StatusLamp>
                    <ActionButton variant="neutral" size="md" disabled>
                      {t(locale, 'settings.phone.pair')}
                    </ActionButton>
                  </span>
                }
              />
            </SettingRows>
          ) : null}
          {section === 'update' ? updateSection : null}
        </WindowFrame>
      </div>
      {/* The editor dialog stands beside the scrim, not inside it: the scrim's blur and the window's
          transform would otherwise become the containing block of its fixed frame. */}
      {section === 'accounts' && openAccount !== undefined ? (
        <AccountEditorDialog
          host="settings"
          account={openAccount.detail}
          locale={locale}
          store={editor}
          models={models}
          formatTime={store.resetsAtLabel}
          onRefresh={() => void store.refreshQuota(openAccount.id)}
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
          mark={<ProviderMark provider={openAccount.provider} mark={marks.markFor(openAccount.provider)} size={19} />}
          title={`${providerName(openAccount.provider) ?? openAccount.provider} · ${openAccount.label}`}
          meta={[openAccount.detail.identityDir, openAccount.detail.endpointHost].filter((part): part is string => part !== null && part !== '').join(' · ')}
          billing={openAccount.detail.billing}
          viaKey={openAccount.detail.authMode === 'api_key'}
          status={{
            tone: settingsAccountRows([openAccount], candidateState.providers)[0]?.tone ?? 'dim',
            text: t(locale, STATUS_KEY[accountStatus(openAccount.detail)]),
          }}
          {...(onOpenAccount === undefined ? {} : { onOpenView: () => onOpenAccount(openAccount.id) })}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}
