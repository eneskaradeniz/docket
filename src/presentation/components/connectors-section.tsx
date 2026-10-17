// components/connectors-section.tsx — Settings → Entegrasyonlar (U-356): one row per built-in
// connector — the manifest's name, version and families as localized words, the readiness chip,
// the enabled switch, and the network line that shows what the connector can reach. An invalid
// row shows its manifest-law code and keeps an inert switch (it is never switchable); a
// connector that declares settings carries the disabled "Hesap ekle" placeholder (U-357 lands
// with the first connector that needs it). Every word arrives through the label bundle outside
// error.* — the switch's own refusal is the one error-styled line — and nothing here names a
// platform: the name, families, version and network are manifest data from connector.list.
import { useSyncExternalStore } from 'react';

import type { ConnectorListView } from '../../api/queries';
import type { PortFamily } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { LampTone } from '../stores/candidates';
import type { ConnectorsStore } from '../stores/connectors';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { StatusLamp } from './status-lamp';

export interface ConnectorsSectionProps {
  readonly store: ConnectorsStore;
  readonly locale: Locale;
}

const PROVIDES_KEY: Readonly<Record<PortFamily, LabelKey>> = {
  forge: 'connectors.provides.forge',
  tracker: 'connectors.provides.tracker',
  ci: 'connectors.provides.ci',
  deploy: 'connectors.provides.deploy',
};

const HEALTH_KEY: Readonly<Record<ConnectorListView['health'], LabelKey>> = {
  ready: 'connectors.health.ready',
  needs_account: 'connectors.health.needs_account',
  needs_cli: 'connectors.health.needs_cli',
  invalid: 'connectors.health.invalid',
};

const HEALTH_TONE: Readonly<Record<ConnectorListView['health'], LampTone>> = {
  ready: 'proceed',
  needs_account: 'signal',
  needs_cli: 'signal',
  invalid: 'error',
};

interface RowProps {
  readonly row: ConnectorListView;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSwitch: (id: string, enabled: boolean) => void;
}

function ConnectorRow({ row, locale, busy, failure, onSwitch }: RowProps) {
  // A row whose manifest failed its law is never switchable (A-415): the switch renders inert.
  const inert = row.health === 'invalid';
  const on = row.enabled && !inert;
  return (
    <li data-connector-row={row.id} className="grid gap-1.5 border-t border-hairline px-3.5 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-bold text-ink">{row.name}</span>
        <span title={row.version} className="flex-none font-mono text-[12px] text-inkdim">
          {row.version}
        </span>
        <StatusLamp tone={HEALTH_TONE[row.health]}>{t(locale, HEALTH_KEY[row.health])}</StatusLamp>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t(locale, 'connectors.switch').replace('{name}', row.name)}
          {...(inert || busy ? { 'aria-disabled': true } : {})}
          onClick={inert || busy ? undefined : () => onSwitch(row.id, !on)}
          className={`relative h-5 w-9 flex-none rounded-full border transition-colors ${on ? 'border-signal bg-signal' : 'border-hairline bg-raised'} ${inert || busy ? 'pointer-events-none opacity-45' : ''}`}
        >
          <span aria-hidden="true" className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="m-0 text-[12px] text-inkdim">{row.provides.map((family) => t(locale, PROVIDES_KEY[family])).join(' · ')}</p>
      <p className="m-0 text-[12px] text-inkdim">{t(locale, 'connectors.network').replace('{hosts}', row.network.join(', '))}</p>
      {row.requiresCli !== undefined ? (
        <p className="m-0 text-[12px] text-inkdim">{t(locale, 'connectors.cli').replace('{cli}', row.requiresCli)}</p>
      ) : null}
      {inert && row.error !== undefined ? (
        <p className="m-0 font-mono text-[11.5px] text-inkdim" data-connector-error>
          {row.error}
        </p>
      ) : null}
      {row.hasSettings ? (
        <div className="flex flex-wrap items-center gap-2" data-connector-account>
          <ActionButton variant="neutral" size="sm" disabled>
            {t(locale, 'connectors.addAccount')}
          </ActionButton>
          <span className="text-[12px] text-inkdim">{t(locale, 'connectors.addAccount.none')}</span>
        </div>
      ) : null}
      {failure !== undefined ? (
        <p role="alert" className="m-0 text-[12px] text-error">
          {t(locale, failureKey(failure))}
        </p>
      ) : null}
    </li>
  );
}

export function ConnectorsSection({ store, locale }: ConnectorsSectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  return (
    <section role="region" aria-label={t(locale, 'settings.section.connectors')} data-connectors aria-busy={state.loading ? true : undefined} className="grid gap-2">
      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}
      {state.loading && !state.loaded ? (
        <div role="status" data-connectors-loading className="rounded-card border border-hairline bg-surface px-3 py-4">
          <p className="m-0 text-[13px] text-inkdim">{t(locale, 'connectors.loading')}</p>
        </div>
      ) : state.loaded && state.rows.length === 0 ? (
        <div data-connectors-empty className="rounded-card border border-hairline bg-surface px-3 py-4">
          <h3 className="m-0 text-[13px] font-bold text-ink">{t(locale, 'connectors.empty')}</h3>
          <p className="m-0 mt-1 text-[12px] text-inkdim">{t(locale, 'connectors.empty.line')}</p>
        </div>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-card border border-hairline bg-surface p-0">
          {state.rows.map((row) => (
            <ConnectorRow
              key={row.id}
              row={row}
              locale={locale}
              busy={state.busy.includes(row.id)}
              failure={state.failures[row.id]}
              onSwitch={(id, enabled) => void store.setEnabled(id, enabled)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
