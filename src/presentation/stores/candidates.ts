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
import { commandResultKey, isQueryFailure } from './results';
import type { SettingsIntentOutcome } from './settings';

/** The candidate fields this list reads, as `accounts.candidates` reports them. */
export interface CandidateFact {
  readonly sourcePath: string;
  readonly displayPath: string;
  readonly kind: 'subscription' | 'compatible_endpoint';
  readonly routeKind: string;
  /** The def id the route kind belongs to; null when unknown (A-53). */
  readonly provider: string | null;
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
}

export interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly statusKey: CandidateStatusKey;
  /** The "log in in a terminal, then scan again" sentence (with `{name}`); only while a login is needed. */
  readonly hintKey: LabelKey | null;
  /** Where to install it, shown as copyable text; only while the provider is not found. */
  readonly installUrl: string | null;
}

const WARN_KEY: Readonly<Record<'env_overrides_login', CandidateWarnKey>> = {
  env_overrides_login: 'candidates.warn.env_overrides_login',
};

/** The rows of the list: `alreadyAdded` candidates are not listed. Pure. */
export const candidateRows = (
  facts: readonly CandidateFact[],
  selected: string | null,
  importToken: boolean,
): readonly CandidateRow[] =>
  facts
    .filter((fact) => !fact.alreadyAdded)
    .map((fact): CandidateRow => {
      const unreadable = fact.warnings.includes('unreadable');
      const isSelected = !unreadable && fact.sourcePath === selected;
      const keyMoveCard = isSelected && fact.envOverrides.includes('token');
      const statusKey: CandidateStatusKey = unreadable
        ? 'candidates.status.unreadable'
        : keyMoveCard && !importToken
          ? 'candidates.status.key_needed'
          : 'candidates.status.ready';
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
      };
    });

/** A provider row: found + logged in is ready, found + logged out needs a login, not found is not
 *  installed; a missing login probe proves nothing and reads as unknown. Pure. */
export const providerRows = (facts: readonly ProviderFact[]): readonly ProviderRow[] =>
  facts.map((fact): ProviderRow => ({
    id: fact.defId,
    name: fact.name,
    hintKey: fact.binPath !== null && fact.loggedIn === false ? 'candidates.hint.login' : null,
    installUrl: fact.binPath === null ? fact.installUrl : null,
    statusKey:
      fact.binPath === null
        ? 'candidates.status.not_installed'
        : fact.loggedIn === true
          ? 'candidates.status.ready'
          : fact.loggedIn === false
            ? 'candidates.status.needs_login'
            : 'candidates.status.unknown',
  }));

export interface CandidatesState {
  readonly loading: boolean;
  readonly rows: readonly CandidateRow[];
  readonly providers: readonly ProviderRow[];
  /** The selected candidate's source path, or null. */
  readonly selected: string | null;
  /** The key-move switch; false on every fresh selection. */
  readonly importToken: boolean;
  readonly adopting: boolean;
  readonly lastOutcome: SettingsIntentOutcome | null;
}

export interface CandidatesStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  /** Called after a successful adoption, so other mirrors (the Hesaplar dot) can re-read. */
  readonly onAdopted?: () => void;
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

const isProviderFact = (value: unknown): value is ProviderFact =>
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
  let adopting = false;
  let lastOutcome: SettingsIntentOutcome | null = null;
  let state: CandidatesState = { loading, rows: [], providers: [], selected, importToken, adopting, lastOutcome };
  const listeners = new Set<() => void>();

  const publish = (): void => {
    state = {
      loading,
      rows: candidateRows(facts, selected, importToken),
      providers: providerRows(providerFacts),
      selected,
      importToken,
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
    if (selected !== null && !candidateRows(facts, selected, false).some((row) => row.id === selected)) {
      selected = null;
      importToken = false;
    }
    loading = false;
    publish();
  };

  return {
    load: () => read(false),
    rescan: () => read(true),
    select: (id) => {
      if (id !== null && !candidateRows(facts, null, false).some((row) => row.id === id && row.selectable)) return;
      selected = id === selected ? null : id;
      importToken = false;
      publish();
    },
    setImportToken: (on) => {
      importToken = on;
      publish();
    },
    adopt: async () => {
      const row = candidateRows(facts, selected, importToken).find((entry) => entry.selected);
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
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
