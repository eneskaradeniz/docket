// stores/connectors.ts — Settings → Entegrasyonlar (U-356): mirrors the `connector.list` query
// as the section's rows and owns the surface's one write, the enabled switch. The switch words
// its own outcome on its row — a typed failure code stays beside the connector it names until
// the next attempt clears it — so the section never toasts. The same rows feed the tracker-link
// surface's display name (manifest data; no platform is named in code).
import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { ConnectorListView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { isQueryFailure } from './results';

export interface ConnectorsStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  /** Every issued command travels as this actor — the settings screen acts as the user. */
  readonly actor: Actor;
}

export interface ConnectorsStoreState {
  readonly loading: boolean;
  /** Whether any read ever answered; the rows stay from the last success. */
  readonly loaded: boolean;
  readonly rows: readonly ConnectorListView[];
  /** The latest list failure's code; null while healthy. */
  readonly problem: string | null;
  /** The connectors whose switch command is open right now. */
  readonly busy: readonly string[];
  /** The latest switch failure's code, by connector id; the next attempt clears it. */
  readonly failures: Readonly<Record<string, string>>;
}

export interface ConnectorsStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly state: () => ConnectorsStoreState;
  /** Re-reads the list — the refresh every switch owes its row. */
  load(): Promise<void>;
  /** Reads the list once per session; later calls answer from the last read. */
  ensure(): Promise<void>;
  /** The row's switch (U-356): issues `connector.setEnabled` as the user and re-reads. A second
   *  press while one command is open issues nothing; a refusal keeps its code on the row. */
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

/** The display name the tracker-link surface shows: the first tracker-providing connector of
 *  the injected list, in list order — manifest data via connector.list, never a platform name
 *  written in code. Null when no connector provides the tracker family (or nothing loaded). */
export const trackerConnectorName = (rows: readonly ConnectorListView[]): string | null =>
  rows.find((row) => row.provides.includes('tracker'))?.name ?? null;

export const createConnectorsStore = (deps: ConnectorsStoreDeps): ConnectorsStore => {
  const listeners = new Set<() => void>();
  let state: ConnectorsStoreState = { loading: false, loaded: false, rows: [], problem: null, busy: [], failures: {} };
  // Only the newest list read may apply its reply.
  let attempts = 0;
  let ensured = false;

  const publish = (next: ConnectorsStoreState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    publish({ ...state, loading: true });
    const reply: unknown = await deps.api.query({ type: 'connector.list' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous rows stay exactly as they were; only the problem appears.
      publish({ ...state, loading: false, problem: reply.code });
      return;
    }
    // The contract of the query: a reply that is not a failure is the row list.
    publish({ ...state, loading: false, loaded: true, rows: reply as readonly ConnectorListView[], problem: null });
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    state: () => state,
    load,
    ensure: async () => {
      if (ensured) return;
      ensured = true;
      await load();
    },
    setEnabled: async (id, enabled) => {
      if (state.busy.includes(id)) return;
      const { [id]: _cleared, ...failures } = state.failures;
      publish({ ...state, busy: [...state.busy, id], failures });
      const result = await deps.api.command(deps.actor, { type: 'connector.setEnabled', id, enabled } satisfies Command);
      publish({
        ...state,
        busy: state.busy.filter((busy) => busy !== id),
        failures: result.ok ? state.failures : { ...state.failures, [id]: result.code },
      });
      await load();
    },
  };
};
