// candidates.test.ts — U-34: the discovered accounts and providers as one list; selection, the
// key-move switch (starts off, never a value), and adoption results through U-8.
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import { createCandidatesStore, candidateRows, candidateDot, candidateStanding, candidateStatusTone, listedCandidateCount, listBody, providerRows, type CandidateFact } from './candidates';

const base: CandidateFact = {
  sourcePath: '/home/u/.alpha',
  displayPath: '~/.alpha',
  kind: 'subscription',
  routeKind: 'route-a',
  provider: 'prov-a',
  billing: 'included',
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

describe('candidate section standing (U-45)', () => {
  it('U-45: a candidate row carries its section standing — ready is found; needs-login and the probe that proved nothing feed the failed summary', () => {
    expect(candidateStanding('candidates.status.ready')).toBe('ready');
    expect(candidateStanding('candidates.status.needs_login')).toBe('needsLogin');
    expect(candidateStanding('candidates.status.unknown')).toBe('unverified');
    expect(candidateStanding('candidates.status.key_needed')).toBe('other');
    expect(candidateStanding('candidates.status.unreadable')).toBe('other');
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

describe('Eklenmemiş list (U-28, U-34)', () => {
  it('U-28: the list count and the dot count are one function of the facts', () => {
    const facts = [base, { ...keyed, alreadyAdded: true }, { ...base, sourcePath: '/x', warnings: ['unreadable' as const] }];
    expect(listedCandidateCount(facts)).toBe(candidateRows(facts, null, false).length);
    expect(listedCandidateCount(facts)).toBe(2);
    expect(listedCandidateCount([{ ...base, alreadyAdded: true }])).toBe(0);
  });

  it('U-28: Ekle is visible only while a candidate is selected', async () => {
    const f = fake([base, keyed]);
    const store = createCandidatesStore({ api: f.api, actor: { kind: 'user', id: 'u' } as never });
    await store.load();
    expect(store.state().addVisible).toBe(false);
    store.select(base.sourcePath);
    expect(store.state().addVisible).toBe(true);
    store.select(base.sourcePath);
    expect(store.state().addVisible).toBe(false);
  });

  it('U-34: status words carry a lamp tone — Hazır proceed, a needed key or login signal, the rest dim', () => {
    expect(candidateStatusTone('candidates.status.ready')).toBe('proceed');
    expect(candidateStatusTone('candidates.status.key_needed')).toBe('signal');
    expect(candidateStatusTone('candidates.status.needs_login')).toBe('signal');
    expect(candidateStatusTone('candidates.status.unreadable')).toBe('dim');
    expect(candidateStatusTone('candidates.status.not_installed')).toBe('dim');
    expect(candidateStatusTone('candidates.status.unknown')).toBe('dim');
  });

  it('U-28: an empty Eklenmemiş list lights no dot — once the list has loaded it is the dot\'s only source', async () => {
    const f = fake([{ ...base, alreadyAdded: true }]);
    const store = createCandidatesStore({ api: f.api, actor: { kind: 'user', id: 'u' } as never });
    expect(candidateDot(store.state(), true)).toBe(true);
    await store.load();
    expect(store.state().rows).toHaveLength(0);
    expect(candidateDot(store.state(), true)).toBe(false);
    const g = fake([base]);
    const other = createCandidatesStore({ api: g.api, actor: { kind: 'user', id: 'u' } as never });
    await other.load();
    expect(candidateDot(other.state(), false)).toBe(true);
  });
});

describe('list body', () => {
  it('U-34: while the scan loads the body is "scanning" (a lamp line), never the empty text; empty only after the answer', () => {
    expect(listBody({ loading: true, loaded: false, rows: [], providers: [] })).toBe('scanning');
    expect(listBody({ loading: true, loaded: true, rows: [], providers: [] })).toBe('scanning');
    expect(listBody({ loading: false, loaded: true, rows: [], providers: [] })).toBe('empty');
    expect(listBody({ loading: false, loaded: true, rows: candidateRows([base], null, false), providers: [] })).toBe('list');
    expect(candidateStatusTone('candidates.status.scanning')).toBe('info');
  });
});

describe('machine-login candidates and the row\'s Ekle (U-42, U-43)', () => {
  const login: CandidateFact = {
    ...base,
    sourcePath: 'machine-login:prov-m',
    displayPath: '~/.prov-m',
    kind: 'machine_login',
    routeKind: 'route-m',
    provider: 'prov-m',
    hasOauthLogin: false,
  };
  const provider = (loggedIn: boolean | null) => ({ defId: 'prov-m', name: 'M', installUrl: null, binPath: '/bin/m', version: '1', loggedIn, optionalFlags: [] });

  it('U-42: a machine-login candidate reads its provider\'s login probe — signed in is ready, signed out needs a login, unproven is Doğrulanamadı', () => {
    const status = (loggedIn: boolean | null) => candidateRows([login], null, false, [provider(loggedIn)])[0];
    expect(status(true)?.statusKey).toBe('candidates.status.ready');
    expect(status(true)?.hintKey).toBeNull();
    expect(status(false)?.statusKey).toBe('candidates.status.needs_login');
    expect(status(false)?.hintKey).toBe('candidates.hint.login');
    expect(status(null)?.statusKey).toBe('candidates.status.unknown');
    expect(status(null)?.hintKey).toBe('candidates.hint.testLater');
    // No probe answer yet proves nothing either.
    expect(candidateRows([login], null, false, [])[0]?.statusKey).toBe('candidates.status.unknown');
  });

  it('U-42: a row carries the billing of its route and whether it rides a key', () => {
    const [plain, keyedRow] = candidateRows([base, { ...keyed, billing: 'included' }], null, false);
    expect(plain).toMatchObject({ billing: 'included', viaKey: false, provider: 'prov-a', displayPath: '~/.alpha', hintKey: null });
    expect(keyedRow).toMatchObject({ billing: 'included', viaKey: true });
  });

  it('U-43: a row\'s Ekle selects the candidate and adopts it at once', async () => {
    const f = fake([base]);
    const store = make(f);
    await store.load();
    const outcome = await store.add(base.sourcePath);
    expect(outcome?.result.ok).toBe(true);
    expect(f.commands).toEqual([{ type: 'account.adopt', sourcePath: base.sourcePath, label: '.alpha' }]);
  });

  it('U-43: a candidate whose token overrides the login opens its key-move card first; a second Ekle adopts', async () => {
    const f = fake([keyed]);
    const store = make(f);
    await store.load();
    expect(await store.add(keyed.sourcePath)).toBeNull();
    expect(f.commands).toHaveLength(0);
    expect(store.state().rows[0]?.keyMoveCard).toBe(true);
    await store.add(keyed.sourcePath);
    expect(f.commands).toHaveLength(1);
  });

  it('U-43: an unreadable candidate cannot be added', async () => {
    const f = fake([{ ...base, warnings: ['unreadable'] }]);
    const store = make(f);
    await store.load();
    expect(await store.add(base.sourcePath)).toBeNull();
    expect(f.commands).toHaveLength(0);
  });

  it('U-44: an accounts.changed event re-reads a list that has been read', async () => {
    const f = fake([base]);
    let emit: (change: { readonly type: string }) => void = () => undefined;
    const store = createCandidatesStore({
      api: f.api,
      actor: ACTOR,
      changes: (listener) => {
        emit = listener;
        return () => undefined;
      },
    });
    emit({ type: 'accounts.changed' });
    await Promise.resolve();
    expect(f.queries).toHaveLength(0);
    await store.load();
    const before = f.queries.length;
    emit({ type: 'accounts.changed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.queries.length).toBeGreaterThan(before);
  });
});
