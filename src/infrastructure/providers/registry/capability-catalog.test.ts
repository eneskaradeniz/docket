// The CapabilityCatalog port over the registry data (A-43/A-44): the default mapping for accounts
// that name no route kind, and the fixed surface saveAccount validates endpoints against.
import { describe, expect, it } from 'vitest';

import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
import { CAPABILITY_REGISTRY } from './capability-registry';
import { createCapabilityCatalog } from './capability-catalog';
import { findRouteKind } from './capability-registry';

describe('createCapabilityCatalog', () => {
  it('A-44: an absent routeKind resolves to the provider defaults for the authMode', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription' })).toBe('anthropic-subscription');
    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'api_key' })).toBe('anthropic-api');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'subscription' })).toBe('codex-subscription');
    expect(catalog.routeKindOf({ provider: 'copilot', authMode: 'subscription' })).toBe('copilot-subscription');
    expect(catalog.routeKindOf({ provider: 'cursor', authMode: 'subscription' })).toBe('cursor-subscription');
    expect(catalog.routeKindOf({ provider: 'opencode', authMode: 'subscription' })).toBe('opencode-subscription');
    expect(catalog.routeKindOf({ provider: 'hermes', authMode: 'subscription' })).toBe('hermes-subscription');
  });

  it('A-44: an explicit routeKind wins over the default; an unknown provider resolves no kind', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription', routeKind: 'compatible' })).toBe('compatible');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'api_key' })).toBeUndefined();
  });

  it('A-44: every default names a route kind the registry knows', () => {
    const catalog = createCapabilityCatalog();

    for (const authMode of ['subscription', 'api_key'] as const) {
      const id = catalog.routeKindOf({ provider: 'claude-code', authMode });
      expect(id).toBeDefined();
      expect(findRouteKind(id ?? '')).toBeDefined();
    }
  });

  it('P-28: every built-in provider with a subscription route kind resolves exactly that kind as its default, and every resolved default names a registry kind of the same provider', () => {
    // The default mapping must stay in lockstep with the built-in definitions: a new provider
    // whose registry kind carries authMode 'subscription' cannot be added without its default
    // route, or account adoption and operator runs resolve no route for it and fail.
    const catalog = createCapabilityCatalog();

    for (const def of BUILTIN_PROVIDER_DEFS) {
      const own = CAPABILITY_REGISTRY.routeKinds.find(
        (kind) => kind.providerId === def.id && kind.authMode === 'subscription',
      );
      if (own === undefined) continue;
      expect(catalog.routeKindOf({ provider: def.id, authMode: 'subscription' }), def.id).toBe(own.id);
    }

    // And every entry the mapping carries (read back over the built-ins) names a registry route
    // kind belonging to that same provider — never a kind of another provider.
    for (const authMode of ['subscription', 'api_key'] as const) {
      for (const def of BUILTIN_PROVIDER_DEFS) {
        const id = catalog.routeKindOf({ provider: def.id, authMode });
        if (id === undefined) continue;
        expect(findRouteKind(id), `${def.id} ${authMode}`).toMatchObject({ providerId: def.id });
      }
    }
  });

  it('routeKind returns the registry surface; an unknown id resolves to undefined', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKind('anthropic-subscription')).toMatchObject({ id: 'anthropic-subscription', authMode: 'subscription' });
    expect(catalog.routeKind('anthropic-subscription')?.endpointHost).toBeUndefined();
    expect(catalog.routeKind('anthropic-api')).toMatchObject({ id: 'anthropic-api', authMode: 'api_key' });
    expect(catalog.routeKind('no-such-route-kind')).toBeUndefined();
  });

  it('P-37: native instruction sets come from the registry rows; an unknown provider has none', () => {
    const catalog = createCapabilityCatalog();

    // The documented sets, each cited to the CLI's own documentation in the data rows. claude-code
    // names its automatic project memory per P-37 — it lives outside the repo, so it never matches
    // a repo file and is never an inline candidate.
    expect(catalog.nativeInstructionFiles('claude-code')).toEqual([
      'CLAUDE.md',
      'CLAUDE.local.md',
      '~/.claude/projects/<project>/memory/',
    ]);
    // kimi reads AGENTS.md natively and does not read CLAUDE.md — the handoff scenario's Y leg.
    expect(catalog.nativeInstructionFiles('kimi')).toEqual(['AGENTS.md', '.kimi-code/AGENTS.md']);
    // amp reads AGENT.md and CLAUDE.md only when AGENTS.md is absent, so those stay inline
    // candidates (A-54: content twice beats content lost).
    expect(catalog.nativeInstructionFiles('amp')).toEqual(['AGENTS.md']);
    expect(catalog.nativeInstructionFiles('grok-build')).toContain('CLAUDE.md');
    expect(catalog.nativeInstructionFiles('never-heard-of')).toEqual([]);
  });

  it('P-37: instructionFileNames is the deduplicated union of the rows in registry order', () => {
    const names = createCapabilityCatalog().instructionFileNames();

    expect(names.slice(0, 3)).toEqual(['CLAUDE.md', 'CLAUDE.local.md', '~/.claude/projects/<project>/memory/']);
    expect(names[3]).toBe('AGENTS.md');
    expect(new Set(names).size).toBe(names.length);
    for (const expected of ['AGENTS.override.md', 'GEMINI.md', 'QWEN.md', 'CODEBUDDY.md', '.github/copilot-instructions.md']) {
      expect(names).toContain(expected);
    }
  });
});
