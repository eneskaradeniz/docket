// screens/settings.tsx — the settings screen (U-6's window): accounts with their meter rows and
// source badges, the per-role bindings editor, the provider discovery list, and the remove flow
// whose warning names the referencing roles before any command is issued. The screen renders the
// store's view and forwards clicks; secret values have no surface here — account names only — and
// every user-visible string arrives through a label key (U-1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { DiscoveryBadges } from '../components/discovery-badges';
import { countedLabel } from '../components/counted-label';
import { LocaleSwitcher } from '../components/locale-switcher';
import { OutcomeNotice } from '../components/outcome-notice';
import { SectionCard } from '../components/section-card';
import { SourceBadge } from '../components/source-badge';
import { StateBadge } from '../components/state-badge';
import type { LocaleStore } from '../stores/locale';
import type {
  AccountDisplay,
  BindingSaveInput,
  DiscoveryRow,
  MeterDisplay,
  SettingsStore,
} from '../stores/settings';
import { failureKey } from '../stores/results';
import type { SettingsBindingScope } from '../../api/queries';

export interface SettingsScreenProps {
  readonly store: SettingsStore;
  readonly locale: Locale;
  /** The language control binds straight to the locale store: a selection swaps the bundle for the
   *  whole app through the root's subscription and persists the choice (U-9). */
  readonly localeStore: LocaleStore;
}

const AUTH_MODE_KEY: Readonly<Record<string, LabelKey>> = {
  subscription: 'auth.mode.subscription',
  api_key: 'auth.mode.api_key',
  cloud: 'auth.mode.cloud',
  byok: 'auth.mode.byok',
};

/** An account's auth mode is a closed set in the record; a value outside it renders as its own dim
 *  slug instead of pretending a known mode. */
const AuthModeBadge = ({ mode, locale }: { readonly mode: string; readonly locale: Locale }) => {
  const key = AUTH_MODE_KEY[mode];
  return <StateBadge tone="dim">{key === undefined ? mode : t(locale, key)}</StateBadge>;
};

const SCOPE_KEY: Readonly<Record<SettingsBindingScope['level'], LabelKey>> = {
  global: 'settings.binding.scope.global',
  workspace: 'settings.binding.scope.workspace',
  workOrder: 'settings.binding.scope.workOrder',
};

const scopeName = (scope: SettingsBindingScope): string =>
  scope.level === 'workspace' ? scope.workspace : scope.level === 'workOrder' ? scope.workOrderId : '';

/** One meter line: the store already resolved the meter's naming context; remaining and reset
 *  segments render only when the meter carries them — absence is omitted, never faked. */
function MeterRow({ meter, locale, store }: { readonly meter: MeterDisplay; readonly locale: Locale; readonly store: SettingsStore }) {
  const resetsAt = store.resetsAtLabel(meter.resetsAt);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5">
      <span className="text-[13px] text-ink">{meter.label}</span>
      <span className="font-mono text-[11.5px] text-inkdim">
        {meter.remaining !== null ? `${t(locale, 'settings.meter.remaining')} ${meter.remaining} ${meter.unit}` : meter.unit}
        {resetsAt !== null ? ` · ${t(locale, 'settings.meter.resetsAt')} ${resetsAt}` : ''}
      </span>
      <span className="ml-auto">
        <SourceBadge code={meter.source} locale={locale} />
      </span>
    </li>
  );
}

function AccountRow({
  account,
  locale,
  store,
  onRemove,
}: {
  readonly account: AccountDisplay;
  readonly locale: Locale;
  readonly store: SettingsStore;
  readonly onRemove: (accountId: string) => void;
}) {
  return (
    <li className="grid gap-1.5 rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-ink">{account.label}</span>
          <code className="font-mono text-[11.5px] text-inkdim">{account.provider}</code>
          <AuthModeBadge mode={account.authMode} locale={locale} />
          {account.plan !== null ? <span className="font-mono text-[11px] text-inkdim">{account.plan}</span> : null}
        </div>
        <ActionButton variant="neutral" onClick={() => onRemove(account.id)}>
          {t(locale, 'settings.account.remove')}
        </ActionButton>
      </div>
      {account.meters.length === 0 ? (
        <p className="text-[12.5px] text-inkdim">{t(locale, 'settings.meters.empty')}</p>
      ) : (
        <ul className="grid gap-1">
          {account.meters.map((meter) => (
            <MeterRow key={meter.id} meter={meter} locale={locale} store={store} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The account picker behind a binding editor: the checked accounts become the chain, in the
 *  order they are saved. */
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
          <label className="flex w-full items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-left text-[13px] text-ink">
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
 *  newly picked accounts append in list order — editing the chain never silently rewrites either. */
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

export function SettingsScreen({ store, locale, localeStore }: SettingsScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  const view = state.view;
  // The dismissal of a remove warning is screen-transient (the store exposes no dismiss intent):
  // keyed by the account it was about, so a fresh warning for the same account re-shows the card.
  const [warningDismissedFor, setWarningDismissedFor] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editAccounts, setEditAccounts] = useState<readonly string[]>([]);
  const [newRole, setNewRole] = useState('');
  const [newAccounts, setNewAccounts] = useState<readonly string[]>([]);

  const remove = (accountId: string): void => {
    setWarningDismissedFor(null);
    void store.removeAccount(accountId);
  };
  const confirmRemove = (accountId: string): void => {
    void store.confirmRemoveAccount(accountId);
  };

  const accounts = view?.accounts ?? [];
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

  return (
    <div className="grid gap-4">
      <header className="grid gap-1.5">
        <h1 className="text-[19px] font-bold tracking-tight text-ink">{t(locale, 'nav.settings')}</h1>
      </header>

      <SectionCard title={t(locale, 'settings.language.label')}>
        <LocaleSwitcher store={localeStore} locale={locale} />
      </SectionCard>

      {state.problem !== null ? (
        <div role="alert" className="rounded-md border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
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
        <div role="alert" className="grid gap-2 rounded-md border border-signal/45 bg-surface px-3 py-2.5">
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

      <SectionCard title={countedLabel(t(locale, 'settings.section.accounts'), accounts.length)}>
        {accounts.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'settings.accounts.empty')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} locale={locale} store={store} onRemove={remove} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={countedLabel(t(locale, 'settings.section.bindings'), view?.bindings.length ?? 0)}>
        <div className="grid gap-3">
          {view === null || view.bindings.length === 0 ? (
            <p className="text-[13px] text-inkdim">{t(locale, 'settings.binding.empty')}</p>
          ) : (
            <ul className="grid gap-1.5">
              {view.bindings.map((binding) => {
                const editable = binding.scope.level === 'global';
                const editing = editRole === binding.role;
                return (
                  <li
                    key={`${binding.scope.level}:${binding.role}:${scopeName(binding.scope)}`}
                    className="grid gap-1.5 rounded-md border border-hairline bg-surface px-3 py-2"
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
            <div className="grid gap-2 rounded-md border border-hairline bg-raised p-3">
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
                    className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
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
            <ul className="grid gap-1.5">
              {state.discovery.rows.map((row: DiscoveryRow) => (
                <li key={row.defId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2">
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
    </div>
  );
}
