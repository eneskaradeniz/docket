// stores/agent-capabilities.test.ts — U-284, U-285 and the agent-capabilities store rules.
import { describe, expect, it } from 'vitest';

import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import { AGENT_CAPABILITY_SECTIONS } from './settings-panel';
import {
  CAPABILITY_TRANSLATION_TABLE,
  createAgentCapabilitiesStore,
  warningForKind,
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
