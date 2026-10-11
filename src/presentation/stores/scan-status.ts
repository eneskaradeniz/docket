// stores/scan-status.ts — the standing every machine scan (accounts, providers) reports: nothing
// read yet, a read in flight, a result, or a failed read. The result itself stays with its own
// store; this is only the shared word, so a screen decides "skeleton" and "busy" the same way.
export type ScanStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The status from a store's three facts. A read in flight is `loading` even over an old result;
 *  a failed read is `error` whether or not a result still stands. Pure. */
export const scanStatusOf = (facts: Readonly<{ loading: boolean; loaded: boolean; failed: boolean }>): ScanStatus =>
  facts.loading ? 'loading' : facts.failed ? 'error' : facts.loaded ? 'ready' : 'idle';

/** The skeleton stands only while no result exists yet and a read is in flight. Pure. */
export const showsSkeleton = (facts: Readonly<{ loading: boolean; loaded: boolean }>): boolean => facts.loading && !facts.loaded;
