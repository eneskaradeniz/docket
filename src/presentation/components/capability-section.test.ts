// capability-section.test.ts — library row versions and removal (U-292, U-293).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DefinitionListItem, McpStatusView, Query, RoleListItem } from '../../api/queries';
import type { RepoSlug, StageSlug } from '../../domain/index';
import { CapabilitySection } from './capability-section';
import { TR } from '../labels/tr';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { createAgentCapabilitiesStore, type AgentCapabilitiesStore } from '../stores/agent-capabilities';

const marks: ProviderMarksStore = {
  load: async () => undefined,
  markFor: () => null,
  state: () => ({ loaded: false }),
  subscribe: () => () => undefined,
};

const running: McpStatusView = { state: 'running', tools: { run: [], chat: [] }, rolesWithout: [] };

const rolesSection = async (
  roles: readonly RoleListItem[],
  opts: { readonly mcp?: readonly DefinitionListItem[] } = {},
): Promise<AgentCapabilitiesStore> => {
  const store = createAgentCapabilitiesStore({
    api: {
      query: async (query: Query) => {
        if (query.type === 'roles.list') return roles;
        if (query.type === 'definitions.list' && query.kind === 'mcp') return opts.mcp ?? [];
        if (query.type === 'mcp.status') return running;
        if (query.type === 'providers.discovered') return [];
        if (query.type === 'project.tree') return [];
        return [];
      },
      command: async () => ({ ok: true }),
    },
    actor: { kind: 'user', id: 'u', label: 'U' },
    runCommand: async () => ({ ok: true }),
    roleLibrary: async () => [],
    now: () => 0,
  });
  store.setSection('roles');
  await store.load();
  return store;
};

const drawRoles = (store: AgentCapabilitiesStore): string =>
  renderToStaticMarkup(createElement(CapabilitySection, { locale: 'tr', section: 'roles', store, marks, active: true }));

describe('CapabilitySection library rows (U-292, U-293)', () => {
  it('U-292: version badge and Eski sürümler open the past-versions modal with immutable revisions', async () => {
    const store = await rolesSection([
      {
        id: 'worker',
        name: 'Uygulayıcı',
        version: 3,
        removal: { kind: 'delete' },
        pastVersions: [
          { version: 2, recordedAt: 2, archived: false },
          { version: 1, recordedAt: 1, archived: false },
        ],
        stages: [],
      },
    ]);
    const html = drawRoles(store);
    expect(html).toContain('v3');
    expect(html).toContain(TR['definition.pastVersions.trigger']);
    store.openPastVersions('worker');
    const open = drawRoles(store);
    expect(open).toContain('data-past-versions-dialog');
    expect(open).toContain('v2');
    expect(open).toContain('v1');
  });

  it('U-293: removal action matches delete, archive, or blocked with dependant note', async () => {
    const deleteStore = await rolesSection([
      { id: 'worker', name: 'Uygulayıcı', version: 1, removal: { kind: 'delete' }, pastVersions: [], stages: [] },
    ]);
    expect(drawRoles(deleteStore)).toContain('Sil');
    expect(drawRoles(deleteStore)).not.toContain('disabled=""');

    const archiveStore = await rolesSection([
      { id: 'worker', name: 'Uygulayıcı', version: 1, removal: { kind: 'archive' }, pastVersions: [], stages: [] },
    ]);
    expect(drawRoles(archiveStore)).toContain('Arşivle');

    const blockedStore = await rolesSection([
      {
        id: 'worker',
        name: 'Uygulayıcı',
        version: 1,
        removal: {
          kind: 'blocked',
          reasons: [{ kind: 'dependant', of: 'stage', repo: 'api' as RepoSlug, stage: 'app' as StageSlug }],
        },
        pastVersions: [],
        stages: [{ flow: 'api', flowName: 'api', stage: 'app', stageName: 'Uygulama', tier: null, thinking: null, reviewOf: null, sameProviderReview: false }],
      },
    ]);
    const blocked = drawRoles(blockedStore);
    expect(blocked).toContain('disabled');
    expect(blocked).toContain('Bu tanım 1 aşamada kullanılıyor');
  });

  it('U-292 / U-293: the built-in MCP row has no version history or removal controls', async () => {
    const store = createAgentCapabilitiesStore({
      api: {
        query: async (query: Query) => {
          if (query.type === 'mcp.status') return running;
          if (query.type === 'definitions.list' && query.kind === 'mcp') return [];
          if (query.type === 'providers.discovered') return [];
          if (query.type === 'project.tree') return [];
          return [];
        },
        command: async () => ({ ok: true }),
      },
      actor: { kind: 'user', id: 'u', label: 'U' },
      runCommand: async () => ({ ok: true }),
      roleLibrary: async () => [],
      now: () => 0,
    });
    store.setSection('mcp');
    await store.load();
    const html = renderToStaticMarkup(
      createElement(CapabilitySection, { locale: 'tr', section: 'mcp', store, marks, active: true, onOpenRoles: () => undefined }),
    );
    const start = html.indexOf('data-setting-row="Docket"');
    const next = html.indexOf('data-setting-row=', start + 1);
    const row = html.slice(start, next === -1 ? undefined : next);
    expect(row).not.toContain(TR['definition.pastVersions.trigger']);
    for (const absent of ['Sil', 'Arşivle']) expect(row).not.toContain(absent);
  });
});
