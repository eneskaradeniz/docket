import { describe, expect, it } from 'vitest';

import type { AppDeps } from '../deps';

import * as Fakes from './index';

import { createFakeClock } from './fake-clock';
import { createFakeDeps } from './fake-deps';

const PORT_KEYS: readonly (keyof AppDeps)[] = [
  'clock',
  'ids',
  'log',
  'workOrders',
  'runs',
  'accounts',
  'bindings',
  'queue',
  'definitions',
  'proposals',
  'secrets',
  'transports',
  'commands',
  'secretScanner',
  'worktrees',
  'evidence',
  'notifier',
];

describe('createFakeDeps', () => {
  it('A-1: returns a complete AppDeps with a fake for every port', () => {
    const deps = createFakeDeps();

    expect(Object.keys(deps).sort()).toEqual([...PORT_KEYS].sort());
    for (const key of PORT_KEYS) {
      expect(deps[key]).toBeDefined();
    }
  });

  it('A-1: overrides replace exactly the named ports', () => {
    const clock = createFakeClock(42);
    const deps = createFakeDeps({ clock });

    expect(deps.clock).toBe(clock);
    expect(deps.clock.now()).toBe(42);
    expect(deps.ids).toBeDefined();
    expect(deps.log).toBeDefined();
  });

  it('A-1: every fake is fresh — two bundles share no mutable state', () => {
    const a = createFakeDeps();
    const b = createFakeDeps();
    expect(a.clock).not.toBe(b.clock);
    expect(a.ids).not.toBe(b.ids);
    expect(a.workOrders).not.toBe(b.workOrders);
  });
});

describe('fakes barrel', () => {
  it('A-1: exports a creator for every port plus createFakeDeps', () => {
    const creators: readonly string[] = [
      'createFakeClock',
      'createFakeIdGen',
      'createFakeEventLog',
      'createFakeWorkOrderRepo',
      'createFakeRunRepo',
      'createFakeAccountRepo',
      'createFakeBindingRepo',
      'createFakeQueueRepo',
      'createFakeDefinitionStore',
      'createFakeProposalRepo',
      'createFakeSecretVault',
      'createFakeTransport',
      'createFakeTransportResolver',
      'createFakeCommandRunner',
      'createFakeSecretScanner',
      'createFakeWorktrees',
      'createFakeEvidenceChecker',
      'createFakeNotifier',
      'createFakeDeps',
    ];
    for (const name of creators) {
      expect(typeof Fakes[name as keyof typeof Fakes]).toBe('function');
    }
  });
});
