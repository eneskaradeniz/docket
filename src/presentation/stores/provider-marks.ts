// stores/provider-marks.ts — the provider marks the account badges render (A-41): one
// `providers.marks` read at startup, cached for the session — the defs' marks are static def
// data, so a re-query could only repeat the first reply. The store exposes the pure lookup;
// an unknown id, an empty id and a provider without a mark all read as null, which the badge
// renders as the neutral glyph. A failed read (no marks source composed) leaves the cache
// empty for the session rather than retrying on every consumer's mount — the badges fall back
// to the neutral glyph and stay there.
import type { Api } from '../../api/api';
import type { ProviderMarksView, Query } from '../../api/queries';
import { isQueryFailure } from './results';

/** One provider's mark as the api's view carries it: the path, the viewBox it was drawn for and
 *  the fill rule it needs — derived off the view so the presentation names no other layer for it. */
export type ProviderMark = NonNullable<ProviderMarksView[string]>;

/** The lookup every badge goes through: a provider the record knows and carries a mark for
 *  answers it; an unknown id, an empty id, a null mark and an empty map all answer null —
 *  never a letter, never a name. Pure. */
export const providerMarkFor = (
  marks: Readonly<ProviderMarksView>,
  providerId: string,
): ProviderMark | null => {
  if (providerId === '') return null;
  return marks[providerId] ?? null;
};

export interface ProviderMarksState {
  /** True once a reply landed; the marks themselves stay private to the lookup. */
  readonly loaded: boolean;
}

export interface ProviderMarksStore {
  /** Reads `providers.marks` once; later calls are the session cache's no-ops. */
  load(): Promise<void>;
  markFor(providerId: string): ProviderMark | null;
  state(): ProviderMarksState;
  subscribe(listener: () => void): () => void;
}

export const createProviderMarksStore = (deps: { readonly api: Pick<Api, 'query'> }): ProviderMarksStore => {
  const { api } = deps;

  let marks: ProviderMarksView = {};
  let state: ProviderMarksState = { loaded: false };
  const listeners = new Set<() => void>();
  // The one read the session ever issues, whatever its reply turns out to be.
  let requested = false;

  const set = (next: ProviderMarksState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    load: async () => {
      if (requested) return;
      requested = true;
      const reply: unknown = await api.query({ type: 'providers.marks' } satisfies Query);
      if (isQueryFailure(reply)) return;
      marks = reply as ProviderMarksView;
      set({ loaded: true });
    },
    markFor: (providerId) => providerMarkFor(marks, providerId),
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
