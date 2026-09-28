// stores/wizard.ts — the first-run wizard store (U-7): a step state machine
// definitions source → account → binding → done. `next` is enabled only when the step's
// validation passes (source reachable / chosen provider discovered+logged-in / at least one bound
// role); `back` preserves entered state; finishing dismisses the wizard, which reappears on open
// only while no workspace exists. The account and binding steps ride the settings commands
// (docs/v2/ui.md, U-6/U-13) and map every result through results.ts (U-8).
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { IntentOutcome } from './work-order-detail';
import { commandResultKey, isQueryFailure } from './results';

/** The four steps of the first-run machine, in walking order (docs/v2/ui.md, U-7). */
export type WizardStep = 'source' | 'account' | 'binding' | 'done';

/** The account draft the account step collects; it rides `account.save` verbatim. */
export interface WizardAccountDraft {
  readonly label: string;
  readonly authMode: string;
  readonly plan?: string;
}

/** The projection of the `providers.discovered` reply this store reads. The raw port shape stays
 *  at the api; presentation narrows it to the fields the gate judges (a binPath found on this
 *  machine means discovered, `loggedIn === true` means logged in — anything less proves nothing). */
export interface DiscoveredProviderView {
  readonly defId: string;
  readonly binPath: string | null;
  readonly loggedIn: boolean | null;
}

export interface WizardStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  /** Every issued command travels as this actor — the wizard acts as the user. */
  readonly actor: Actor;
  /** Whether the entered definitions source is reachable. No api query serves the definitions
   *  surface yet; the wiring that supplies the real probe lands with the screens, tests inject a
   *  fake — the same stance as the detail store's injected definitions loader. */
  readonly sourceReachable: (source: string) => Promise<boolean>;
  /** Whether a workspace exists on this machine — the wiring reads `workspaces.list`, the api's
   *  one enumeration. The verdict stays injected so the store judges only the boolean; `open`
   *  re-checks it rather than trusting a remembered verdict. */
  readonly workspaceExists: () => Promise<boolean>;
}

export interface WizardState {
  /** False until `open` proves no workspace exists, and again once the machine finishes. */
  readonly visible: boolean;
  readonly step: WizardStep;
  /** True while `open` is re-checking workspace existence. */
  readonly checking: boolean;
  /** The entered definitions source, verbatim; the probe judges its trimmed form. */
  readonly source: string;
  /** The trimmed text the latest reachability probe judged; null = nothing probed. */
  readonly sourceChecked: string | null;
  readonly sourceOk: boolean;
  /** True while a reachability probe is in flight. */
  readonly probing: boolean;
  /** The provider chosen for the account, or null while nothing is chosen. */
  readonly provider: string | null;
  readonly draft: WizardAccountDraft;
  /** The latest `providers.discovered` reply; empty when the pass failed (the gate fails closed). */
  readonly discovered: readonly DiscoveredProviderView[];
  /** True while a discovery pass is in flight. */
  readonly discovering: boolean;
  /** The account the account step saved (the id `account.save` returned), or null. */
  readonly accountId: string | null;
  /** Roles whose `binding.save` returned ok — the binding step's pass condition. */
  readonly boundRoles: readonly string[];
  /** The latest command's U-8 mapping; null before the first command. */
  readonly lastOutcome: IntentOutcome | null;
}

export interface WizardStore {
  /** The shell's entry point: re-checks workspace existence and shows the wizard only when none
   *  exists (U-7). A finished machine re-runs from the source step; a mid-wizard session keeps
   *  its place. */
  open(): Promise<void>;
  state(): WizardState;
  /** The sync hint for enabling the next control, computed from the latest probe and discovery
   *  replies. The `next` intent remains the authority — it re-validates at click time. */
  nextEnabled(): boolean;
  /** Validates the current step and advances; a failed validation or command keeps the step. */
  next(): Promise<void>;
  /** Steps back without touching any entered state (U-7). */
  back(): void;
  enterSource(source: string): void;
  /** Probes the entered source now, so `nextEnabled` can reflect a verdict before a click. */
  checkSource(): Promise<void>;
  chooseProvider(defId: string): void;
  enterAccount(draft: WizardAccountDraft): void;
  /** Loads a fresh discovery pass into the state (each query kicks one, U-13). */
  refreshDiscovery(): Promise<void>;
  /** Saves a role binding onto the wizard's account and counts the role as bound on success. */
  bind(role: string): Promise<IntentOutcome>;
  subscribe(listener: () => void): () => void;
}

/** The account step's gate: the chosen provider must be found on this machine AND logged in. A
 *  missing binary or an unknown login state proves nothing, so only the exact pair passes. */
const providerReady = (provider: string, discovered: readonly DiscoveredProviderView[]): boolean =>
  discovered.some(
    (entry) => entry.defId === provider && entry.binPath !== null && entry.loggedIn === true,
  );

export const createWizardStore = (deps: WizardStoreDeps): WizardStore => {
  const { api, actor, sourceReachable, workspaceExists } = deps;

  let state: WizardState = {
    visible: false,
    step: 'source',
    checking: false,
    source: '',
    sourceChecked: null,
    sourceOk: false,
    probing: false,
    provider: null,
    draft: { label: '', authMode: '' },
    discovered: [],
    discovering: false,
    accountId: null,
    boundRoles: [],
    lastOutcome: null,
  };
  const listeners = new Set<() => void>();
  // Only the newest attempt of each async intent may apply its reply: a slow earlier probe or
  // pass must not overwrite a fresher verdict, as in the other stores.
  let openAttempts = 0;
  let probeAttempts = 0;
  let discoveryAttempts = 0;
  let moves = 0;

  const set = (next: WizardState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const open = async (): Promise<void> => {
    const attempt = (openAttempts += 1);
    set({ ...state, checking: true });
    const exists = await workspaceExists();
    if (attempt !== openAttempts) return;
    if (exists) {
      // A workspace means the first run is over, whenever the question is asked again.
      set({ ...state, checking: false, visible: false });
      return;
    }
    // The machine restarts; entered values remain valid inputs and saved bindings remain saved.
    const step: WizardStep = state.step === 'done' ? 'source' : state.step;
    set({ ...state, checking: false, visible: true, step });
  };

  const checkSource = async (): Promise<void> => {
    const attempt = (probeAttempts += 1);
    const text = state.source.trim();
    if (text === '') {
      // An empty source is not probed: no verdict can exist for it.
      set({ ...state, probing: false, sourceChecked: null, sourceOk: false });
      return;
    }
    set({ ...state, probing: true });
    const ok = await sourceReachable(text);
    if (attempt !== probeAttempts) return;
    set({ ...state, probing: false, sourceChecked: text, sourceOk: ok });
  };

  const refreshDiscovery = async (): Promise<void> => {
    const attempt = (discoveryAttempts += 1);
    set({ ...state, discovering: true });
    const reply: unknown = await api.query({ type: 'providers.discovered' } satisfies Query);
    if (attempt !== discoveryAttempts) return;
    // A failed pass proves nothing discovered, so the gate must fail closed: the list empties
    // rather than keeping a stale one that could hold the gate open.
    const discovered = isQueryFailure(reply) ? [] : (reply as readonly DiscoveredProviderView[]);
    set({ ...state, discovering: false, discovered });
  };

  const next = async (): Promise<void> => {
    // A dismissed wizard has no intents.
    if (!state.visible) return;
    const move = (moves += 1);
    switch (state.step) {
      case 'source': {
        // The click is the authority: it re-probes the entered text instead of trusting the
        // cached verdict, which may judge an older text.
        const text = state.source.trim();
        const ok = text === '' ? false : await sourceReachable(text);
        if (move !== moves) return;
        set({
          ...state,
          sourceChecked: text === '' ? null : text,
          sourceOk: ok,
        });
        if (!ok) return;
        set({ ...state, step: 'account' });
        // Entering the account step kicks a discovery pass so the choice can be validated.
        await refreshDiscovery();
        return;
      }
      case 'account': {
        // A fresh pass at click time: login state can change between the screen's load and now.
        await refreshDiscovery();
        if (move !== moves) return;
        const provider = state.provider;
        if (provider === null) return;
        if (!providerReady(provider, state.discovered)) return;
        const draft = state.draft;
        // Re-crossing the step re-saves the same account (the id `account.save` returned) instead
        // of stacking a duplicate account per crossing.
        const command: Command = {
          type: 'account.save',
          provider,
          label: draft.label,
          authMode: draft.authMode,
          ...(draft.plan !== undefined ? { plan: draft.plan } : {}),
          ...(state.accountId !== null ? { id: state.accountId } : {}),
        };
        const result = await api.command(actor, command);
        if (move !== moves) return;
        const outcome: IntentOutcome = {
          command: 'account.save',
          result,
          labelKey: commandResultKey('account.save', result),
        };
        if (!result.ok) {
          set({ ...state, lastOutcome: outcome });
          return;
        }
        set({ ...state, lastOutcome: outcome, accountId: result.id ?? state.accountId, step: 'binding' });
        return;
      }
      case 'binding': {
        if (state.boundRoles.length === 0) return;
        // Finishing leaves the wizard: the machine parks on its terminal step, dismissed.
        set({ ...state, step: 'done', visible: false });
        return;
      }
      case 'done':
        return;
    }
  };

  const back = (): void => {
    // A dismissed wizard has no intents; the source step has nothing behind it.
    if (!state.visible) return;
    if (state.step === 'account') set({ ...state, step: 'source' });
    else if (state.step === 'binding') set({ ...state, step: 'account' });
  };

  const bind = async (role: string): Promise<IntentOutcome> => {
    if (state.accountId === null) {
      // The binding step is unreachable without a saved account; a local refusal keeps the
      // contract (issue nothing, map the refusal through U-8) instead of issuing a chainless
      // binding the use case would reject anyway.
      const result: CommandResult = { ok: false, code: 'not_found' };
      const refused: IntentOutcome = {
        command: 'binding.save',
        result,
        labelKey: commandResultKey('binding.save', result),
      };
      set({ ...state, lastOutcome: refused });
      return refused;
    }
    const result = await api.command(actor, {
      type: 'binding.save',
      role,
      accounts: [{ accountId: state.accountId }],
    });
    const outcome: IntentOutcome = {
      command: 'binding.save',
      result,
      labelKey: commandResultKey('binding.save', result),
    };
    set({
      ...state,
      lastOutcome: outcome,
      // The same role saved twice is one binding (the repo upserts); the list stays a set.
      boundRoles:
        result.ok && !state.boundRoles.includes(role) ? [...state.boundRoles, role] : state.boundRoles,
    });
    return outcome;
  };

  const nextEnabled = (): boolean => {
    switch (state.step) {
      case 'source':
        // The cached verdict counts only while it judges the text currently entered.
        return state.sourceOk && state.sourceChecked !== null && state.sourceChecked === state.source.trim();
      case 'account':
        return state.provider !== null && providerReady(state.provider, state.discovered);
      case 'binding':
        return state.boundRoles.length > 0;
      case 'done':
        return false;
    }
  };

  return {
    open,
    state: () => state,
    nextEnabled,
    next,
    back,
    enterSource: (source) => set({ ...state, source }),
    checkSource,
    chooseProvider: (defId) => set({ ...state, provider: defId }),
    enterAccount: (draft) => set({ ...state, draft }),
    refreshDiscovery,
    bind,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
