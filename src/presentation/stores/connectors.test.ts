// connectors.test.ts — the Entegrasyonlar store (U-356) over a fake bridge: the list mirrors
// connector.list row for row, the switch issues its command as the user actor and re-reads, a
// refused switch keeps its typed reason on its own row, and the tracker-link surface's display
// name is manifest data via the same list — never a hard-coded platform.
import { describe, expect, it } from 'vitest';

import type { Command } from '../../api/commands';
import type { ConnectorListView } from '../../api/queries';
import type { Actor } from '../../domain/index';

import { createConnectorsStore, trackerConnectorName, type ConnectorsStore } from './connectors';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const row = (over: Partial<ConnectorListView>): ConnectorListView => ({
  id: 'demo-forge',
  name: 'Demo Forge',
  version: '1.2.0',
  provides: ['forge', 'tracker'],
  hostMatch: ['forge.example'],
  network: ['api.forge.example'],
  hasSettings: false,
  enabled: true,
  health: 'ready',
  ...over,
});

const ROWS: readonly ConnectorListView[] = [
  row({}),
  row({ id: 'only-tracker', name: 'Tracker Only', provides: ['tracker'], hostMatch: undefined, enabled: false, health: 'needs_cli' }),
];

interface Bridge {
  readonly store: ConnectorsStore;
  readonly commands: Command[];
  readonly reads: number;
}

const bridge = (
  rows: readonly ConnectorListView[] = ROWS,
  switchResult: { readonly ok: true } | { readonly ok: false; readonly code: string } = { ok: true },
): Bridge => {
  const commands: Command[] = [];
  let reads = 0;
  let switched = false;
  const store = createConnectorsStore({
    api: {
      query: async () => {
        reads += 1;
        // A switch re-read answers the flipped row, so the refresh the command owes is observable.
        return switched ? rows.map((one) => (one.id === 'demo-forge' ? { ...one, enabled: false } : one)) : rows;
      },
      command: async (_actor, command) => {
        commands.push(command);
        if (command.type === 'connector.setEnabled') switched = command.enabled === false;
        return switchResult;
      },
    },
    actor: USER,
  });
  return { store, commands, get reads() { return reads; } };
};

describe('connectors store (U-356)', () => {
  it('U-356: the store mirrors connector.list row for row; ensure reads once per session', async () => {
    const b = bridge();
    await b.store.ensure();
    expect(b.store.state()).toMatchObject({ loading: false, loaded: true, problem: null, rows: ROWS });
    await b.store.ensure();
    expect(b.reads).toBe(1);
    await b.store.load();
    expect(b.reads).toBe(2);
  });

  it('U-356: a failed list read names its problem code and keeps the rows it already had', async () => {
    let failing = false;
    const store = createConnectorsStore({
      api: {
        query: async () => (failing ? { ok: false, code: 'invalid_settings' } : ROWS),
        command: async () => ({ ok: true }),
      },
      actor: USER,
    });
    await store.load();
    failing = true;
    await store.load();
    expect(store.state().problem).toBe('invalid_settings');
    expect(store.state().rows).toStrictEqual(ROWS);
  });

  it('U-356: the switch issues connector.setEnabled as the user actor and re-reads the list', async () => {
    const b = bridge();
    await b.store.load();
    await b.store.setEnabled('demo-forge', false);
    expect(b.commands).toStrictEqual([{ type: 'connector.setEnabled', id: 'demo-forge', enabled: false }]);
    expect(b.reads).toBe(2);
    expect(b.store.state().rows[0].enabled).toBe(false);
    expect(b.store.state().busy).toStrictEqual([]);
  });

  it('U-356: a refused switch keeps its typed reason on its row until the next attempt clears it', async () => {
    let refuse = true;
    const commands: Command[] = [];
    const store = createConnectorsStore({
      api: {
        query: async () => ROWS,
        command: async (_actor, command) => {
          commands.push(command);
          return refuse ? { ok: false as const, code: 'invalid' } : { ok: true as const };
        },
      },
      actor: USER,
    });
    await store.load();
    await store.setEnabled('demo-forge', true);
    expect(store.state().failures).toStrictEqual({ 'demo-forge': 'invalid' });
    expect(store.state().rows[0].enabled).toBe(true);
    // The retry succeeds: the reason leaves with it.
    refuse = false;
    await store.setEnabled('demo-forge', true);
    expect(store.state().failures).toStrictEqual({});
  });

  it('U-356: a second press while one switch is open issues nothing', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const commands: Command[] = [];
    const store = createConnectorsStore({
      api: {
        query: async () => ROWS,
        command: async (_actor, command) => {
          commands.push(command);
          if (command.type === 'connector.setEnabled') await gate;
          return { ok: true };
        },
      },
      actor: USER,
    });
    await store.load();
    const first = store.setEnabled('demo-forge', false);
    await store.setEnabled('demo-forge', false);
    expect(commands).toHaveLength(1);
    release?.();
    await first;
  });

  it('U-356: trackerConnectorName reads the first tracker-providing row — manifest data, order-stable', () => {
    expect(trackerConnectorName(ROWS)).toBe('Demo Forge');
    expect(trackerConnectorName([row({ id: 'forge-only', name: 'Forge Only', provides: ['forge'] })])).toBeNull();
    expect(trackerConnectorName([])).toBeNull();
  });
});
