// wizard.test.ts — U-35: the setup wizard's step machine. The api is a scripted fake that records
// every command, so the finish fan-out is asserted payload by payload.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, SettingsAccountView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { createWizardStore, type WizardStore } from './wizard';

const userActor: Actor = { kind: 'user', id: 'user-1' };

const candidate = (path: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourcePath: `/h/${path}`,
  displayPath: `~/${path}`,
  kind: 'subscription',
  routeKind: 'anthropic',
  provider: 'claude',
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

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  readonly queries: Query[];
  setTree(reply: unknown): void;
  setCandidates(facts: readonly Record<string, unknown>[]): void;
  setAccounts(accounts: readonly SettingsAccountView[]): void;
  failOn(type: Command['type'], result: CommandResult): void;
}

const fakeApi = (): Fake => {
  const commands: Command[] = [];
  const queries: Query[] = [];
  let tree: unknown = [];
  let facts: readonly Record<string, unknown>[] = [claudeA];
  let accounts: SettingsAccountView[] = [];
  const failures = new Map<string, CommandResult>();
  let adopted = 0;
  return {
    commands,
    queries,
    setTree: (reply) => {
      tree = reply;
    },
    setCandidates: (next) => {
      facts = next;
    },
    setAccounts: (next) => {
      accounts = [...next];
    },
    failOn: (type, result) => failures.set(type, result),
    query: (query) => {
      queries.push(query);
      switch (query.type) {
        case 'project.tree':
          return Promise.resolve(tree);
        case 'accounts.candidates':
          return Promise.resolve(facts);
        case 'providers.discovered':
          return Promise.resolve([
            { defId: 'claude', name: 'Claude Code', installUrl: null, binPath: '/usr/bin/claude', version: null, loggedIn: true, optionalFlags: [] },
          ]);
        case 'settings.accounts':
          return Promise.resolve({ accounts, bindings: [] });
        case 'roles.list':
          return Promise.resolve(roles);
        default:
          return Promise.resolve([]);
      }
    },
    command: (_actor, command) => {
      commands.push(command);
      const failure = failures.get(command.type);
      if (failure !== undefined) return Promise.resolve(failure);
      if (command.type === 'project.attach') return Promise.resolve({ ok: true, id: 'atolye' });
      if (command.type === 'account.adopt') {
        adopted += 1;
        const id = `acc-${adopted}`;
        const isEndpoint = command.sourcePath.includes('zai');
        accounts.push(accountView(id, command.label, isEndpoint ? 'api_key' : 'subscription'));
        return Promise.resolve({ ok: true, id });
      }
      return Promise.resolve({ ok: true });
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
  const store = createWizardStore({ api, actor: userActor });
  return { api, store };
};

const keyOf = (path: string): string => `/h/${path}`;

/** Opens the wizard and walks Hoş geldin → Hesaplar with the given paths selected. */
const toAccounts = async (bundle: Setup, selected: readonly string[]): Promise<void> => {
  await bundle.store.open();
  await bundle.store.next();
  for (const path of selected) bundle.store.select(keyOf(path));
};

const railOf = (store: WizardStore): readonly string[] =>
  store.state().rail.map((entry) => `${entry.step}:${entry.standing}`);

describe('wizard store (U-35)', () => {
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

  it('U-35: the steps run Hoş geldin → Hesaplar → Yetenekler → Asistan sırası → Bütçe; Yetenekler is skipped while no capability source is composed and Asistan sırası under two accounts', async () => {
    const one = setup([claudeA, claudeB]);
    await toAccounts(one, ['.claude']);
    expect(railOf(one.store)).toEqual([
      'welcome:done',
      'accounts:cur',
      'capabilities:skipped',
      'order:skipped',
      'budget:todo',
    ]);
    await one.store.next();
    expect(one.store.state().step).toBe('budget');

    const two = setup([claudeA, claudeB]);
    await toAccounts(two, ['.claude', '.claude-b']);
    expect(two.store.state().rail.find((entry) => entry.step === 'order')?.standing).toBe('todo');
    await two.store.next();
    expect(two.store.state().step).toBe('order');
    await two.store.next();
    expect(two.store.state().step).toBe('budget');
  });

  it('U-35: Yetenekler shows when a source holds capabilities, and the summary counts the selected ones', async () => {
    const api = fakeApi();
    const store = createWizardStore({
      api,
      actor: userActor,
      capabilities: [
        { id: 'mcp:fs', name: 'fs', kind: 'MCP' },
        { id: 'skill:lint', name: 'lint', kind: 'Skill' },
      ],
    });
    await store.open();
    await store.next();
    store.select(keyOf('.claude'));
    await store.next();
    expect(store.state().step).toBe('capabilities');
    store.toggleCapability('skill:lint');
    expect(store.state().capabilities.filter((entry) => entry.selected)).toHaveLength(1);
    await store.next();
    expect(store.state().step).toBe('budget');
    await store.next();
    expect(store.state().summary?.capabilities).toBe(1);
  });

  it('U-35: Hesaplar is gated on one ready selected account; a token candidate stays "Anahtar gerekli" until the key-move switch is on; unreadable rows cannot be selected', async () => {
    const bundle = setup([endpoint, unreadable, claudeA]);
    await bundle.store.open();
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('accounts');
    expect(bundle.store.state().nextEnabled).toBe(false);

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
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('accounts');
  });

  it('U-35: an account added earlier is listed already selected, so a wizard re-run is never stuck behind an empty list', async () => {
    const bundle = setup([]);
    bundle.api.setAccounts([accountView('acc-9', 'Eski hesap', 'subscription')]);
    await bundle.store.open();
    await bundle.store.next();
    expect(bundle.store.state().rows.map((row) => [row.id, row.selected])).toEqual([['acc-9', true]]);
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

  it('U-35: "Bu adımı atla" is offered on the steps with a default and never on a gate', async () => {
    const bundle = setup([claudeA, claudeB]);
    await bundle.store.open();
    expect(bundle.store.state().canSkip).toBe(true);
    await bundle.store.skip();
    expect(bundle.store.state().step).toBe('accounts');
    expect(bundle.store.state().canSkip).toBe(false);
    await bundle.store.skip();
    expect(bundle.store.state().step).toBe('accounts');
    bundle.store.select(keyOf('.claude'));
    bundle.store.select(keyOf('.claude-b'));
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('order');
    expect(bundle.store.state().canSkip).toBe(true);
    await bundle.store.skip();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().canSkip).toBe(false);
  });

  it('U-35: Asistan sırası orders the chain with up/down and the order drives the finish chain', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle, ['.claude', '.claude-b']);
    await bundle.store.next();
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
    bundle.store.moveDown(keyOf('.claude'));
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude-b'), keyOf('.claude')]);
    bundle.store.moveUp(keyOf('.claude'));
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude'), keyOf('.claude-b')]);
    bundle.store.moveUp(keyOf('.claude'));
    expect(bundle.store.state().order[0]?.id).toBe(keyOf('.claude'));
    bundle.store.moveUp(keyOf('.claude-b'));
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
    await toAccounts(bundle, ['.claude', '.claude-zai']);
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    bundle.store.moveDown(keyOf('.claude'));
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.allowSpend(keyOf('.claude-zai'), { amount: '40', scope: 'account_month' })).toBe(true);
    bundle.store.back();
    bundle.store.back();
    bundle.store.back();
    expect(bundle.store.state().step).toBe('welcome');
    expect(bundle.store.state().rows.filter((row) => row.selected).map((row) => row.id)).toEqual([
      keyOf('.claude'),
      keyOf('.claude-zai'),
    ]);
    expect(bundle.store.state().rows.find((row) => row.id === keyOf('.claude-zai'))?.importToken).toBe(true);
    expect(bundle.store.state().order.map((entry) => entry.id)).toEqual([keyOf('.claude-zai'), keyOf('.claude')]);
    await bundle.store.next();
    await bundle.store.next();
    await bundle.store.next();
    const spend = bundle.store.state().budget.payPerUse[0];
    expect(spend?.consented).toBe(true);
    expect(spend?.cap?.amountUsd).toBe(40);
  });

  it('U-35: Bütçe lists the selected accounts as Abonelikler and Kullandıkça öde, with the U-29 difference count per row', async () => {
    const bundle = setup([claudeA, endpoint]);
    await toAccounts(bundle, ['.claude', '.claude-zai']);
    bundle.store.setImportToken(keyOf('.claude-zai'), true);
    await bundle.store.next();
    await bundle.store.next();
    const { subscriptions, payPerUse } = bundle.store.state().budget;
    expect(subscriptions.map((row) => row.id)).toEqual([keyOf('.claude')]);
    expect(payPerUse.map((row) => row.id)).toEqual([keyOf('.claude-zai')]);
    expect(subscriptions[0]?.diffCount).toBe(0);
    expect(payPerUse[0]?.needsConsent).toBe(true);
    expect(payPerUse[0]?.cap).toBeNull();

    await bundle.store.openEditor(keyOf('.claude'));
    await bundle.store.editorRun({ type: 'account.save', provider: 'claude', label: 'claude', authMode: 'subscription', limitPolicy: 'ask' });
    bundle.store.saveEditor();
    expect(bundle.store.state().budget.subscriptions[0]?.diffCount).toBe(1);
  });

  it('U-35: a pay-per-use account needs its spend consent with a cap before "Kurulumu bitir" is enabled', async () => {
    const bundle = setup([endpoint]);
    await toAccounts(bundle, ['.claude-zai']);
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

  it('U-35: the editor window edits a draft — Vazgeç discards it, Kaydet keeps it, and nothing is written before the finish', async () => {
    const bundle = setup([claudeA]);
    await toAccounts(bundle, ['.claude']);
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

  it('U-35: finishing adopts every selected account with its draft, writes caps and consents, then binds every role with the chain and the recommended work style', async () => {
    const bundle = setup([claudeA, endpoint]);
    await toAccounts(bundle, ['.claude', '.claude-zai']);
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
      { type: 'account.save', id: 'acc-1', provider: 'claude', label: 'Kişisel', authMode: 'subscription', reserve: { short: 0.2, long: 0.2 } },
      { type: 'account.cap.save', id: 'acc-2', scope: 'account_month', amountUsd: 40, warnPercent: 80 },
      { type: 'account.consent.grant', id: 'acc-2', model: '*' },
      { type: 'binding.save', role: 'analyst', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'fast', thinking: { level: 'fast' } },
      { type: 'binding.save', role: 'developer', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'balanced', thinking: { level: 'balanced' } },
      { type: 'binding.save', role: 'planner', accounts: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }], tier: 'strong', thinking: { level: 'deep' } },
    ]);
    expect(bundle.store.state().step).toBe('done');
    expect(railOf(bundle.store)).toEqual([
      'welcome:done',
      'accounts:done',
      'capabilities:skipped',
      'order:done',
      'budget:done',
    ]);
    expect(bundle.store.state().summary).toEqual({ accounts: 2, capabilities: 0, firstLabel: 'Kişisel' });
  });

  it('U-35: a failed finish stays on Bütçe with the U-8 label and a retry does not adopt twice', async () => {
    const bundle = setup([claudeA, claudeB]);
    await toAccounts(bundle, ['.claude', '.claude-b']);
    await bundle.store.next();
    await bundle.store.next();
    bundle.api.failOn('binding.save', { ok: false, code: 'unknown_role' });
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('budget');
    expect(bundle.store.state().lastOutcome?.result.ok).toBe(false);
    bundle.api.failOn('binding.save', { ok: true });
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('done');
    expect(bundle.api.commands.filter((command) => command.type === 'account.adopt')).toHaveLength(2);
  });

  it('U-35: an account row carries its provider name beside the label derived from the folder', async () => {
    const bundle = setup([claudeB]);
    await bundle.store.open();
    await bundle.store.next();
    const row = bundle.store.state().rows[0];
    expect(row?.providerName).toBe('Claude Code');
    expect(row?.label).toBe('claude-b');
  });

  it('U-35: "Proje bağla" opens an inline form; Bağla issues project.attach and a single-repo project opens its board, a multi-repo one its roadmap', async () => {
    const single = setup();
    await toAccounts(single, ['.claude']);
    await single.store.next();
    await single.store.next();
    expect(single.store.state().step).toBe('done');
    single.store.attachProject();
    expect(single.store.state().attach.open).toBe(true);
    single.store.setAttachPath('   ');
    await single.store.submitAttach();
    expect(single.api.commands.some((command) => command.type === 'project.attach')).toBe(false);
    single.store.setAttachPath('/work/atolye');
    single.api.setTree([{ project: 'atolye', mainRepo: 'atolye-api', repos: [{ repo: 'atolye-api' }] }]);
    await single.store.submitAttach();
    expect(single.api.commands.at(-1)).toEqual({ type: 'project.attach', path: '/work/atolye' });
    expect(single.store.state().visible).toBe(false);
    expect(single.store.state().opened).toEqual({ kind: 'board', repo: 'atolye-api' });

    const multi = setup();
    await toAccounts(multi, ['.claude']);
    await multi.store.next();
    await multi.store.next();
    multi.store.attachProject();
    multi.store.setAttachPath('/work/atolye');
    multi.api.setTree([{ project: 'atolye', mainRepo: 'a', repos: [{ repo: 'a' }, { repo: 'b' }] }]);
    await multi.store.submitAttach();
    expect(multi.store.state().opened).toEqual({ kind: 'roadmap', project: 'atolye' });
  });

  it('U-35: a successful project.attach reloads the project tree once before the wizard leaves', async () => {
    const api = fakeApi();
    api.setCandidates([claudeA]);
    const seen: boolean[] = [];
    let reloads = 0;
    const holder: { store: WizardStore | null } = { store: null };
    const store = createWizardStore({
      api,
      actor: userActor,
      reloadTree: () => {
        reloads += 1;
        seen.push(holder.store?.state().visible ?? false);
        return Promise.resolve();
      },
    });
    holder.store = store;
    await toAccounts({ api, store }, ['.claude']);
    await store.next();
    await store.next();
    store.attachProject();
    store.setAttachPath('/nope');
    api.failOn('project.attach', { ok: false, code: 'not_a_repo' });
    await store.submitAttach();
    expect(reloads).toBe(0);
    api.failOn('project.attach', { ok: true });
    api.setTree([{ project: 'atolye', mainRepo: 'a', repos: [{ repo: 'a' }] }]);
    await store.submitAttach();
    expect(reloads).toBe(1);
    expect(seen).toEqual([true]);
    expect(store.state().visible).toBe(false);
  });

  it('U-40: "Yeni proje oluştur" in the inline attach form leaves the wizard for the Yeni proje page; Vazgeç there returns to the moment with the form intact', async () => {
    const bundle = setup();
    await toAccounts(bundle, ['.claude']);
    await bundle.store.next();
    bundle.store.createProject();
    // Only the finished setup offers it.
    expect(bundle.store.state().opened).toBeNull();
    expect(bundle.store.resume()).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('done');
    bundle.store.attachProject();
    bundle.store.setAttachPath('/work/atolye');
    const before = bundle.api.commands.length;
    bundle.store.createProject();
    expect(bundle.store.state().opened).toEqual({ kind: 'newProject' });
    expect(bundle.store.state().visible).toBe(false);
    expect(bundle.api.commands.length).toBe(before);

    expect(bundle.store.resume()).toBe(true);
    const back = bundle.store.state();
    expect(back.visible).toBe(true);
    expect(back.opened).toBeNull();
    expect(back.step).toBe('done');
    expect(back.attach.open).toBe(true);
    expect(back.attach.path).toBe('/work/atolye');
    expect(bundle.store.resume()).toBe(false);
  });

  it('U-40: once the Yeni proje page ends in a project the wizard does not come back', async () => {
    const bundle = setup();
    await toAccounts(bundle, ['.claude']);
    await bundle.store.next();
    await bundle.store.next();
    bundle.store.attachProject();
    bundle.store.createProject();
    bundle.store.leave();
    expect(bundle.store.resume()).toBe(false);
    expect(bundle.store.state().visible).toBe(false);
  });

  it('U-35: a failed project.attach shows its U-8 label under the field and keeps the wizard open', async () => {
    const bundle = setup();
    await toAccounts(bundle, ['.claude']);
    await bundle.store.next();
    await bundle.store.next();
    bundle.store.attachProject();
    bundle.store.setAttachPath('/nope');
    bundle.api.failOn('project.attach', { ok: false, code: 'not_found' });
    await bundle.store.submitAttach();
    expect(bundle.store.state().attach.failureKey).toBe('error.not_found');
    expect(bundle.store.state().visible).toBe(true);
    expect(bundle.store.state().opened).toBeNull();
    bundle.store.cancelAttach();
    expect(bundle.store.state().attach.open).toBe(false);
  });

  it('U-35: the wizard does not reappear while a project exists', async () => {
    const bundle = setup();
    await bundle.store.open();
    bundle.api.setTree([{ project: 'atolye' }]);
    await bundle.store.open();
    expect(bundle.store.state().visible).toBe(false);
  });
});
