// stores/candidates.ts — U-34: the discovered accounts (`accounts.candidates`) and providers
// (`providers.discovered`) as one list for Settings → Hesaplar → "Eklenmemiş" and the wizard.
// The pure row mapping decides mark, label, status and selectability; the store holds the
// selection and the key-move switch (always off on a fresh selection) and issues `account.adopt`
// — with `importToken: true` only when the switch is on. No value ever travels through here:
// a candidate carries only a path and an endpoint host. Results map through results.ts (U-8).
import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import type { RowStanding } from './account-groups';
import { commandResultKey, isQueryFailure } from './results';
import type { SettingsIntentOutcome } from './settings';

/** The candidate fields this list reads, as `accounts.candidates` reports them. */
export interface CandidateFact {
  readonly sourcePath: string;
  readonly displayPath: string;
  readonly kind: 'subscription' | 'compatible_endpoint' | 'machine_login';
  readonly routeKind: string;
  /** The def id the route kind belongs to; null when unknown (A-67). */
  readonly provider: string | null;
  /** The candidate's route billing (A-83a). */
  readonly billing: 'included' | 'metered' | 'unknown';
  readonly endpointHost?: string;
  readonly hasOauthLogin: boolean;
  readonly envOverrides: readonly ('endpoint' | 'token' | 'model')[];
  readonly warnings: readonly ('env_overrides_login' | 'unreadable')[];
  readonly alreadyAdded: boolean;
}

/** The `providers.discovered` fields this list reads. */
export interface ProviderFact {
  readonly defId: string;
  readonly name: string;
  readonly installUrl: string | null;
  readonly binPath: string | null;
  readonly version: string | null;
  readonly loggedIn: boolean | null;
  readonly optionalFlags: readonly string[];
}

export type CandidateStatusKey = Extract<LabelKey, `candidates.status.${string}`>;
export type CandidateWarnKey = Extract<LabelKey, `candidates.warn.${string}`>;

export interface CandidateRow {
  /** The candidate's source path. */
  readonly id: string;
  /** The provider whose mark the row shows; null reads as the neutral glyph. */
  readonly markKey: string | null;
  readonly label: string;
  readonly endpointHost: string | null;
  readonly statusKey: CandidateStatusKey;
  readonly selectable: boolean;
  readonly selected: boolean;
  /** Why the row is disabled; null while selectable. */
  readonly disabledReasonKey: LabelKey | null;
  readonly warnKeys: readonly CandidateWarnKey[];
  /** Whether the separate key-move card shows: selected and `envOverrides` holds `token`. */
  readonly keyMoveCard: boolean;
  /** The provider's def id; null when discovery does not know it. */
  readonly provider: string | null;
  /** The path the account reads from, as the candidate displays it (mono in the row). */
  readonly displayPath: string;
  /** The candidate's route billing (A-83a): the row's tag and the Bütçe grouping read it. */
  readonly billing: 'included' | 'metered' | 'unknown';
  /** The route rides a key (a compatible endpoint): an included one reads "Abonelik · anahtarla". */
  readonly viaKey: boolean;
  /** The sentence under a row that needs the user: a login in the terminal, or "test it after setup". */
  readonly hintKey: LabelKey | null;
}

export interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly statusKey: CandidateStatusKey;
  /** The "log in in a terminal, then scan again" sentence (with `{name}`); only while a login is needed. */
  readonly hintKey: LabelKey | null;
  /** "Test it in Settings after setup" (U-39): only while the login probe proved nothing. The
   *  wizard shows it; a provider that is not an account yet has no "Test et". */
  readonly testLaterKey: LabelKey | null;
  /** Where to install it, shown as copyable text; only while the provider is not found. */
  readonly installUrl: string | null;
}

const WARN_KEY: Readonly<Record<'env_overrides_login', CandidateWarnKey>> = {
  env_overrides_login: 'candidates.warn.env_overrides_login',
};

/** The lamp hue of a status word: the book's proceed / signal / dim (error is never a status here). */
export type LampTone = 'proceed' | 'signal' | 'dim' | 'error' | 'info';

const CANDIDATE_TONE: Readonly<Record<CandidateStatusKey, LampTone>> = {
  'candidates.status.ready': 'proceed',
  'candidates.status.key_needed': 'signal',
  'candidates.status.needs_login': 'signal',
  'candidates.status.unreadable': 'dim',
  'candidates.status.not_installed': 'dim',
  'candidates.status.unknown': 'dim',
  'candidates.status.scanning': 'info',
};

export const candidateStatusTone = (key: CandidateStatusKey): LampTone => CANDIDATE_TONE[key];

/** A candidate row's U-45 standing: needs-login and the probe that proved nothing (U-42's
 *  Doğrulanamadı) are the only failing ones (U-45a) and feed the closed summary; every other
 *  status stays in Bulunanlar. */
const CANDIDATE_STANDING: Readonly<Record<CandidateStatusKey, RowStanding>> = {
  'candidates.status.ready': 'ready',
  'candidates.status.key_needed': 'other',
  'candidates.status.needs_login': 'needsLogin',
  'candidates.status.unreadable': 'other',
  'candidates.status.not_installed': 'other',
  'candidates.status.unknown': 'unverified',
  'candidates.status.scanning': 'other',
};

export const candidateStanding = (key: CandidateStatusKey): RowStanding => CANDIDATE_STANDING[key];

export type ProviderStatus = 'ready' | 'needs_login' | 'not_installed' | 'unknown';

/** Found + logged in is ready, found + logged out needs a login, not found is not installed; a
 *  missing login probe proves nothing and reads as unknown. Shared by every provider list. Pure. */
export const providerStatus = (fact: Pick<ProviderFact, 'binPath' | 'loggedIn'>): ProviderStatus =>
  fact.binPath === null
    ? 'not_installed'
    : fact.loggedIn === true
      ? 'ready'
      : fact.loggedIn === false
        ? 'needs_login'
        : 'unknown';

const CANDIDATE_STATUS_KEY: Readonly<Record<ProviderStatus, CandidateStatusKey>> = {
  ready: 'candidates.status.ready',
  needs_login: 'candidates.status.needs_login',
  not_installed: 'candidates.status.not_installed',
  unknown: 'candidates.status.unknown',
};

/** How many candidates the Eklenmemiş list shows: every one not yet added. The Hesaplar dot reads
 *  this same count, so the dot and the list cannot disagree. Pure. */
export const listedCandidateCount = (facts: readonly Pick<CandidateFact, 'alreadyAdded'>[]): number =>
  facts.filter((fact) => !fact.alreadyAdded).length;

/** The Hesaplar dot: once the list has loaded, exactly its rows decide (none rendered, no dot); before
 *  that the startup mirror's reading stands. */
export const candidateDot = (state: Pick<CandidatesState, 'loaded' | 'rows'>, mirrored: boolean): boolean =>
  state.loaded ? state.rows.length > 0 : mirrored;

/** What the list body shows: the scanning line while a read is in flight, the empty text only once a
 *  read has answered with nothing, else the rows. Pure. */
export const listBody = (state: Pick<CandidatesState, 'loading' | 'loaded' | 'rows' | 'providers'>): 'scanning' | 'empty' | 'list' =>
  state.loading ? 'scanning' : state.loaded && state.rows.length === 0 && state.providers.length === 0 ? 'empty' : 'list';

/** The rows of the list: `alreadyAdded` candidates are not listed. Pure. */
export const candidateRows = (
  facts: readonly CandidateFact[],
  selected: string | null,
  importToken: boolean,
  providers: readonly ProviderFact[] = [],
): readonly CandidateRow[] =>
  facts
    .filter((fact) => !fact.alreadyAdded)
    .map((fact): CandidateRow => {
      const unreadable = fact.warnings.includes('unreadable');
      const isSelected = !unreadable && fact.sourcePath === selected;
      const keyMoveCard = isSelected && fact.envOverrides.includes('token');
      // A machine-login candidate has no folder to read: its standing is its provider's login
      // probe (P-53), and a probe that proved nothing is "Doğrulanamadı", never "Hazır".
      const loginFact = fact.kind === 'machine_login' ? providers.find((provider) => provider.defId === fact.provider) : undefined;
      const loginStatus: CandidateStatusKey | null =
        fact.kind !== 'machine_login'
          ? null
          : loginFact === undefined
            ? 'candidates.status.unknown'
            : CANDIDATE_STATUS_KEY[providerStatus(loginFact)];
      const statusKey: CandidateStatusKey = unreadable
        ? 'candidates.status.unreadable'
        : keyMoveCard && !importToken
          ? 'candidates.status.key_needed'
          : (loginStatus ?? 'candidates.status.ready');
      const hintKey: LabelKey | null =
        statusKey === 'candidates.status.needs_login'
          ? 'candidates.hint.login'
          : statusKey === 'candidates.status.unknown'
            ? 'candidates.hint.testLater'
            : null;
      return {
        id: fact.sourcePath,
        markKey: fact.provider,
        label: fact.displayPath,
        endpointHost: fact.endpointHost ?? null,
        statusKey,
        selectable: !unreadable,
        selected: isSelected,
        disabledReasonKey: unreadable ? 'candidates.reason.unreadable' : null,
        warnKeys: fact.warnings.includes('env_overrides_login') ? [WARN_KEY.env_overrides_login] : [],
        keyMoveCard,
        provider: fact.provider,
        displayPath: fact.displayPath,
        billing: fact.billing,
        viaKey: fact.kind === 'compatible_endpoint' || fact.endpointHost !== undefined,
        hintKey,
      };
    });

/** A provider row of the discovered-accounts list. Pure. */
export const providerRows = (facts: readonly ProviderFact[]): readonly ProviderRow[] =>
  facts.map((fact): ProviderRow => ({
    id: fact.defId,
    name: fact.name,
    hintKey: fact.binPath !== null && fact.loggedIn === false ? 'candidates.hint.login' : null,
    testLaterKey: providerStatus(fact) === 'unknown' ? 'candidates.hint.testLater' : null,
    installUrl: fact.binPath === null ? fact.installUrl : null,
    statusKey: CANDIDATE_STATUS_KEY[providerStatus(fact)],
  }));

export interface CandidatesState {
  readonly loading: boolean;
  readonly rows: readonly CandidateRow[];
  readonly providers: readonly ProviderRow[];
  /** The selected candidate's source path, or null. */
  readonly selected: string | null;
  /** The key-move switch; false on every fresh selection. */
  readonly importToken: boolean;
  /** "Ekle" shows only while a candidate is selected. */
  readonly addVisible: boolean;
  /** True once a read has finished: from then on the list's own count is the dot's truth. */
  readonly loaded: boolean;
  readonly adopting: boolean;
  readonly lastOutcome: SettingsIntentOutcome | null;
}

export interface CandidatesStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  /** Called after a successful adoption, so other mirrors (the Hesaplar dot) can re-read. */
  readonly onAdopted?: () => void;
  /** The api's change events: an `accounts.changed` re-reads a list that has been read once (U-44). */
  readonly changes?: (listener: (change: { readonly type: string }) => void) => () => void;
}

export interface CandidatesStore {
  /** Reads both queries (cached candidates). */
  load(): Promise<void>;
  /** "Yeniden tara": a fresh scan of both. */
  rescan(): Promise<void>;
  select(id: string | null): void;
  setImportToken(on: boolean): void;
  /** Adopts the selected candidate; null when nothing adoptable is selected. */
  adopt(): Promise<SettingsIntentOutcome | null>;
  /** A row's "Ekle" (U-43): selects the candidate and adopts it at once, unless it needs the
   *  key-move decision first — then the row only opens its card and a second "Ekle" adopts. */
  add(id: string): Promise<SettingsIntentOutcome | null>;
  state(): CandidatesState;
  subscribe(listener: () => void): () => void;
}

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

export const isProviderFact = (value: unknown): value is ProviderFact =>
  typeof value === 'object' && value !== null && 'defId' in value && typeof value.defId === 'string' && 'name' in value && typeof value.name === 'string' && 'binPath' in value;

/** The account's default label: the last segment of the candidate's display path. */
const labelOf = (displayPath: string): string => displayPath.split('/').filter((part) => part !== '').pop() ?? displayPath;

export const createCandidatesStore = (deps: CandidatesStoreDeps): CandidatesStore => {
  const { api, actor, onAdopted } = deps;
  let facts: readonly CandidateFact[] = [];
  let providerFacts: readonly ProviderFact[] = [];
  let selected: string | null = null;
  let importToken = false;
  let loading = false;
  let loaded = false;
  let adopting = false;
  let lastOutcome: SettingsIntentOutcome | null = null;
  let state: CandidatesState = { loading, rows: [], providers: [], selected, importToken, addVisible: false, loaded: false, adopting, lastOutcome };
  const listeners = new Set<() => void>();

  const publish = (): void => {
    const rows = candidateRows(facts, selected, importToken, providerFacts);
    state = {
      loading,
      rows,
      providers: providerRows(providerFacts),
      selected,
      importToken,
      addVisible: rows.some((row) => row.selected),
      loaded,
      adopting,
      lastOutcome,
    };
    for (const listener of [...listeners]) listener();
  };

  const read = async (refresh: boolean): Promise<void> => {
    loading = true;
    publish();
    const candidateQuery: Query = refresh ? { type: 'accounts.candidates', refresh: true } : { type: 'accounts.candidates' };
    const [candidateReply, providerReply] = await Promise.all([
      api.query(candidateQuery),
      api.query({ type: 'providers.discovered' }),
    ]);
    facts = !isQueryFailure(candidateReply) && Array.isArray(candidateReply) ? candidateReply.filter(isFact) : [];
    providerFacts = !isQueryFailure(providerReply) && Array.isArray(providerReply) ? providerReply.filter(isProviderFact) : [];
    // A selection that is no longer listed (added elsewhere, vanished on rescan) falls away.
    if (selected !== null && !candidateRows(facts, selected, false, providerFacts).some((row) => row.id === selected)) {
      selected = null;
      importToken = false;
    }
    loading = false;
    loaded = true;
    publish();
  };

  deps.changes?.((change) => {
    if (change.type === 'accounts.changed' && loaded && !loading) void read(false);
  });

  const adopt = async (): Promise<SettingsIntentOutcome | null> => {
    const row = candidateRows(facts, selected, importToken, providerFacts).find((entry) => entry.selected);
    const fact = facts.find((entry) => entry.sourcePath === row?.id);
    if (row === undefined || fact === undefined || adopting) return null;
    adopting = true;
    publish();
    const command: Command = {
      type: 'account.adopt',
      sourcePath: fact.sourcePath,
      label: labelOf(fact.displayPath),
      ...(importToken ? { importToken: true } : {}),
    };
    const result = await api.command(actor, command);
    const outcome: SettingsIntentOutcome = {
      command: command.type,
      result,
      labelKey: commandResultKey(command.type, result),
    };
    lastOutcome = outcome;
    adopting = false;
    if (result.ok) {
      selected = null;
      importToken = false;
      publish();
      await read(true);
      onAdopted?.();
    } else {
      publish();
    }
    return outcome;
  };

  return {
    load: () => read(false),
    rescan: () => read(true),
    select: (id) => {
      if (id !== null && !candidateRows(facts, null, false, providerFacts).some((row) => row.id === id && row.selectable)) return;
      selected = id === selected ? null : id;
      importToken = false;
      publish();
    },
    setImportToken: (on) => {
      importToken = on;
      publish();
    },
    add: async (id) => {
      const row = candidateRows(facts, null, false, providerFacts).find((entry) => entry.id === id);
      if (row === undefined || !row.selectable) return null;
      if (selected !== id) {
        selected = id;
        importToken = false;
        publish();
        // A candidate whose token overrides the login waits for the user's key-move choice.
        if (candidateRows(facts, selected, false, providerFacts).some((entry) => entry.id === id && entry.keyMoveCard)) return null;
      }
      return adopt();
    },
    adopt,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
