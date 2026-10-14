// stores/roles.ts — the Roller section's rules (U-33) as data and pure helpers. `roles.list`
// (A-50) and the stored global bindings (`settings.accounts`, A-49) become one row per role: its
// work style (a presentation preset over { tier, thinking }; any other pair reads "Özel"), the
// recommended style with the U-29 diff, its chain and whether that chain is the shared one, the
// stages that set their own tier or thinking (read-only) and the same-provider review flag. The
// "Asistan sırası" chain is the one most roles share; reordering it saves EVERY listed role with
// its complete binding, because `binding.save` replaces the whole binding (A-49) — a field left
// out would be cleared. A role with its own chain keeps it. Model pins on `$`/`?` models open
// only after consent. Failures map through U-8; time is injected.
import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type {
  AccountModelsView,
  ModelView,
  Query,
  RoleListItem,
  SettingsAccountsView,
  SettingsBindingView,
} from '../../api/queries';
import { mostSharedChain, type Actor, type RemovalVerdict } from '../../domain/index';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import { SAVED_FLAG_MS } from './account-editor';
import { recommendedWorkStyle, type WorkStyle } from './recommended';
import { commandResultKey, isQueryFailure } from './results';

/** The built-in chat role whose binding follows the shared order. */
export const ASSISTANT_ROLE = 'assistant';

export type Tier = 'strong' | 'balanced' | 'fast';
export type Thinking = { readonly level: string } | { readonly effort: string };
/** `unset`: neither tier nor thinking stored; `custom`: a stored pair matching none of the styles. */
export type RoleWorkStyle = WorkStyle | 'custom' | 'unset';

export const WORK_STYLES: readonly WorkStyle[] = ['fast', 'balanced', 'careful'];
export const TIERS: readonly Tier[] = ['fast', 'balanced', 'strong'];
export const THINKING_LEVELS: readonly string[] = ['fast', 'balanced', 'deep'];

const STYLE_PAIRS: Readonly<Record<WorkStyle, { readonly tier: Tier; readonly thinking: { readonly level: string } }>> = {
  fast: { tier: 'fast', thinking: { level: 'fast' } },
  balanced: { tier: 'balanced', thinking: { level: 'balanced' } },
  careful: { tier: 'strong', thinking: { level: 'deep' } },
};

/** The preset a stored pair stands for, `unset` when nothing is stored, `custom` ("Özel") for any other pair. Pure. */
export const workStyle = (tier: Tier | null, thinking: Thinking | null): RoleWorkStyle => {
  if (tier === null && thinking === null) return 'unset';
  if (tier === null || thinking === null || !('level' in thinking)) return 'custom';
  for (const style of WORK_STYLES) {
    const pair = STYLE_PAIRS[style];
    if (pair.tier === tier && pair.thinking.level === thinking.level) return style;
  }
  return 'custom';
};

/** The pair a preset writes. */
export const styleSettings = (style: WorkStyle): { readonly tier: Tier; readonly thinking: { readonly level: string } } =>
  STYLE_PAIRS[style];

/** A model a role may be pinned to: included in the plan, or consented (U-32). */
export const selectableModels = (view: AccountModelsView): readonly ModelView[] =>
  view.models.filter((model) => model.billing === 'included' || model.consented);

/** The exact efforts the given models declare, in first-seen order. */
export const effortOptions = (models: readonly ModelView[]): readonly string[] => {
  const seen: string[] = [];
  for (const model of models) {
    if (model.thinking.kind !== 'levels') continue;
    for (const level of model.thinking.levels) if (!seen.includes(level)) seen.push(level);
  }
  return seen;
};

export interface StyleChoice {
  readonly style: WorkStyle;
  /** The role's recommended style carries the "Önerilen" tag in the Listbox (U-33). */
  readonly recommended: boolean;
}

/** The work-style Listbox of a role row (U-43): Hızlı · Dengeli · Özenli, the recommended one tagged. */
export const styleChoices = (row: Pick<RoleRow, 'recommended'>): readonly StyleChoice[] =>
  WORK_STYLES.map((style) => ({ style, recommended: style === row.recommended }));

/** What the Listbox button reads for a role: a preset's own name; "Özel" for any other pair; and a
 *  role with neither tier nor thinking set shows no selection. */
export const styleStanding = (style: RoleWorkStyle): WorkStyle | 'custom' | null => (style === 'unset' ? null : style);

export interface ChainEntry {
  readonly accountId: string;
  readonly model: string | null;
}

export interface StageView {
  readonly flowName: string;
  readonly stageName: string;
  readonly tier: Tier | null;
  readonly thinking: Thinking | null;
}

export interface DefinitionVersionView {
  readonly version: number;
  readonly recordedAt: number;
  readonly archived: boolean;
}

/** The roles.list wire carries pre-evaluated removal and version fields (#1026 architect). */
export type RoleListWire = RoleListItem;

export interface RemovalBlockNote {
  readonly short: string;
  readonly full: string;
}

const BLOCKER_CAP = 3;

export const removalActionOf = (verdict: RemovalVerdict): 'delete' | 'archive' | 'blocked' =>
  verdict.kind === 'blocked' ? 'blocked' : verdict.kind === 'archive' ? 'archive' : 'delete';

/** The Sil / Arşivle label while blocked still names the action that would apply (U-293). */
export const removalLabelAction = (verdict: RemovalVerdict): 'delete' | 'archive' => {
  if (verdict.kind === 'archive') return 'archive';
  if (verdict.kind === 'delete') return 'delete';
  if (verdict.reasons.some((reason) => reason.kind === 'dependant')) return 'delete';
  return 'archive';
};

/** Stage lines for a dependant block, preferring the list item's human names. */
export const stageLinesForRole = (stages: RoleListItem['stages']): readonly string[] =>
  stages.map((stage) => `${stage.flowName} (${stage.stageName})`);

/** Up to three visible blockers; the full list is the accessible description (architect #1026). */
export const removalBlockNote = (
  locale: Locale,
  verdict: RemovalVerdict,
  stages: RoleListItem['stages'],
): RemovalBlockNote | null => {
  if (verdict.kind !== 'blocked') return null;
  const parts: string[] = [];
  for (const reason of verdict.reasons) {
    if (reason.kind === 'running_work') {
      parts.push(t(locale, 'definition.blocked.runningWork'));
      continue;
    }
    const match = stages.find((stage) => stage.flow === reason.repo && (reason.stage === undefined || stage.stage === reason.stage));
    parts.push(
      match === undefined
        ? t(locale, 'definition.blocked.stageEntry').replace('{repo}', reason.repo).replace('{stage}', reason.stage ?? '')
        : t(locale, 'definition.blocked.stageEntry').replace('{repo}', match.flowName).replace('{stage}', match.stageName),
    );
  }
  if (parts.length === 0) return null;
  const stageOnly = verdict.reasons.every((reason) => reason.kind === 'dependant');
  const head =
    stageOnly && parts.length > 0
      ? t(locale, 'definition.blocked.stageCount').replace('{n}', String(parts.length))
      : '';
  const visible = parts.slice(0, BLOCKER_CAP);
  const hidden = parts.length - visible.length;
  const inline = visible.join(', ');
  const more = hidden > 0 ? t(locale, 'definition.blocked.more').replace('{n}', String(hidden)) : '';
  const short =
    stageOnly && head.length > 0
      ? `${head}: ${inline}${more.length > 0 ? ` ${more}` : ''}`
      : `${inline}${more.length > 0 ? ` ${more}` : ''}`;
  const full = stageOnly && head.length > 0 ? `${head}: ${parts.join(', ')}` : parts.join(', ');
  return { short, full };
};

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly pastVersions: readonly DefinitionVersionView[];
  readonly removal: RemovalVerdict;
  readonly tier: Tier | null;
  readonly thinking: Thinking | null;
  readonly style: RoleWorkStyle;
  readonly recommended: WorkStyle;
  readonly differs: boolean;
  readonly chainMode: 'all' | 'own';
  readonly chain: readonly ChainEntry[];
  /** The exact efforts the chain's selectable models declare (empty until catalogs load). */
  readonly efforts: readonly string[];
  readonly stages: readonly StageView[];
  /** Every repo stage that binds this role — for removal blockers (U-293). */
  readonly dependantStages: readonly {
    readonly flow: string;
    readonly flowName: string;
    readonly stage: string;
    readonly stageName: string;
  }[];
  readonly sameProviderReview: boolean;
}

export interface RoleAccount {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  /** The account's billing view: automatic switching skips one that is not included (U-42). */
  readonly billing: 'included' | 'metered' | 'unknown';
  /** The account rides a key: an included one reads "Abonelik · anahtarla". */
  readonly viaKey: boolean;
}

export interface RolesState {
  readonly loading: boolean;
  readonly rows: readonly RoleRow[] | null;
  readonly pastVersionsRole: string | null;
  readonly accounts: readonly RoleAccount[];
  /** Asistan sırası: account ids, the chain most roles share. */
  readonly globalChain: readonly string[];
  /** Roles whose binding stores neither tier nor thinking (the "Önerilenleri uygula" line). */
  readonly unsetCount: number;
  readonly catalogs: Readonly<Record<string, AccountModelsView>>;
  readonly failure: { readonly row: string; readonly labelKey: LabelKey } | null;
}

const sameIds = (a: readonly ChainEntry[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, at) => entry.accountId === b[at]);

/** The chain most roles' global bindings share; the first role's wins a tie. The chat reads the
 *  same rule when no assistant binding is stored. Pure. */
export const globalChainOf = (bindings: readonly SettingsBindingView[]): readonly string[] =>
  mostSharedChain(
    bindings.filter((binding) => binding.scope.level === 'global').map((binding) => binding.accounts),
    (entry) => entry.accountId,
  ).map((entry) => entry.accountId);

/** The empty-chain line's key: with no account at all the line asks for one; with accounts but an
 *  empty chain it asks for the recommended setup or a pick — the same empty look is not the same
 *  problem, and the copy must not send a user who has an account to add another. Pure. */
export const chainEmptyKey = (accountCount: number): LabelKey => (accountCount === 0 ? 'roles.chain.empty' : 'roles.chain.unbound');

/** The roles an adoption must bind: those with no global binding yet. A binding at a narrower
 *  scope is not a chain — the role still has no global accounts to run on. Pure. */
export const unboundRoleIds = (
  roles: readonly { readonly id: string }[],
  bindings: readonly SettingsBindingView[],
): readonly string[] => {
  const bound = new Set(bindings.filter((binding) => binding.scope.level === 'global').map((binding) => binding.role));
  return roles.filter((entry) => !bound.has(entry.id)).map((entry) => entry.id);
};

/** The complete binding as `binding.save` takes it: every stored field, a null one left out. */
export const bindingCommand = (
  role: string,
  chain: readonly ChainEntry[],
  tier: Tier | null,
  thinking: Thinking | null,
): Command => ({
  type: 'binding.save',
  role,
  accounts: chain.map((entry) => (entry.model === null ? { accountId: entry.accountId } : { accountId: entry.accountId, model: entry.model })),
  ...(thinking !== null ? { thinking: 'level' in thinking ? { level: thinking.level } : { effort: thinking.effort } } : {}),
  ...(tier !== null ? { tier } : {}),
});

type ChainMode = 'all' | 'own';

const buildRows = (
  roles: readonly RoleListWire[],
  bindings: readonly SettingsBindingView[],
  globalChain: readonly string[],
  overrides: Readonly<Record<string, ChainMode>>,
  catalogs: Readonly<Record<string, AccountModelsView>>,
): readonly RoleRow[] =>
  roles.map((role) => {
    const stored = bindings.find((binding) => binding.scope.level === 'global' && binding.role === role.id);
    const chain: readonly ChainEntry[] =
      stored === undefined ? globalChain.map((accountId) => ({ accountId, model: null })) : stored.accounts;
    const storedOwn = stored !== undefined && (!sameIds(chain, globalChain) || chain.some((entry) => entry.model !== null));
    const tier = stored?.tier ?? null;
    const thinking = stored?.thinking ?? null;
    const style = workStyle(tier, thinking);
    const recommended = recommendedWorkStyle(role.id);
    const models: ModelView[] = [];
    for (const entry of chain) {
      const view = catalogs[entry.accountId];
      if (view === undefined) continue;
      for (const model of selectableModels(view)) if (entry.model === null || entry.model === model.id) models.push(model);
    }
    return {
      id: role.id,
      name: role.name,
      version: role.version,
      pastVersions: role.pastVersions,
      removal: role.removal,
      tier,
      thinking,
      style,
      recommended,
      differs: style !== 'unset' && style !== recommended,
      chainMode: overrides[role.id] ?? (storedOwn ? 'own' : 'all'),
      chain,
      efforts: effortOptions(models),
      stages: role.stages
        .filter((stage) => stage.tier !== null || stage.thinking !== null)
        .map((stage) => ({ flowName: stage.flowName, stageName: stage.stageName, tier: stage.tier, thinking: stage.thinking })),
      dependantStages: role.stages.map((stage) => ({
        flow: stage.flow,
        flowName: stage.flowName,
        stage: stage.stage,
        stageName: stage.stageName,
      })),
      sameProviderReview: role.stages.some((stage) => stage.sameProviderReview),
    };
  });

export interface RolesStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: (listener: (change: { readonly type: string }) => void) => () => void;
  /** Every issued command travels as this actor — the settings panel acts as the user. */
  readonly actor: Actor;
  readonly now: () => number;
}

export interface RolesStore {
  load(): Promise<void>;
  openPastVersions(role: string): void;
  closePastVersions(): void;
  removeDefinition(role: string): Promise<void>;
  /** Models of one account (consent standing included), for pins and efforts. */
  loadModels(accountId: string): Promise<void>;
  /** Asistan sırası: move the account at `from` by `delta` (±1); saves every listed role. */
  moveGlobal(from: number, delta: number): Promise<void>;
  /** Asistan sırası: append an account the chain does not hold; saves every listed role. */
  addGlobal(accountId: string): Promise<void>;
  setStyle(role: string, style: WorkStyle): Promise<void>;
  resetStyle(role: string): Promise<void>;
  /** "Önerilenleri uygula": the recommended style for exactly the roles with no style stored. */
  applyRecommended(): Promise<void>;
  setChainMode(role: string, mode: ChainMode): Promise<void>;
  toggleAccount(role: string, accountId: string): Promise<void>;
  moveOwn(role: string, from: number, delta: number): Promise<void>;
  /** Pin (or, with null, unpin) a model; a `$`/`?` model without consent issues nothing. */
  pinModel(role: string, accountId: string, model: string | null): Promise<void>;
  setTier(role: string, tier: Tier | null): Promise<void>;
  setThinking(role: string, thinking: Thinking | null): Promise<void>;
  /** Whether "Kaydedildi" shows beside this row right now. */
  isSaved(row: string): boolean;
  state(): RolesState;
  subscribe(listener: () => void): () => void;
}

export const createRolesStore = (deps: RolesStoreDeps): RolesStore => {
  const { api, actor } = deps;
  let state: RolesState = { loading: false, rows: null, pastVersionsRole: null, accounts: [], globalChain: [], unsetCount: 0, catalogs: {}, failure: null };
  let roles: readonly RoleListWire[] = [];
  let bindings: readonly SettingsBindingView[] = [];
  let overrides: Readonly<Record<string, ChainMode>> = {};
  const pendingModels = new Set<string>();
  let savedRow: string | null = null;
  let savedUntil = 0;
  const listeners = new Set<() => void>();

  const set = (next: RolesState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const rebuild = (patch: Partial<RolesState> = {}): void => {
    const globalChain = globalChainOf(bindings);
    const catalogs = patch.catalogs ?? state.catalogs;
    const rows = buildRows(roles, bindings, globalChain, overrides, catalogs);
    set({ ...state, ...patch, globalChain, rows, unsetCount: rows.filter((row) => row.style === 'unset').length });
  };

  const load = async (): Promise<void> => {
    set({ ...state, loading: true });
    const [rolesReply, settingsReply] = await Promise.all([
      api.query({ type: 'roles.list' } satisfies Query),
      api.query({ type: 'settings.accounts' } satisfies Query),
    ]);
    if (isQueryFailure(rolesReply) || isQueryFailure(settingsReply)) {
      set({ ...state, loading: false });
      return;
    }
    roles = rolesReply as readonly RoleListWire[];
    const view = settingsReply as SettingsAccountsView;
    bindings = view.bindings;
    rebuild({
      loading: false,
      accounts: view.accounts.map((account) => ({
        id: account.id,
        label: account.label,
        provider: account.provider,
        billing: account.billing,
        viaKey: account.authMode === 'api_key',
      })),
    });
  };

  const runAll = async (row: string, commands: readonly Command[]): Promise<void> => {
    for (const command of commands) {
      const result = await api.command(actor, command);
      if (!result.ok) {
        set({ ...state, failure: { row, labelKey: commandResultKey(command.type, result) } });
        await load();
        return;
      }
    }
    savedRow = row;
    savedUntil = deps.now() + SAVED_FLAG_MS;
    set({ ...state, failure: null });
    await load();
  };

  const rowOf = (role: string): RoleRow | undefined => state.rows?.find((row) => row.id === role);

  const saveRole = (role: string, change: { chain?: readonly ChainEntry[]; tier?: Tier | null; thinking?: Thinking | null }): Promise<void> => {
    const row = rowOf(role);
    if (row === undefined) return Promise.resolve();
    return runAll(role, [
      bindingCommand(
        role,
        change.chain ?? row.chain,
        change.tier === undefined ? row.tier : change.tier,
        change.thinking === undefined ? row.thinking : change.thinking,
      ),
    ]);
  };

  const markOwn = (role: string): void => {
    overrides = { ...overrides, [role]: 'own' };
  };

  const move = <T,>(list: readonly T[], from: number, delta: number): readonly T[] | null => {
    const to = from + delta;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
    const next = [...list];
    const [item] = next.splice(from, 1);
    if (item === undefined) return null;
    next.splice(to, 0, item);
    return next;
  };

  /** A new shared chain reaches every role: each saves its complete binding with the new order,
   *  because `binding.save` replaces the whole binding (A-49) — a role with its own chain keeps
   *  it, pin included. */
  const saveGlobalChain = async (next: readonly string[]): Promise<void> => {
    const commands = roles.map((entry) => {
      const row = rowOf(entry.id);
      const own = row !== undefined && row.chainMode === 'own' && bindings.some((b) => b.scope.level === 'global' && b.role === entry.id);
      const chain: readonly ChainEntry[] = own && row !== undefined ? row.chain : next.map((accountId) => ({ accountId, model: null }));
      return bindingCommand(entry.id, chain, row?.tier ?? null, row?.thinking ?? null);
    });
    // The assistant is not a listed role, yet it rides this order: saving it is what makes the
    // chat run on the chain the list shows, once a stored binding stands in for the fallback.
    commands.push(bindingCommand(ASSISTANT_ROLE, next.map((accountId) => ({ accountId, model: null })), null, null));
    await runAll('chain', commands);
  };

  deps.changes((change) => {
    if (change.type === 'update.changed' || roles.length === 0) return;
    void load();
  });

  return {
    load,
    loadModels: async (accountId) => {
      // Every role row asks for its chain's catalogs; one query per account is enough.
      if (pendingModels.has(accountId)) return;
      pendingModels.add(accountId);
      const reply = await api.query({ type: 'account.models', accountId } satisfies Query);
      pendingModels.delete(accountId);
      if (isQueryFailure(reply)) return;
      rebuild({ catalogs: { ...state.catalogs, [accountId]: reply as AccountModelsView } });
    },
    moveGlobal: async (from, delta) => {
      const next = move(state.globalChain, from, delta);
      if (next === null) return;
      await saveGlobalChain(next);
    },
    addGlobal: async (accountId) => {
      if (state.globalChain.includes(accountId)) return;
      await saveGlobalChain([...state.globalChain, accountId]);
    },
    setStyle: (role, style) => {
      const pair = styleSettings(style);
      return saveRole(role, { tier: pair.tier, thinking: pair.thinking });
    },
    resetStyle: (role) => {
      const pair = styleSettings(recommendedWorkStyle(role));
      return saveRole(role, { tier: pair.tier, thinking: pair.thinking });
    },
    applyRecommended: async () => {
      const commands = (state.rows ?? [])
        .filter((row) => row.style === 'unset')
        .map((row) => {
          const pair = styleSettings(row.recommended);
          return bindingCommand(row.id, row.chain, pair.tier, pair.thinking);
        });
      if (commands.length === 0) return;
      await runAll('roles', commands);
    },
    setChainMode: async (role, mode) => {
      if (mode === 'own') {
        markOwn(role);
        rebuild();
        return;
      }
      const { [role]: _dropped, ...rest } = overrides;
      overrides = rest;
      await saveRole(role, { chain: state.globalChain.map((accountId) => ({ accountId, model: null })) });
    },
    toggleAccount: async (role, accountId) => {
      const row = rowOf(role);
      if (row === undefined) return;
      markOwn(role);
      const chain = row.chain.some((entry) => entry.accountId === accountId)
        ? row.chain.filter((entry) => entry.accountId !== accountId)
        : [...row.chain, { accountId, model: null }];
      await saveRole(role, { chain });
    },
    moveOwn: async (role, from, delta) => {
      const row = rowOf(role);
      const chain = row === undefined ? null : move(row.chain, from, delta);
      if (chain === null) return;
      markOwn(role);
      await saveRole(role, { chain });
    },
    pinModel: async (role, accountId, model) => {
      const row = rowOf(role);
      if (row === undefined) return;
      if (model !== null) {
        const catalog = state.catalogs[accountId];
        if (catalog === undefined || !selectableModels(catalog).some((entry) => entry.id === model)) return;
      }
      markOwn(role);
      await saveRole(role, { chain: row.chain.map((entry) => (entry.accountId === accountId ? { accountId, model } : entry)) });
    },
    setTier: (role, tier) => saveRole(role, { tier }),
    setThinking: (role, thinking) => saveRole(role, { thinking }),
    isSaved: (row) => savedRow === row && deps.now() < savedUntil,
    openPastVersions: (role) => set({ ...state, pastVersionsRole: role }),
    closePastVersions: () => set({ ...state, pastVersionsRole: null }),
    removeDefinition: async (role) => {
      const row = rowOf(role);
      if (row === undefined) return;
      const action = removalActionOf(row.removal);
      if (action === 'blocked') return;
      const command: Command =
        action === 'archive'
          ? { type: 'definitions.archive', kind: 'roles', id: role }
          : { type: 'definitions.delete', kind: 'roles', id: role };
      const result = await api.command(actor, command);
      if (!result.ok) {
        set({ ...state, failure: { row: role, labelKey: commandResultKey(command.type, result) } });
        return;
      }
      await load();
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
