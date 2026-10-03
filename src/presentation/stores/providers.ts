// stores/providers.ts — U-38: Settings → Sağlayıcılar. The `providers.discovered` rows (A-67) as
// a view: mark key, name, version, status word and binary path, with the providers not found on
// the machine folded into one closed group whose rows carry their install URL as copyable text.
// "Yeniden tara" re-runs discovery and rows settle as their provider answers (U-6): the store
// takes partial results (`receive`), so a source that streams per provider updates one row at a
// time. The api answers a whole pass at once, so until the reply lands every listed row stays
// "scanning" and the reply is received as one batch. A null field is shown as absent — nothing
// is invented (no version, no status, no command).
import type { Api } from '../../api/api';
import type { LabelKey } from '../labels/keys';
import { isProviderFact, providerStatus, type ProviderFact, type ProviderStatus } from './candidates';
import { isQueryFailure } from './results';

export type ProviderStatusKey = Extract<LabelKey, `providers.status.${string}`>;

export interface ProviderViewRow {
  readonly id: string;
  /** The provider whose mark the row shows. */
  readonly markKey: string;
  readonly name: string;
  readonly version: string | null;
  readonly statusKey: ProviderStatusKey;
  /** The binary's full path (the row shows it dim, the full text also goes in `title`). */
  readonly binPath: string | null;
  /** Where to install it; only on a not-found row, null when the def carries none. */
  readonly installUrl: string | null;
  /** True while this provider's answer is still pending. */
  readonly scanning: boolean;
}

export interface ProvidersViewRows {
  readonly installed: readonly ProviderViewRow[];
  readonly notInstalled: readonly ProviderViewRow[];
}

const STATUS_KEY: Readonly<Record<Exclude<ProviderStatus, 'not_installed'>, ProviderStatusKey>> = {
  ready: 'providers.status.ready',
  needs_login: 'providers.status.needs_login',
  unknown: 'providers.status.unverified',
};

/** Rows and the not-found fold from the facts; `pending` holds the ids still being scanned. Pure. */
export const providerViewRows = (facts: readonly ProviderFact[], pending: ReadonlySet<string>): ProvidersViewRows => {
  const installed: ProviderViewRow[] = [];
  const notInstalled: ProviderViewRow[] = [];
  for (const fact of facts) {
    const status = providerStatus(fact);
    const base = {
      id: fact.defId,
      markKey: fact.defId,
      name: fact.name,
      version: fact.version,
      binPath: fact.binPath,
      scanning: pending.has(fact.defId),
    };
    if (status === 'not_installed') {
      notInstalled.push({ ...base, statusKey: 'providers.status.not_installed', installUrl: fact.installUrl });
    } else {
      installed.push({ ...base, statusKey: STATUS_KEY[status], installUrl: null });
    }
  }
  return { installed, notInstalled };
};

export interface ProvidersState {
  readonly installed: readonly ProviderViewRow[];
  readonly notInstalled: readonly ProviderViewRow[];
  /** The "Kurulu değil · n" group; starts closed. */
  readonly groupOpen: boolean;
  /** True while a scan is in flight. */
  readonly scanning: boolean;
  /** True when the latest finished scan failed; the prior rows stay listed. */
  readonly failed: boolean;
}

export interface ProvidersStoreDeps {
  readonly api: Pick<Api, 'query'>;
}

export interface ProvidersStore {
  /** Reads the providers (a discovery pass). */
  load(): Promise<void>;
  /** "Yeniden tara". */
  rescan(): Promise<void>;
  /** Marks every listed row as awaiting its provider's answer. */
  beginScan(): void;
  /** Takes the answers of some providers: each updates (or adds) its own row and settles it. */
  receive(facts: readonly ProviderFact[]): void;
  toggleGroup(): void;
  state(): ProvidersState;
  subscribe(listener: () => void): () => void;
}

export const createProvidersStore = (deps: ProvidersStoreDeps): ProvidersStore => {
  const { api } = deps;
  let facts: readonly ProviderFact[] = [];
  let pending = new Set<string>();
  let groupOpen = false;
  let scanning = false;
  let failed = false;
  let attempts = 0;
  let state: ProvidersState = { ...providerViewRows([], pending), groupOpen, scanning, failed };
  const listeners = new Set<() => void>();

  const publish = (): void => {
    state = { ...providerViewRows(facts, pending), groupOpen, scanning, failed };
    for (const listener of [...listeners]) listener();
  };

  const receive = (answers: readonly ProviderFact[]): void => {
    const next = facts.map((fact) => answers.find((answer) => answer.defId === fact.defId) ?? fact);
    const added = answers.filter((answer) => !facts.some((fact) => fact.defId === answer.defId));
    facts = [...next, ...added];
    pending = new Set([...pending].filter((id) => !answers.some((answer) => answer.defId === id)));
    publish();
  };

  const beginScan = (): void => {
    pending = new Set(facts.map((fact) => fact.defId));
    scanning = true;
    failed = false;
    publish();
  };

  const scan = async (): Promise<void> => {
    const attempt = ++attempts;
    beginScan();
    const reply: unknown = await api.query({ type: 'providers.discovered' });
    if (attempt !== attempts) return;
    if (isQueryFailure(reply) || !Array.isArray(reply)) {
      failed = true;
    } else {
      receive(reply.filter(isProviderFact));
    }
    pending = new Set();
    scanning = false;
    publish();
  };

  return {
    load: scan,
    rescan: scan,
    beginScan,
    receive,
    toggleGroup: () => {
      groupOpen = !groupOpen;
      publish();
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
