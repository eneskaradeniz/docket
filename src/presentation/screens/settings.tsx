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
import { AccountsScanning } from '../components/accounts-scanning';
import { AccountsSections, type AccountsSectionKind } from '../components/accounts-sections';
import { AccountTest } from '../components/account-test';
import { ActionButton } from '../components/action-button';
import { SettingsLaunchers } from '../components/launcher-rows';
import { AppearanceRows } from '../components/appearance-rows';
import { ConcurrencySection } from '../components/concurrency-section';
import { KeyMoveCard } from '../components/key-move-card';
import { MOTION, motionVars } from '../components/motion';
import { ProviderList } from '../components/provider-list';
import { ProviderMark } from '../components/provider-mark';
import { SettingRow, SettingRows } from '../components/setting-row';
import { CapabilitySection } from '../components/capability-section';
import { MemorySection } from '../components/memory-section';
import { SettingsMenu } from '../components/settings-menu';
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
import { groupAccountRows, groupTotals, type AccountGroup } from '../stores/account-groups';
import { candidateDot, type CandidatesStore } from '../stores/candidates';
import { createDispatchSettingsStore } from '../stores/dispatch-settings';
import { addedOpen, unaddedOpen } from '../stores/settings-cards';
import type { LocaleStore } from '../stores/locale';
import { providerDisplayName, type ProvidersStore } from '../stores/providers';
import type { AccountModelsStore } from '../stores/account-models';
import type { RolesStore } from '../stores/roles';
import { focusRestoredOnClose } from '../stores/search-palette';
import {
  SETTINGS_SECTIONS,
  reclaimsPanelFocus,
  type SettingsOpenTarget,
  type SettingsPanelOrigin,
  type SettingsSection,
} from '../stores/settings-panel';
import { settingsAccountRows, settingsStanding, type SettingsAccountRow } from '../stores/settings-accounts';
import type { ThemeStore } from '../stores/theme';
import { toastOutcome } from '../stores/toasts';
import type { Api } from '../../api/api';
import type { Actor } from '../../domain/index';
import {
  createAgentCapabilitiesStore,
  isAgentCapabilitySection,
  type AgentCapabilitiesStore,
} from '../stores/agent-capabilities';
import { builtinRoleLibrary } from '../stores/repo-settings';
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
  concurrency: 'settings.section.concurrency',
  providers: 'settings.section.providers',
  memory: 'settings.section.memory',
  roles: 'settings.section.roles',
  plugins: 'settings.section.plugins',
  mcp: 'settings.section.mcp',
  skills: 'settings.section.skills',
  commands: 'settings.section.commands',
  hooks: 'settings.section.hooks',
  appearance: 'settings.section.appearance',
  update: 'settings.section.update',
};

const SECTION_HINT_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  accounts: 'settings.hint.accounts',
  concurrency: 'settings.hint.concurrency',
  providers: 'settings.hint.providers',
  memory: 'settings.hint.memory',
  roles: 'settings.hint.roles',
  plugins: 'settings.hint.plugins',
  mcp: 'settings.hint.mcp',
  skills: 'settings.hint.skills',
  commands: 'settings.hint.commands',
  hooks: 'settings.hint.hooks',
  appearance: 'settings.hint.appearance',
  update: 'settings.hint.update',
};

const SETTINGS_ACTOR: Actor = { kind: 'user', id: 'settings-panel', label: 'Operator' };

const docketBridge = (): Pick<Api, 'query' | 'command'> => {
  const bridge = (window as unknown as { docket?: Pick<Api, 'query' | 'command'> }).docket;
  if (bridge === undefined) {
    return {
      query: async () => ({ ok: false, code: 'not_found' }),
      command: async () => ({ ok: false, code: 'not_found' }),
    };
  }
  return bridge;
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

export function SettingsPanel({ open, origin, section, subPage, tab, fineTune: _fineTune, onOpenTarget, onSection, onBack, onEscape, onClose, candidateDot: candidateDotMirror, candidates, providers, models, themeStore, store, marks, roles, update, locale, localeStore, onEnterSubPage, onOpenAccount }: SettingsPanelProps) {
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
    // Every section arrival re-reads the view: a binding updated over in Roller must be what
    // Hesaplar decides removal on when the user comes back, not the view from before the trip.
    if (open) void store.load();
  }, [store, open, section]);
  // The scans live in memory for the session: opening a section reads them and scans only if
  // none was ever read ("Yeniden tara" is the one way to refresh).
  useEffect(() => {
    if (open && section === 'accounts') void candidates.ensure();
  }, [open, section, candidates]);
  useEffect(() => {
    if (open && section === 'providers') void providers.ensure();
  }, [open, section, providers]);

  const view = state.view;
  const rolesState = useSyncExternalStore(roles.subscribe, roles.state);
  // The Roller rows load whenever the section is on screen, and for the role chips on an
  // account's Genel tab.
  useEffect(() => {
    if (open && section === 'accounts' && subPage !== null) void roles.load();
  }, [open, section, subPage, roles]);
  const agentCapabilities = useMemo<AgentCapabilitiesStore>(
    () =>
      createAgentCapabilitiesStore({
        api: docketBridge(),
        actor: SETTINGS_ACTOR,
        runCommand: async (command) => (await store.runCommand(command)).result,
        roleLibrary: async () => builtinRoleLibrary(),
        now: () => Date.now(),
      }),
    [store],
  );
  const agentState = useSyncExternalStore(agentCapabilities.subscribe, agentCapabilities.state);
  useEffect(() => {
    if (open && isAgentCapabilitySection(section)) {
      agentCapabilities.setSection(section);
      void agentCapabilities.load();
    }
  }, [open, section, agentCapabilities]);
  const [pendingSection, setPendingSection] = useState<SettingsSection | 'close' | null>(null);
  const tryLeaveAgent = (next: SettingsSection | 'close'): boolean => {
    if (!isAgentCapabilitySection(section)) {
      if (next === 'close') onClose();
      else onSection(next);
      return true;
    }
    if (agentCapabilities.closeSubview() && agentCapabilities.requestLeave()) {
      if (next === 'close') onClose();
      else onSection(next);
      return true;
    }
    setPendingSection(next);
    return false;
  };
  // The dismissal of a remove warning is panel-transient (the store exposes no dismiss intent):
  // keyed by the account it was about, so a fresh warning for the same account re-shows the card.
  const [warningDismissedFor, setWarningDismissedFor] = useState<string | null>(null);
  // The Hesaplar disclosures' standing is this screen's: a "Yeniden tara" re-renders it, never
  // resets it. A null override means the default of stores/settings-cards.ts stands.
  const [addedOverride, setAddedOverride] = useState<boolean | null>(null);
  const [unaddedOverride, setUnaddedOverride] = useState<boolean | null>(null);
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

  // The Eşzamanlılık form: one store per panel life, over the settings store's own reads and writes.
  const dispatch = useMemo(() => createDispatchSettingsStore({ read: store.readDispatch, write: store.writeDispatch }), [store]);
  const dispatchState = useSyncExternalStore(dispatch.subscribe, dispatch.state);

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

  // A control that goes natively disabled while busy — the rescan button's "Taranıyor…" — drops
  // focus to the body, and the panel's keydown surface (Esc, the Tab trap) rides its own subtree:
  // a body focus leaves it dead. While open, a focus that falls to the body comes back to the
  // root; a focus that moved into another overlay (the editor beside the scrim) is a move, not a
  // fall, and stays.
  useEffect(() => {
    if (!open || !mounted) return undefined;
    const panel = panelRef.current;
    if (panel === null) return undefined;
    let queued = 0;
    const onFocusOut = () => {
      window.clearTimeout(queued);
      // The check rides a task of its own: at focusout time the new focus is not settled yet.
      queued = window.setTimeout(() => {
        if (reclaimsPanelFocus(open, document.activeElement, document.body)) panel.focus();
      });
    };
    panel.addEventListener('focusout', onFocusOut);
    return () => {
      window.clearTimeout(queued);
      panel.removeEventListener('focusout', onFocusOut);
    };
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
      if (isAgentCapabilitySection(section)) {
        if (!agentCapabilities.closeSubview()) {
          setPendingSection('close');
          return;
        }
        if (!agentCapabilities.requestLeave()) {
          setPendingSection('close');
          return;
        }
        agentCapabilities.confirmDiscardLeave();
      }
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
    <SettingsMenu
      locale={locale}
      section={section}
      onSection={(next) => (isAgentCapabilitySection(section) ? tryLeaveAgent(next) : onSection(next))}
      dot={candidateDot(candidateState, candidateDotMirror)}
    />
  );

  const head = (
    <div className="flex items-start gap-3">
      <WindowTitle title={t(locale, SECTION_KEY[section])} lead={t(locale, SECTION_HINT_KEY[section])} />
      {section === 'concurrency' && dispatchState.justSaved ? (
        <span role="status" className="ml-auto flex-none text-[0.75rem] leading-[1.875rem] text-proceed">
          {t(locale, 'dispatch.saved')}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => tryLeaveAgent('close')}
        aria-label={t(locale, 'settings.close')}
        title={t(locale, 'settings.close')}
        className={`${section === 'concurrency' && dispatchState.justSaved ? '' : 'ml-auto '}grid h-[30px] w-[30px] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink`}
      >
        <CloseIcon />
      </button>
    </div>
  );

  // The scanning surface (U-52) is the one the wizard's Hesaplar step shares: while the scan
  // runs it draws the skeleton over both lists; the body mounts only once it ends.
  const accountsSection = (
    <AccountsScanning locale={locale} titleKey="accountGroups.added" scanning={candidateState.loading && !candidateState.loaded} busy={candidateState.loading} scannedAt={candidateState.scannedAt} failed={candidateState.status === 'error' && !candidateState.loaded} onRescan={() => void candidates.rescan()} totals={addedTotals} now={Date.now}>
      {(reveal) => (
        <>
          <AccountsSections
            locale={locale}
            addedCount={accounts.length}
            unaddedCount={candidateState.rows.length}
            addedOpen={addedOpen(addedOverride)}
            unaddedOpen={unaddedOpen(accounts.length, unaddedOverride)}
            onToggle={(kind: AccountsSectionKind) => {
              if (kind === 'added') setAddedOverride(!addedOpen(addedOverride));
              else setUnaddedOverride(!unaddedOpen(accounts.length, unaddedOverride));
            }}
            onAdd={() => setUnaddedOverride(true)}
            added={
              <AccountGroups
                locale={locale}
                groups={addedGroups}
                markFor={marks.markFor}
                nameOf={groupName}
                reveal={reveal}
                actionsRight
                onEdit={(row) => onEnterSubPage(row.id)}
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
            }
            unadded={
              <div data-unadded="">
                <AccountGroups
                  locale={locale}
                  groups={unaddedGroups}
                  markFor={marks.markFor}
                  nameOf={groupName}
                  reveal={reveal}
                  actionsRight
                  trailing={(row) => (
                    <ActionButton variant="neutral" disabled={candidateState.adopting || row.disabled === true} onClick={() => void candidates.add(row.id)}>
                      {t(locale, 'candidates.add')}
                    </ActionButton>
                  )}
                  below={(row) =>
                    row.source.keyMoveCard ? <KeyMoveCard locale={locale} on={row.source.importToken} onChange={(on) => candidates.setImportToken(row.id, on)} /> : null
                  }
                />
              </div>
            }
          />
        </>
      )}
    </AccountsScanning>
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
          if (event.target === event.currentTarget) tryLeaveAgent('close');
        }}
        onTransitionEnd={(event) => {
          // The scrim's own fade ends last on close (the panel leaves first) — that is the
          // moment the overlay's life in the DOM is over.
          if (!open && event.target === event.currentTarget && event.propertyName === 'opacity') {
            setMounted(false);
          }
        }}
        className={[
          // Definite grid tracks, not auto ones: the window's `max-h-full` is a percentage, and a
          // percentage against an auto track resolves to the content's own height — at the minimum
          // window (1024×640) the 580px window would overflow the scrim's 576px content box by
          // 4px and sit off-centre. A minmax(0,1fr) track is definite, so the clamp binds.
          'fixed inset-0 z-40 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center bg-bg/60 p-8',
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
          dataMark="data-settings-panel"
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

          <SettingsLaunchers section={section} onLaunch={onClose} />

          {section === 'accounts' ? accountsSection : null}
          {section === 'memory' ? <MemorySection locale={locale} store={agentCapabilities} active={open} /> : null}
          {section === 'roles' ? (
            <CapabilitySection locale={locale} section="roles" store={agentCapabilities} marks={marks} active={open} />
          ) : null}
          {section === 'plugins' || section === 'mcp' || section === 'skills' || section === 'commands' || section === 'hooks' ? (
            <CapabilitySection locale={locale} section={section} store={agentCapabilities} marks={marks} active={open} />
          ) : null}
          {section === 'concurrency' ? (
            <ConcurrencySection
              store={dispatch}
              locale={locale}
              active={open}
              accounts={accounts.map((account) => ({ id: account.id, name: `${providerName(account.provider) ?? account.provider} · ${account.label}` }))}
            />
          ) : null}
          {section === 'providers' ? <ProviderList store={providers} marks={marks} locale={locale} /> : null}
          {section === 'appearance' ? <AppearanceRows locale={locale} localeStore={localeStore} themeStore={themeStore} /> : null}
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
          refreshing={state.refreshing.includes(openAccount.id) || state.refreshing.includes('*')}
          refreshFailure={state.refreshFailures[openAccount.id] ?? null}
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
                  onlyAccount: removeWarning.onlyAccount,
                  // The jump unmounts the dialog without its own focus return (that rides the
                  // close paths), so the panel takes focus back itself — Esc and the Tab trap
                  // stay alive instead of dying on a focused body.
                  onOpenRoles: () => {
                    onOpenTarget({ section: 'roles' });
                    panelRef.current?.focus();
                  },
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
      {agentState.confirmDiscard || pendingSection !== null ? (
        <div role="dialog" aria-modal="true" aria-labelledby="agent-discard-title" className="fixed inset-0 z-[60] grid place-items-center bg-bg/60 p-6">
          <div className="w-[min(100%,28rem)] rounded-panel border border-hairline bg-panel p-4">
            <h3 id="agent-discard-title" className="m-0 text-[15px] font-bold text-ink">
              {t(locale, 'repoSettings.discard.title')}
            </h3>
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton variant="neutral" size="sm" onClick={() => { agentCapabilities.cancelDiscardLeave(); setPendingSection(null); }}>
                {t(locale, 'repoSettings.discard.stay')}
              </ActionButton>
              <ActionButton
                variant="primary"
                size="sm"
                onClick={() => {
                  agentCapabilities.confirmDiscardLeave();
                  const next = pendingSection;
                  setPendingSection(null);
                  if (next === 'close') onClose();
                  else if (next !== null) onSection(next);
                }}
              >
                {t(locale, 'repoSettings.discard.exit')}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
