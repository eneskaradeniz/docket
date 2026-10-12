// stores/candidates.ts — U-34: the discovered accounts (`accounts.candidates`) and providers
// (`providers.discovered`) as one list for Settings → Hesaplar → "Eklenmemiş" and the wizard.
// The pure row mapping decides mark, label, status and selectability; the store holds the
// selection and the per-row key-move standing (U-262: a token-needing row is "Kurulum bekliyor"
// and inert until its key is moved) and issues `account.adopt` — with `importToken: true` only
// for a row whose key was moved. A successful adoption then binds every role that has no binding
// yet to the new account: the wizard is not the only door in, and an account added from Settings
// must leave the roles runnable too. No value ever travels through here: a candidate carries only
// a path and an endpoint host. Results map through results.ts (U-8).
import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { Query, RoleListItem, SettingsAccountsView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import type { RowStanding } from './account-groups';
import { commandResultKey, isQueryFailure } from './results';
import { bindingCommand, unboundRoleIds } from './roles';
import { scanStatusOf, type ScanStatus } from './scan-status';
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
  /** Whether the separate key-move card shows: `envOverrides` holds `token` — while the row
   *  waits for the move and after it, so the move can be undone before adoption (U-262). */
  readonly keyMoveCard: boolean;
  /** The row's key-move standing: off until the user moves the key, then on (U-262). */
  readonly importToken: boolean;
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
  'candidates.status.setup_pending': 'signal',
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
  'candidates.status.setup_pending': 'other',
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

/** The rows of the list: `alreadyAdded` candidates are not listed. `moved` holds the source
 *  paths whose key the user has already moved to the keychain. Pure. */
export const candidateRows = (
  facts: readonly CandidateFact[],
  selected: string | null,
  moved: ReadonlySet<string>,
  providers: readonly ProviderFact[] = [],
): readonly CandidateRow[] =>
  facts
    .filter((fact) => !fact.alreadyAdded)
    .map((fact): CandidateRow => {
      const unreadable = fact.warnings.includes('unreadable');
      // U-262: adopting a candidate whose env token is its credential would leave a secretRef
      // with nothing behind it, so the row waits for the key move instead — before any selection.
      const needsKeyMove = fact.envOverrides.includes('token');
      const keyMoved = moved.has(fact.sourcePath);
      const setupPending = needsKeyMove && !keyMoved;
      const isSelected = !unreadable && !setupPending && fact.sourcePath === selected;
      // The card stays once the key is moved, so the move can be undone before adoption.
      const keyMoveCard = needsKeyMove;
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
        : setupPending
          ? 'candidates.status.setup_pending'
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
        selectable: !unreadable && !setupPending,
        selected: isSelected,
        disabledReasonKey: unreadable ? 'candidates.reason.unreadable' : setupPending ? 'candidates.reason.setup_pending' : null,
        warnKeys: fact.warnings.includes('env_overrides_login') ? [WARN_KEY.env_overrides_login] : [],
        keyMoveCard,
        importToken: keyMoved,
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
  /** "Ekle" shows only while a candidate is selected. */
  readonly addVisible: boolean;
  /** True once a read has finished: from then on the list's own count is the dot's truth. */
  readonly loaded: boolean;
  readonly adopting: boolean;
  readonly lastOutcome: SettingsIntentOutcome | null;
  /** The scan's standing; an old result stays listed through `loading` and `error`. */
  readonly status: ScanStatus;
  /** When the last successful scan finished; null before one has. */
  readonly scannedAt: number | null;
}

export interface CandidatesStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  /** Called after a successful adoption, so other mirrors (the Hesaplar dot) can re-read. */
  readonly onAdopted?: () => void;
  /** The api's change events: an `accounts.changed` re-reads a list that has been read once (U-44). */
  readonly changes?: (listener: (change: { readonly type: string }) => void) => () => void;
  /** The clock the scan time reads; the app passes the wall clock. */
  readonly now?: () => number;
  /** Receives the discovery answer this scan already read, so the providers cache needs no
   *  second pass at start. */
  readonly onProviders?: (facts: readonly ProviderFact[]) => void;
}

export interface CandidatesStore {
  /** Reads both queries (cached candidates). */
  load(): Promise<void>;
  /** Scans only when nothing has been read yet; a result or a scan in flight is left alone. */
  ensure(): Promise<void>;
  /** "Yeniden tara": a fresh scan of both. */
  rescan(): Promise<void>;
  select(id: string | null): void;
  /** The key-move switch of one row (U-262); turning it off drops the row's selection. */
  setImportToken(id: string, on: boolean): void;
  /** Adopts the selected candidate; null when nothing adoptable is selected. */
  adopt(): Promise<SettingsIntentOutcome | null>;
  /** A row's "Ekle" (U-43): selects the candidate and adopts it at once. A row still waiting for
   *  its key move is not selectable (U-262), so its "Ekle" does nothing until the move. */
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

const isRole = (value: unknown): value is RoleListItem =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && 'name' in value;

const isAccountsView = (value: unknown): value is SettingsAccountsView =>
  typeof value === 'object' && value !== null && 'accounts' in value && Array.isArray(value.accounts) && 'bindings' in value && Array.isArray(value.bindings);

/** The account's default label: the last segment of the candidate's display path. */
const labelOf = (displayPath: string): string => displayPath.split('/').filter((part) => part !== '').pop() ?? displayPath;

export const createCandidatesStore = (deps: CandidatesStoreDeps): CandidatesStore => {
  const { api, actor, onAdopted } = deps;
  let facts: readonly CandidateFact[] = [];
  let providerFacts: readonly ProviderFact[] = [];
  let selected: string | null = null;
  /** The source paths whose key the user has moved to the keychain (U-262); sticky per row. */
  const moved = new Set<string>();
  let loading = false;
  let loaded = false;
  let failed = false;
  let scannedAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  let adopting = false;
  let lastOutcome: SettingsIntentOutcome | null = null;
  const now = deps.now ?? ((): number => Date.now());
  let state: CandidatesState = { loading, rows: [], providers: [], selected, addVisible: false, loaded: false, adopting, lastOutcome, status: 'idle', scannedAt: null };
  const listeners = new Set<() => void>();

  const publish = (): void => {
    const rows = candidateRows(facts, selected, moved, providerFacts);
    state = {
      loading,
      rows,
      providers: providerRows(providerFacts),
      selected,
      addVisible: rows.some((row) => row.selected),
      loaded,
      adopting,
      lastOutcome,
      status: scanStatusOf({ loading, loaded, failed }),
      scannedAt,
    };
    for (const listener of [...listeners]) listener();
  };

  const run = async (refresh: boolean): Promise<void> => {
    loading = true;
    publish();
    const candidateQuery: Query = refresh ? { type: 'accounts.candidates', fresh: true } : { type: 'accounts.candidates' };
    const [candidateReply, providerReply] = await Promise.all([
      api.query(candidateQuery),
      api.query({ type: 'providers.discovered' }),
    ]);
    const candidatesOk = !isQueryFailure(candidateReply) && Array.isArray(candidateReply);
    const providersOk = !isQueryFailure(providerReply) && Array.isArray(providerReply);
    // A failed read keeps the last result: only an answer replaces what is listed.
    if (candidatesOk) facts = candidateReply.filter(isFact);
    if (providersOk) {
      providerFacts = providerReply.filter(isProviderFact);
      deps.onProviders?.(providerFacts);
    }
    // A selection that is no longer listed (added elsewhere, vanished on rescan) falls away.
    if (selected !== null && !candidateRows(facts, selected, moved, providerFacts).some((row) => row.id === selected)) {
      selected = null;
    }
    failed = !candidatesOk;
    if (candidatesOk) {
      loaded = true;
      scannedAt = now();
    }
    loading = false;
    publish();
  };

  /** One scan at a time: a plain ask while one runs joins it; a fresh ask waits for it, then runs. */
  const read = (refresh: boolean): Promise<void> => {
    if (inFlight !== null) return refresh ? inFlight.then(() => read(true)) : inFlight;
    const current = run(refresh).finally(() => {
      inFlight = null;
    });
    inFlight = current;
    return current;
  };

  deps.changes?.((change) => {
    if (change.type === 'accounts.changed' && loaded && !loading) void read(false);
  });

  /** The step after a successful adoption: every role with no binding yet gets one whose chain
   *  is exactly the new account; roles that already have a binding are left untouched — this
   *  door never rewrites a chain the user or the wizard set. The chain is all it writes: a style
   *  stays unset, so "Önerilenleri uygula" keeps its work. A save that fails surfaces as the
   *  latest outcome (the toast tells the truth) but never undoes the adoption itself. */
  const bindUnboundRoles = async (accountId: string): Promise<void> => {
    const [rolesReply, settingsReply] = await Promise.all([
      api.query({ type: 'roles.list' } satisfies Query),
      api.query({ type: 'settings.accounts' } satisfies Query),
    ]);
    if (isQueryFailure(rolesReply) || isQueryFailure(settingsReply)) return;
    const roles = Array.isArray(rolesReply) ? rolesReply.filter(isRole) : [];
    const bindings = isAccountsView(settingsReply) ? settingsReply.bindings : [];
    for (const roleId of unboundRoleIds(roles, bindings)) {
      const bind: Command = bindingCommand(roleId, [{ accountId, model: null }], null, null);
      const result = await api.command(actor, bind);
      if (!result.ok) {
        lastOutcome = { command: bind.type, result, labelKey: commandResultKey(bind.type, result) };
        publish();
        return;
      }
    }
  };

  const adopt = async (): Promise<SettingsIntentOutcome | null> => {
    const row = candidateRows(facts, selected, moved, providerFacts).find((entry) => entry.selected);
    const fact = facts.find((entry) => entry.sourcePath === row?.id);
    if (row === undefined || fact === undefined || adopting) return null;
    adopting = true;
    publish();
    const command: Command = {
      type: 'account.adopt',
      sourcePath: fact.sourcePath,
      label: labelOf(fact.displayPath),
      ...(moved.has(fact.sourcePath) ? { importToken: true } : {}),
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
      moved.delete(fact.sourcePath);
      publish();
      if (result.id !== undefined) await bindUnboundRoles(result.id);
      await read(true);
      onAdopted?.();
    } else {
      publish();
    }
    return outcome;
  };

  return {
    load: () => read(false),
    ensure: () => (state.status === 'idle' ? read(false) : (inFlight ?? Promise.resolve())),
    rescan: () => read(true),
    select: (id) => {
      if (id !== null && !candidateRows(facts, null, moved, providerFacts).some((row) => row.id === id && row.selectable)) return;
      selected = id === selected ? null : id;
      publish();
    },
    setImportToken: (id, on) => {
      if (!facts.some((fact) => fact.sourcePath === id && fact.envOverrides.includes('token'))) return;
      if (on) moved.add(id);
      else {
        moved.delete(id);
        // A row back to "Kurulum bekliyor" cannot stand selected (U-262).
        if (selected === id) selected = null;
      }
      publish();
    },
    add: async (id) => {
      const row = candidateRows(facts, null, moved, providerFacts).find((entry) => entry.id === id);
      if (row === undefined || !row.selectable) return null;
      if (selected !== id) {
        selected = id;
        publish();
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
