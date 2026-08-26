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
// - `useActiveDrive(store)` binds the App to the ONE active drive (the board overlay's source) — the
//   snapshot is identity-stable between real transitions (see activeSnapshot).
// - One drive at a time (the runner's event channel is a broadcast — see audit F10); a second start while
//   one runs is rejected, exactly like the panes' old `running` guard.
// - `onEnd` is registered by the App: a completion refreshes the WO wherever the operator is (the board's
//   cost/stage too), not just the open detail.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DriveInput, LiveSessionState, PermissionDecision, TranscriptLine } from '../../../core/runner';
import { foldSessionEvent, initialSessionState } from '../../../core/runner';
import type { SessionRunner } from '../../../core/runner';

export interface DriveHandle {
  state: LiveSessionState;
  running: boolean;
  /** Booting (base-mobile trial): started, no first event folded yet — the provider subprocess spawn
   *  window. Cleared on the first folded event of ANY kind; read by the detail turn state (starting)
   *  and the board overlay alike, so both surfaces cover a resume-after-wind-down re-boot too. */
  booting: boolean;
  startedAt?: number; // epoch ms of store.start() — the live ticker's anchor (WO-0029 / 7c)
}

/** The active drive's card-level facts (the board overlay's input — feed to core's overlayLiveDrive). */
export interface ActiveDriveSnapshot {
  key: string;
  woId: DriveInput['workOrderId'];
  running: boolean;
  booting: boolean;
  status: LiveSessionState['status'];
}

type Listener = () => void;

export function createDriveStore(runner: SessionRunner) {
  const drives = new Map<string, DriveHandle>();
  const sessionIds = new Map<string, string | undefined>(); // per-key provider session id (resume/approve)
  const keyWo = new Map<string, DriveInput['workOrderId']>(); // key → branded WO id (ADR-0003: no ui-side cast)
  // WO-0047: each key's LAST drive input, captured at start — the budget refusal card's
  // raise-and-re-run re-issues it verbatim (ONE wiring point, not nine start sites).
  const keyInput = new Map<string, DriveInput>();
  const listeners = new Set<Listener>();
  let onEnd: ((key: string) => void) | undefined;
  // WO-0029 / B13+B14: fired from the fold loop so the App can refresh the board the moment a drive
  // starts (the card flips to "Çalışıyor") or an ask surfaces in the background ("Seni bekliyor").
  let onStarted: ((key: string) => void) | undefined;
  let onAsk: ((key: string) => void) | undefined;
  // base-mobile trial (2026-08-22): the pipeline returns the session row to 'running' when the last
  // ask is answered, but no other callback fires for ask_resolved — the App refreshes here so the
  // rows snapshot agrees with the fold. Without it the board card bounces working → Seni bekliyor →
  // settled when the drive ends and the live overlay lifts off a stale stopped_asking row.
  let onAskResolved: ((key: string) => void) | undefined;
  // WO-0031c: a drive DIED (a folded error event or the stream itself threw) — the notification
  // contract's error toast. Distinct from onEnd, which fires for every completion.
  let onError: ((key: string) => void) | undefined;
  let active: string | undefined; // the one running key (one drive at a time)
  // The active-drive snapshot cache (identity-stable — see activeSnapshot).
  let snapDirty = true;
  let snap: ActiveDriveSnapshot | undefined;

  const notify = (): void => {
    snapDirty = true;
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

  /** The active drive's card-level facts. CACHED WITH CONTENT COMPARISON: notify() fires on every
   *  folded transcript line, and useSyncExternalStore re-renders on identity change — a fresh object
   *  per call would re-render the App per streamed line. The snapshot object is replaced only when
   *  {key, woId, running, booting, status} actually change (start, a status transition, the end). */
  function activeSnapshot(): ActiveDriveSnapshot | undefined {
    if (!snapDirty) return snap;
    snapDirty = false;
    const key = active;
    const h = key === undefined ? undefined : drives.get(key);
    const woId = key === undefined ? undefined : keyWo.get(key);
    if (!key || !h || woId === undefined) {
      snap = undefined;
      return snap;
    }
    const next: ActiveDriveSnapshot = { key, woId, running: h.running, booting: h.booting, status: h.state.status };
    if (
      snap &&
      snap.key === next.key &&
      snap.woId === next.woId &&
      snap.running === next.running &&
      snap.booting === next.booting &&
      snap.status === next.status
    ) {
      return snap;
    }
    snap = next;
    return snap;
  }

  function snapshot(key: string, seed: () => LiveSessionState): LiveSessionState {
    return drives.get(key)?.state ?? seed();
  }

  /** Begin a drive. Returns false when another drive is running (caller surfaces it) or this key already
   *  runs. `seed` seeds the fold for a resumed session so the stream APPENDS to prior lines (F14). */
  function start(key: string, input: DriveInput, seed: LiveSessionState = initialSessionState): boolean {
    if (active !== undefined) return active === key; // already running this key → no-op true; another → false
    active = key;
    keyWo.set(key, input.workOrderId);
    keyInput.set(key, input);
    drives.set(key, { state: seed, running: true, booting: true, startedAt: Date.now() });
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
          if (ev.kind === 'ask_resolved') onAskResolved?.(key);
          if (ev.kind === 'error') onError?.(key);
          // booting clears on the FIRST folded event (any kind) — the spawn window is over.
          const cur = drives.get(key) ?? { state: initialSessionState, running: true, booting: false, startedAt: Date.now() };
          drives.set(key, { ...cur, booting: false, state: foldSessionEvent(cur.state, ev) });
          notify();
        }
      } catch {
        // WO-0035: the crash is identified structurally, never by a string — the fold's error events
        // always carry a message (+code when classified), so `status === 'error' && !lastErrorCode &&
        // !lastError` is this catch path alone; the panes render UI.driveStreamCrashed for that shape.
        const cur = drives.get(key);
        if (cur) drives.set(key, { ...cur, state: { ...cur.state, status: 'error' } });
        onError?.(key);
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
  /** WO-0047: re-issue a key's LAST drive input verbatim — the budget refusal's raise-and-re-run.
   *  Seeds from the key's current fold (a refused drive's fold carries no transcript; the re-run's
   *  `started` clears the refusal on the way through, the pendingPlan precedent). False while the
   *  key runs or when no input was captured (the drive predates this store's lifetime). Main
   *  re-resolves cwd/prompt/rule on arrival — the captured input is the renderer's ask, never an
   *  assembled prompt, so nothing stale leaks. */
  function restart(key: string): boolean {
    const input = keyInput.get(key);
    const prior = drives.get(key);
    if (!input || prior?.running) return false;
    return start(key, input, prior?.state ?? initialSessionState);
  }
  /** The branded work-order id a key belongs to (WO-0031c) — captured at start, so nothing in the UI
   *  ever constructs a branded id from the key string (ADR-0003). */
  const woId = (key: string): DriveInput['workOrderId'] | undefined => keyWo.get(key);
  /** Drop every fold this store holds for a work order — the DELETE flow's second half. Without it
   *  a deleted WO's live fold (transcript, pending question, 'done' status) outlives the row AND
   *  leaks into the next WO that recycles its number (the decision store's nextWorkOrderNumber
   *  reuses freed numbers): the new WO opened with a foreign transcript, an answerable question
   *  card whose reply resumes the DEAD provider session, and no rail (found by the WO-0037/0038
   *  E2E rewrite, 2026-08-22). Idempotent; the active drive is untouched (a live WO cannot be
   *  deleted — the Sil gate holds while a drive spends). */
  function forgetWo(id: DriveInput['workOrderId']): void {
    for (const [key, wo] of keyWo) {
      if (wo !== id) continue;
      drives.delete(key);
      keyWo.delete(key);
      sessionIds.delete(key);
    }
    notify();
  }
  /** WO-0031c: append an operator-side NOTE line to a drive's fold (the wind-down/force-kill terminal
   *  annotations). Live-only — a persisted transcript never carries Docket's own commentary. */
  function note(key: string, line: TranscriptLine): void {
    const cur = drives.get(key);
    if (!cur) return;
    drives.set(key, { ...cur, state: { ...cur.state, entries: [...cur.state.entries, line] } });
    notify();
  }
  /** WO-0031c: Zorla kes — the 5s-stuck escape hatch (forwards the port's forced stop). */
  const abort = (): Promise<void> => runner.abort();
  /** WO-0045: queue an operator note into the RUNNING drive. The count arrives via the folded
   *  steer_queued event (the noteId rides it — the pending list's retract handle). False when no
   *  drive is live or the transport refused (CLI without msg_lifecycle_v1). */
  const steer = (key: string, note: string): Promise<boolean> => {
    if (active !== key) return Promise.resolve(false);
    return runner.steer?.(note) ?? Promise.resolve(false);
  };
  /** WO-0045: pull a queued note back (live drive — best-effort; stopped drive — the mirror route
   *  through the data port, see retractNote below). */
  const retract = (key: string, noteId: string): Promise<boolean> => {
    if (active !== key) return Promise.resolve(false);
    return runner.retractSteer?.(noteId) ?? Promise.resolve(false);
  };
  /** WO-0045: drop a note from a STOPPED drive's fold — pairs the data port's row rewrite (the store
   *  rewrites the mirror + audits) with the live fold, so the pending list agrees the row is gone.
   *  The `note()` pattern: a fold patch, not a runner call. */
  function retractNote(key: string, noteId: string): void {
    const cur = drives.get(key);
    if (!cur) return;
    drives.set(key, { ...cur, state: { ...cur.state, pendingNotes: cur.state.pendingNotes.filter((n) => n.id !== noteId) } });
    notify();
  }

  return {
    subscribe,
    get,
    snapshot,
    activeSnapshot,
    start,
    restart,
    decide,
    interrupt,
    abort,
    note,
    forgetWo,
    sessionId,
    woId,
    steer,
    retract,
    retractNote,
    set onEnd(cb: (key: string) => void) {
      onEnd = cb;
    },
    set onStarted(cb: (key: string) => void) {
      onStarted = cb;
    },
    set onAsk(cb: (key: string) => void) {
      onAsk = cb;
    },
    set onAskResolved(cb: (key: string) => void) {
      onAskResolved = cb;
    },
    set onError(cb: (key: string) => void) {
      onError = cb;
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

/** Bind the App to the ONE active drive (the board overlay's source). The snapshot's identity is
 *  stable between real transitions (see activeSnapshot), so this re-renders only on drive start,
 *  status transitions and the end — never per streamed transcript line. */
export function useActiveDrive(store: DriveStore): ActiveDriveSnapshot | undefined {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.activeSnapshot(),
    () => store.activeSnapshot(),
  );
}
