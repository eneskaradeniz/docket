// candidates.test.ts — U-34: the discovered accounts and providers as one list; selection, the
// key-move switch (starts off, never a value), and adoption results through U-8.
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import { createCandidatesStore, candidateRows, providerRows, type CandidateFact } from './candidates';

const base: CandidateFact = {
  sourcePath: '/home/u/.alpha',
  displayPath: '~/.alpha',
  kind: 'subscription',
  routeKind: 'route-a',
  provider: 'prov-a',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
};
const keyed: CandidateFact = {
  ...base,
  sourcePath: '/home/u/.beta',
  displayPath: '~/.beta',
  kind: 'compatible_endpoint',
  routeKind: 'route-b',
  provider: null,
  endpointHost: 'api.example.test',
  hasOauthLogin: false,
  envOverrides: ['endpoint', 'token'],
};

interface Fake {
  readonly queries: Query[];
  readonly commands: Command[];
  candidates: unknown;
  discovered: unknown;
  result: CommandResult;
  readonly api: { query(q: Query): Promise<unknown>; command(a: unknown, c: Command): Promise<CommandResult> };
}
const fake = (candidates: unknown, discovered: unknown = []): Fake => {
  const f: Fake = {
    queries: [],
    commands: [],
    candidates,
    discovered,
    result: { ok: true, id: 'acc-1' },
    api: {
      query: (q) => {
        f.queries.push(q);
        return Promise.resolve(q.type === 'accounts.candidates' ? f.candidates : f.discovered);
      },
      command: (_a, c) => {
        f.commands.push(c);
        return Promise.resolve(f.result);
      },
    },
  };
  return f;
};
const ACTOR = { kind: 'user', id: 'u', label: 'U' } as const;
const make = (f: Fake, onAdopted?: () => void) =>
  createCandidatesStore({ api: f.api, actor: ACTOR, ...(onAdopted ? { onAdopted } : {}) });

describe('candidateRows', () => {
  it('U-34: a row carries mark key, label, status and selectable; alreadyAdded rows are not listed', () => {
    const rows = candidateRows([base, { ...keyed, alreadyAdded: true }], null, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '/home/u/.alpha',
      markKey: 'prov-a',
      label: '~/.alpha',
      statusKey: 'candidates.status.ready',
      selectable: true,
      selected: false,
    });
  });

  it('U-34: the mark comes from the candidate provider; an unknown provider has none', () => {
    const rows = candidateRows([base, keyed], null, false);
    expect(rows.map((row) => row.markKey)).toEqual(['prov-a', null]);
  });

  it('U-34: unreadable is disabled and carries its reason', () => {
    const [row] = candidateRows([{ ...base, warnings: ['unreadable'] }], null, false);
    expect(row?.selectable).toBe(false);
    expect(row?.statusKey).toBe('candidates.status.unreadable');
    expect(row?.disabledReasonKey).toBe('candidates.reason.unreadable');
  });

  it('U-34: env_overrides_login shows a warning tag with an info bubble', () => {
    const [row] = candidateRows([{ ...base, warnings: ['env_overrides_login'] }], null, false);
    expect(row?.warnKeys).toEqual(['candidates.warn.env_overrides_login']);
    expect(row?.selectable).toBe(true);
  });

  it('U-34: a token candidate reads "Anahtar gerekli" once selected with the switch off, ready with it on', () => {
    const [unselected] = candidateRows([keyed], null, false);
    expect(unselected?.statusKey).toBe('candidates.status.ready');
    expect(unselected?.keyMoveCard).toBe(false);
    const [off] = candidateRows([keyed], keyed.sourcePath, false);
    expect(off?.keyMoveCard).toBe(true);
    expect(off?.statusKey).toBe('candidates.status.key_needed');
    const [on] = candidateRows([keyed], keyed.sourcePath, true);
    expect(on?.statusKey).toBe('candidates.status.ready');
  });

  it('U-34: a candidate without a token override never shows the key-move card', () => {
    const [row] = candidateRows([base], base.sourcePath, false);
    expect(row?.keyMoveCard).toBe(false);
  });
});

describe('providerRows', () => {
  it('U-34: a discovered provider reads ready, needs login or not installed; unknown login proves nothing', () => {
    const rows = providerRows([
      { defId: 'p1', name: 'One', installUrl: null, binPath: '/bin/p1', version: '1', loggedIn: true, optionalFlags: [] },
      { defId: 'p2', name: 'Two', installUrl: null, binPath: '/bin/p2', version: '1', loggedIn: false, optionalFlags: [] },
      { defId: 'p3', name: 'Three', installUrl: 'https://example.invalid/three', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
      { defId: 'p4', name: 'Four', installUrl: null, binPath: '/bin/p4', version: null, loggedIn: null, optionalFlags: [] },
    ]);
    expect(rows.map((r) => [r.id, r.statusKey])).toEqual([
      ['p1', 'candidates.status.ready'],
      ['p2', 'candidates.status.needs_login'],
      ['p3', 'candidates.status.not_installed'],
      ['p4', 'candidates.status.unknown'],
    ]);
  });
});

describe('provider hints', () => {
  const rows = providerRows([
    { defId: 'p2', name: 'Two', installUrl: 'https://example.invalid/two', binPath: '/bin/p2', version: null, loggedIn: false, optionalFlags: [] },
    { defId: 'p3', name: 'Three', installUrl: 'https://example.invalid/three', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    { defId: 'p5', name: 'Five', installUrl: null, binPath: null, version: null, loggedIn: null, optionalFlags: [] },
  ]);

  it('U-34: a provider that needs a login names itself in the login hint and shows no install link', () => {
    expect(rows[0]).toMatchObject({ name: 'Two', hintKey: 'candidates.hint.login', installUrl: null });
  });

  it('U-34: a provider not found shows its install url as copyable text, never a command', () => {
    expect(rows[1]).toMatchObject({ name: 'Three', hintKey: null, installUrl: 'https://example.invalid/three' });
    expect(rows[2]).toMatchObject({ installUrl: null });
  });
});

describe('createCandidatesStore', () => {
  it('U-34: load reads both queries and lists the rows; a failed reply lists nothing', async () => {
    const f = fake([base, keyed], [{ defId: 'p1', name: 'One', installUrl: null, binPath: '/b', version: null, loggedIn: true, optionalFlags: [] }]);
    const store = make(f);
    await store.load();
    expect(store.state().rows).toHaveLength(2);
    expect(store.state().providers).toHaveLength(1);
    f.candidates = { ok: false, code: 'not_found' };
    await store.load();
    expect(store.state().rows).toHaveLength(0);
  });

  it('U-34: the key-move switch starts off on every selection, and off sends adopt without importToken', async () => {
    const f = fake([keyed]);
    const store = make(f);
    await store.load();
    store.select(keyed.sourcePath);
    expect(store.state().importToken).toBe(false);
    await store.adopt();
    expect(f.commands).toEqual([{ type: 'account.adopt', sourcePath: keyed.sourcePath, label: '.beta' }]);
    expect('importToken' in (f.commands[0] ?? {})).toBe(false);
  });

  it('U-34: switch on sends importToken: true; re-selecting resets it to off', async () => {
    const f = fake([keyed, base]);
    const store = make(f);
    await store.load();
    store.select(keyed.sourcePath);
    store.setImportToken(true);
    expect(store.state().importToken).toBe(true);
    store.select(base.sourcePath);
    store.select(keyed.sourcePath);
    expect(store.state().importToken).toBe(false);
    store.setImportToken(true);
    await store.adopt();
    expect(f.commands[0]).toMatchObject({ importToken: true });
  });

  it('U-34: an unreadable candidate cannot be selected or adopted', async () => {
    const f = fake([{ ...base, warnings: ['unreadable'] }]);
    const store = make(f);
    await store.load();
    store.select(base.sourcePath);
    expect(store.state().selected).toBeNull();
    await store.adopt();
    expect(f.commands).toHaveLength(0);
  });

  it('U-34: a successful adopt maps through U-8, clears the selection, refreshes the list and tells the host', async () => {
    const f = fake([base]);
    let told = 0;
    const store = make(f, () => {
      told += 1;
    });
    await store.load();
    store.select(base.sourcePath);
    f.candidates = [{ ...base, alreadyAdded: true }];
    const outcome = await store.adopt();
    expect(outcome?.labelKey).toBe('success.account.adopt');
    expect(store.state().selected).toBeNull();
    expect(store.state().rows).toHaveLength(0);
    expect(f.queries).toContainEqual({ type: 'accounts.candidates', refresh: true });
    expect(told).toBe(1);
  });

  it('U-34: a failed adopt maps its code through U-8, keeps the selection and does not refresh', async () => {
    const f = fake([base]);
    f.result = { ok: false, code: 'not_found' };
    const store = make(f);
    await store.load();
    store.select(base.sourcePath);
    const before = f.queries.length;
    const outcome = await store.adopt();
    expect(outcome?.labelKey).toBe('error.not_found');
    expect(store.state().selected).toBe(base.sourcePath);
    expect(f.queries.length).toBe(before);
  });

  it('U-34: rescan queries candidates with refresh, and discovery again', async () => {
    const f = fake([base]);
    const store = make(f);
    await store.rescan();
    expect(f.queries).toContainEqual({ type: 'accounts.candidates', refresh: true });
    expect(f.queries).toContainEqual({ type: 'providers.discovered' });
  });
});
