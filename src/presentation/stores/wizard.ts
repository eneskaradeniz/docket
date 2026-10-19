// stores/wizard.ts — the setup wizard's machine (U-42): Hoş geldin → Hesaplar → Yetenekler →
// Asistan sırası → Bütçe, then straight to Anasayfa. A step with nothing to decide is skipped and
// reads "–" in the rail (Yetenekler while its read has not finished with a candidate, U-58;
// Asistan sırası under two selected accounts). Every choice is a draft held here: the selection
// and its key-move switches (U-34, U-262: a token-needing row is inert until its key is moved),
// an account's editor draft (U-43), the spend consents (U-32),
// the Bütçe rows' reserve choice (U-48) and the capability picks (U-59, identities until the
// finish). Nothing is written before the finish; the finish adopts every selected account, binds
// every role with the chosen chain and its recommended work style (complete bindings, A-49),
// imports the picked capabilities in one call that never blocks the walk (U-60), then lands the
// drafts — caps and consents among them — on the stored accounts. Its real phases (U-49) —
// accounts, capabilities, order, budget, home — publish as they complete, so the progress list's
// checks follow real replies, never a timer; the window stays mounted while `finished` is set and
// leaves on `ackFinish`, after the shell's handoff and the wizard's fade. `back` never touches an
// entry and does not exist on Hoş geldin. Discovery candidates carry their route's billing
// (A-83a) and, before they are accounts, their quota is read with `accounts.candidateQuota`
// (A-82). Failures map through U-8.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type {
  CapabilityCandidateView,
  CapabilityCandidatesView,
  CandidateQuotaView,
  Query,
  RoleListItem,
  SettingsAccountView,
  SettingsAccountsView,
  SettingsMeterView,
  SettingsPoolView,
} from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import {
  labelSaveCommand,
  policyChoices,
  policyLabelKey,
  policySaveCommand,
  reserveSaveCommand,
  usageView,
  type EditorOutcome,
  type EditorTab,
  type LimitPolicy,
} from './account-editor';
import { parseAmountUsd, type CapScope } from './account-models';
import { spendsMoney, type Billing } from './account-groups';
import { meterListEmpty, meterListView, type MeterListEmpty, type MeterListView } from './meter-list';
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
import { moveItem } from './drag-order';
import { ASSISTANT_ROLE, bindingCommand, styleSettings } from './roles';

export type WizardStep = 'welcome' | 'accounts' | 'capabilities' | 'order' | 'budget';

/** The rail's steps in walking order. */
export const WIZARD_STEPS: readonly WizardStep[] = ['welcome', 'accounts', 'capabilities', 'order', 'budget'];

/** The tabs of the wizard's editor: a draft has no stored account to list models of, and Genel holds
 *  no model choice — no contract stores one (U-44a). */
export const WIZARD_EDITOR_TABS: readonly EditorTab[] = ['general', 'usage', 'limits'];

export type RailStanding = 'done' | 'cur' | 'todo' | 'skipped';

/** The finish's real phases (U-49), in the progress list's walking order: each maps to one line
 *  and to the work that makes it true — adoption, the capability import (U-60), the chain's
 *  bindings, the drafts' writes, the leave for Anasayfa. */
export type FinishPhase = 'accounts' | 'capabilities' | 'order' | 'budget' | 'home';

export interface FinishError {
  /** The line the finish stopped on; the phases before it keep their checks. */
  readonly phase: FinishPhase;
  /** Why it stopped — the outcome's U-8 label. */
  readonly reasonKey: LabelKey;
}

export interface RailEntry {
  readonly step: WizardStep;
  readonly standing: RailStanding;
}

/** One Yetenekler row: the merged candidate (R-63) with its pick standing (U-59). A candidate
 *  found in several accounts is one row — `sources` holds every account that found it. */
export interface WizardCapabilityRow {
  readonly identity: string;
  readonly kind: 'mcp' | 'skill' | 'context';
  readonly name: string;
  readonly sources: readonly string[];
  readonly command: string | null;
  readonly path: string | null;
  readonly description: string | null;
  readonly imported: boolean;
  readonly selected: boolean;
}

/** One Yetenekler group: the account whose config directory held the rows, titled the way
 *  Hesaplar reads that account — "Asistan · Hesap" (U-59). */
export interface WizardCapabilityGroup {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly WizardCapabilityRow[];
}

/** A rejected import row, as the end note lists it: the candidate's name and the rejection
 *  code's own label key is decided by the screen (U-60). */
export interface WizardCapabilityReject {
  readonly name: string;
  readonly reason: string;
}

/** The change events the wizard reads: an `accounts.changed` re-reads what it shows (U-44). */
export type WizardChangeSignal = (listener: (change: { readonly type: string }) => void) => () => void;

export interface WizardStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  /** Every issued command travels as this actor — the wizard acts as the user. */
  readonly actor: Actor;
  /** The api's change events; absent in tests that do not need them. */
  readonly changes?: WizardChangeSignal;
}

/** One line of Hesaplar: a candidate not yet added, or an account added earlier. */
export interface WizardAccountRow extends CandidateRow {
  /** The provider's display name (A-67); null while discovery does not know it. */
  readonly providerName: string | null;
  readonly existing: boolean;
}

export interface OrderEntry {
  readonly id: string;
  readonly providerName: string | null;
  readonly label: string;
  readonly markKey: string | null;
  readonly billing: Billing;
  readonly viaKey: boolean;
  /** An account that may spend money: automatic switching skips it, only the user picks it. */
  readonly autoSkipped: boolean;
}

/** What a candidate's quota read stands at: still loading, answered, or an error (A-82). */
export type QuotaStanding =
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly pools: readonly SettingsPoolView[]; readonly meters: readonly SettingsMeterView[] }
  | { readonly state: 'error' };

export interface BudgetRow {
  readonly id: string;
  readonly providerName: string | null;
  readonly label: string;
  readonly markKey: string | null;
  readonly billing: Billing;
  readonly viaKey: boolean;
  readonly displayPath: string;
  readonly host: string | null;
  /** The U-29 count of settings that differ from the recommendation. */
  readonly diffCount: number;
  readonly policy: LimitPolicy;
  readonly policyKey: LabelKey;
  /** The "Limit dolunca" options, in display order; the pool switch only with a model-scoped pool. */
  readonly policyChoices: readonly LimitPolicy[];
  readonly reserveShort: number;
  readonly reserveLong: number;
  /** The draft's held-back share as a whole percent (0 = none) — the summary line's "rezerv %n". */
  readonly reservePercent: number;
  /** The MeterList rows; empty before a quota answer or when the provider reports none. */
  readonly meters: MeterListView;
  /** The line shown instead of rows; null while rows exist. */
  readonly meterEmpty: MeterListEmpty | null;
  readonly cap: { readonly scope: string; readonly amountUsd: number; readonly warnPercent: number } | null;
  /** The cap the row shows: the stored one, else the recommendation. */
  readonly capShown: { readonly scope: CapScope; readonly amountUsd: number };
  readonly spentUsd: number | null;
  readonly needsConsent: boolean;
  readonly consented: boolean;
}

export interface WizardOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

/** Set once the finish has written everything: the shell opens Anasayfa with the one toast. */
export interface WizardFinished {
  /** Ready accounts the setup leaves behind ("Kurulum tamamlandı · n hesap hazır"). */
  readonly accounts: number;
}

export interface WizardState {
  /** False until `open` proves no project exists, and again once the wizard has been left. */
  readonly visible: boolean;
  readonly checking: boolean;
  readonly step: WizardStep;
  readonly rail: readonly RailEntry[];
  readonly rows: readonly WizardAccountRow[];
  readonly providers: readonly ProviderRow[];
  /** The providers that are installed, for the account groups (an installed one always has a card). */
  readonly installed: readonly { readonly id: string; readonly name: string }[];
  readonly loading: boolean;
  /** Yetenekler (U-58): the query runs while the step is walked through; the skeleton holds it. */
  readonly capabilitiesLoading: boolean;
  /** One group per account the candidates name in `sources` (U-59). */
  readonly capabilityGroups: readonly WizardCapabilityGroup[];
  /** The scan found more than the cap (U-59): one note line, no pagination. */
  readonly capabilityTruncated: boolean;
  /** The summary line's "n yetenek": distinct selected, not-yet-imported identities (U-59). */
  readonly capabilityPicked: number;
  /** Whether Yetenekler stands with something to walk through — the finish list draws its
   *  capability line only then (U-60). */
  readonly capabilitiesLive: boolean;
  /** The import's rejected rows, listed as the end note (U-60); empty while none. */
  readonly capabilityRejects: readonly WizardCapabilityReject[];
  readonly order: readonly OrderEntry[];
  readonly budget: { readonly subscriptions: readonly BudgetRow[]; readonly payPerUse: readonly BudgetRow[] };
  /** The open editor window: its working copy of one account. */
  readonly editor: { readonly key: string; readonly account: SettingsAccountView } | null;
  /** Geri does not exist on Hoş geldin. */
  readonly canBack: boolean;
  /** "Bu adımı atla" is offered on Bütçe only (it finishes with the recommended values). */
  readonly canSkip: boolean;
  /** Whether the primary footer slot is enabled — on Bütçe it is "Kurulumu bitir". */
  readonly nextEnabled: boolean;
  /** Why the primary slot is disabled; null while it is enabled. */
  readonly reasonKey: LabelKey | null;
  /** P-67: the add-another-account card of the home-rooted CLI; null while that CLI is not
   *  installed. `noteKey` is the input's own refusal note, never an error-styled line. */
  readonly agyAdd: { readonly path: string; readonly noteKey: LabelKey | null; readonly providerName: string } | null;
  readonly finishing: boolean;
  /** The progress list's current line (U-49); null outside a finish. */
  readonly finishPhase: FinishPhase | null;
  /** The line a failed finish stopped on; null while it runs and after a clean leave. */
  readonly finishError: FinishError | null;
  readonly lastOutcome: WizardOutcome | null;
  /** Non-null from the finish until the shell has taken it. */
  readonly finished: WizardFinished | null;
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
  /** A done step in the rail: goes back to it, keeping every entry. Later and skipped steps do nothing. */
  goTo(target: WizardStep): void;
  select(key: string): void;
  clearSelection(): void;
  selectAllReady(): void;
  setImportToken(key: string, on: boolean): void;
  /** P-67: the add-another-account card's directory input; typing clears its refusal note. */
  setAgyAddPath(path: string): void;
  /** P-67: "Ekle" — validates the directory locally and adds the would-be account, selected. */
  addAgyAccount(): void;
  /** "Yeniden tara": a fresh scan of candidates and providers. */
  rescan(): Promise<void>;
  toggleCapability(id: string): void;
  /** Drag and drop or Alt+↑/↓ on Asistan sırası: the account takes the slot (clamped). */
  moveTo(key: string, index: number): void;
  /** Opens the editor window on a working copy of the account's draft. */
  openEditor(key: string): Promise<void>;
  /** The editor's command runner: applied to the working copy, issued to nothing. */
  editorRun(command: Command): Promise<EditorOutcome>;
  /** Kaydet: the working copy becomes the draft. */
  saveEditor(): void;
  /** Vazgeç: the working copy is dropped. */
  cancelEditor(): void;
  /** The "Limit dolunca" Listbox of a subscription row. */
  setPolicy(key: string, policy: LimitPolicy): void;
  /** The Ayrıntı reserve choice (U-48): one percent held back from both windows; null = Yok. */
  setReserve(key: string, percent: number | null): void;
  /** The cap amount and period of a pay-per-use row; false while the amount does not parse. */
  setCap(key: string, input: SpendInput): boolean;
  /** The U-32 consent: grants with the cap; false while the amount does not parse. */
  allowSpend(key: string, input: SpendInput): boolean;
  revokeSpend(key: string): void;
  /** Reads a candidate's quota again (the editor's Yenile). */
  refreshQuota(key: string): Promise<void>;
  /** The shell has opened Anasayfa and the window's fade is over: the wizard leaves for good. */
  ackFinish(): void;
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
  /** P-67: a chosen identity directory — a home-rooted CLI's account, adopted through the
   *  identity form of `account.adopt` at the finish. */
  readonly manual: boolean;
}

/** P-67: the one home-rooted CLI whose accounts are per-account HOME directories. The def's
 *  config mechanism is infrastructure data the presentation cannot read, so the id stands here. */
const AGY_PROVIDER_ID = 'agy';

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
const syntheticView = (fact: CandidateFact, importToken: boolean, quota: QuotaStanding | undefined): SettingsAccountView => ({
  id: fact.sourcePath,
  provider: fact.provider ?? '',
  label: labelOf(fact.displayPath),
  authMode: fact.kind === 'compatible_endpoint' && fact.endpointHost !== undefined ? 'api_key' : 'subscription',
  // The candidate row carries its route's billing (A-83a); the stored account's own view replaces it.
  billing: fact.billing,
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
  // The candidate's own quota preview (A-82): ids exist only in that answer.
  pools: quota?.state === 'ok' ? quota.pools : [],
  meters: quota?.state === 'ok' ? quota.meters : [],
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

const isQuotaView = (value: unknown): value is CandidateQuotaView =>
  typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean';

const isCapabilityCandidate = (value: unknown): value is CapabilityCandidateView =>
  typeof value === 'object' &&
  value !== null &&
  'identity' in value &&
  typeof value.identity === 'string' &&
  'kind' in value &&
  typeof value.kind === 'string' &&
  'name' in value &&
  typeof value.name === 'string' &&
  'sources' in value &&
  Array.isArray(value.sources) &&
  'imported' in value &&
  typeof value.imported === 'boolean';

const isCandidatesView = (value: unknown): value is CapabilityCandidatesView =>
  typeof value === 'object' && value !== null && 'candidates' in value && Array.isArray(value.candidates) && 'truncated' in value && typeof value.truncated === 'boolean';

export const createWizardStore = (deps: WizardStoreDeps): WizardStore => {
  const { api, actor } = deps;

  let visible = false;
  let checking = false;
  let step: WizardStep = 'welcome';
  let loading = false;
  let finishing = false;
  let finishPhase: FinishPhase | null = null;
  let finishError: FinishError | null = null;
  /** Where the next finish starts: a retry resumes at the phase the run stopped on, so a phase
   *  that already completed is never walked or written again (U-49). */
  let finishResume: FinishPhase = 'accounts';
  let facts: readonly CandidateFact[] = [];
  let providerFacts: readonly ProviderFact[] = [];
  let existing: readonly SettingsAccountView[] = [];
  /** P-67: the identity directories chosen in Hesaplar — drafts until the finish, like every entry. */
  let manualHomes: readonly string[] = [];
  /** P-67: the add-another-account card's input and its refusal note; null note while clean. */
  let agyAddPath = '';
  let agyAddNote: LabelKey | null = null;
  /** Chosen entry keys in chain order (Asistan sırası). */
  let selection: readonly string[] = [];
  const importTokens = new Set<string>();
  const drafts = new Map<string, DraftSettings>();
  /** Candidates the finish has already adopted (key → account id): a retry never adopts twice. */
  const adoptedIds = new Map<string, string>();
  /** The quota preview of each candidate not yet adopted (A-82), by source path. */
  const quotas = new Map<string, QuotaStanding>();
  /** The picked capability identities — a draft until the finish, like every wizard choice. */
  let capabilityPicks: ReadonlySet<string> = new Set();
  /** Yetenekler's read (U-58): never read before an account exists (A-90's scan would find
   *  nothing), read when Hesaplar completes and again whenever the adopted set changes. */
  let capsLoading = false;
  let capsRead = false;
  let capsError = false;
  let capsFacts: readonly CapabilityCandidateView[] = [];
  let capsTruncated = false;
  /** The import's rejected rows (U-60); set by the finish, kept for the end note. */
  let importRejects: readonly WizardCapabilityReject[] = [];
  let editorWork: { readonly key: string; readonly settings: DraftSettings } | null = null;
  let lastOutcome: WizardOutcome | null = null;
  let loaded = false;
  let finished: WizardFinished | null = null;
  /** The finish has run: the wizard never comes back in this session. */
  let completed = false;
  let openAttempts = 0;

  const listeners = new Set<() => void>();

  const nameOf = (provider: string): string | null =>
    provider === '' ? null : (providerFacts.find((fact) => fact.defId === provider)?.name ?? null);

  // --- entries ---------------------------------------------------------------------------------

  const entries = (): readonly Entry[] => [
    ...existing.map((view): Entry => ({ key: view.id, base: view, fact: null, settings: drafts.get(view.id) ?? settingsOf(view), manual: false })),
    ...facts
      .filter((fact) => !fact.alreadyAdded)
      .map((fact): Entry => {
        const base = syntheticView(fact, importTokens.has(fact.sourcePath), quotas.get(fact.sourcePath));
        return { key: fact.sourcePath, base, fact, settings: drafts.get(fact.sourcePath) ?? settingsOf(base), manual: false };
      }),
    // P-67: the chosen identity directories — each one a would-be account of the home-rooted
    // CLI, standing exactly like a scanned subscription candidate until the finish adopts it.
    ...manualHomes.map((dir): Entry => {
      const base: SettingsAccountView = {
        id: `manual:${dir}`,
        provider: AGY_PROVIDER_ID,
        label: labelOf(dir),
        authMode: 'subscription',
        // A home-rooted CLI's accounts ride their plan's quota: nothing here bills per use.
        billing: 'included',
        plan: null,
        limitPolicy: RECOMMENDED.limitPolicy,
        reserve: { short: null, long: null },
        caps: [],
        consentedModels: [],
        routeKind: null,
        identityDir: dir,
        endpointHost: null,
        hasSecret: false,
        test: null,
        pools: [],
        meters: [],
      };
      const key = `manual:${dir}`;
      return { key, base, fact: null, settings: drafts.get(key) ?? settingsOf(base), manual: true };
    }),
  ];

  const entryOf = (key: string): Entry | undefined => entries().find((entry) => entry.key === key);

  const rowsOf = (): readonly WizardAccountRow[] =>
    entries().map((entry): WizardAccountRow => {
      if (entry.manual) {
        // A chosen identity directory stands as a ready, selectable candidate row (P-67): the
        // operator signed in under it with the vendor's own tool, so it owes no scan state.
        return {
          id: entry.key,
          markKey: AGY_PROVIDER_ID,
          label: entry.settings.label,
          providerName: nameOf(AGY_PROVIDER_ID),
          endpointHost: null,
          statusKey: 'candidates.status.ready',
          selectable: true,
          selected: selection.includes(entry.key),
          disabledReasonKey: null,
          warnKeys: [],
          keyMoveCard: false,
          provider: AGY_PROVIDER_ID,
          displayPath: entry.base.identityDir ?? '',
          billing: 'included',
          viaKey: false,
          hintKey: null,
          existing: false,
          importToken: false,
        };
      }
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
          provider: entry.base.provider === '' ? null : entry.base.provider,
          displayPath: entry.base.identityDir ?? '',
          billing: entry.base.billing,
          viaKey: entry.base.authMode === 'api_key',
          hintKey: null,
          existing: true,
          importToken: false,
        };
      }
      const [row] = candidateRows([entry.fact], selection.includes(entry.key) ? entry.key : null, importTokens, providerFacts);
      if (row === undefined) throw new Error('a listed candidate has no row');
      return { ...row, label: entry.settings.label, providerName: nameOf(entry.base.provider), existing: false };
    });

  const selectedEntries = (): readonly Entry[] => selection.map(entryOf).filter((entry): entry is Entry => entry !== undefined);

  const viewOfEntry = (entry: Entry): SettingsAccountView => viewOf(entry.base, entry.settings);

  const orderEntries = (): readonly OrderEntry[] =>
    selectedEntries().map((entry) => ({
      id: entry.key,
      providerName: nameOf(entry.base.provider),
      label: entry.settings.label,
      markKey: entry.base.provider === '' ? null : entry.base.provider,
      billing: entry.base.billing,
      viaKey: entry.base.authMode === 'api_key',
      autoSkipped: spendsMoney(entry.base.billing),
    }));

  // --- Yetenekler (U-58 … U-60) -----------------------------------------------------------------

  /** Whether Yetenekler stands with something to walk through: a read in flight (the step holds
   *  its skeleton) or a finished read with at least one candidate. An empty answer or a failed
   *  query skips the step (U-58). */
  const capsLive = (): boolean => capsLoading || (capsRead && !capsError && capsFacts.length > 0);

  /** One row per merged candidate: the pick is the identity, so a candidate found in several
   *  accounts toggles once for all of its groups (U-59). An imported row never reads selected. */
  const capabilityRows = (): readonly WizardCapabilityRow[] =>
    capsFacts.map((fact) => ({
      identity: fact.identity,
      kind: fact.kind,
      name: fact.name,
      sources: fact.sources.filter((id): id is string => typeof id === 'string'),
      command: fact.command ?? null,
      path: fact.path ?? null,
      description: fact.description ?? null,
      imported: fact.imported,
      selected: !fact.imported && capabilityPicks.has(fact.identity),
    }));

  /** One group per account the candidates name in `sources`, titled "Asistan · Hesap" the way
   *  Hesaplar reads that account; the group count equals the number of distinct accounts (U-59). */
  const capabilityGroups = (): readonly WizardCapabilityGroup[] => {
    const rows = capabilityRows();
    return existing
      .filter((view) => rows.some((row) => row.sources.includes(view.id)))
      .map((view) => {
        const providerName = nameOf(view.provider);
        return {
          id: view.id,
          title: providerName === null ? view.label : `${providerName} · ${view.label}`,
          rows: rows.filter((row) => row.sources.includes(view.id)),
        };
      });
  };

  /** The read itself (A-94 — the query scans on every call). A failure is the skip standing:
   *  empty facts, no error surface anywhere (U-58). */
  const readCapabilities = async (): Promise<void> => {
    // Never read before an account exists: the scan walks the account store's own identity
    // directories (A-90), so the answer would be empty by construction — and a world whose last
    // account left keeps no stale candidates either.
    if (existing.length === 0) {
      capsFacts = [];
      capsTruncated = false;
      capabilityPicks = new Set();
      publish();
      return;
    }
    capsLoading = true;
    publish();
    const reply: unknown = await api.query({ type: 'capabilities.candidates' });
    if (isQueryFailure(reply) || !isCandidatesView(reply)) {
      capsError = true;
      capsFacts = [];
      capsTruncated = false;
    } else {
      capsError = false;
      capsFacts = reply.candidates.filter(isCapabilityCandidate);
      capsTruncated = reply.truncated;
    }
    capsRead = true;
    capsLoading = false;
    // A pick that the fresh read no longer lists falls away, like an account choice.
    const listed = new Set(capsFacts.map((fact) => fact.identity));
    capabilityPicks = new Set([...capabilityPicks].filter((identity) => listed.has(identity)));
    publish();
    // The read resolved into a skip while the user stands on the step: the walk moves on by
    // itself, exactly as it does when the step was skipped before landing on it (U-58).
    if (step === 'capabilities' && !capsLive()) {
      const next = stepAfter('capabilities');
      if (next !== null) {
        step = next;
        publish();
        if (step === 'budget') await ensureQuotas();
      }
    }
  };

  // --- the machine -------------------------------------------------------------------------------

  const skipped = (target: WizardStep): boolean => {
    if (target === 'capabilities') return !capsLive();
    if (target === 'order') return selection.length < 2;
    return false;
  };

  const railOf = (): readonly RailEntry[] =>
    WIZARD_STEPS.map((entry, index): RailEntry => {
      if (skipped(entry)) return { step: entry, standing: 'skipped' };
      const current = WIZARD_STEPS.indexOf(step);
      return { step: entry, standing: index < current ? 'done' : index === current ? 'cur' : 'todo' };
    });

  const stepAfter = (from: WizardStep): WizardStep | null => {
    const start = WIZARD_STEPS.indexOf(from);
    for (let at = start + 1; at < WIZARD_STEPS.length; at += 1) {
      const candidate = WIZARD_STEPS[at];
      if (candidate !== undefined && !skipped(candidate)) return candidate;
    }
    return null;
  };

  const stepBefore = (from: WizardStep): WizardStep | null => {
    const start = WIZARD_STEPS.indexOf(from);
    for (let at = start - 1; at >= 0; at -= 1) {
      const candidate = WIZARD_STEPS[at];
      if (candidate !== undefined && !skipped(candidate)) return candidate;
    }
    return null;
  };

  const readySelected = (): boolean => rowsOf().some((row) => row.selected && row.statusKey === 'candidates.status.ready');

  const consentMissing = (): boolean =>
    selectedEntries().some((entry) => isPayPerUse(viewOfEntry(entry)) && !(entry.settings.consent && entry.settings.caps.length > 0));

  const gate = (): LabelKey | null => {
    if (step === 'accounts') return readySelected() ? null : 'wizard.reason.accounts';
    // The one query runs on the step itself; the primary slot waits it out (U-58).
    if (step === 'capabilities') return capsLoading ? 'wizard.reason.capabilities' : null;
    if (step === 'budget') return consentMissing() ? 'wizard.reason.budget' : null;
    return null;
  };

  const capShown = (view: SettingsAccountView): { readonly scope: CapScope; readonly amountUsd: number } => {
    const stored = view.caps[0];
    return stored === undefined
      ? { scope: RECOMMENDED.cap.scope, amountUsd: RECOMMENDED.cap.amountUsd }
      : { scope: stored.scope, amountUsd: stored.amountUsd };
  };

  const budgetRow = (entry: Entry): BudgetRow => {
    const view = viewOfEntry(entry);
    const usage = usageView(view);
    const cap = view.caps[0] ?? null;
    const meters = meterListView(view.pools, view.meters);
    const standing = entry.fact === null ? undefined : quotas.get(entry.fact.sourcePath);
    const needsLogin = rowsOf().find((row) => row.id === entry.key)?.statusKey === 'candidates.status.needs_login';
    return {
      id: entry.key,
      providerName: nameOf(view.provider),
      label: view.label,
      markKey: view.provider === '' ? null : view.provider,
      billing: view.billing,
      viaKey: view.authMode === 'api_key',
      displayPath: view.identityDir ?? '',
      host: view.endpointHost,
      diffCount: settingDiffs(view).length,
      policy: view.limitPolicy,
      policyKey: policyLabelKey(view.limitPolicy),
      policyChoices: policyChoices(view),
      reserveShort: view.reserve.short ?? 0,
      reserveLong: view.reserve.long ?? 0,
      // Either window's held-back share reads in the summary; the Ayrıntı choice always sets both.
      reservePercent: Math.round((view.reserve.short ?? view.reserve.long ?? 0) * 100),
      meters,
      meterEmpty:
        meters.rows.length > 0
          ? null
          : meterListEmpty({ loading: standing?.state === 'loading', failed: standing?.state === 'error', needsLogin }),
      cap: cap === null ? null : { scope: cap.scope, amountUsd: cap.amountUsd, warnPercent: cap.warnPercent },
      capShown: capShown(view),
      spentUsd: usage.kind === 'spend' ? usage.spentUsd : null,
      needsConsent: isPayPerUse(view),
      consented: view.consentedModels.includes('*'),
    };
  };

  /** P-67: the add-another-account card's state — present exactly while the home-rooted CLI is
   *  installed on this machine (an uninstalled CLI has no login to point a directory at). */
  const agyAddState = (): WizardState['agyAdd'] => {
    const fact = providerFacts.find((provider) => provider.defId === AGY_PROVIDER_ID && provider.binPath !== null);
    if (fact === undefined) return null;
    return { path: agyAddPath, noteKey: agyAddNote, providerName: fact.name };
  };

  const compute = (): WizardState => {
    const selected = selectedEntries();
    const budgetRows = selected.map(budgetRow);
    const reason = visible ? gate() : null;
    const editorEntry = editorWork === null ? undefined : entryOf(editorWork.key);
    return {
      visible,
      checking,
      step,
      rail: railOf(),
      rows: rowsOf(),
      providers: providerRows(providerFacts),
      installed: providerFacts.filter((fact) => fact.binPath !== null).map((fact) => ({ id: fact.defId, name: fact.name })),
      loading,
      capabilitiesLoading: capsLoading,
      capabilityGroups: capabilityGroups(),
      capabilityTruncated: capsTruncated,
      capabilityPicked: capsFacts.filter((fact) => !fact.imported && capabilityPicks.has(fact.identity)).length,
      capabilitiesLive: capsLive(),
      capabilityRejects: importRejects,
      order: orderEntries(),
      budget: {
        subscriptions: budgetRows.filter((row) => !row.needsConsent),
        payPerUse: budgetRows.filter((row) => row.needsConsent),
      },
      editor:
        editorWork === null || editorEntry === undefined ? null : { key: editorWork.key, account: viewOf(editorEntry.base, editorWork.settings) },
      canBack: visible && stepBefore(step) !== null,
      canSkip: step === 'budget',
      nextEnabled: !finishing && finished === null && reason === null,
      reasonKey: reason,
      agyAdd: agyAddState(),
      finishing,
      finishPhase,
      finishError,
      lastOutcome,
      finished,
    };
  };

  let state: WizardState = compute();
  const publish = (): void => {
    state = compute();
    for (const listener of [...listeners]) listener();
  };

  // --- reads -----------------------------------------------------------------------------------

  /** Reads one candidate's quota preview; a compatible endpoint has no provider to ask (A-82). */
  const readQuota = async (fact: CandidateFact): Promise<void> => {
    if (fact.kind === 'compatible_endpoint') {
      quotas.set(fact.sourcePath, { state: 'error' });
      publish();
      return;
    }
    if (!quotas.has(fact.sourcePath)) quotas.set(fact.sourcePath, { state: 'loading' });
    publish();
    const reply: unknown = await api.query({ type: 'accounts.candidateQuota', sourcePath: fact.sourcePath });
    const view = isQuotaView(reply) ? reply : null;
    quotas.set(fact.sourcePath, view !== null && view.ok ? { state: 'ok', pools: view.pools, meters: view.meters } : { state: 'error' });
    publish();
  };

  /** The quota of every selected candidate that has none yet — the budget step and the editor need it. */
  const ensureQuotas = async (): Promise<void> => {
    const wanted = selectedEntries().flatMap((entry) => (entry.fact !== null && !quotas.has(entry.fact.sourcePath) ? [entry.fact] : []));
    await Promise.all(wanted.map(readQuota));
  };

  let inFlight: Promise<void> | null = null;

  const runRead = async (refresh: boolean, showLoading: boolean): Promise<void> => {
    if (showLoading) {
      loading = true;
      publish();
    }
    const candidateQuery: Query = refresh ? { type: 'accounts.candidates', fresh: true } : { type: 'accounts.candidates' };
    const [candidateReply, providerReply, accountsReply] = await Promise.all([
      api.query(candidateQuery),
      api.query({ type: 'providers.discovered' }),
      api.query({ type: 'settings.accounts' }),
    ]);
    facts = !isQueryFailure(candidateReply) && Array.isArray(candidateReply) ? candidateReply.filter(isFact) : [];
    providerFacts = !isQueryFailure(providerReply) && Array.isArray(providerReply) ? providerReply.filter(isProviderFact) : [];
    existing = isAccountsView(accountsReply) ? accountsReply.accounts.filter(isAccountView) : [];
    if (!loaded) {
      // Accounts added earlier start chosen, and so does every ready candidate (U-42): a re-run of
      // the wizard is never stuck behind an empty selection. A candidate whose token overrides its
      // login reads "Kurulum bekliyor" until its key is moved (U-262), so it is not chosen for
      // them — the first read holds no moved key yet.
      const ready = candidateRows(facts, null, importTokens, providerFacts)
        .filter((row) => row.statusKey === 'candidates.status.ready' && row.selectable)
        .map((row) => row.id);
      selection = [...selection, ...[...existing.map((view) => view.id), ...ready].filter((id) => !selection.includes(id))];
      loaded = true;
    }
    // A choice that is no longer listed (added elsewhere, vanished on rescan) falls away, and so
    // does one whose row can no longer be adopted — unreadable on a rescan (U-263).
    const listed = new Set(entries().map((entry) => entry.key));
    const adoptable = new Set(rowsOf().filter((row) => row.selectable).map((row) => row.id));
    selection = selection.filter((key) => listed.has(key) && adoptable.has(key));
    for (const key of [...quotas.keys()]) if (!listed.has(key)) quotas.delete(key);
    if (showLoading) {
      loading = false;
    }
    publish();
  };

  /** One scan at a time: a plain ask while one runs joins it; a fresh ask waits for it, then runs (U-260). */
  const read = (refresh: boolean, showLoading = true): Promise<void> => {
    if (inFlight !== null) return refresh ? inFlight.then(() => read(true, showLoading)) : inFlight;
    const current = runRead(refresh, showLoading).finally(() => {
      inFlight = null;
    });
    inFlight = current;
    return current;
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
    // A wizard already finished in this session does not come back (the shell opened Anasayfa).
    visible = !completed;
    publish();
    if (!loaded) await read(false);
  };

  // `accounts.changed` — an adoption, a removal or a quota poll elsewhere: the lists the wizard
  // shows are read again, and a candidate's quota with them. A finish in flight, stopped on its
  // failed line or handing off owns the window: a re-read there could drop an already-adopted
  // candidate out of the selection under the retry that must resume from it (U-49). Background
  // updates do not re-enter loading (U-261).
  deps.changes?.((change) => {
    if (change.type !== 'accounts.changed' || !visible || !loaded || finishing || finishPhase !== null || finished !== null) return;
    void (async () => {
      await read(false, false);
      quotas.clear();
      if (step === 'budget' || editorWork !== null) await ensureQuotas();
      // The adopted set changed: Yetenekler's answer changes with it (U-58).
      await readCapabilities();
    })();
  });

  // --- the finish -------------------------------------------------------------------------------

  const outcomeOf = (command: Command, result: CommandResult): WizardOutcome => ({
    command: command.type,
    result,
    labelKey: commandResultKey(command.type, result),
  });

  const failWith = (phase: FinishPhase, outcome: WizardOutcome): void => {
    lastOutcome = outcome;
    // The list stops on the failing line — its phases before it keep their checks (U-49).
    finishPhase = phase;
    finishError = { phase, reasonKey: outcome.labelKey };
    finishing = false;
    publish();
  };

  const finish = async (): Promise<void> => {
    if (!visible || completed || finished !== null) return;
    finishing = true;
    lastOutcome = null;
    finishError = null;
    // A fresh run walks from the accounts; a retry picks the run up where it stopped, so the
    // lines before the failure keep their checks and their writes (U-49).
    finishPhase = finishResume;
    publish();
    const readyCount = rowsOf().filter((row) => row.selected && row.statusKey === 'candidates.status.ready').length;
    // The distinct picked, not-yet-imported identities (U-60): imported rows are never sent, and
    // a shared candidate is one identity however many groups list it.
    const capChosen = capsFacts.filter((fact) => !fact.imported && capabilityPicks.has(fact.identity)).map((fact) => fact.identity);
    // Every chosen entry's account id, read without writing anything: a stored account is its
    // own id, an adopted one comes from the run's memo. The accounts phase adopts only what is
    // still missing — a retry can never produce a second copy of an account. Defence in depth
    // (U-263): a selected row that cannot be adopted into a working account — unreadable, or its
    // key still not moved — is skipped everywhere: the adoption, the chain and the drafts.
    const adoptableKeys = new Set(rowsOf().filter((row) => row.selected && row.selectable).map((row) => row.id));
    const chosen = entries().filter((candidate) => selection.includes(candidate.key) && adoptableKeys.has(candidate.key));
    const ids = new Map<string, string>();
    for (const entry of chosen) {
      // Only a stored account is its own id; a candidate and a chosen identity directory
      // (P-67) both wait for the adoption below to name theirs.
      if (entry.fact === null && !entry.manual) ids.set(entry.key, entry.key);
      else {
        const adopted = adoptedIds.get(entry.key);
        if (adopted !== undefined) ids.set(entry.key, adopted);
      }
    }
    if (finishPhase === 'accounts') {
      // Adopt in list order; a stored account keeps its id.
      for (const entry of chosen) {
        if (ids.has(entry.key)) continue;
        // A chosen identity directory adopts through the P-67 form — no scan stands behind it;
        // a scanned candidate keeps the source-path form.
        const command: Command = entry.manual
          ? {
              type: 'account.adopt',
              provider: AGY_PROVIDER_ID,
              identityDir: entry.base.identityDir ?? '',
              label: entry.settings.label,
            }
          : {
              type: 'account.adopt',
              sourcePath: entry.fact?.sourcePath ?? entry.key,
              label: entry.settings.label,
              ...(importTokens.has(entry.key) ? { importToken: true } : {}),
            };
        const result = await api.command(actor, command);
        if (!result.ok || result.id === undefined) {
          failWith('accounts', outcomeOf(command, result.ok ? { ok: false, code: 'not_found' } : result));
          return;
        }
        adoptedIds.set(entry.key, result.id);
        ids.set(entry.key, result.id);
      }
      finishPhase = 'capabilities';
      finishResume = 'capabilities';
      // The phase owns a progress line only while an import really runs: a wizard with nothing
      // picked flips through without a publish, so its list keeps its own lines (U-49).
      if (capChosen.length > 0) publish();
    }

    if (finishPhase === 'capabilities') {
      // One call for every picked identity (U-60). A rejected row or a failed call never blocks
      // the finish: the rows become the end note and the walk goes on.
      if (capChosen.length > 0) {
        const command: Command = { type: 'capabilities.import', identities: capChosen };
        try {
          const result = await api.command(actor, command);
          if (result.ok && result.results !== undefined) {
            importRejects = result.results
              .filter((row) => row.status === 'rejected')
              .map((row) => ({
                name: capsFacts.find((fact) => fact.identity === row.identity)?.name ?? row.identity,
                reason: row.reason ?? 'not_found',
              }));
          }
        } catch {
          // A thrown failure leaves nothing to list; the finish goes on (U-60).
        }
      }
      finishPhase = 'order';
      finishResume = 'order';
      publish();
    }

    if (finishPhase === 'order') {
      // The chain is written before the budget: the progress lines check in their own order —
      // the accounts exist, then the order binds every role (A-49), then the drafts land.
      const rolesReply: unknown = await api.query({ type: 'roles.list' });
      if (isQueryFailure(rolesReply)) {
        failWith('order', { command: 'binding.save', result: rolesReply, labelKey: queryFailureKey(rolesReply) });
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
          failWith('order', outcomeOf(command, result));
          return;
        }
      }
      // The assistant rides the same order: without its own binding the chat would fall back
      // to a derived order instead of the one just chosen.
      const assistant = bindingCommand(ASSISTANT_ROLE, chain, null, null);
      const assistantResult = await api.command(actor, assistant);
      if (!assistantResult.ok) {
        failWith('order', outcomeOf(assistant, assistantResult));
        return;
      }
      finishPhase = 'budget';
      finishResume = 'budget';
      publish();
    }

    if (finishPhase === 'budget') {
      // The drafts land on the stored accounts: only what differs from what is stored. The read
      // is a catalog skip (A-86): caps and consents need no billing view, so finishing n new
      // accounts starts no live model listing.
      const accountsReply: unknown = await api.query({ type: 'settings.accounts', catalog: 'skip' });
      if (isQueryFailure(accountsReply)) {
        failWith('budget', { command: 'account.save', result: accountsReply, labelKey: queryFailureKey(accountsReply) });
        return;
      }
      const stored = isAccountsView(accountsReply) ? accountsReply.accounts.filter(isAccountView) : [];
      for (const entry of chosen) {
        const id = ids.get(entry.key);
        const real = stored.find((view) => view.id === id);
        if (real === undefined) {
          failWith('budget', outcomeOf({ type: 'account.save', provider: '', label: '', authMode: '' }, { ok: false, code: 'not_found' }));
          return;
        }
        for (const command of settingsCommands(real, entry.settings)) {
          const result = await api.command(actor, command);
          if (!result.ok) {
            failWith('budget', outcomeOf(command, result));
            return;
          }
        }
      }
      // The leave itself is the last line: its spinner stands while the handoff is prepared,
      // then the shell opens Anasayfa with the toast, the window fades over it and `ackFinish`
      // takes it down — the line's check is the finished flag itself.
      finishPhase = 'home';
      publish();
    }

    finishing = false;
    completed = true;
    finished = { accounts: readyCount };
    publish();
  };

  /** Ready subscriptions first, then the rest; each class keeps its order (U-42). */
  const rankSelection = (): void => {
    const statusOf = new Map(rowsOf().map((row) => [row.id, row.statusKey]));
    const rank = (key: string, at: number): number => {
      const entry = entryOf(key);
      return (entry !== undefined && spendsMoney(entry.base.billing) ? 1000 : 0) + (statusOf.get(key) === 'candidates.status.ready' ? 0 : 500) + at;
    };
    selection = selection
      .map((key, at) => ({ key, rank: rank(key, at) }))
      .sort((a, b) => a.rank - b.rank)
      .map((item) => item.key);
  };

  const advance = async (): Promise<void> => {
    if (step === 'budget') {
      await finish();
      return;
    }
    // Leaving Hesaplar fixes the starting order of the chosen accounts and starts Yetenekler's
    // one read (U-58) — the step it lands on holds the skeleton while the query runs.
    if (step === 'accounts') {
      rankSelection();
      void readCapabilities();
    }
    const next = stepAfter(step);
    if (next === null) return;
    step = next;
    publish();
    if (step === 'budget') await ensureQuotas();
  };

  // --- the store ---------------------------------------------------------------------------------

  const patchDraft = (key: string, patch: (settings: DraftSettings) => DraftSettings): void => {
    const entry = entryOf(key);
    if (entry === undefined) return;
    drafts.set(key, patch(entry.settings));
  };

  const capEntry = (scope: CapScope, amountUsd: number): Caps[number] => ({ scope, amountUsd, warnPercent: RECOMMENDED.warnPercent });

  return {
    open,
    state: () => state,
    next: async () => {
      if (!visible || finishing || finished !== null || !state.nextEnabled) return;
      await advance();
    },
    skip: async () => {
      if (!visible || finishing || finished !== null || !state.canSkip) return;
      await advance();
    },
    back: () => {
      if (!visible || finishing || finished !== null) return;
      const before = stepBefore(step);
      if (before === null) return;
      step = before;
      // Leaving the step drops a stopped finish's list with it; the next finish is a fresh run
      // (the adoption memo still holds, so it adopts nothing twice) (U-49).
      finishPhase = null;
      finishError = null;
      finishResume = 'accounts';
      publish();
    },
    goTo: (target) => {
      if (!visible || finishing || finished !== null) return;
      if (WIZARD_STEPS.indexOf(target) >= WIZARD_STEPS.indexOf(step) || skipped(target)) return;
      step = target;
      finishPhase = null;
      finishError = null;
      finishResume = 'accounts';
      publish();
    },
    select: (key) => {
      const row = rowsOf().find((entry) => entry.id === key);
      if (row === undefined || !row.selectable) return;
      if (selection.includes(key)) {
        selection = selection.filter((entry) => entry !== key);
      } else {
        selection = [...selection, key];
      }
      publish();
    },
    clearSelection: () => {
      selection = [];
      publish();
    },
    selectAllReady: () => {
      selection = rowsOf()
        .filter((row) => row.selectable)
        .map((row) => row.id);
      publish();
    },
    setImportToken: (key, on) => {
      if (on) importTokens.add(key);
      else {
        importTokens.delete(key);
        // A row back to "Kurulum bekliyor" cannot stand selected (U-262).
        selection = selection.filter((entry) => entry !== key);
      }
      publish();
    },
    setAgyAddPath: (path) => {
      agyAddPath = path;
      agyAddNote = null;
      publish();
    },
    addAgyAccount: () => {
      // The local checks mirror the adoption's own refusals (A-43's absolute path, an occupied
      // directory) so the card never offers a finish that is bound to fail; the server stays the
      // authority and its failure codes still map through U-8 at the finish.
      const dir = agyAddPath.trim();
      if (dir === '') {
        agyAddNote = 'wizard.accounts.agyAdd.note.empty';
      } else if (!dir.startsWith('/')) {
        agyAddNote = 'wizard.accounts.agyAdd.note.relative';
      } else if (
        manualHomes.includes(dir) ||
        entries().some((entry) => entry.base.identityDir === dir)
      ) {
        agyAddNote = 'wizard.accounts.agyAdd.note.taken';
      } else {
        manualHomes = [...manualHomes, dir];
        selection = [...selection, `manual:${dir}`];
        agyAddPath = '';
        agyAddNote = null;
      }
      publish();
    },
    rescan: async () => {
      await read(true);
      quotas.clear();
      if (step === 'budget') await ensureQuotas();
    },
    toggleCapability: (id) => {
      // An imported row is already there: it is shown checked and disabled, never picked (U-59).
      const fact = capsFacts.find((entry) => entry.identity === id);
      if (fact === undefined || fact.imported) return;
      const next = new Set(capabilityPicks);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      capabilityPicks = next;
      publish();
    },
    moveTo: (key, index) => {
      const moved = moveItem(selection, selection.indexOf(key), index);
      if (moved === null) return;
      selection = moved;
      publish();
    },
    openEditor: async (key) => {
      const entry = entryOf(key);
      if (entry === undefined) return;
      editorWork = { key, settings: entry.settings };
      publish();
      await ensureQuotas();
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
    setPolicy: (key, policy) => {
      patchDraft(key, (settings) => ({ ...settings, limitPolicy: policy }));
      publish();
    },
    setReserve: (key, percent) => {
      if (entryOf(key) === undefined) return;
      const share = percent === null ? null : percent / 100;
      patchDraft(key, (settings) => ({ ...settings, reserve: { short: share, long: share } }));
      publish();
    },
    setCap: (key, input) => {
      const amountUsd = parseAmountUsd(input.amount);
      if (amountUsd === null || entryOf(key) === undefined) return false;
      patchDraft(key, (settings) => ({
        ...settings,
        caps: [...settings.caps.filter((cap) => cap.scope !== input.scope), capEntry(input.scope, amountUsd)],
      }));
      publish();
      return true;
    },
    allowSpend: (key, input) => {
      const amountUsd = parseAmountUsd(input.amount);
      if (amountUsd === null || entryOf(key) === undefined) return false;
      patchDraft(key, (settings) => ({
        ...settings,
        consent: true,
        caps: [...settings.caps.filter((cap) => cap.scope !== input.scope), capEntry(input.scope, amountUsd)],
      }));
      publish();
      return true;
    },
    revokeSpend: (key) => {
      patchDraft(key, (settings) => ({ ...settings, consent: false }));
      publish();
    },
    refreshQuota: async (key) => {
      const fact = entryOf(key)?.fact ?? null;
      if (fact === null) return;
      quotas.delete(fact.sourcePath);
      await readQuota(fact);
    },
    ackFinish: () => {
      if (finished === null) return;
      finished = null;
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
