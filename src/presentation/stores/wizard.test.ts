// wizard.test.ts — U-35 / U-42: the setup wizard's step machine. The api is a scripted fake that
// records every command, so the finish fan-out is asserted payload by payload.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { CapabilityImportResultView, Command, CommandResult } from '../../api/commands';
import type { Query, SettingsAccountView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { createWizardStore, WIZARD_EDITOR_TABS, type WizardStore } from './wizard';

const userActor: Actor = { kind: 'user', id: 'user-1' };

const candidate = (path: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourcePath: `/h/${path}`,
  displayPath: `~/${path}`,
  kind: 'subscription',
  routeKind: 'anthropic',
  provider: 'claude',
  billing: 'included',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
  ...patch,
});

const claudeA = candidate('.claude');
const claudeB = candidate('.claude-b');
const endpoint = candidate('.claude-zai', {
  kind: 'compatible_endpoint',
  billing: 'unknown',
  endpointHost: 'api.z.ai',
  envOverrides: ['token', 'endpoint'],
});
const unreadable = candidate('.claude-bad', { warnings: ['unreadable'] });

const roles = [
  { id: 'analyst', name: 'Analist', stages: [] },
  { id: 'developer', name: 'Geliştirici', stages: [] },
  { id: 'planner', name: 'Planlayıcı', stages: [] },
];

const accountView = (id: string, label: string, authMode: string): SettingsAccountView => ({
  id,
  provider: 'claude',
  label,
  authMode,
  billing: authMode === 'subscription' ? 'included' : 'unknown',
  plan: null,
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
});

const pool = (id: string, label: string, appliesTo: unknown) => ({ id, label, kind: 'allowance', appliesTo });
const meter = (id: string, poolId: string, label: string) => ({
  id,
  poolId,
  label,
  cadence: 'fixed',
  durationMs: null,
  unit: 'fraction',
  used: 0.3,
  limit: 1,
  remaining: 0.7,
  resetsAt: 1,
  resetPrecision: 'exact',
  observedAt: 1,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'short',
  reserveShare: 0,
});

type Change = { readonly type: string };

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  readonly queries: Query[];
  emit(change: Change): void;
  readonly changes: (listener: (change: Change) => void) => () => void;
  setTree(reply: unknown): void;
  setCandidates(facts: readonly Record<string, unknown>[]): void;
  setProviders(providers: readonly Record<string, unknown>[]): void;
  setAccounts(accounts: readonly SettingsAccountView[]): void;
  setQuota(reply: unknown): void;
  setCapabilities(view: unknown): void;
  failCapabilities(): void;
  /** The rows `capabilities.import` answers with; absent means every identity imports. */
  setImportResults(rows: readonly CapabilityImportResultView[]): void;
  failOn(type: Command['type'], result: CommandResult): void;
  /** Holds every command of a type until resolved — a finish's real step, made observable. */
  holdOn(type: Command['type']): { readonly resolve: () => void };
  /** Holds every query of a type until resolved — Yetenekler's read, made observable. */
  holdQuery(type: Query['type']): { readonly resolve: () => void };
}

const claudeProvider = { defId: 'claude', name: 'Claude Code', installUrl: null, binPath: '/usr/bin/claude', version: null, loggedIn: true, optionalFlags: [] };

const fakeApi = (): Fake => {
  const commands: Command[] = [];
  const queries: Query[] = [];
  const listeners = new Set<(change: Change) => void>();
  let tree: unknown = [];
  let facts: readonly Record<string, unknown>[] = [claudeA];
  let providers: readonly Record<string, unknown>[] = [claudeProvider];
  let accounts: SettingsAccountView[] = [];
  let quota: unknown = { ok: false, code: 'not_found' };
  let caps: unknown = { candidates: [], truncated: false };
  let capsFail = false;
  let importResults: readonly CapabilityImportResultView[] | null = null;
  const failures = new Map<string, CommandResult>();
  const holds = new Map<Command['type'], (() => void)[]>();
  const queryHolds = new Map<Query['type'], (() => void)[]>();
  let adopted = 0;
  const settle = (command: Command): Promise<CommandResult> => {
    const failure = failures.get(command.type);
    if (failure !== undefined) return Promise.resolve(failure);
    if (command.type === 'account.adopt') {
      adopted += 1;
      const id = `acc-${adopted}`;
      const isEndpoint = command.sourcePath.includes('zai');
      accounts.push(accountView(id, command.label, isEndpoint ? 'api_key' : 'subscription'));
      return Promise.resolve({ ok: true, id });
    }
    if (command.type === 'capabilities.import') {
      return Promise.resolve({
        ok: true,
        results: importResults ?? command.identities.map((identity) => ({ identity, status: 'imported', id: `cap-${identity.length}`, reason: null })),
      });
    }
    return Promise.resolve({ ok: true });
  };
  return {
    commands,
    queries,
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
    changes: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTree: (reply) => {
      tree = reply;
    },
    setCandidates: (next) => {
      facts = next;
    },
    setProviders: (next) => {
      providers = next;
    },
    setAccounts: (next) => {
      accounts = [...next];
    },
    setQuota: (reply) => {
      quota = reply;
    },
    setCapabilities: (view) => {
      caps = view;
    },
    failCapabilities: () => {
      capsFail = true;
    },
    setImportResults: (rows) => {
      importResults = rows;
    },
    failOn: (type, result) => failures.set(type, result),
    holdOn: (type) => {
      holds.set(type, []);
      return {
        resolve: () => {
          const waiting = holds.get(type) ?? [];
          holds.delete(type);
          for (const go of waiting) go();
        },
      };
    },
    holdQuery: (type) => {
      queryHolds.set(type, []);
      return {
        resolve: () => {
          const waiting = queryHolds.get(type) ?? [];
          queryHolds.delete(type);
          for (const go of waiting) go();
        },
      };
    },
    query: (query) => {
      queries.push(query);
      const answer = (): unknown => {
        switch (query.type) {
          case 'project.tree':
            return tree;
          case 'accounts.candidates':
            return facts;
          case 'providers.discovered':
            return providers;
          case 'settings.accounts':
            return { accounts, bindings: [] };
          case 'roles.list':
            return roles;
          case 'accounts.candidateQuota':
            return quota;
          case 'capabilities.candidates':
            return capsFail ? { ok: false, code: 'internal' } : caps;
          default:
            return [];
        }
      };
      const held = queryHolds.get(query.type);
      if (held !== undefined) return new Promise((resolve) => { held.push(() => resolve(answer())); });
      return Promise.resolve(answer());
    },
    command: (_actor, command) => {
      commands.push(command);
      const held = holds.get(command.type);
      if (held !== undefined) return new Promise((resolve) => { held.push(() => { void settle(command).then(resolve); }); });
      return settle(command);
    },
  };
};

interface Setup {
  readonly api: Fake;
  readonly store: WizardStore;
}

const setup = (facts: readonly Record<string, unknown>[] = [claudeA]): Setup => {
  const api = fakeApi();
  api.setCandidates(facts);
  const store = createWizardStore({ api, actor: userActor, changes: api.changes });
  return { api, store };
};

const keyOf = (path: string): string => `/h/${path}`;

/** Opens the wizard and walks Hoş geldin → Hesaplar. */
const toAccounts = async (bundle: Setup): Promise<void> => {
  await bundle.store.open();
  await bundle.store.next();
};

const selectedIds = (store: WizardStore): readonly string[] => store.state().rows.filter((row) => row.selected).map((row) => row.id);

const railOf = (store: WizardStore): readonly string[] => store.state().rail.map((entry) => `${entry.step}:${entry.standing}`);

/** One capability candidate on the wire; the name derives from the identity unless given. */
const capOf = (identity: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  identity,
  kind: 'mcp',
  name: identity.replace(/^mcp:/, '').split('|')[0],
  sources: ['acc-a'],
  imported: false,
  ...patch,
});

/** A wizard whose Hesaplar holds two stored accounts and whose Yetenekler read answers `caps`. */
const toCapabilities = async (bundle: Setup, caps: readonly Record<string, unknown>[]): Promise<void> => {
  bundle.api.setAccounts([accountView('acc-a', 'Kişisel', 'subscription'), accountView('acc-b', 'İş', 'subscription')]);
  bundle.api.setCapabilities({ candidates: caps, truncated: false });
  await bundle.store.open();
  await bundle.store.next();
  await bundle.store.next();
};

describe('wizard store (U-35, U-42)', () => {
  it('U-35: open with a project keeps the wizard hidden; no project shows it on Hoş geldin; an unreadable project read never suppresses it', async () => {
    const hidden = setup();
    hidden.api.setTree([{ project: 'atolye' }]);
    await hidden.store.open();
    expect(hidden.store.state().visible).toBe(false);

    const shown = setup();
    await shown.store.open();
    expect(shown.store.state().visible).toBe(true);
    expect(shown.store.state().step).toBe('welcome');

    const failed = setup();
    failed.api.setTree({ ok: false, code: 'internal' });
    await failed.store.open();
    expect(failed.store.state().visible).toBe(true);
  });

  it('U-42: the steps run Hoş geldin → Hesaplar → Yetenekler → Asistan sırası → Bütçe; Yetenekler is skipped while no capability source is composed and Asistan sırası under two selected accounts', async () => {
    const one = setup([claudeA, claudeB]);
    await toAccounts(one);
    one.store.select(keyOf('.claude-b'));
    expect(railOf(one.store)).toEqual(['welcome:done', 'accounts:cur', 'capabilities:skipped', 'order:skipped', 'budget:todo']);
    await one.store.next();
    expect(one.store.state().step).toBe('budget');

    const two = setup([claudeA, claudeB]);
    await toAccounts(two);
    expect(two.store.state().rail.find((entry) => entry.step === 'order')?.standing).toBe('todo');
    await two.store.next();
    expect(two.store.state().step).toBe('order');
    await two.store.next();
    expect(two.store.state().step).toBe('budget');
  });

  it('U-42: Hoş geldin has no Geri; every later step has one, and Hesaplar goes back to Hoş geldin', async () => {
    const bundle = setup();
    await bundle.store.open();
    expect(bundle.store.state().canBack).toBe(false);
    bundle.store.back();
    expect(bundle.store.state().step).toBe('welcome');
    await bundle.store.next();
    expect(bundle.store.state().canBack).toBe(true);
    bundle.store.back();
    expect(bundle.store.state().step).toBe('welcome');
  });

  it('U-42: a done step in the rail goes back to it; the current, a later and a skipped step do nothing', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('order');
    bundle.store.goTo('order');
    bundle.store.goTo('budget');
    bundle.store.goTo('capabilities');
    expect(bundle.store.state().step).toBe('order');
    bundle.store.goTo('welcome');
    expect(bundle.store.state().step).toBe('welcome');
    // Entries survive the trip.
    expect(selectedIds(bundle.store)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
  });

  it('U-35: Yetenekler shows when the read holds candidates and its picks are kept as identities, a draft until the finish', async () => {
    const bundle = setup([claudeA]);
    await toCapabilities(bundle, [capOf('mcp:fs|fs-server'), capOf('context:CLAUDE.md', { kind: 'context' })]);
    expect(bundle.store.state().step).toBe('capabilities');
    bundle.store.toggleCapability('context:CLAUDE.md');
    expect(bundle.store.state().capabilityPicked).toBe(1);
    // The pick survives the trip through the later steps — nothing is written before the finish.
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().capabilityPicked).toBe(1);
    expect(bundle.api.commands).toEqual([]);
  });

  it('U-58: the read runs when Hesaplar completes and again on accounts.changed — never before an account exists', async () => {
    // No stored account: the scan has nothing to walk (A-90), so the step is skipped and the
    // query is never sent.
    const none = setup([claudeA]);
    none.api.setCapabilities({ candidates: [capOf('mcp:fs|fs')], truncated: false });
    await none.store.open();
    await none.store.next();
    await none.store.next();
    expect(none.store.state().step).toBe('budget');
    expect(none.api.queries.filter((query) => query.type === 'capabilities.candidates')).toHaveLength(0);

    const bundle = setup([claudeA]);
    await toCapabilities(bundle, [capOf('mcp:fetch|npx')]);
    expect(bundle.store.state().step).toBe('capabilities');
    expect(bundle.api.queries.filter((query) => query.type === 'capabilities.candidates')).toHaveLength(1);
    bundle.api.emit({ type: 'accounts.changed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bundle.api.queries.filter((query) => query.type === 'capabilities.candidates')).toHaveLength(2);
  });

  it('U-58: while the query runs the step holds its loading standing and the primary slot stays disabled until it resolves', async () => {
    const bundle = setup([claudeA]);
    bundle.api.setAccounts([accountView('acc-a', 'Kişisel', 'subscription')]);
    bundle.api.setCapabilities({ candidates: [capOf('mcp:fetch|npx')], truncated: false });
    const held = bundle.api.holdQuery('capabilities.candidates');
    await bundle.store.open();
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('capabilities');
    expect(bundle.store.state().capabilitiesLoading).toBe(true);
    expect(bundle.store.state().nextEnabled).toBe(false);
    expect(bundle.store.state().reasonKey).toBe('wizard.reason.capabilities');
    held.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bundle.store.state().capabilitiesLoading).toBe(false);
    expect(bundle.store.state().nextEnabled).toBe(true);
  });

  it('U-35a: an empty answer or a failed query skips Yetenekler — "–" in the rail and no error anywhere', async () => {
    const empty = setup([]);
    empty.api.setAccounts([accountView('acc-a', 'Kişisel', 'subscription')]);
    empty.api.setCapabilities({ candidates: [], truncated: false });
    await empty.store.open();
    await empty.store.next();
    await empty.store.next();
    expect(empty.store.state().step).toBe('budget');
    expect(empty.store.state().rail.find((entry) => entry.step === 'capabilities')?.standing).toBe('skipped');
    expect(empty.store.state().lastOutcome).toBeNull();

    const failed = setup([]);
    failed.api.setAccounts([accountView('acc-a', 'Kişisel', 'subscription')]);
    failed.api.failCapabilities();
    await failed.store.open();
    await failed.store.next();
    await failed.store.next();
    expect(failed.store.state().step).toBe('budget');
    expect(failed.store.state().rail.find((entry) => entry.step === 'capabilities')?.standing).toBe('skipped');
    // The error is non-blocking: the rail shows no error and neither does the end of the walk.
    expect(failed.store.state().reasonKey).toBeNull();
    expect(failed.store.state().lastOutcome).toBeNull();
  });

  it('U-59: one group per source account titled the way Hesaplar reads it; a shared identity is one capability whose checkbox is synced across its groups', async () => {
    const bundle = setup([claudeA]);
    await toCapabilities(bundle, [
      capOf('mcp:fetch|npx', { sources: ['acc-a', 'acc-b'], command: 'npx', description: "Web'den içerik çeker" }),
      capOf('mcp:db|db-server', { sources: ['acc-b'] }),
    ]);
    const state = bundle.store.state();
    expect(state.capabilityGroups.map((group) => [group.id, group.title])).toEqual([
      ['acc-a', 'Claude Code · Kişisel'],
      ['acc-b', 'Claude Code · İş'],
    ]);
    expect(state.capabilityGroups[0]?.rows.map((row) => row.identity)).toEqual(['mcp:fetch|npx']);
    expect(state.capabilityGroups[1]?.rows.map((row) => row.identity)).toEqual(['mcp:fetch|npx', 'mcp:db|db-server']);
    // Toggling in one group syncs the other by identity; the summary counts the identity once.
    bundle.store.toggleCapability('mcp:fetch|npx');
    const synced = bundle.store.state();
    expect(synced.capabilityGroups[0]?.rows[0]?.selected).toBe(true);
    expect(synced.capabilityGroups[1]?.rows[0]?.selected).toBe(true);
    expect(synced.capabilityPicked).toBe(1);
    // The row carries what its ⓘ popover lists: the description, the command and the sources.
    expect(synced.capabilityGroups[0]?.rows[0]?.command).toBe('npx');
    expect(synced.capabilityGroups[0]?.rows[0]?.description).toBe("Web'den içerik çeker");
    expect(synced.capabilityGroups[0]?.rows[0]?.sources).toEqual(['acc-a', 'acc-b']);
  });

  it('U-59: an imported row is checked and disabled with "Eklendi", is never sent to import and never counts in the summary; a truncated read notes it', async () => {
    const bundle = setup([claudeA]);
    await toCapabilities(bundle, [capOf('mcp:fs|fs', { imported: true }), capOf('mcp:fetch|npx')]);
    bundle.api.setCapabilities({ candidates: [capOf('mcp:fs|fs', { imported: true }), capOf('mcp:fetch|npx')], truncated: true });
    bundle.store.back();
    bundle.store.back();
    await bundle.store.next();
    await bundle.store.next();
    const row = bundle.store.state().capabilityGroups[0]?.rows.find((entry) => entry.identity === 'mcp:fs|fs');
    expect(row?.imported).toBe(true);
    expect(row?.selected).toBe(false);
    expect(bundle.store.state().capabilityTruncated).toBe(true);
    // The toggle is dead on an imported row and the summary counts nothing.
    bundle.store.toggleCapability('mcp:fs|fs');
    expect(bundle.store.state().capabilityPicked).toBe(0);
  });

  it('U-60: the finish walks a capability phase after the accounts phase — one import call with the distinct picked identities, none when nothing is picked', async () => {
    const bundle = setup([]);
    await toCapabilities(bundle, [capOf('mcp:fetch|npx', { sources: ['acc-a', 'acc-b'] }), capOf('mcp:db|db-server', { sources: ['acc-b'] })]);
    bundle.store.toggleCapability('mcp:fetch|npx');
    bundle.store.toggleCapability('mcp:db|db-server');
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    const walk: string[] = [];
    bundle.store.subscribe(() => {
      const standing = bundle.store.state();
      if (!standing.finishing && standing.finishError === null && standing.finished === null) return;
      const mark = `${standing.finishPhase ?? '-'}${standing.finished !== null ? '+' : standing.finishError !== null ? '!' : ''}`;
      if (walk[walk.length - 1] !== mark) walk.push(mark);
    });
    await bundle.store.next();
    // One call, both distinct identities, already-imported rows never in it.
    expect(bundle.api.commands.filter((command) => command.type === 'capabilities.import')).toEqual([
      { type: 'capabilities.import', identities: ['mcp:fetch|npx', 'mcp:db|db-server'] },
    ]);
    expect(walk).toEqual(['accounts', 'capabilities', 'order', 'budget', 'home', 'home+']);
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    expect(bundle.store.state().capabilityRejects).toEqual([]);

    // Nothing picked: no import call at all, and the finish keeps its four own lines (U-49).
    const quiet = setup([]);
    await toCapabilities(quiet, [capOf('mcp:fetch|npx')]);
    await quiet.store.next();
    await quiet.store.next();
    const quietWalk: string[] = [];
    quiet.store.subscribe(() => {
      const standing = quiet.store.state();
      if (!standing.finishing && standing.finishError === null && standing.finished === null) return;
      const mark = `${standing.finishPhase ?? '-'}${standing.finished !== null ? '+' : ''}`;
      if (quietWalk[quietWalk.length - 1] !== mark) quietWalk.push(mark);
    });
    await quiet.store.next();
    expect(quiet.api.commands.filter((command) => command.type === 'capabilities.import')).toHaveLength(0);
    expect(quietWalk).toEqual(['accounts', 'order', 'budget', 'home', 'home+']);
    expect(quiet.store.state().finished).toEqual({ accounts: 2 });
  });

  it('U-60: a rejected row never blocks the finish and is listed with its name and reason; already_present counts as success', async () => {
    const bundle = setup([]);
    await toCapabilities(bundle, [capOf('mcp:fetch|npx'), capOf('mcp:db|db')]);
    bundle.store.toggleCapability('mcp:fetch|npx');
    bundle.store.toggleCapability('mcp:db|db');
    bundle.api.setImportResults([
      { identity: 'mcp:fetch|npx', status: 'already_present', id: 'cap-fetch', reason: null },
      { identity: 'mcp:db|db', status: 'rejected', id: null, reason: 'id_taken' },
    ]);
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    expect(bundle.store.state().capabilityRejects).toEqual([{ name: 'db', reason: 'id_taken' }]);
  });

  it('U-60: a failed import call never blocks the finish — nothing is listed and the walk completes', async () => {
    const bundle = setup([]);
    await toCapabilities(bundle, [capOf('mcp:fetch|npx')]);
    bundle.store.toggleCapability('mcp:fetch|npx');
    bundle.api.failOn('capabilities.import', { ok: false, code: 'internal' });
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    expect(bundle.store.state().finishError).toBeNull();
    expect(bundle.store.state().capabilityRejects).toEqual([]);
  });

  it('U-35: Hesaplar is gated on one ready selected account; a token candidate stays "Anahtar gerekli" until the key-move switch is on; unreadable rows cannot be selected', async () => {
    const bundle = setup([endpoint, unreadable, claudeA]);
    await toAccounts(bundle);
    // The ready candidate starts selected; deselect it to see the gate.
    bundle.store.select(keyOf('.claude'));
    expect(bundle.store.state().nextEnabled).toBe(false);
    expect(bundle.store.state().reasonKey).toBe('wizard.reason.accounts');

    bundle.store.select(keyOf('.claude-bad'));
    expect(bundle.store.state().rows.find((row) => row.id === keyOf('.claude-bad'))?.selected).toBe(false);
    expect(bundle.store.state().nextEnabled).toBe(false);

    bundle.store.select(keyOf('.claude-zai'));
    const row = bundle.store.state().rows.find((entry) => entry.id === keyOf('.claude-zai'));
    expect(row?.statusKey).toBe('candidates.status.key_needed');
    expect(row?.keyMoveCard).toBe(true);
    expect(row?.importToken).toBe(false);
    expect(bundle.store.state().nextEnabled).toBe(false);

    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    expect(bundle.store.state().nextEnabled).toBe(true);

    bundle.store.setImportToken(keyOf('.claude-zai'), false);
    bundle.store.select(keyOf('.claude'));
    expect(bundle.store.state().nextEnabled).toBe(true);
    // A next past a gate that is closed does nothing.
    bundle.store.select(keyOf('.claude'));
    bundle.store.select(keyOf('.claude-zai'));
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('accounts');
  });

  it('U-42: ready accounts start selected; one whose token overrides its login and an unreadable one do not', async () => {
    const bundle = setup([claudeA, claudeB, endpoint, unreadable]);
    await toAccounts(bundle);
    expect(selectedIds(bundle.store)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
    expect(bundle.store.state().nextEnabled).toBe(true);
  });

  it('U-35: an account added earlier is listed already selected, so a wizard re-run is never stuck behind an empty list', async () => {
    const bundle = setup([]);
    bundle.api.setAccounts([accountView('acc-9', 'Eski hesap', 'subscription')]);
    await bundle.store.open();
    await bundle.store.next();
    expect(bundle.store.state().rows.map((row) => [row.id, row.selected])).toEqual([['acc-9', true]]);
    expect(bundle.store.state().nextEnabled).toBe(true);
  });

  it('U-42: a machine-login candidate is listed with its provider\'s login standing, and every installed provider is a group of its own', async () => {
    const login = candidate('machine-login:agy', { kind: 'machine_login', provider: 'agy', displayPath: '~/.gemini', routeKind: 'agy' });
    const bundle = setup([claudeA, login]);
    bundle.api.setProviders([
      claudeProvider,
      { defId: 'agy', name: 'Antigravity', installUrl: null, binPath: '/usr/bin/agy', version: null, loggedIn: false, optionalFlags: [] },
      { defId: 'codex', name: 'Codex', installUrl: 'https://example.test/codex', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);
    await toAccounts(bundle);
    const row = bundle.store.state().rows.find((entry) => entry.id === keyOf('machine-login:agy'));
    expect(row?.statusKey).toBe('candidates.status.needs_login');
    expect(row?.hintKey).toBe('candidates.hint.login');
    expect(row?.selected).toBe(false);
    expect(bundle.store.state().installed.map((entry) => entry.id)).toEqual(['claude', 'agy']);
  });

  it('A-83a: a candidate whose route declares included billing lands in Abonelikler with no consent gate', async () => {
    const zaiPlan = candidate('.claude-zai-plan', { kind: 'compatible_endpoint', billing: 'included', endpointHost: 'api.z.ai' });
    const bundle = setup([zaiPlan]);
    await toAccounts(bundle);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    const { subscriptions, payPerUse } = bundle.store.state().budget;
    expect(subscriptions.map((row) => row.id)).toEqual([keyOf('.claude-zai-plan')]);
    expect(payPerUse).toEqual([]);
    expect(bundle.store.state().nextEnabled).toBe(true);
  });

  it('A-83: Bütçe groups and gates by the billing view — an included key-based account is no pay-per-use, an unknown one is', async () => {
    const bundle = setup([]);
    bundle.api.setAccounts([
      { ...accountView('acc-plan', 'z.ai planı', 'api_key'), billing: 'included' },
      accountView('acc-key', 'Anahtar', 'api_key'),
    ]);
    await bundle.store.open();
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    const { subscriptions, payPerUse } = bundle.store.state().budget;
    expect(subscriptions.map((row) => row.id)).toEqual(['acc-plan']);
    expect(payPerUse.map((row) => row.id)).toEqual(['acc-key']);
    expect(bundle.store.state().nextEnabled).toBe(false);
  });

  it('U-42: "Bu adımı atla" is offered on Bütçe only, and finishes', async () => {
    const bundle = setup([claudeA, claudeB]);
    await bundle.store.open();
    expect(bundle.store.state().canSkip).toBe(false);
    await bundle.store.skip();
    expect(bundle.store.state().step).toBe('welcome');
    await bundle.store.next();
    expect(bundle.store.state().canSkip).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('order');
    expect(bundle.store.state().canSkip).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().canSkip).toBe(true);
    await bundle.store.skip();
    // The finish keeps the window up for its fade (U-49); the shell leaves via ackFinish.
    expect(bundle.store.state().visible).toBe(true);
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    bundle.store.ackFinish();
    expect(bundle.store.state().visible).toBe(false);
  });

  it('U-42: Asistan sırası starts with the ready subscriptions, then the others, each class keeping its order', async () => {
    const bundle = setup([endpoint, claudeA, claudeB]);
    await toAccounts(bundle);
    // The key-based account is chosen first, so only the ranking can put it last.
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    expect(selectedIds(bundle.store)).toEqual([keyOf('.claude-zai'), keyOf('.claude'), keyOf('.claude-b')]);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('order');
    expect(bundle.store.state().order.map((entry) => [entry.id, entry.autoSkipped])).toEqual([
      [keyOf('.claude'), false],
      [keyOf('.claude-b'), false],
      [keyOf('.claude-zai'), true],
    ]);
  });

  it('U-42: dragging a row to a slot reorders the chain and the order drives the finish chain', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
    bundle.store.moveTo(keyOf('.claude'), 1);
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude-b'), keyOf('.claude')]);
    bundle.store.moveTo(keyOf('.claude'), -3);
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
    bundle.store.moveTo(keyOf('.claude'), 0);
    bundle.store.moveTo('nope', 1);
    bundle.store.moveTo(keyOf('.claude-b'), 0);
    await bundle.store.next();
    await bundle.store.next();
    const bindings = bundle.api.commands.filter((command) => command.type === 'binding.save');
    expect(bindings.length).toBe(3);
    for (const binding of bindings) {
      expect(binding.type === 'binding.save' && binding.accounts.map((entry) => entry.accountId)).toEqual(['acc-2', 'acc-1']);
    }
  });

  it('U-35: back keeps every entry — selection, key-move switch, order, an editor draft and a consent', async () => {
    const bundle = setup([claudeA, endpoint]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    bundle.store.moveTo(keyOf('.claude'), 1);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: '40', scope: 'account_month' })).toBe(true);
    bundle.store.back();
    bundle.store.back();
    bundle.store.back();
    expect(bundle.store.state().step).toBe('welcome');
    expect(selectedIds(bundle.store)).toEqual([keyOf('.claude'), keyOf('.claude-zai')]);
    expect(bundle.store.state().rows.find((row) => row.id === keyOf('.claude-zai'))?.importToken).toBe(true);
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude-zai'), keyOf('.claude')]);
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    const spend = bundle.store.state().budget.payPerUse[0];
    expect(spend?.consented).toBe(true);
    expect(spend?.cap?.amountUsd).toBe(40);
  });

  it('U-42: Bütçe lists the selected accounts as Abonelikler and Kullandıkça öde, with the U-29 difference count per row', async () => {
    const bundle = setup([claudeA, endpoint]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    await bundle.store.next();
    const { subscriptions, payPerUse } = bundle.store.state().budget;
    expect(subscriptions.map((row) => row.id)).toEqual([keyOf('.claude')]);
    expect(payPerUse.map((row) => row.id)).toEqual([keyOf('.claude-zai')]);
    expect(subscriptions[0]?.diffCount).toBe(0);
    expect(payPerUse[0]?.needsConsent).toBe(true);
    expect(payPerUse[0]?.cap).toBeNull();
    // The row shows the recommendation until a cap is stored.
    expect(payPerUse[0]?.capShown).toEqual({ scope: 'account_month', amountUsd: 50 });

    await bundle.store.openEditor(keyOf('.claude'));
    await bundle.store.editorRun({ type: 'account.save', provider: 'claude', label: 'claude', authMode: 'subscription', limitPolicy: 'ask' });
    bundle.store.saveEditor();
    expect(bundle.store.state().budget.subscriptions[0]?.diffCount).toBe(1);
  });

  it('U-42: a subscription row\'s "Limit dolunca" Listbox writes the draft policy; the pool switch is offered only with a model-scoped pool', async () => {
    const plain = setup([claudeA]);
    await toAccounts(plain);
    await plain.store.next();
    expect(plain.store.state().budget.subscriptions[0]?.policyChoices).toEqual(['wait_resume', 'fallback_account', 'ask']);

    const scoped = setup([claudeA]);
    scoped.api.setQuota({
      ok: true,
      pools: [pool('p1', 'max', 'all'), pool('p2', 'Fable', [{ prefix: 'claude-fable' }])],
      meters: [meter('m1', 'p1', 'five_hour'), meter('m2', 'p2', 'seven_day')],
    });
    await toAccounts(scoped);
    await scoped.store.next();
    const row = scoped.store.state().budget.subscriptions[0];
    expect(row?.policyChoices).toEqual(['wait_resume', 'fallback_account', 'switch_pool', 'ask']);
    expect(row?.policy).toBe('wait_resume');
    scoped.store.setPolicy(keyOf('.claude'), 'fallback_account');
    expect(scoped.store.state().budget.subscriptions[0]?.policy).toBe('fallback_account');
    expect(scoped.api.commands).toEqual([]);
    await scoped.store.next();
    expect(scoped.api.commands).toContainEqual(expect.objectContaining({ type: 'account.save', limitPolicy: 'fallback_account' }));
  });

  it('U-42: Bütçe reads a candidate\'s quota with accounts.candidateQuota — a MeterList while it answers, one line while it loads or fails', async () => {
    const bundle = setup([claudeA, endpoint]);
    bundle.api.setQuota({ ok: true, pools: [pool('p1', 'max', 'all')], meters: [meter('m1', 'p1', 'five_hour'), meter('m2', 'p1', 'seven_day')] });
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    await bundle.store.next();
    const asked = bundle.api.queries.filter((query) => query.type === 'accounts.candidateQuota');
    // A compatible endpoint has no provider to ask (A-82): it is never queried.
    expect(asked).toEqual([{ type: 'accounts.candidateQuota', sourcePath: keyOf('.claude') }]);
    const sub = bundle.store.state().budget.subscriptions[0];
    expect(sub?.meters.rows.map((row) => row.name)).toEqual([{ key: 'meterList.window.five_hour' }, { key: 'meterList.window.seven_day' }]);
    expect(sub?.meterEmpty).toBeNull();
    expect(bundle.store.state().budget.payPerUse[0]?.meterEmpty).toBe('meterList.afterAdd');

    const failing = setup([claudeA]);
    await toAccounts(failing);
    await failing.store.next();
    expect(failing.store.state().budget.subscriptions[0]?.meterEmpty).toBe('meterList.afterAdd');

    const none = setup([claudeA]);
    none.api.setQuota({ ok: true, pools: [], meters: [] });
    await toAccounts(none);
    await none.store.next();
    expect(none.store.state().budget.subscriptions[0]?.meterEmpty).toBe('meterList.noMeter');
  });

  it('U-42: a candidate that needs a login says limits appear once it signs in', async () => {
    const login = candidate('machine-login:agy', { kind: 'machine_login', provider: 'agy', routeKind: 'agy' });
    const bundle = setup([claudeA, login]);
    bundle.api.setProviders([claudeProvider, { defId: 'agy', name: 'Antigravity', installUrl: null, binPath: '/usr/bin/agy', version: null, loggedIn: false, optionalFlags: [] }]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('machine-login:agy'));
    await bundle.store.next();
    await bundle.store.next();
    const row = bundle.store.state().budget.subscriptions.find((entry) => entry.id === keyOf('machine-login:agy'));
    expect(row?.meterEmpty).toBe('meterList.needsLogin');
  });

  it('U-44a: a pay-per-use row stores its cap amount and period without granting consent; the gate waits for the consent', async () => {
    const bundle = setup([endpoint]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.setCap(keyOf('.claude-zai'), { amount: 'abc', scope: 'account_week' })).toBe(false);
    expect(bundle.store.setCap(keyOf('.claude-zai'), { amount: '75', scope: 'account_week' })).toBe(true);
    const row = bundle.store.state().budget.payPerUse[0];
    expect(row?.cap).toEqual({ scope: 'account_week', amountUsd: 75, warnPercent: 80 });
    expect(row?.consented).toBe(false);
    expect(bundle.store.state().nextEnabled).toBe(false);
  });

  it('U-44a: a pay-per-use account needs its spend consent with a cap before "Kurulumu bitir" is enabled', async () => {
    const bundle = setup([endpoint]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().nextEnabled).toBe(false);
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: 'abc', scope: 'account_month' })).toBe(false);
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: '0', scope: 'account_month' })).toBe(false);
    expect(bundle.store.state().nextEnabled).toBe(false);
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: '50', scope: 'account_month' })).toBe(true);
    expect(bundle.store.state().nextEnabled).toBe(true);
    bundle.store.revokeSpend(keyOf('.claude-zai'));
    expect(bundle.store.state().nextEnabled).toBe(false);
  });

  it('U-43: the editor window edits a draft — Vazgeç discards it, Kaydet keeps it, and nothing is written before the finish', async () => {
    const bundle = setup([claudeA]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.openEditor(keyOf('.claude'));
    expect(bundle.store.state().editor?.account.label).toBe('claude');
    await bundle.store.editorRun({ type: 'account.save', provider: 'claude', label: 'Kişisel', authMode: 'subscription' });
    expect(bundle.store.state().editor?.account.label).toBe('Kişisel');
    bundle.store.cancelEditor();
    expect(bundle.store.state().editor).toBeNull();
    expect(bundle.store.state().rows[0]?.label).toBe('claude');

    await bundle.store.openEditor(keyOf('.claude'));
    await bundle.store.editorRun({
      type: 'account.save',
      provider: 'claude',
      label: 'Kişisel',
      authMode: 'subscription',
      reserve: { short: 0.2, long: 0.2 },
    });
    bundle.store.saveEditor();
    expect(bundle.store.state().editor).toBeNull();
    expect(bundle.api.commands).toEqual([]);
    expect(bundle.store.state().budget.subscriptions[0]?.label).toBe('Kişisel');
    expect(bundle.store.state().budget.subscriptions[0]?.reserveShort).toBe(0.2);
  });

  it('U-43: the editor\'s Kullanım tab reads the candidate\'s quota, and Yenile reads it again', async () => {
    const bundle = setup([claudeA]);
    bundle.api.setQuota({ ok: true, pools: [pool('p1', 'max', 'all')], meters: [meter('m1', 'p1', 'five_hour')] });
    await toAccounts(bundle);
    await bundle.store.openEditor(keyOf('.claude'));
    expect(bundle.store.state().editor?.account.meters).toHaveLength(1);
    const before = bundle.api.queries.filter((query) => query.type === 'accounts.candidateQuota').length;
    await bundle.store.refreshQuota(keyOf('.claude'));
    expect(bundle.api.queries.filter((query) => query.type === 'accounts.candidateQuota').length).toBe(before + 1);
  });

  it('U-44a: finishing adopts every selected account with its draft, writes caps and consents, binds every role, then leaves for Anasayfa with the ready count', async () => {
    const bundle = setup([claudeA, endpoint]);
    await toAccounts(bundle);
    bundle.store.select(keyOf('.claude-zai'));
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.openEditor(keyOf('.claude'));
    await bundle.store.editorRun({ type: 'account.save', provider: 'claude', label: 'Kişisel', authMode: 'subscription', reserve: { short: 0.2, long: 0.2 } });
    bundle.store.saveEditor();
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: '40', scope: 'account_month' })).toBe(true);

    await bundle.store.next();

    expect(bundle.api.commands).toEqual([
      { type: 'account.adopt', sourcePath: keyOf('.claude'), label: 'Kişisel' },
      { type: 'account.adopt', sourcePath: keyOf('.claude-zai'), label: 'claude-zai', importToken: true },
      { type: 'binding.save', role: 'analyst', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'fast', thinking: { level: 'fast' } },
      { type: 'binding.save', role: 'developer', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'balanced', thinking: { level: 'balanced' } },
      { type: 'binding.save', role: 'planner', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'strong', thinking: { level: 'deep' } },
      { type: 'account.save', id: 'acc-1', provider: 'claude', label: 'Kişisel', authMode: 'subscription', reserve: { short: 0.2, long: 0.2 } },
      { type: 'account.cap.save', id: 'acc-2', scope: 'account_month', amountUsd: 40, warnPercent: 80 },
      { type: 'account.consent.grant', id: 'acc-2', model: '*' },
    ]);
    // No completion moment: the finish is done and the shell is told once (U-49 keeps the window
    // up for its fade; the ack is what leaves).
    expect(bundle.store.state().visible).toBe(true);
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    bundle.store.ackFinish();
    expect(bundle.store.state().finished).toBeNull();
    expect(bundle.store.state().visible).toBe(false);
    // Opening again in the same session does not bring the wizard back.
    await bundle.store.open();
    expect(bundle.store.state().visible).toBe(false);
  });

  it('U-35: a failed finish stays on Bütçe with the U-8 label and a retry does not adopt twice', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    bundle.api.failOn('binding.save', { ok: false, code: 'unknown_role' });
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().visible).toBe(true);
    expect(bundle.store.state().finished).toBeNull();
    expect(bundle.store.state().lastOutcome?.result.ok).toBe(false);
    bundle.api.failOn('binding.save', { ok: true });
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    expect(bundle.api.commands.filter((command) => command.type === 'account.adopt')).toHaveLength(2);
  });

  it("A-86: the finish's settings.accounts read skips the model catalog", async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    // The budget phase reads the stored rows only to apply caps and consents: its query is the
    // one skip read, and nothing after the finish began asks for the billing view.
    const settings = bundle.api.queries.filter((query) => query.type === 'settings.accounts');
    expect(settings.filter((query) => query.catalog === 'skip')).toEqual([{ type: 'settings.accounts', catalog: 'skip' }]);
    expect(settings[settings.length - 1]).toEqual({ type: 'settings.accounts', catalog: 'skip' });
  });

  it('U-35: an account row carries its provider name beside the label derived from the folder', async () => {
    const bundle = setup([claudeB]);
    await bundle.store.open();
    await bundle.store.next();
    const row = bundle.store.state().rows[0];
    expect(row?.providerName).toBe('Claude Code');
    expect(row?.label).toBe('claude-b');
    expect(row?.displayPath).toBe('~/.claude-b');
  });

  it('U-44: an accounts.changed event re-reads the lists and a candidate\'s quota while Bütçe is open', async () => {
    const bundle = setup([claudeA]);
    bundle.api.setQuota({ ok: true, pools: [pool('p1', 'max', 'all')], meters: [meter('m1', 'p1', 'five_hour')] });
    await toAccounts(bundle);
    await bundle.store.next();
    const countOf = (type: Query['type']): number => bundle.api.queries.filter((query) => query.type === type).length;
    const before = [countOf('accounts.candidates'), countOf('accounts.candidateQuota')];
    bundle.api.emit({ type: 'accounts.changed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countOf('accounts.candidates')).toBe((before[0] ?? 0) + 1);
    expect(countOf('accounts.candidateQuota')).toBe((before[1] ?? 0) + 1);
    // Other events change nothing.
    bundle.api.emit({ type: 'workOrders.changed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countOf('accounts.candidates')).toBe((before[0] ?? 0) + 1);
  });

  it('U-44a: the wizard editor offers Genel, Kullanım and Limitler — no Modeller tab', () => {
    expect(WIZARD_EDITOR_TABS).toEqual(['general', 'usage', 'limits']);
  });

  it('U-35: the wizard does not reappear while a project exists', async () => {
    const bundle = setup();
    await bundle.store.open();
    bundle.api.setTree([{ project: 'atolye' }]);
    await bundle.store.open();
    expect(bundle.store.state().visible).toBe(false);
  });

  it('U-48: a budget row carries its reserve percent and the Ayrıntı reserve choice writes both windows through the finish', async () => {
    const bundle = setup([claudeA]);
    await toAccounts(bundle);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().budget.subscriptions[0]?.reservePercent).toBe(0);
    bundle.store.setReserve(keyOf('.claude'), 20);
    expect(bundle.store.state().budget.subscriptions[0]?.reservePercent).toBe(20);
    // "Yok" takes the whole reserve back off the draft.
    bundle.store.setReserve(keyOf('.claude'), null);
    expect(bundle.store.state().budget.subscriptions[0]?.reservePercent).toBe(0);
    bundle.store.setReserve(keyOf('.claude'), 30);
    await bundle.store.next();
    const saves = bundle.api.commands.filter((command): command is Extract<Command, { readonly type: 'account.save' }> => command.type === 'account.save');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.reserve).toEqual({ short: 0.3, long: 0.3 });
  });

  it('U-49: the finish walks its four lines in order — a line takes its check only when its real step completes, never on a fixed delay', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    const walk: string[] = [];
    bundle.store.subscribe(() => {
      const standing = bundle.store.state();
      if (!standing.finishing && standing.finishError === null && standing.finished === null) return;
      const mark = `${standing.finishPhase ?? '-'}${standing.finished !== null ? '+' : standing.finishError !== null ? '!' : ''}`;
      if (walk[walk.length - 1] !== mark) walk.push(mark);
    });
    const held = bundle.api.holdOn('binding.save');
    const finishing = bundle.store.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Both adoptions answered but the first binding is still in flight: the list holds its
    // spinner on "Sıra kaydediliyor" — the check waits for the real reply, not a timer.
    const mid = bundle.store.state();
    expect(mid.finishing).toBe(true);
    expect(mid.finishPhase).toBe('order');
    expect(mid.finished).toBeNull();
    // Geri and the rail are dead while it runs.
    bundle.store.back();
    bundle.store.goTo('accounts');
    expect(bundle.store.state().step).toBe('budget');
    held.resolve();
    await finishing;
    const done = bundle.store.state();
    expect(done.finished).toEqual({ accounts: 2 });
    expect(done.finishPhase).toBe('home');
    expect(walk).toEqual(['accounts', 'order', 'budget', 'home', 'home+']);
  });

  it('U-49: a failing step stops the list on its line with its reason, and a retry finishes without adopting twice', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    bundle.store.setReserve(keyOf('.claude'), 20);
    bundle.api.failOn('account.save', { ok: false, code: 'invalid_reserve' });
    await bundle.store.next();
    const failed = bundle.store.state();
    expect(failed.finishing).toBe(false);
    expect(failed.finishPhase).toBe('budget');
    expect(failed.finishError?.phase).toBe('budget');
    expect(failed.finishError?.reasonKey).toBe('error.invalid_reserve');
    expect(failed.finished).toBeNull();
    expect(failed.lastOutcome?.result.ok).toBe(false);
    // The stop releases Geri again; leaving the step drops the stopped list.
    expect(failed.canBack).toBe(true);
    bundle.store.back();
    expect(bundle.store.state().step).toBe('order');
    expect(bundle.store.state().finishPhase).toBeNull();
    expect(bundle.store.state().finishError).toBeNull();
    // Walk forward to Bütçe again and finish from there.
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    bundle.api.failOn('account.save', { ok: true });
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    expect(bundle.api.commands.filter((command) => command.type === 'account.adopt')).toHaveLength(2);
  });

  it('U-49: retry resumes from the failed phase without adopting twice', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    bundle.api.failOn('binding.save', { ok: false, code: 'unknown_role' });
    await bundle.store.next();
    const stopped = bundle.store.state();
    expect(stopped.finishError?.phase).toBe('order');
    // The accounts phase completed before the order phase failed: both accounts exist by now.
    const adopts = bundle.api.commands.filter((command) => command.type === 'account.adopt');
    expect(adopts).toHaveLength(2);
    const walk: string[] = [];
    bundle.store.subscribe(() => {
      const standing = bundle.store.state();
      if (!standing.finishing && standing.finishError === null && standing.finished === null) return;
      const mark = `${standing.finishPhase ?? '-'}${standing.finished !== null ? '+' : standing.finishError !== null ? '!' : ''}`;
      if (walk[walk.length - 1] !== mark) walk.push(mark);
    });
    bundle.api.failOn('binding.save', { ok: true });
    await bundle.store.next();
    expect(bundle.store.state().finished).toEqual({ accounts: 2 });
    // The retry picks the run up at the failed line: no second adoption, no re-walk of the
    // accounts phase — a duplicate account can never come out of a retry.
    expect(bundle.api.commands.filter((command) => command.type === 'account.adopt')).toHaveLength(2);
    expect(walk).toEqual(['order', 'budget', 'home', 'home+']);
  });

  it('U-49: the finished wizard stays mounted for its fade and leaves only on ackFinish', async () => {
    const bundle = setup([claudeA]);
    await toAccounts(bundle);
    await bundle.store.next();
    await bundle.store.next();
    const done = bundle.store.state();
    expect(done.finished).toEqual({ accounts: 1 });
    expect(done.visible).toBe(true);
    // Nothing on the footer is clickable through the handoff.
    expect(done.nextEnabled).toBe(false);
    bundle.store.ackFinish();
    const left = bundle.store.state();
    expect(left.finished).toBeNull();
    expect(left.visible).toBe(false);
    await bundle.store.open();
    expect(bundle.store.state().visible).toBe(false);
  });
});
