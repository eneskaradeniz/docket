// roles.test.ts — U-33: the Roller section's rules. The pure work-style mapping, the recommended
// style per role with the U-29 diff line, the global chain fan-out (every listed role with its
// complete binding, A-49), a role's own chain, consent-gated model pins, kademe and düşünme, the
// read-only stages and the same-provider review line. Api and change signal are fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { AccountModelsView, Query, RoleListItem, SettingsAccountsView, SettingsBindingView } from '../../api/queries';

import { createRolesStore, effortOptions, selectableModels, styleSettings, workStyle } from './roles';

type BindingSave = Extract<Command, { readonly type: 'binding.save' }>;

const account = (id: string, provider: string): SettingsAccountsView['accounts'][number] => ({
  id,
  provider,
  label: id,
  authMode: 'subscription',
  plan: null,
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  pools: [],
  meters: [],
});

const binding = (role: string, ids: readonly string[], extra: Partial<SettingsBindingView> = {}): SettingsBindingView => ({
  scope: { level: 'global' },
  role,
  thinking: null,
  tier: null,
  accounts: ids.map((accountId) => ({ accountId, model: null })),
  ...extra,
});

const role = (id: string, name: string, stages: RoleListItem['stages'] = []): RoleListItem => ({ id, name, stages });

const ROLES: readonly RoleListItem[] = [
  role('developer', 'Geliştirici'),
  role('planner', 'Planlayıcı'),
  role('reviewer', 'Gözden geçirici', [
    {
      flow: 'feature',
      flowName: 'Özellik',
      stage: 'review',
      stageName: 'Gözden geçirme',
      tier: 'strong',
      thinking: { effort: 'high' },
      reviewOf: 'developer',
      sameProviderReview: true,
    },
  ]),
];

const BINDINGS: readonly SettingsBindingView[] = [
  binding('developer', ['a1', 'a2'], { tier: 'balanced', thinking: { level: 'balanced' } }),
  binding('planner', ['a1', 'a2'], { tier: 'strong', thinking: { level: 'deep' } }),
  binding('reviewer', ['a1', 'a2'], { tier: 'fast', thinking: { effort: 'high' } }),
];

const MODELS: Readonly<Record<string, AccountModelsView>> = {
  a1: {
    models: [
      { id: 'atlas-max', thinking: { kind: 'levels', levels: ['low', 'high'] }, billing: 'included', source: 'live', stale: false, autoClassified: false, consented: false },
      { id: 'atlas-paid', thinking: { kind: 'none' }, billing: 'metered', source: 'live', stale: false, autoClassified: false, consented: false },
      { id: 'atlas-fog', thinking: { kind: 'unknown' }, billing: 'unknown', source: 'live', stale: false, autoClassified: false, consented: true },
    ],
    defaultConsented: false,
    defaultBilling: 'included',
  },
  a2: { models: [], defaultConsented: false, defaultBilling: 'included' },
};

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  setBindings(next: readonly SettingsBindingView[]): void;
  setCommandResult(code: string | null): void;
}

const fake = (bindings: readonly SettingsBindingView[] = BINDINGS): Fake => {
  const commands: Command[] = [];
  let current = bindings;
  let failure: string | null = null;
  return {
    commands,
    setBindings: (next) => {
      current = next;
    },
    setCommandResult: (code) => {
      failure = code;
    },
    query: (query: Query) => {
      if (query.type === 'roles.list') return Promise.resolve(ROLES);
      if (query.type === 'settings.accounts') {
        const view: SettingsAccountsView = { accounts: [account('a1', 'atlas'), account('a2', 'borea')], bindings: current };
        return Promise.resolve(view);
      }
      if (query.type === 'account.models') return Promise.resolve(MODELS[query.accountId]);
      return Promise.resolve({ ok: false, code: 'not_found' });
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(failure === null ? ({ ok: true } as const) : ({ ok: false, code: failure } as const));
    },
  };
};

const makeStore = (api: Fake, clock: { now: number } = { now: 0 }) =>
  createRolesStore({ api, changes: () => () => undefined, actor: { kind: 'user' } as never, now: () => clock.now });

const saves = (api: Fake): BindingSave[] => api.commands.filter((c): c is BindingSave => c.type === 'binding.save');

describe('U-33: work style', () => {
  it('U-33: workStyle maps fast/fast, balanced/balanced and strong/deep to the three styles', () => {
    expect(workStyle('fast', { level: 'fast' })).toBe('fast');
    expect(workStyle('balanced', { level: 'balanced' })).toBe('balanced');
    expect(workStyle('strong', { level: 'deep' })).toBe('careful');
  });

  it('U-33: every other pair, an exact effort or a missing half reads Özel', () => {
    expect(workStyle('strong', { level: 'fast' })).toBe('custom');
    expect(workStyle('fast', { effort: 'high' })).toBe('custom');
    expect(workStyle('balanced', null)).toBe('custom');
    expect(workStyle(null, { level: 'deep' })).toBe('custom');
  });

  it('U-33: styleSettings maps a style back to its { tier, thinking } pair, round-tripping workStyle', () => {
    expect(styleSettings('careful')).toEqual({ tier: 'strong', thinking: { level: 'deep' } });
    for (const style of ['fast', 'balanced', 'careful'] as const) {
      const pair = styleSettings(style);
      expect(workStyle(pair.tier, pair.thinking)).toBe(style);
    }
  });
});

describe('U-33: rows and the recommendation', () => {
  it('U-33: each row carries its current style, the recommended style and the diff against it', async () => {
    const store = makeStore(fake());
    await store.load();
    const rows = store.state().rows ?? [];
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.developer).toMatchObject({ style: 'balanced', recommended: 'balanced', differs: false });
    expect(byId.planner).toMatchObject({ style: 'careful', recommended: 'careful', differs: false });
    expect(byId.reviewer).toMatchObject({ style: 'custom', recommended: 'careful', differs: true });
  });

  it('U-33: reset ("Önerilene dön") saves the recommended style with the rest of the binding intact', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.resetStyle('reviewer');
    expect(saves(api)).toEqual([
      { type: 'binding.save', role: 'reviewer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], tier: 'strong', thinking: { level: 'deep' } },
    ]);
  });

  it('U-33: choosing a style saves tier and thinking together and sends the stored chain', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.setStyle('developer', 'fast');
    expect(saves(api)).toEqual([
      { type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], tier: 'fast', thinking: { level: 'fast' } },
    ]);
  });
});

describe('U-33: Asistan sırası', () => {
  it('U-33: moving an account down saves EVERY listed role with its complete binding', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    expect(store.state().globalChain).toEqual(['a1', 'a2']);
    await store.moveGlobal(0, 1);
    expect(saves(api)).toEqual([
      { type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a2' }, { accountId: 'a1' }], tier: 'balanced', thinking: { level: 'balanced' } },
      { type: 'binding.save', role: 'planner', accounts: [{ accountId: 'a2' }, { accountId: 'a1' }], tier: 'strong', thinking: { level: 'deep' } },
      { type: 'binding.save', role: 'reviewer', accounts: [{ accountId: 'a2' }, { accountId: 'a1' }], tier: 'fast', thinking: { effort: 'high' } },
    ]);
  });

  it('U-33: a role with its own chain keeps it (model pin included) while the others follow the move', async () => {
    const own = binding('planner', ['a2'], { tier: 'strong', thinking: { level: 'deep' }, accounts: [{ accountId: 'a2', model: 'atlas-x' }] });
    const api = fake([BINDINGS[0] as SettingsBindingView, own, BINDINGS[2] as SettingsBindingView]);
    const store = makeStore(api);
    await store.load();
    await store.moveGlobal(0, 1);
    const planner = saves(api).find((c) => c.role === 'planner');
    expect(planner?.accounts).toEqual([{ accountId: 'a2', model: 'atlas-x' }]);
    expect(saves(api)).toHaveLength(3);
  });

  it('U-33: a role without a stored binding gets the new global chain and nothing invented', async () => {
    const api = fake([BINDINGS[0] as SettingsBindingView, BINDINGS[2] as SettingsBindingView]);
    const store = makeStore(api);
    await store.load();
    await store.moveGlobal(0, 1);
    expect(saves(api).find((c) => c.role === 'planner')).toEqual({ type: 'binding.save', role: 'planner', accounts: [{ accountId: 'a2' }, { accountId: 'a1' }] });
  });

  it('U-33: a move past either end issues nothing', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.moveGlobal(0, -1);
    await store.moveGlobal(1, 1);
    expect(api.commands).toEqual([]);
  });

  it('U-33: a saved chain shows "Kaydedildi" for 1.5 s', async () => {
    const clock = { now: 1000 };
    const store = makeStore(fake(), clock);
    await store.load();
    await store.moveGlobal(0, 1);
    expect(store.isSaved('chain')).toBe(true);
    clock.now = 2501;
    expect(store.isSaved('chain')).toBe(false);
  });
});

describe('U-33: a role\'s own chain', () => {
  it('U-33: Bu role özel changes nothing stored; Tüm roller saves the global chain without pins', async () => {
    const pinned = binding('reviewer', ['a1', 'a2'], { accounts: [{ accountId: 'a1', model: 'atlas-max' }, { accountId: 'a2', model: null }] });
    const api = fake([BINDINGS[0] as SettingsBindingView, pinned]);
    const store = makeStore(api);
    await store.load();
    const reviewer = () => store.state().rows?.find((row) => row.id === 'reviewer');
    expect(reviewer()?.chainMode).toBe('own');
    await store.setChainMode('reviewer', 'all');
    expect(saves(api)).toEqual([{ type: 'binding.save', role: 'reviewer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }] }]);
    api.commands.length = 0;
    await store.setChainMode('developer', 'own');
    expect(api.commands).toEqual([]);
    expect(store.state().rows?.find((row) => row.id === 'developer')?.chainMode).toBe('own');
  });

  it('U-33: toggling an account in an own chain saves the new chain; emptying it surfaces empty_chain (U-8)', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.toggleAccount('developer', 'a2');
    expect(saves(api)[0]?.accounts).toEqual([{ accountId: 'a1' }]);
    api.setBindings([binding('developer', ['a1'])]);
    await store.load();
    api.setCommandResult('empty_chain');
    await store.toggleAccount('developer', 'a1');
    expect(saves(api)[1]?.accounts).toEqual([]);
    expect(store.state().failure).toEqual({ row: 'developer', labelKey: 'error.empty_chain' });
  });

  it('U-33: a failure clears on the next success', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    api.setCommandResult('empty_chain');
    await store.setStyle('developer', 'fast');
    expect(store.state().failure).not.toBeNull();
    api.setCommandResult(null);
    await store.setStyle('developer', 'fast');
    expect(store.state().failure).toBeNull();
  });
});

describe('U-33: model pins and consent', () => {
  it('U-33: only included or consented models are selectable', () => {
    const ids = selectableModels(MODELS.a1 as AccountModelsView).map((model) => model.id);
    expect(ids).toEqual(['atlas-max', 'atlas-fog']);
  });

  it('U-33: a pin on an included or consented model saves with the chain; an unconsented $ model issues nothing', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.loadModels('a1');
    await store.pinModel('developer', 'a1', 'atlas-paid');
    expect(api.commands).toEqual([]);
    await store.pinModel('developer', 'a1', 'atlas-fog');
    expect(saves(api)[0]?.accounts).toEqual([{ accountId: 'a1', model: 'atlas-fog' }, { accountId: 'a2' }]);
    await store.pinModel('developer', 'a1', null);
    expect(saves(api)[1]?.accounts).toEqual([{ accountId: 'a1' }, { accountId: 'a2' }]);
  });

  it('U-33: exact efforts come from the levels the chain\'s models declare', async () => {
    const options = effortOptions(MODELS.a1?.models ?? []);
    expect(options).toEqual(['low', 'high']);
  });
});

describe('U-33: kademe and düşünme', () => {
  it('U-33: kademe and thinking save the whole binding with only that field changed', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.setTier('developer', 'strong');
    expect(saves(api)[0]).toEqual({ type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], tier: 'strong', thinking: { level: 'balanced' } });
    await store.setThinking('developer', { effort: 'low' });
    expect(saves(api)[1]).toEqual({ type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], tier: 'balanced', thinking: { effort: 'low' } });
  });

  it('U-33: clearing kademe or thinking leaves the field out (A-49 replaces the binding)', async () => {
    const api = fake();
    const store = makeStore(api);
    await store.load();
    await store.setTier('developer', null);
    expect(saves(api)[0]).toEqual({ type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], thinking: { level: 'balanced' } });
  });
});

describe('U-33: stages and the review line', () => {
  it('U-33: a role lists its own-setting stages read-only, with the flow name', async () => {
    const store = makeStore(fake());
    await store.load();
    const reviewer = store.state().rows?.find((row) => row.id === 'reviewer');
    expect(reviewer?.stages).toEqual([
      { flowName: 'Özellik', stageName: 'Gözden geçirme', tier: 'strong', thinking: { effort: 'high' } },
    ]);
    expect(store.state().rows?.find((row) => row.id === 'developer')?.stages).toEqual([]);
  });

  it('U-33: sameProviderReview puts the amber line on the role whose stage sets it, and only there', async () => {
    const store = makeStore(fake());
    await store.load();
    const flags = Object.fromEntries((store.state().rows ?? []).map((row) => [row.id, row.sameProviderReview]));
    expect(flags).toEqual({ developer: false, planner: false, reviewer: true });
  });
});

describe('U-33: unset styles and the apply-all line', () => {
  const unsetBindings: readonly SettingsBindingView[] = [
    binding('developer', ['a1', 'a2']),
    binding('planner', ['a1'], { tier: null, thinking: null }),
    binding('reviewer', ['a1', 'a2'], { tier: 'fast', thinking: { effort: 'high' } }),
  ];

  it('U-33: workStyle of neither tier nor thinking is unset, not custom', () => {
    expect(workStyle(null, null)).toBe('unset');
    expect(workStyle('balanced', null)).toBe('custom');
  });

  it('U-29: a role with nothing stored has no difference and its disclosure stays closed', async () => {
    const store = makeStore(fake(unsetBindings));
    await store.load();
    const rows = store.state().rows ?? [];
    expect(rows.find((row) => row.id === 'developer')).toMatchObject({ style: 'unset', differs: false });
    expect(rows.find((row) => row.id === 'reviewer')).toMatchObject({ style: 'custom', differs: true });
  });

  it('U-29: an explicit style differing from its recommendation keeps the diff', async () => {
    const store = makeStore(fake([binding('developer', ['a1', 'a2'], { tier: 'fast', thinking: { level: 'fast' } })]));
    await store.load();
    const developer = (store.state().rows ?? []).find((row) => row.id === 'developer');
    expect(developer).toMatchObject({ style: 'fast', differs: true });
  });

  it('U-33: the unset count counts roles with neither tier nor thinking and is 0 once all are set', async () => {
    const store = makeStore(fake(unsetBindings));
    await store.load();
    expect(store.state().unsetCount).toBe(2);
    const settled = makeStore(fake());
    await settled.load();
    expect(settled.state().unsetCount).toBe(0);
  });

  it('U-33: apply-recommended saves the recommended style for exactly the unset roles with complete bindings (A-49)', async () => {
    const api = fake([
      binding('developer', ['a1', 'a2']),
      binding('planner', ['a1'], { accounts: [{ accountId: 'a1', model: 'atlas-max' }] }),
      binding('reviewer', ['a1', 'a2'], { tier: 'fast', thinking: { effort: 'high' } }),
    ]);
    const store = makeStore(api);
    await store.load();
    await store.applyRecommended();
    expect(saves(api)).toEqual([
      { type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }, { accountId: 'a2' }], tier: 'balanced', thinking: { level: 'balanced' } },
      { type: 'binding.save', role: 'planner', accounts: [{ accountId: 'a1', model: 'atlas-max' }], tier: 'strong', thinking: { level: 'deep' } },
    ]);
  });
});
