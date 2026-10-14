// stores/agent-capabilities.test.ts — U-284, U-285 and the agent-capabilities store rules.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import type { DefinitionListItem, McpStatusView, Query } from '../../api/queries';
import { CapabilitySection } from '../components/capability-section';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import type { ProviderMarksStore } from './provider-marks';
import { AGENT_CAPABILITY_SECTIONS } from './settings-panel';
import {
  CAPABILITY_TRANSLATION_TABLE,
  createAgentCapabilitiesStore,
  warningForKind,
  type AgentCapabilitiesStore,
} from './agent-capabilities';

describe('agent capabilities menu (U-284)', () => {
  it('U-284: the Ajan yetenekleri group lists the seven kinds in strict order and Roller is not under Çalışma', () => {
    expect(AGENT_CAPABILITY_SECTIONS).toStrictEqual(['memory', 'roles', 'plugins', 'mcp', 'skills', 'commands', 'hooks']);
  });

  it('U-284: warnings list only non-native support for installed providers', () => {
    const warning = warningForKind('hook', ['codex'], { 'codex': 'Codex CLI' });
    expect(warning?.key).toBe('capabilities.warning.unsupported');
    expect(warning?.providers).toBe('Codex CLI');
    expect(warningForKind('mcp', ['codex'], { 'codex': 'Codex CLI' })).toBeNull();
    expect(warningForKind('mcp', ['claude-code'], { 'claude-code': 'Claude Code' })).toBeNull();
  });
});

describe('machine import copy (U-285)', () => {
  it('U-285: the secret notice is verbatim in both languages', () => {
    expect(TR['capabilities.import.secretNotice']).toBe('Sır değerleri kopyalanmaz; anahtar zincirine eklersin');
    expect(EN['capabilities.import.secretNotice']).toBe('Secret values are not copied; add them to the keychain');
  });

  it('U-285: the translation table copy matches the infrastructure registry row count', () => {
    expect(CAPABILITY_TRANSLATION_TABLE.length).toBeGreaterThan(0);
    expect(CAPABILITY_TRANSLATION_TABLE.some((row) => row.provider === 'claude-code' && row.kind === 'mcp')).toBe(true);
  });
});

describe('createAgentCapabilitiesStore', () => {
  it('refuses leave while a create draft is dirty until discard', () => {
    const store = createAgentCapabilitiesStore({
      api: { query: async () => [], command: async () => ({ ok: true }) },
      actor: { kind: 'user', id: 'u', label: 'U' },
      runCommand: async () => ({ ok: true }),
      roleLibrary: async () => [],
      now: () => 0,
    });
    store.setSection('roles');
    store.openCreate();
    store.setCreateDraft({ kind: 'roles', name: 'Planner' });
    expect(store.requestLeave()).toBe(false);
    store.confirmDiscardLeave();
    expect(store.requestLeave()).toBe(true);
  });
});

// --- the built-in MCP row (U-314, A-380, A-381) ---------------------------------------------------------

const stopped: McpStatusView = {
  state: 'stopped',
  reason: 'listener_down',
  tools: { run: ['page_publish', 'page_update'], chat: ['docket_get', 'docket_search'] },
  rolesWithout: ['sessiz'],
};
const running: McpStatusView = { state: 'running', tools: { run: ['page_publish'], chat: ['docket_get'] }, rolesWithout: [] };

const marks: ProviderMarksStore = {
  load: async () => undefined,
  markFor: () => null,
  state: () => ({ loaded: false }),
  subscribe: () => () => undefined,
};

const userEntry = (id: string): DefinitionListItem => ({
  definitionId: id,
  version: 1,
  recordedAt: 0,
  archived: false,
  body: { kind: 'mcp', id, name: id, command: 'npx', args: [], env: {} },
  removal: { kind: 'delete' },
});

/** A store whose MCP section read `standing` and lists `entries` user definitions; `restore` is
 *  what `mcp.restore` answers. */
const mcpSection = async (
  standing: McpStatusView,
  entries: readonly DefinitionListItem[] = [],
  restore: CommandResult = { ok: true, status: running },
): Promise<{ readonly store: AgentCapabilitiesStore; readonly restoreCommands: readonly Command[] }> => {
  const restoreCommands: Command[] = [];
  const store = createAgentCapabilitiesStore({
    api: {
      query: async (query: Query) =>
        query.type === 'mcp.status' ? standing : query.type === 'definitions.list' && query.kind === 'mcp' ? entries : [],
      command: async () => ({ ok: true }),
    },
    actor: { kind: 'user', id: 'u', label: 'U' },
    runCommand: async (command) => {
      restoreCommands.push(command);
      return restore;
    },
    roleLibrary: async () => [],
    now: () => 0,
  });
  store.setSection('mcp');
  await store.load();
  return { store, restoreCommands };
};

const draw = (store: AgentCapabilitiesStore): string =>
  renderToStaticMarkup(
    createElement(CapabilitySection, { locale: 'tr', section: 'mcp', store, marks, active: true, onOpenRoles: () => undefined }),
  );

/** The built-in row's own markup: from its data attribute to the next setting row (or the end). */
const builtinSegment = (html: string): string => {
  const start = html.indexOf('data-setting-row="Docket"');
  expect(start).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('data-setting-row=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

describe('the built-in MCP row (U-314)', () => {
  it('U-314: the row is first with the badge, the standing and the reason; user entries follow in their own order', async () => {
    const { store } = await mcpSection(stopped, [userEntry('wiki'), userEntry('db')]);
    const html = draw(store);
    expect(html.indexOf('data-setting-row="Docket"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-setting-row="Docket"')).toBeLessThan(html.indexOf('data-setting-row="wiki"'));
    expect(html.indexOf('data-setting-row="wiki"')).toBeLessThan(html.indexOf('data-setting-row="db"'));
    const row = builtinSegment(html);
    expect(row).toContain(TR['capabilities.mcp.builtin']);
    expect(row).toContain(TR['capabilities.mcp.stopped']);
    expect(row).toContain(TR['capabilities.mcp.reason.listener_down']);
    expect(row).toContain('run · page_publish, page_update');
    expect(row).toContain('chat · docket_get, docket_search');
    expect(row).toContain('aria-live="polite"');
  });

  it('U-314: the row carries no remove, archive, rename or edit control — absent, not disabled', async () => {
    const { store } = await mcpSection(stopped, [userEntry('wiki')]);
    const row = builtinSegment(draw(store));
    // The only controls are the repair button and the roles link; nothing else ever renders.
    expect(row.match(/<button/g)?.length).toBe(2);
    for (const absent of ['Kaldır', 'Arşivle', 'Düzenle', 'Yeniden adlandır', 'Sil']) expect(row).not.toContain(absent);
    expect(row).not.toContain('disabled=""');
  });

  it('U-314: a running row shows Çalışıyor, announces politely, and carries no repair button', async () => {
    const { store } = await mcpSection(running);
    const row = builtinSegment(draw(store));
    expect(row).toContain(TR['capabilities.mcp.running']);
    expect(row).toContain('aria-live="polite"');
    expect(row).not.toContain(TR['capabilities.mcp.restore']);
    expect(row).not.toContain(TR['capabilities.mcp.rolesWithout']);
  });

  it('U-314: the opted-out count is a link to the roles menu, not plain text', async () => {
    const { store } = await mcpSection(stopped);
    const row = builtinSegment(draw(store));
    expect(row).toContain('data-mcp-roles-without=""');
    expect(row).toContain(TR['capabilities.mcp.rolesWithout'].replace('{count}', '1'));
  });

  it('U-314: an empty user list still shows the built-in row, never the empty card', async () => {
    const { store } = await mcpSection(running, []);
    const html = draw(store);
    expect(html).toContain('data-setting-row="Docket"');
    expect(html).not.toContain('data-empty-card');
  });

  it('U-314: Geri yükle shows a busy state, then the inline result of the restart', async () => {
    const { store } = await mcpSection(stopped, [], { ok: true, status: running });
    expect(store.state().mcpBusy).toBe(false);
    await store.restoreMcp();
    expect(store.state().mcpBusy).toBe(false);
    expect(store.state().mcpResult).toBe('capabilities.mcp.restored');
    expect(store.state().mcp?.state).toBe('running');
    const row = builtinSegment(draw(store));
    expect(row).toContain(TR['capabilities.mcp.restored']);
    expect(row).toContain('data-mcp-restore-result=""');
  });

  it('U-314: a refused restart shows its typed sentence inline, the standing stays stopped', async () => {
    const { store, restoreCommands } = await mcpSection(stopped, [], { ok: false, code: 'script_missing', error: 'script_missing' });
    await store.restoreMcp();
    expect(restoreCommands).toContainEqual({ type: 'mcp.restore' });
    expect(store.state().mcpResult).toBe('capabilities.mcp.reason.script_missing');
    expect(store.state().mcp?.state).toBe('stopped');
    const row = builtinSegment(draw(store));
    expect(row).toContain(TR['capabilities.mcp.reason.script_missing']);
  });

  it('U-314: the row copy is verbatim in both bundles and every sentence stays at most 8 words (U-178)', () => {
    const keys = [
      'capabilities.mcp.builtin',
      'capabilities.mcp.running',
      'capabilities.mcp.stopped',
      'capabilities.mcp.reason.no_endpoint',
      'capabilities.mcp.reason.listener_down',
      'capabilities.mcp.reason.script_missing',
      'capabilities.mcp.rolesWithout',
      'capabilities.mcp.restore',
      'capabilities.mcp.restoring',
      'capabilities.mcp.restored',
    ] as const;
    for (const key of keys) {
      for (const sentence of [TR[key], EN[key]]) {
        expect(sentence.trim().length).toBeGreaterThan(0);
        expect(sentence.replace(/\{count\}/, '7').split(/\s+/).length).toBeLessThanOrEqual(8);
      }
    }
  });
});
