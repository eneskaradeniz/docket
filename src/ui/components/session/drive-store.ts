// src/ui/components/session/drive-store.ts — the app-level BACKGROUND drive store (WO-0028 / Bulgu 12).
//
// The live drive used to be owned by the pane component: navigating away unmounted the pane and the
// operator lost the live stream (the drive looked cancelled; closing the app killed it for real). This
// store lifts the ownership to the application: panes COME AND GO, the drive + its folded state live
// here for the whole renderer lifetime.
//
// - `start(key, input, opts)` begins (or joins) a drive; the fold state per key is kept here.
// - `useDrive(key, seed)` binds a pane to a drive with useSyncExternalStore — a remounted pane re-renders
//   the LIVE state instantly (the stream never stopped), falling back to the persisted seed when the key
//   has no active/recent drive.
// - One drive at a time (the runner's event channel is a broadcast — see audit F10); a second start while
//   one runs is rejected, exactly like the panes' old `running` guard.
// - `onEnd` is registered by the App: a completion refreshes the WO wherever the operator is (the board's
//   cost/stage too), not just the open detail.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DriveInput, LiveSessionState, PermissionDecision } from '../../../core/runner';
import { foldSessionEvent, initialSessionState } from '../../../core/runner';
import type { SessionRunner } from '../../../core/runner';

export interface DriveHandle {
  state: LiveSessionState;
  running: boolean;
  startedAt?: number; // epoch ms of store.start() — the live ticker's anchor (WO-0029 / 7c)
}

type Listener = () => void;

export function createDriveStore(runner: SessionRunner) {
  const drives = new Map<string, DriveHandle>();
  const sessionIds = new Map<string, string | undefined>(); // per-key provider session id (resume/approve)
  const listeners = new Set<Listener>();
  let onEnd: ((key: string) => void) | undefined;
  // WO-0029 / B13+B14: fired from the fold loop so the App can refresh the board the moment a drive
  // starts (the card flips to "Çalışıyor") or an ask surfaces in the background ("Seni bekliyor").
  let onStarted: ((key: string) => void) | undefined;
  let onAsk: ((key: string) => void) | undefined;
  let active: string | undefined; // the one running key (one drive at a time)

  const notify = (): void => {
    for (const l of listeners) l();
  };

  function subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  }

  /** The current handle for a key — undefined when that drive never ran in this app session. */
  function get(key: string): DriveHandle | undefined {
    return drives.get(key);
  }

  function snapshot(key: string, seed: () => LiveSessionState): LiveSessionState {
    return drives.get(key)?.state ?? seed();
  }

  /** Begin a drive. Returns false when another drive is running (caller surfaces it) or this key already
   *  runs. `seed` seeds the fold for a resumed session so the stream APPENDS to prior lines (F14). */
  function start(key: string, input: DriveInput, seed: LiveSessionState = initialSessionState): boolean {
    if (active !== undefined) return active === key; // already running this key → no-op true; another → false
    active = key;
    drives.set(key, { state: seed, running: true, startedAt: Date.now() });
    sessionIds.set(key, seed.sessionId);
    notify();
    void (async () => {
      try {
        for await (const ev of runner.drive(input)) {
          if (ev.kind === 'started') {
            sessionIds.set(key, ev.sessionId);
            onStarted?.(key);
          }
          if (ev.kind === 'permission_request') onAsk?.(key);
          const cur = drives.get(key) ?? { state: initialSessionState, running: true, startedAt: Date.now() };
          drives.set(key, { ...cur, state: foldSessionEvent(cur.state, ev) });
          notify();
        }
      } catch {
        const cur = drives.get(key);
        if (cur) drives.set(key, { ...cur, state: { ...cur.state, status: 'error', lastError: 'drive failed' } });
        notify();
      } finally {
        const cur = drives.get(key);
        if (cur) drives.set(key, { ...cur, running: false });
        if (active === key) active = undefined;
        notify();
        onEnd?.(key);
      }
    })();
    return true;
  }

  const decide = (requestId: string, decision: PermissionDecision): Promise<void> =>
    runner.decide(requestId, decision);
  const interrupt = (): Promise<void> => runner.interrupt();
  const sessionId = (key: string): string | undefined => sessionIds.get(key);

  return {
    subscribe,
    get,
    snapshot,
    start,
    decide,
    interrupt,
    sessionId,
    set onEnd(cb: (key: string) => void) {
      onEnd = cb;
    },
    set onStarted(cb: (key: string) => void) {
      onStarted = cb;
    },
    set onAsk(cb: (key: string) => void) {
      onAsk = cb;
    },
  };
}

export type DriveStore = ReturnType<typeof createDriveStore>;

export const DriveStoreContext = createContext<DriveStore | null>(null);

export function useDriveStore(): DriveStore {
  const store = useContext(DriveStoreContext);
  if (!store) throw new Error('useDriveStore: no DriveStoreContext provider');
  return store;
}

/** Bind a pane to a drive key: live state while it (or its memory) exists, the persisted seed otherwise. */
export function useDrive(store: DriveStore, key: string, seed: () => LiveSessionState): LiveSessionState {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.snapshot(key, seed),
    () => store.snapshot(key, seed),
  );
}
