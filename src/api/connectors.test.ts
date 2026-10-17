// api/connectors.test.ts — the connector settings surface on the wire (A-415, U-356): the list
// query answers one row per connector straight from the manifest plus the registry's switch state
// and health, and the switch command speaks for the operator the api's actor names — a non-user
// actor answers user_only before any registry call, exactly like the registry's own guard.
import { describe, expect, it } from 'vitest';

import type { Actor, RoleSlug, RunId } from '../domain/index';
import { CONNECTOR_API_VERSION, err, ok } from '../domain/index';
import type { ConnectorListEntry, SetConnectorEnabledError } from '../application';
import { createFakeDeps } from '../application/ports/fakes';

import { createApi } from './api';
import type { ConnectorWiring } from './api';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const AGENT: Actor = {
  kind: 'agent',
  runId: '01ARZ3NDEKTSV4RRFFQ69G5F777' as RunId,
  role: 'worker' as RoleSlug,
};

/** A manifest-valid row fixture; `over` mutates the facts the view copies. */
const entry = (over: {
  readonly id?: string;
  readonly provides?: ConnectorListEntry['manifest']['provides'];
  readonly hostMatch?: readonly string[];
  readonly settings?: ConnectorListEntry['manifest']['settings'];
  readonly requiresCli?: string;
  readonly enabled?: boolean;
  readonly health?: ConnectorListEntry['health'];
  readonly error?: ConnectorListEntry['error'];
}): ConnectorListEntry => ({
  manifest: {
    id: (over.id ?? 'demo-forge') as ConnectorListEntry['manifest']['id'],
    name: over.id === undefined ? 'Demo Forge' : `Forge ${over.id}`,
    version: '1.2.0',
    apiVersion: CONNECTOR_API_VERSION,
    provides: over.provides ?? ['forge', 'tracker'],
    hostMatch: over.hostMatch ?? ['forge.example'],
    network: ['api.forge.example', 'forge.example'],
    settings: over.settings ?? [],
    ...(over.requiresCli === undefined ? {} : { requiresCli: over.requiresCli }),
  },
  enabled: over.enabled ?? true,
  health: over.health ?? 'ready',
  ...(over.error === undefined ? {} : { error: over.error }),
});

/** The wiring over canned answers: the list rows and the switch's refusal (ok by default). */
const wiring = (
  rows: readonly ConnectorListEntry[],
  refuse?: SetConnectorEnabledError,
  calls?: string[],
): ConnectorWiring => ({
  list: async () => (rows === null ? err('invalid_settings') : ok(rows)),
  setEnabled: async (id, enabled) => {
    calls?.push(`${id}:${enabled}`);
    return refuse === undefined ? ok(undefined) : err(refuse);
  },
});

const apiWith = (w: ConnectorWiring) =>
  createApi(
    createFakeDeps(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    w,
  );

describe('connector.list / connector.setEnabled', () => {
  it('A-415: the list answers manifest data plus the switch state and health, one row per connector', async () => {
    const api = apiWith(wiring([
      entry({}),
      entry({ id: 'partial', provides: ['tracker'], hostMatch: [], enabled: false, health: 'needs_cli' }),
      entry({ id: 'broken', health: 'invalid', error: 'bad_version', enabled: false }),
      entry({ id: 'withfields', settings: [{ key: 'token', label: 'Token', kind: 'secret', required: true }] }),
    ]));
    expect(await api.query({ type: 'connector.list' })).toStrictEqual([
      {
        id: 'demo-forge',
        name: 'Demo Forge',
        version: '1.2.0',
        provides: ['forge', 'tracker'],
        hostMatch: ['forge.example'],
        network: ['api.forge.example', 'forge.example'],
        hasSettings: false,
        enabled: true,
        health: 'ready',
      },
      {
        id: 'partial',
        name: 'Forge partial',
        version: '1.2.0',
        provides: ['tracker'],
        network: ['api.forge.example', 'forge.example'],
        hasSettings: false,
        enabled: false,
        health: 'needs_cli',
      },
      {
        id: 'broken',
        name: 'Forge broken',
        version: '1.2.0',
        provides: ['forge', 'tracker'],
        hostMatch: ['forge.example'],
        network: ['api.forge.example', 'forge.example'],
        hasSettings: false,
        enabled: false,
        health: 'invalid',
        error: 'bad_version',
      },
      {
        id: 'withfields',
        name: 'Forge withfields',
        version: '1.2.0',
        provides: ['forge', 'tracker'],
        hostMatch: ['forge.example'],
        network: ['api.forge.example', 'forge.example'],
        hasSettings: true,
        enabled: true,
        health: 'ready',
      },
    ]);
  });

  it('A-415: a corrupt settings store answers invalid_settings, never a silently defaulted list', async () => {
    const api = apiWith({ list: async () => err('invalid_settings'), setEnabled: async () => ok(undefined) });
    expect(await api.query({ type: 'connector.list' })).toStrictEqual({ ok: false, code: 'invalid_settings' });
  });

  it('A-415: the switch speaks for the operator — a non-user actor answers user_only before any registry call', async () => {
    const calls: string[] = [];
    const api = apiWith(wiring([entry({})], undefined, calls));
    expect(await api.command(AGENT, { type: 'connector.setEnabled', id: 'demo-forge', enabled: false })).toStrictEqual({ ok: false, code: 'user_only' });
    expect(calls).toStrictEqual([]);
  });

  it('A-415: setEnabled failures carry their typed codes; a malformed id answers invalid_id at the edge', async () => {
    const api = apiWith(wiring([entry({})], 'invalid'));
    expect(await api.command(USER, { type: 'connector.setEnabled', id: 'demo-forge', enabled: true })).toStrictEqual({ ok: false, code: 'invalid' });
    expect(await api.command(USER, { type: 'connector.setEnabled', id: 'Not A Slug', enabled: true })).toStrictEqual({ ok: false, code: 'invalid_id' });
  });

  it('U-356: without registry wiring the surface answers not_found instead of inventing rows', async () => {
    const api = createApi(createFakeDeps());
    expect(await api.query({ type: 'connector.list' })).toStrictEqual({ ok: false, code: 'not_found' });
    expect(await api.command(USER, { type: 'connector.setEnabled', id: 'demo-forge', enabled: true })).toStrictEqual({ ok: false, code: 'not_found' });
  });
});
