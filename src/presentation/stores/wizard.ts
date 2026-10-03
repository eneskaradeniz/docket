// stores/wizard.ts — the setup wizard's machine (U-35): Hoş geldin → Hesaplar → Yetenekler →
// Asistan sırası → Bütçe → the "Kurulum tamam" moment. A step with nothing to decide is skipped
// and reads "–" in the rail (Yetenekler while no capability source holds anything, Asistan sırası
// under two accounts). Every choice is a draft held here: the selection and its key-move
// switches (U-34), an account's editor draft (U-30) and the spend consents (U-32). Nothing is
// written before the finish; the finish adopts or saves every selected account with its draft,
// writes caps and consents, and binds every role with the chosen chain and the role's
// recommended work style (complete bindings, A-49). `back` never touches an entry. The wizard
// shows only while no project exists. Failures map through U-8.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { ProjectTreeItem, Query, RoleListItem, SettingsAccountView, SettingsAccountsView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import {
  labelSaveCommand,
  meterBar,
  policyLabelKey,
  policySaveCommand,
  reserveSaveCommand,
  usageView,
  type EditorOutcome,
} from './account-editor';
import { parseAmountUsd, type CapScope } from './account-models';
import {
  candidateRows,
  isProviderFact,
  providerRows,
  type CandidateFact,
  type CandidateRow,
  type ProviderFact,
  type ProviderRow,
} from './candidates';
import { RECOMMENDED, isPayPerUse, recommendedWorkStyle, settingDiffs } from './recommended';
import { commandResultKey, isQueryFailure, queryFailureKey } from './results';
import { bindingCommand, styleSettings } from './roles';

export type WizardStep = 'welcome' | 'accounts' | 'capabilities' | 'order' | 'budget' | 'done';

/** The rail's steps in walking order; the "Kurulum tamam" moment is not a step. */
export const WIZARD_STEPS: readonly WizardStep[] = ['welcome', 'accounts', 'capabilities', 'order', 'budget'];

export type RailStanding = 'done' | 'cur' | 'todo' | 'skipped';

export interface RailEntry {
  readonly step: WizardStep;
  readonly standing: RailStanding;
}

/** A capability a composed source offers (MCP · Skill · Hook · Context); none is composed today. */
export interface WizardCapability {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface WizardStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  /** Every issued command travels as this actor — the wizard acts as the user. */
  readonly actor: Actor;
  /** What the composed capability source found; absent or empty skips Yetenekler. */
  readonly capabilities?: readonly WizardCapability[];
  /** Re-queries the sidebar tree: an attach appends no work-order event, so nothing else would. */
  readonly reloadTree?: () => Promise<void>;
}

/** One line of Hesaplar: a candidate not yet added, or an account added earlier. */
export interface WizardAccountRow extends CandidateRow {
  /** The provider's display name (A-67); null while discovery does not know it. */
  readonly providerName: string | null;
  readonly existing: boolean;
  readonly importToken: boolean;
}

export interface OrderEntry {
  readonly id: string;
  readonly providerName: string | null;
  readonly label: string;
  readonly markKey: string | null;
}

export interface BudgetRow {
  readonly id: string;
  readonly providerName: string | null;
  readonly label: string;
  readonly markKey: string | null;
  /** The U-29 count of settings that differ from the recommendation. */
  readonly diffCount: number;
  readonly policyKey: LabelKey;
  readonly reserveShort: number;
  readonly reserveLong: number;
  /** Each meter's remaining share, 0..1, null when unreadable; empty before the account exists. */
  readonly bars: readonly (number | null)[];
  readonly cap: { readonly scope: string; readonly amountUsd: number; readonly warnPercent: number } | null;
  readonly spentUsd: number | null;
  readonly needsConsent: boolean;
  readonly consented: boolean;
}

export interface WizardOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface WizardSummary {
  readonly accounts: number;
  readonly capabilities: number;
  readonly firstLabel: string;
}

/** Where the project's default view is: a multi-repo project opens its roadmap, a single-repo one
 *  its board (as the cockpit's project cards do). */
export type WizardOpenTarget =
  | { readonly kind: 'roadmap'; readonly project: string }
  | { readonly kind: 'board'; readonly repo: string };

export interface WizardAttach {
  readonly open: boolean;
  readonly path: string;
  readonly busy: boolean;
  /** The U-8 label of a failed attach, shown under the field. */
  readonly failureKey: LabelKey | null;
}

export interface WizardState {
  /** False until `open` proves no project exists, and again once the wizard has been left. */
  readonly visible: boolean;
  readonly checking: boolean;
  readonly step: WizardStep;
  readonly rail: readonly RailEntry[];
  readonly rows: readonly WizardAccountRow[];
  readonly providers: readonly ProviderRow[];
  readonly loading: boolean;
  readonly capabilities: readonly (WizardCapability & { readonly selected: boolean })[];
  readonly order: readonly OrderEntry[];
  readonly budget: { readonly subscriptions: readonly BudgetRow[]; readonly payPerUse: readonly BudgetRow[] };
  /** The open editor window: its working copy of one account. */
  readonly editor: { readonly key: string; readonly account: SettingsAccountView } | null;
  readonly canSkip: boolean;
  /** Whether the primary footer slot is enabled — on Bütçe it is "Kurulumu bitir". */
  readonly nextEnabled: boolean;
  /** Why the primary slot is disabled; null while it is enabled. */
  readonly reasonKey: LabelKey | null;
  readonly finishing: boolean;
  readonly lastOutcome: WizardOutcome | null;
  /** The one line of the "Kurulum tamam" moment; null before it. */
  readonly summary: WizardSummary | null;
  /** The inline attach form of "Proje bağla". */
  readonly attach: WizardAttach;
  /** Set once a project is attached: the view to open; the wizard has left by then. */
  readonly opened: WizardOpenTarget | null;
}

export interface SpendInput {
  readonly amount: string;
  readonly scope: CapScope;
}

export interface WizardStore {
  /** The shell's entry point: shows the wizard only while no project exists. */
  open(): Promise<void>;
  state(): WizardState;
  next(): Promise<void>;
  skip(): Promise<void>;
  back(): void;
  select(key: string): void;
  setImportToken(key: string, on: boolean): void;
  /** "Yeniden tara": a fresh scan of candidates and providers. */
  rescan(): Promise<void>;
  toggleCapability(id: string): void;
  moveUp(key: string): void;
  moveDown(key: string): void;
  /** Opens the editor window on a working copy of the account's draft. */
  openEditor(key: string): Promise<void>;
  /** The editor's command runner: applied to the working copy, issued to nothing. */
  editorRun(command: Command): Promise<EditorOutcome>;
  /** Kaydet: the working copy becomes the draft. */
  saveEditor(): void;
  /** Vazgeç: the working copy is dropped. */
  cancelEditor(): void;
  /** The U-32 card's İzin ver: false while the amount does not parse. */
  allowSpend(key: string, input: SpendInput): boolean;
  revokeSpend(key: string): void;
  /** "Proje bağla": opens the inline attach form. */
  attachProject(): void;
  setAttachPath(path: string): void;
  /** Leaves the form for the summary. */
  cancelAttach(): void;
  /** "Bağla": `project.attach`; on success the wizard leaves and `opened` names the view. */
  submitAttach(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

type Caps = SettingsAccountView['caps'];

/** What an account will be once the finish has written it; the editor window edits a copy. */
interface DraftSettings {
  readonly label: string;
  readonly limitPolicy: SettingsAccountView['limitPolicy'];
  readonly reserve: { readonly short: number | null; readonly long: number | null };
  readonly caps: Caps;
  /** The account-level spend consent (`'*'`, U-32). */
  readonly consent: boolean;
}

interface Entry {
  readonly key: string;
  /** The stored account, or the synthetic view of a candidate not yet adopted. */
  readonly base: SettingsAccountView;
  readonly fact: CandidateFact | null;
  readonly settings: DraftSettings;
}

/** The account's default label: the config folder's name without its leading dot. */
const labelOf = (displayPath: string): string =>
  (displayPath.split('/').filter((part) => part !== '').pop() ?? displayPath).replace(/^\.+/, '');

const isFact = (value: unknown): value is CandidateFact =>
  typeof value === 'object' &&
  value !== null &&
  'sourcePath' in value &&
  typeof value.sourcePath === 'string' &&
  'displayPath' in value &&
  typeof value.displayPath === 'string' &&
  'warnings' in value &&
  Array.isArray(value.warnings) &&
  'envOverrides' in value &&
  Array.isArray(value.envOverrides) &&
  'alreadyAdded' in value &&
  typeof value.alreadyAdded === 'boolean';

const isAccountView = (value: unknown): value is SettingsAccountView =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && 'limitPolicy' in value && 'caps' in value;

const isAccountsView = (value: unknown): value is SettingsAccountsView =>
  typeof value === 'object' && value !== null && 'accounts' in value && Array.isArray(value.accounts);

const isRole = (value: unknown): value is RoleListItem =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && 'name' in value;

const settingsOf = (view: SettingsAccountView): DraftSettings => ({
  label: view.label,
  limitPolicy: view.limitPolicy,
  reserve: view.reserve,
  caps: view.caps,
  consent: view.consentedModels.includes('*'),
});

/** The account as it reads with its draft laid over its base. */
const viewOf = (base: SettingsAccountView, settings: DraftSettings): SettingsAccountView => ({
  ...base,
  label: settings.label,
  limitPolicy: settings.limitPolicy,
  reserve: settings.reserve,
  caps: settings.caps,
  consentedModels: settings.consent ? ['*'] : base.consentedModels.filter((model) => model !== '*'),
});

/** A candidate before it exists: `account.adopt` stores subscription routes as subscriptions and
 *  compatible endpoints as key-based accounts. */
const syntheticView = (fact: CandidateFact, importToken: boolean): SettingsAccountView => ({
  id: fact.sourcePath,
  provider: fact.provider ?? '',
  label: labelOf(fact.displayPath),
  authMode: fact.kind === 'compatible_endpoint' && fact.endpointHost !== undefined ? 'api_key' : 'subscription',
  plan: null,
  limitPolicy: RECOMMENDED.limitPolicy,
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: fact.routeKind,
  identityDir: fact.displayPath,
  endpointHost: fact.endpointHost ?? null,
  hasSecret: importToken,
  test: null,
  pools: [],
  meters: [],
});

/** One editor command laid over a draft. Only the fields the editor writes are read; a command
 *  the draft has no use for is accepted and ignored. */
export const applyDraftCommand = (settings: DraftSettings, command: Command): DraftSettings => {
  switch (command.type) {
    case 'account.save':
      return {
        ...settings,
        label: command.label.trim() === '' ? settings.label : command.label,
        limitPolicy:
          command.limitPolicy === undefined ? settings.limitPolicy : (command.limitPolicy as SettingsAccountView['limitPolicy']),
        reserve:
          command.reserve === undefined
            ? settings.reserve
            : { short: command.reserve.short ?? settings.reserve.short, long: command.reserve.long ?? settings.reserve.long },
      };
    case 'account.cap.save':
      return {
        ...settings,
        caps: [
          ...settings.caps.filter((cap) => cap.scope !== command.scope),
          { scope: command.scope as Caps[number]['scope'], amountUsd: command.amountUsd, warnPercent: command.warnPercent },
        ],
      };
    case 'account.cap.remove':
      return { ...settings, caps: settings.caps.filter((cap) => cap.scope !== command.scope) };
    default:
      return settings;
  }
};

const percentOf = (share: number | null): number => Math.round((share ?? 0) * 100);

/** The commands that bring a stored account to its draft: only what differs, caps before the
 *  consent that needs one and removals after it (a consent never stands without a cap). */
export const settingsCommands = (real: SettingsAccountView, draft: DraftSettings): readonly Command[] => {
  const commands: Command[] = [];
  if (draft.label !== real.label) commands.push(labelSaveCommand(real, draft.label));
  if (draft.limitPolicy !== real.limitPolicy) commands.push(policySaveCommand(real, draft.limitPolicy));
  if (percentOf(draft.reserve.short) !== percentOf(real.reserve.short) || percentOf(draft.reserve.long) !== percentOf(real.reserve.long)) {
    commands.push(reserveSaveCommand(real, percentOf(draft.reserve.short), percentOf(draft.reserve.long)));
  }
  for (const cap of draft.caps) {
    const same = real.caps.some((stored) => stored.scope === cap.scope && stored.amountUsd === cap.amountUsd && stored.warnPercent === cap.warnPercent);
    if (!same) commands.push({ type: 'account.cap.save', id: real.id, scope: cap.scope, amountUsd: cap.amountUsd, warnPercent: cap.warnPercent });
  }
  const consented = real.consentedModels.includes('*');
  if (draft.consent && !consented) commands.push({ type: 'account.consent.grant', id: real.id, model: '*' });
  if (!draft.consent && consented) commands.push({ type: 'account.consent.revoke', id: real.id, model: '*' });
  for (const stored of real.caps) {
    if (!draft.caps.some((cap) => cap.scope === stored.scope)) commands.push({ type: 'account.cap.remove', id: real.id, scope: stored.scope });
  }
  return commands;
};

export const createWizardStore = (deps: WizardStoreDeps): WizardStore => {
  const { api, actor } = deps;

  let visible = false;
  let checking = false;
  let step: WizardStep = 'welcome';
  let loading = false;
  let finishing = false;
  let facts: readonly CandidateFact[] = [];
  let providerFacts: readonly ProviderFact[] = [];
  let existing: readonly SettingsAccountView[] = [];
  /** Chosen entry keys in chain order (Asistan sırası). */
  let selection: readonly string[] = [];
  const importTokens = new Set<string>();
  const drafts = new Map<string, DraftSettings>();
  /** Candidates the finish has already adopted (key → account id): a retry never adopts twice. */
  const adoptedIds = new Map<string, string>();
  let capabilityPicks: ReadonlySet<string> = new Set((deps.capabilities ?? []).map((capability) => capability.id));
  let editorWork: { readonly key: string; readonly settings: DraftSettings } | null = null;
  let lastOutcome: WizardOutcome | null = null;
  let loaded = false;
  let attach: WizardAttach = { open: false, path: '', busy: false, failureKey: null };
  let opened: WizardOpenTarget | null = null;
  let openAttempts = 0;

  const capabilities = deps.capabilities ?? [];
  const listeners = new Set<() => void>();

  const nameOf = (provider: string): string | null =>
    provider === '' ? null : (providerFacts.find((fact) => fact.defId === provider)?.name ?? null);

  // --- entries ---------------------------------------------------------------------------------

  const entries = (): readonly Entry[] => [
    ...existing.map((view): Entry => ({ key: view.id, base: view, fact: null, settings: drafts.get(view.id) ?? settingsOf(view) })),
    ...facts
      .filter((fact) => !fact.alreadyAdded)
      .map((fact): Entry => {
        const base = syntheticView(fact, importTokens.has(fact.sourcePath));
        return { key: fact.sourcePath, base, fact, settings: drafts.get(fact.sourcePath) ?? settingsOf(base) };
      }),
  ];

  const entryOf = (key: string): Entry | undefined => entries().find((entry) => entry.key === key);

  const rowsOf = (): readonly WizardAccountRow[] =>
    entries().map((entry): WizardAccountRow => {
      if (entry.fact === null) {
        return {
          id: entry.key,
          markKey: entry.base.provider === '' ? null : entry.base.provider,
          label: entry.settings.label,
          providerName: nameOf(entry.base.provider),
          endpointHost: entry.base.endpointHost,
          statusKey: 'candidates.status.ready',
          selectable: true,
          selected: selection.includes(entry.key),
          disabledReasonKey: null,
          warnKeys: [],
          keyMoveCard: false,
          existing: true,
          importToken: false,
        };
      }
      const [row] = candidateRows([entry.fact], selection.includes(entry.key) ? entry.key : null, importTokens.has(entry.key));
      if (row === undefined) throw new Error('a listed candidate has no row');
      return { ...row, label: entry.settings.label, providerName: nameOf(entry.base.provider), existing: false, importToken: importTokens.has(entry.key) };
    });

  const selectedEntries = (): readonly Entry[] => selection.map(entryOf).filter((entry): entry is Entry => entry !== undefined);

  const viewOfEntry = (entry: Entry): SettingsAccountView => viewOf(entry.base, entry.settings);

  const orderEntries = (): readonly OrderEntry[] =>
    selectedEntries().map((entry) => ({ id: entry.key, providerName: nameOf(entry.base.provider), label: entry.settings.label, markKey: entry.base.provider === '' ? null : entry.base.provider }));

  // --- the machine -------------------------------------------------------------------------------

  const skipped = (target: WizardStep): boolean => {
    if (target === 'capabilities') return capabilities.length === 0;
    if (target === 'order') return selection.length < 2;
    return false;
  };

  const railOf = (): readonly RailEntry[] =>
    WIZARD_STEPS.map((entry, index): RailEntry => {
      if (skipped(entry)) return { step: entry, standing: 'skipped' };
      if (step === 'done') return { step: entry, standing: 'done' };
      const current = WIZARD_STEPS.indexOf(step);
      return { step: entry, standing: index < current ? 'done' : index === current ? 'cur' : 'todo' };
    });

  const stepAfter = (from: WizardStep): WizardStep => {
    const start = WIZARD_STEPS.indexOf(from);
    for (let at = start + 1; at < WIZARD_STEPS.length; at += 1) {
      const candidate = WIZARD_STEPS[at];
      if (candidate !== undefined && !skipped(candidate)) return candidate;
    }
    return 'done';
  };

  const stepBefore = (from: WizardStep): WizardStep | null => {
    const start = from === 'done' ? WIZARD_STEPS.length : WIZARD_STEPS.indexOf(from);
    for (let at = start - 1; at >= 0; at -= 1) {
      const candidate = WIZARD_STEPS[at];
      if (candidate !== undefined && !skipped(candidate)) return candidate;
    }
    return null;
  };

  const readySelected = (): boolean =>
    rowsOf().some((row) => row.selected && row.statusKey === 'candidates.status.ready');

  const consentMissing = (): boolean =>
    selectedEntries().some((entry) => isPayPerUse(viewOfEntry(entry)) && !(entry.settings.consent && entry.settings.caps.length > 0));

  const gate = (): LabelKey | null => {
    if (step === 'accounts') return readySelected() ? null : 'wizard.reason.accounts';
    if (step === 'budget') return consentMissing() ? 'wizard.reason.budget' : null;
    return null;
  };

  const budgetRow = (entry: Entry): BudgetRow => {
    const view = viewOfEntry(entry);
    const usage = usageView(view);
    const cap = view.caps[0] ?? null;
    return {
      id: entry.key,
      providerName: nameOf(view.provider),
      label: view.label,
      markKey: view.provider === '' ? null : view.provider,
      diffCount: settingDiffs(view).length,
      policyKey: policyLabelKey(view.limitPolicy),
      reserveShort: view.reserve.short ?? 0,
      reserveLong: view.reserve.long ?? 0,
      bars: view.meters.map((meter) => meterBar(meter).fill),
      cap: cap === null ? null : { scope: cap.scope, amountUsd: cap.amountUsd, warnPercent: cap.warnPercent },
      spentUsd: usage.kind === 'spend' ? usage.spentUsd : null,
      needsConsent: isPayPerUse(view),
      consented: view.consentedModels.includes('*'),
    };
  };

  const compute = (): WizardState => {
    const selected = selectedEntries();
    const budgetRows = selected.map(budgetRow);
    const reason = visible ? gate() : null;
    const editorEntry = editorWork === null ? undefined : entryOf(editorWork.key);
    const first = selected[0];
    return {
      visible,
      checking,
      step,
      rail: railOf(),
      rows: rowsOf(),
      providers: providerRows(providerFacts),
      loading,
      capabilities: capabilities.map((capability) => ({ ...capability, selected: capabilityPicks.has(capability.id) })),
      order: orderEntries(),
      budget: {
        subscriptions: budgetRows.filter((row) => !row.needsConsent),
        payPerUse: budgetRows.filter((row) => row.needsConsent),
      },
      editor:
        editorWork === null || editorEntry === undefined ? null : { key: editorWork.key, account: viewOf(editorEntry.base, editorWork.settings) },
      canSkip: step === 'welcome' || step === 'capabilities' || step === 'order',
      nextEnabled: step !== 'done' && !finishing && reason === null,
      reasonKey: reason,
      finishing,
      lastOutcome,
      summary:
        step === 'done' && first !== undefined
          ? { accounts: selected.length, capabilities: capabilities.filter((c) => capabilityPicks.has(c.id)).length, firstLabel: first.settings.label }
          : null,
      attach,
      opened,
    };
  };

  let state: WizardState = compute();
  const publish = (): void => {
    state = compute();
    for (const listener of [...listeners]) listener();
  };

  // --- reads -----------------------------------------------------------------------------------

  const read = async (refresh: boolean): Promise<void> => {
    loading = true;
    publish();
    const candidateQuery: Query = refresh ? { type: 'accounts.candidates', refresh: true } : { type: 'accounts.candidates' };
    const [candidateReply, providerReply, accountsReply] = await Promise.all([
      api.query(candidateQuery),
      api.query({ type: 'providers.discovered' }),
      api.query({ type: 'settings.accounts' }),
    ]);
    facts = !isQueryFailure(candidateReply) && Array.isArray(candidateReply) ? candidateReply.filter(isFact) : [];
    providerFacts = !isQueryFailure(providerReply) && Array.isArray(providerReply) ? providerReply.filter(isProviderFact) : [];
    existing = isAccountsView(accountsReply) ? accountsReply.accounts.filter(isAccountView) : [];
    if (!loaded) {
      // Accounts added earlier start chosen: a re-run of the wizard is never stuck behind an
      // empty candidate list.
      selection = [...selection, ...existing.map((view) => view.id).filter((id) => !selection.includes(id))];
      loaded = true;
    }
    // A choice that is no longer listed (added elsewhere, vanished on rescan) falls away.
    const listed = new Set(entries().map((entry) => entry.key));
    selection = selection.filter((key) => listed.has(key));
    loading = false;
    publish();
  };

  const open = async (): Promise<void> => {
    const attempt = (openAttempts += 1);
    checking = true;
    publish();
    const reply: unknown = await api.query({ type: 'project.tree' });
    if (attempt !== openAttempts) return;
    // Any project ends the first run; an unverifiable read must never suppress the setup.
    const exists = !isQueryFailure(reply) && Array.isArray(reply) && reply.length > 0;
    checking = false;
    if (exists) {
      visible = false;
      publish();
      return;
    }
    visible = true;
    if (step === 'done') step = 'welcome';
    publish();
    if (!loaded) await read(false);
  };

  // --- the finish -------------------------------------------------------------------------------

  const outcomeOf = (command: Command, result: CommandResult): WizardOutcome => ({
    command: command.type,
    result,
    labelKey: commandResultKey(command.type, result),
  });

  const failWith = (outcome: WizardOutcome): void => {
    lastOutcome = outcome;
    finishing = false;
    publish();
  };

  const finish = async (): Promise<void> => {
    finishing = true;
    lastOutcome = null;
    publish();
    // Adopt in list order; a stored account keeps its id.
    const ids = new Map<string, string>();
    for (const entry of entries().filter((candidate) => selection.includes(candidate.key))) {
      if (entry.fact === null) {
        ids.set(entry.key, entry.key);
        continue;
      }
      const adopted = adoptedIds.get(entry.key);
      if (adopted !== undefined) {
        ids.set(entry.key, adopted);
        continue;
      }
      const command: Command = {
        type: 'account.adopt',
        sourcePath: entry.fact.sourcePath,
        label: entry.settings.label,
        ...(importTokens.has(entry.key) ? { importToken: true } : {}),
      };
      const result = await api.command(actor, command);
      if (!result.ok || result.id === undefined) {
        failWith(outcomeOf(command, result.ok ? { ok: false, code: 'not_found' } : result));
        return;
      }
      adoptedIds.set(entry.key, result.id);
      ids.set(entry.key, result.id);
    }

    // The drafts land on the stored accounts: only what differs from what is stored.
    const accountsReply: unknown = await api.query({ type: 'settings.accounts' });
    if (isQueryFailure(accountsReply)) {
      failWith({ command: 'account.save', result: accountsReply, labelKey: queryFailureKey(accountsReply) });
      return;
    }
    const stored = isAccountsView(accountsReply) ? accountsReply.accounts.filter(isAccountView) : [];
    for (const entry of selectedEntries()) {
      const id = ids.get(entry.key);
      const real = stored.find((view) => view.id === id);
      if (real === undefined) {
        failWith(outcomeOf({ type: 'account.save', provider: '', label: '', authMode: '' }, { ok: false, code: 'not_found' }));
        return;
      }
      for (const command of settingsCommands(real, entry.settings)) {
        const result = await api.command(actor, command);
        if (!result.ok) {
          failWith(outcomeOf(command, result));
          return;
        }
      }
    }

    // Every role is bound with the chosen chain and its recommended work style, complete (A-49).
    const rolesReply: unknown = await api.query({ type: 'roles.list' });
    if (isQueryFailure(rolesReply)) {
      failWith({ command: 'binding.save', result: rolesReply, labelKey: queryFailureKey(rolesReply) });
      return;
    }
    const roles = Array.isArray(rolesReply) ? rolesReply.filter(isRole) : [];
    const chain = selection.flatMap((key) => {
      const id = ids.get(key);
      return id === undefined ? [] : [{ accountId: id, model: null }];
    });
    for (const role of roles) {
      const { tier, thinking } = styleSettings(recommendedWorkStyle(role.id));
      const command = bindingCommand(role.id, chain, tier, thinking);
      const result = await api.command(actor, command);
      if (!result.ok) {
        failWith(outcomeOf(command, result));
        return;
      }
    }
    finishing = false;
    step = 'done';
    publish();
  };

  const advance = async (): Promise<void> => {
    if (step === 'done') return;
    if (step === 'budget') {
      await finish();
      return;
    }
    step = stepAfter(step);
    publish();
  };

  // --- the store ---------------------------------------------------------------------------------

  const patchDraft = (key: string, patch: (settings: DraftSettings) => DraftSettings): void => {
    const entry = entryOf(key);
    if (entry === undefined) return;
    drafts.set(key, patch(entry.settings));
  };

  const move = (key: string, by: -1 | 1): void => {
    const at = selection.indexOf(key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= selection.length) return;
    const next = [...selection];
    const [moved] = next.splice(at, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    selection = next;
    publish();
  };

  return {
    open,
    state: () => state,
    next: async () => {
      if (!visible || finishing || !state.nextEnabled) return;
      await advance();
    },
    skip: async () => {
      if (!visible || finishing || !state.canSkip) return;
      await advance();
    },
    back: () => {
      if (!visible || finishing || step === 'done') return;
      const before = stepBefore(step);
      if (before === null) return;
      step = before;
      publish();
    },
    select: (key) => {
      const row = rowsOf().find((entry) => entry.id === key);
      if (row === undefined || !row.selectable) return;
      if (selection.includes(key)) {
        selection = selection.filter((entry) => entry !== key);
        // A fresh selection starts with the key-move switch off (U-34).
        importTokens.delete(key);
      } else {
        selection = [...selection, key];
      }
      publish();
    },
    setImportToken: (key, on) => {
      if (on) importTokens.add(key);
      else importTokens.delete(key);
      publish();
    },
    rescan: () => read(true),
    toggleCapability: (id) => {
      const next = new Set(capabilityPicks);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      capabilityPicks = next;
      publish();
    },
    moveUp: (key) => move(key, -1),
    moveDown: (key) => move(key, 1),
    openEditor: (key) => {
      const entry = entryOf(key);
      if (entry !== undefined) {
        editorWork = { key, settings: entry.settings };
        publish();
      }
      return Promise.resolve();
    },
    editorRun: (command) => {
      if (editorWork !== null) {
        editorWork = { key: editorWork.key, settings: applyDraftCommand(editorWork.settings, command) };
        publish();
      }
      const result: CommandResult = { ok: true };
      return Promise.resolve({ result, labelKey: commandResultKey(command.type, result) });
    },
    saveEditor: () => {
      if (editorWork === null) return;
      const { key, settings } = editorWork;
      drafts.set(key, settings);
      editorWork = null;
      publish();
    },
    cancelEditor: () => {
      editorWork = null;
      publish();
    },
    allowSpend: (key, input) => {
      const amountUsd = parseAmountUsd(input.amount);
      if (amountUsd === null || entryOf(key) === undefined) return false;
      patchDraft(key, (settings) => ({
        ...settings,
        consent: true,
        caps: [
          ...settings.caps.filter((cap) => cap.scope !== input.scope),
          { scope: input.scope, amountUsd, warnPercent: RECOMMENDED.warnPercent },
        ],
      }));
      publish();
      return true;
    },
    revokeSpend: (key) => {
      patchDraft(key, (settings) => ({ ...settings, consent: false }));
      publish();
    },
    attachProject: () => {
      attach = { ...attach, open: true, failureKey: null };
      publish();
    },
    setAttachPath: (path) => {
      attach = { ...attach, path, failureKey: null };
      publish();
    },
    cancelAttach: () => {
      attach = { ...attach, open: false, failureKey: null };
      publish();
    },
    submitAttach: async () => {
      const path = attach.path.trim();
      if (!attach.open || attach.busy || path === '') return;
      attach = { ...attach, busy: true, failureKey: null };
      publish();
      const command: Command = { type: 'project.attach', path };
      const result = await api.command(actor, command);
      if (!result.ok) {
        attach = { ...attach, busy: false, failureKey: commandResultKey(command.type, result) };
        publish();
        return;
      }
      await deps.reloadTree?.();
      const tree: unknown = await api.query({ type: 'project.tree' });
      const projects = !isQueryFailure(tree) && Array.isArray(tree) ? (tree as readonly ProjectTreeItem[]) : [];
      const project = projects.find((item) => item.project === result.id) ?? projects[projects.length - 1];
      opened =
        project === undefined
          ? null
          : project.repos.length > 1
            ? { kind: 'roadmap', project: project.project }
            : { kind: 'board', repo: project.mainRepo };
      attach = { ...attach, busy: false };
      visible = false;
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
