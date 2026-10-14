// components/capability-section.tsx — one Ajan yetenekleri kind: library rows, empty card, import, create.
import { useSyncExternalStore } from 'react';

import type { CapabilityDef, WriteScope } from '../../domain/index';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import {
  definitionKindOf,
  importSectionOf,
  type AgentCapabilitiesStore,
  type DefinitionSection,
} from '../stores/agent-capabilities';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { BuiltinMcpRow } from './builtin-mcp-row';
import { ProviderMark } from './provider-mark';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { RescanButton } from './rescan-button';
import { SettingRow, SettingRows } from './setting-row';
import { EmptyCard, InfoBanner } from './settings-cards';
import { Skeleton, SkeletonStyle } from './skeleton';
import { VersionBadge } from './version-badge';

const EMPTY_TITLE: Readonly<Record<DefinitionSection | 'roles', LabelKey>> = {
  roles: 'capabilities.empty.roles.title',
  plugins: 'capabilities.empty.plugins.title',
  mcp: 'capabilities.empty.mcp.title',
  skills: 'capabilities.empty.skills.title',
  commands: 'capabilities.empty.commands.title',
  hooks: 'capabilities.empty.hooks.title',
};

const EMPTY_LINE: Readonly<Record<DefinitionSection | 'roles', LabelKey>> = {
  roles: 'capabilities.empty.roles.line',
  plugins: 'capabilities.empty.plugins.line',
  mcp: 'capabilities.empty.mcp.line',
  skills: 'capabilities.empty.skills.line',
  commands: 'capabilities.empty.commands.line',
  hooks: 'capabilities.empty.hooks.line',
};

const WRITE_SCOPE_KEY: Readonly<Record<WriteScope['kind'], LabelKey>> = {
  none: 'capabilities.roles.writeScope.none',
  docs: 'capabilities.roles.writeScope.docs',
  tests: 'capabilities.roles.writeScope.tests',
  repo: 'capabilities.roles.writeScope.repo',
  paths: 'capabilities.roles.writeScope.paths',
};

const isCapabilityBody = (body: unknown): body is CapabilityDef => {
  if (typeof body !== 'object' || body === null || !('kind' in body)) return false;
  return typeof (body as { kind: unknown }).kind === 'string';
};

const warningText = (locale: Locale, key: LabelKey, providers: string): string =>
  t(locale, key).replace('{providers}', providers);

export interface CapabilitySectionProps {
  readonly locale: Locale;
  readonly section: DefinitionSection | 'roles';
  readonly store: AgentCapabilitiesStore;
  readonly marks: ProviderMarksStore;
  readonly active: boolean;
  /** The built-in MCP row's "N rolde kapalı" link (U-305): the settings panel's own section switch. */
  readonly onOpenRoles?: () => void;
}

export function CapabilitySection({ locale, section, store, marks, active, onOpenRoles }: CapabilitySectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  useSyncExternalStore(marks.subscribe, marks.state, marks.state);

  if (!active) return null;

  const importMode = section === 'roles' ? null : importSectionOf(section);
  const canCreate = section === 'roles' || section === 'commands' || section === 'hooks';
  const canImport = importMode !== null;

  if (state.loading && !state.loaded) {
    return (
      <div aria-busy="true">
        <SkeletonStyle />
        <Skeleton width="100%" height="5rem" radius="card" />
      </div>
    );
  }

  if (state.problem !== null && !state.loaded) {
    return (
      <div role="alert" className="rounded-card border border-error/40 px-3 py-3 text-[13px] text-error">
        {t(locale, failureKey(state.problem))}
      </div>
    );
  }

  if (state.view === 'import' && canImport) {
    return (
      <div className="grid gap-3" data-capability-import="">
        <InfoBanner mark="data-import-secret">{t(locale, 'capabilities.import.secretNotice')}</InfoBanner>
        <RescanButton locale={locale} busy={state.importScanning} onRescan={() => void store.rescanImport()} />
        {importMode === 'machine' ? (
          <SettingRows>
            {state.machineRows.map((row) => (
              <SettingRow
                key={row.key}
                framed
                locale={locale}
                title={row.name}
                below={
                  <div className="grid gap-1 text-[12px] text-inkdim">
                    <div className="flex items-center gap-2">
                      <ProviderMark provider={row.providerId} mark={marks.markFor(row.providerId)} size={16} />
                      <span>{row.providerName}</span>
                    </div>
                    <span className="font-mono">{row.sourcePath}</span>
                    {row.secretNames.length > 0 ? (
                      <span>{row.secretNames.join(', ')}</span>
                    ) : null}
                  </div>
                }
                control={
                  row.importable ? (
                    <ActionButton variant="neutral" size="sm" onClick={() => void store.importMachine([row.key])}>
                      {t(locale, 'capabilities.import.action')}
                    </ActionButton>
                  ) : (
                    <ActionButton variant="neutral" size="sm" disabled>
                      {t(locale, 'capabilities.import.manual')}
                    </ActionButton>
                  )
                }
              />
            ))}
          </SettingRows>
        ) : (
          <SettingRows>
            {state.candidateRows.map((row) => (
              <SettingRow
                key={row.identity}
                framed
                locale={locale}
                title={row.name}
                below={
                  <div className="grid gap-1 text-[12px] text-inkdim">
                    <div className="flex items-center gap-2">
                      {row.providerId !== '' ? (
                        <ProviderMark provider={row.providerId} mark={marks.markFor(row.providerId)} size={16} />
                      ) : null}
                      <span>{row.providerName}</span>
                    </div>
                    {row.path !== null ? <span className="font-mono">{row.path}</span> : null}
                    {row.command !== null ? <span className="font-mono">{row.command}</span> : null}
                  </div>
                }
                control={
                  row.imported ? (
                    <span className="text-[12px] text-inkdim">{t(locale, 'capabilities.import.added')}</span>
                  ) : (
                    <ActionButton variant="neutral" size="sm" onClick={() => void store.importCandidates([row.identity])}>
                      {t(locale, 'capabilities.import.action')}
                    </ActionButton>
                  )
                }
              />
            ))}
          </SettingRows>
        )}
      </div>
    );
  }

  if (state.view === 'create' && canCreate && state.createDraft !== null) {
    const name =
      state.createDraft.kind === 'roles' || state.createDraft.kind === 'commands' || state.createDraft.kind === 'hooks'
        ? state.createDraft.name
        : '';
    return (
      <div className="rounded-card border border-hairline bg-surface p-3" data-capability-create="">
        <label className="grid gap-1 text-[13px]">
          <span className="font-semibold text-ink">{t(locale, 'capabilities.empty.createAction')}</span>
          <input
            className="rounded-control border border-bord bg-transparent px-2.5 py-2 text-[13px] text-ink"
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              if (state.createDraft?.kind === 'roles') store.setCreateDraft({ kind: 'roles', name: next });
              else if (state.createDraft?.kind === 'commands') store.setCreateDraft({ kind: 'commands', name: next });
              else if (state.createDraft?.kind === 'hooks') store.setCreateDraft({ kind: 'hooks', name: next });
            }}
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <ActionButton variant="neutral" size="sm" onClick={() => store.cancelCreate()}>
            {t(locale, 'repoSettings.saveBar.cancel')}
          </ActionButton>
          <ActionButton variant="primary" size="sm" disabled={state.saving || name.trim() === ''} onClick={() => void store.saveCreate()}>
            {t(locale, 'repoSettings.saveBar.save')}
          </ActionButton>
        </div>
      </div>
    );
  }

  if (section === 'roles') {
    const rows = state.roles;
    if (rows.length === 0) {
      return (
        <EmptyCard
          mark="capabilities-roles"
          title={t(locale, EMPTY_TITLE.roles)}
          line={t(locale, EMPTY_LINE.roles)}
          action={
            <ActionButton variant="primary" onClick={() => store.openCreate()}>
              {t(locale, 'capabilities.empty.createAction')}
            </ActionButton>
          }
        />
      );
    }
    return (
      <SettingRows>
        {rows.map((row) => (
          <SettingRow
            key={row.id}
            framed
            locale={locale}
            title={row.name}
            purpose={`${t(locale, WRITE_SCOPE_KEY[row.writeScope.kind])} · ${row.linkedCount}`}
            note={row.warningKey === null ? undefined : warningText(locale, row.warningKey, row.warningProviders)}
            control={<VersionBadge locale={locale} version={row.version} />}
          />
        ))}
      </SettingRows>
    );
  }

  const items = state.definitions[section];
  // The MCP menu's first row is the built-in Docket entry (U-305); with no user entry at all the
  // menu still shows it, so the empty card is never its face.
  const builtinRow =
    section === 'mcp' ? (
      <BuiltinMcpRow
        locale={locale}
        status={state.mcp}
        busy={state.mcpBusy}
        result={state.mcpResult}
        onRestore={() => void store.restoreMcp()}
        {...(onOpenRoles === undefined ? {} : { onOpenRoles })}
      />
    ) : null;
  if (items.length === 0 && builtinRow === null) {
    return (
      <EmptyCard
        mark={`capabilities-${section}`}
        title={t(locale, EMPTY_TITLE[section])}
        line={t(locale, EMPTY_LINE[section])}
        action={
          canImport ? (
            <ActionButton variant="primary" onClick={() => store.openImport()}>
              {t(locale, 'capabilities.import.action')}
            </ActionButton>
          ) : (
            <ActionButton variant="primary" onClick={() => store.openCreate()}>
              {t(locale, 'capabilities.empty.createAction')}
            </ActionButton>
          )
        }
      />
    );
  }

  return (
    <SettingRows>
      {builtinRow}
      {items.map((item) => {
        const body = isCapabilityBody(item.body) ? item.body : null;
        const kind = body?.kind ?? definitionKindOf(section);
        const warningKey = kind === undefined ? null : store.rowWarning(kind);
        const warningProviders = kind === undefined ? '' : store.rowWarningProviders(kind);
        const below = (() => {
          if (body === null) return undefined;
          switch (body.kind) {
            case 'plugin':
              return (
                <div className="grid gap-1 text-[12px] text-inkdim">
                  <span className="font-mono">
                    {body.source.kind === 'path' ? body.source.path : `${body.source.marketplace}/${body.source.name}`}
                  </span>
                  <span>{body.includes.join(', ')}</span>
                </div>
              );
            case 'mcp':
              return (
                <div className="grid gap-1 text-[12px] text-inkdim">
                  <span className="font-mono">{`${body.command} ${body.args.join(' ')}`.trim()}</span>
                  <span>
                    {Object.entries(body.env)
                      .map(([key, value]) => ('secretRef' in value ? `${key} (${t(locale, 'capabilities.mcp.secretRef')})` : key))
                      .join(', ')}
                  </span>
                </div>
              );
            case 'skill':
            case 'context':
              return <span className="font-mono text-[12px] text-inkdim">{body.path}</span>;
            case 'command':
              return (
                <div className="grid gap-1 text-[12px] text-inkdim">
                  <span>{body.template}</span>
                  <span>{body.arguments.map((arg) => arg.name).join(', ')}</span>
                </div>
              );
            case 'hook':
              return (
                <div className="grid gap-1 text-[12px] text-inkdim">
                  <span>{body.event}</span>
                  <span className="font-mono">{body.command}</span>
                </div>
              );
          }
        })();
        return (
          <SettingRow
            key={item.definitionId}
            framed
            locale={locale}
            title={body?.name ?? item.definitionId}
            below={below}
            note={warningKey === null ? undefined : warningText(locale, warningKey, warningProviders)}
            control={null}
          />
        );
      })}
    </SettingRows>
  );
}
