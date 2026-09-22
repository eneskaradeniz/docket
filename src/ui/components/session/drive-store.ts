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
// - `useActiveDrives(store)` binds the App to the RUNNING drives (WO-0088: N at once, ONE per owner) —
//   the snapshots array is identity-stable between real transitions (see activeSnapshots).
// - ONE drive per OWNER, N owners in parallel (WO-0088's frozen scope): a second key on an owner that
//   already runs is refused — a work order's step sequencing stays serial. The event channel is a
//   broadcast; the renderer port filters by owner tag before events reach this store.
// - `onEnd` is registered by the App: a completion refreshes the WO wherever the operator is (the board's
//   cost/stage too), not just the open detail.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DriveInput, LiveSessionState, PermissionDecision, TranscriptLine } from '../../../core/runner';
import { driveOwnerTag, foldSessionEvent, initialSessionState, isDraftDrive } from '../../../core/runner';
import type { SessionRunner } from '../../../core/runner';
import type { LimitWindow } from '../../../core/types';

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

/** WO-0060: the appbar chip's facts — the same ONE active drive, read for ACCOUNT health instead of
 *  for a card. Deliberately WO-less: `activeSnapshot` bails on the ✦ draft (its key never enters
 *  keyWo — the draft must never overlay a board card), but the chip counts the draft like any
 *  drive, so this accessor keys off `active` alone. The limit facts ride the fold: `limitResetAt`
 *  is `lastLimit.resetAt` (the ONLY live red source — `limitWindows[].resetAt` is a window-OPENING
 *  time and would paint a mere warning red), `limitStatus`/`limitSubject` carry the provider's own
 *  warning word and its fullest window (the chip body stays figure-free; the tooltip speaks it). */
export interface DriveActivity {
  /** WO-0088: the LIVE DRIVE COUNT (the chip's «(n)») — was the single-drive boolean. */
  running: number;
  limitStatus?: 'ok' | 'warning' | 'blocked';
  limitResetAt?: string;
  limitSubject?: LimitWindow;
}

type Listener = () => void;

export function createDriveStore(runner: SessionRunner) {
  const drives = new Map<string, DriveHandle>();
  const sessionIds = new Map<string, string | undefined>(); // per-key provider session id (resume/approve)
  const keyWo = new Map<string, DriveInput['workOrderId']>(); // key → branded WO id (ADR-0003: no ui-side cast)
  // WO-0050 / D9: the WO-less draft drives key by WORKSPACE — the same capture discipline, one map
  // per arm. activeSnapshot stays WO-only by truth (a draft's key never enters keyWo), which IS
  // the locked ruling: the draft never overlays a board card.
  const keyWs = new Map<string, NonNullable<DriveInput['workspaceId']>>();
  // WO-0047: each key's LAST drive input, captured at start — the budget refusal card's
  // raise-and-re-run re-issues it verbatim (ONE wiring point, not nine start sites).
  const keyInput = new Map<string, DriveInput>();
  const listeners = new Set<Listener>();
  let onEnd: ((key: string) => void) | undefined;
  // WO-0029 / B13+B14: fired from the fold loop so the App can refresh the board the moment a drive
  // starts (the card flips to "Çalışıyor") or an ask surfaces in the background ("Seni bekliyor").
  let onStarted: ((key: string) => void) | undefined;
  let onAsk: ((key: string) => void) | undefined;
  // WO-0050: a plan_ready landed mid-drive (before the turn ends) — the App refreshes the roadmap
  // draft row so the TASLAK card descends the moment the proposal arrives, not a beat later at onEnd.
  let onPlanReady: ((key: string) => void) | undefined;
  // base-mobile trial (2026-08-22): the pipeline returns the session row to 'running' when the last
  // ask is answered, but no other callback fires for ask_resolved — the App refreshes here so the
  // rows snapshot agrees with the fold. Without it the board card bounces working → Seni bekliyor →
  // settled when the drive ends and the live overlay lifts off a stale stopped_asking row.
  let onAskResolved: ((key: string) => void) | undefined;
  // WO-0031c: a drive DIED (a folded error event or the stream itself threw) — the notification
  // contract's error toast. Distinct from onEnd, which fires for every completion.
  let onError: ((key: string) => void) | undefined;
  // WO-0088: the PARALLEL spine — N keys drive at once, ONE per owner (work order / draft).
  // `keyOwner` captures each key's owner tag (driveOwnerTag) at start; the guard refuses a second
  // key on an owner that already runs (a WO's step sequencing stays serial — the frozen scope).
  const activeKeys = new Set<string>();
  const keyOwner = new Map<string, string>();
  // WO-0060: the drive that ended LAST. The active keys clear in the fold loop's finally BEFORE
  // onEnd → refreshWorkOrders lands the updated rows (a DB read) — the chip's limit facts key on
  // `lastTouched` (the most recent start OR end); nothing clears it by hand (forgetWo deletes the
  // fold, so a deleted WO self-heals).
  let lastActive: string | undefined;
  // The active-drive snapshot cache (identity-stable — see activeSnapshots).
  let snapDirty = true;
  let snaps: ActiveDriveSnapshot[] = [];
  // The activity snapshot cache (WO-0060 — same discipline, own flag: both caches recompute on
  // notify, and a shared flag would let the first accessor's recompute hide the second's).
  let actDirty = true;
  let act: DriveActivity | undefined;

  const notify = (): void => {
    snapDirty = true;
    actDirty = true;
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

  /** The RUNNING drives' card-level facts — ONE entry per WO-keyed drive (WO-0088: the board
   *  overlays N cards; the ✦ draft never overlays a board card, the locked ruling). CACHED WITH
   *  CONTENT COMPARISON: notify() fires on every folded transcript line, and useSyncExternalStore
   *  re-renders on identity change — the ARRAY identity holds until a member's facts actually
   *  change (start, a status transition, the end), so the App never re-renders per streamed line. */
  function activeSnapshots(): ActiveDriveSnapshot[] {
    if (!snapDirty) return snaps;
    snapDirty = false;
    const next: ActiveDriveSnapshot[] = [];
    for (const key of activeKeys) {
      const h = drives.get(key);
      const woId = keyWo.get(key);
      if (!h || woId === undefined) continue; // the draft arm never enters the board overlay
      next.push({ key, woId, running: h.running, booting: h.booting, status: h.state.status });
    }
    if (snaps.length === next.length && snaps.every((s, i) => {
      const n = next[i]!;
      return s.key === n.key && s.woId === n.woId && s.running === n.running && s.booting === n.booting && s.status === n.status;
    })) {
      return snaps;
    }
    snaps = next;
    return snaps;
  }

  /** WO-0060: the appbar chip's snapshot — `activeSnapshots`' content-compare discipline, keyed off
   *  the most recently TOUCHED drive (`lastActive` — no end-of-drive blink), WO-less by design
   *  (the ✦ draft counts). WO-0088: `running` is the COUNT of live drives (the chip's «(n)»), the
   *  limit facts stay the last-touched drive's. Compares PRIMITIVES only — the windows array's
   *  identity changes on every ~30s pull emit, and the header must not re-render for that.
   *  `limitSubject` is the fullest window by PaneWarnline's own sort (pane-chrome.tsx — one
   *  ranking, two voices); the UI never sorts. */
  function activitySnapshot(): DriveActivity | undefined {
    if (!actDirty) return act;
    actDirty = false;
    // The limit voice reads the most recently TOUCHED drive (start OR end — `lastActive` is
    // stamped at both), exactly what the comment above promises; `running` is the live count.
    const key = lastActive;
    const h = key === undefined ? undefined : drives.get(key);
    if (!key || !h) {
      if (act !== undefined) act = undefined;
      return act;
    }
    const st = h.state;
    const windows = st.limitWindows?.windows;
    const subject = windows?.slice().sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0];
    const next: DriveActivity = {
      running: activeKeys.size,
      ...(st.limitWindows?.status !== undefined ? { limitStatus: st.limitWindows.status } : {}),
      ...(st.lastLimit?.resetAt !== undefined ? { limitResetAt: st.lastLimit.resetAt } : {}),
      ...(subject !== undefined ? { limitSubject: subject } : {}),
    };
    if (
      act &&
      act.running === next.running &&
      act.limitStatus === next.limitStatus &&
      act.limitResetAt === next.limitResetAt &&
      act.limitSubject?.window === next.limitSubject?.window &&
      act.limitSubject?.utilization === next.limitSubject?.utilization &&
      act.limitSubject?.resetAt === next.limitSubject?.resetAt
    ) {
      return act;
    }
    act = next;
    return act;
  }

  function snapshot(key: string, seed: () => LiveSessionState): LiveSessionState {
    return drives.get(key)?.state ?? seed();
  }

  /** Begin a drive. Returns false when this key's OWNER already runs another drive (WO-0088: one
   *  drive per owner, N owners in parallel — the caller surfaces it) or... this key itself already
   *  runs (no-op true). `seed` seeds the fold for a resumed session so the stream APPENDS to prior
   *  lines (F14). */
  function start(key: string, input: DriveInput, seed: LiveSessionState = initialSessionState): boolean {
    const tag = driveOwnerTag(input);
    for (const k of activeKeys) {
      if (keyOwner.get(k) === tag) return k === key; // this key running → no-op true; a sibling key on the same owner → false
    }
    activeKeys.add(key);
    keyOwner.set(key, tag);
    lastActive = key; // WO-0060: the chip's limit facts read the most recently touched drive
    // WO-0050: the owner capture is arm-aware — a draft keys keyWs (and never keyWs+keyWo both).
    if (isDraftDrive(input)) keyWs.set(key, input.workspaceId);
    else keyWo.set(key, input.workOrderId);
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
          if (ev.kind === 'plan_ready') onPlanReady?.(key);
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
        activeKeys.delete(key);
        keyOwner.delete(key);
        lastActive = key; // WO-0060: the chip keeps reading this fold until the rows refresh
        notify();
        onEnd?.(key);
      }
    })();
    return true;
  }

  const decide = (requestId: string, decision: PermissionDecision): Promise<void> =>
    runner.decide(requestId, decision);
  /** WO-0045/WO-0088: stop ONE drive. With a KEYED port the key must be LIVE — a dead key (folded
   *  owner, stale render frame) refuses instead of falling through, because the unkeyed form over
   *  IPC would land on main's last-started drive and stop a SIBLING (the M1 cross-talk). The
   *  unkeyed fallback is for unkeyed realizations only (single-drive hosts, tests). */
  const interrupt = (key: string): Promise<void> =>
    runner.interruptDrive
      ? keyOwner.has(key)
        ? runner.interruptDrive(keyOwner.get(key)!)
        : Promise.resolve()
      : runner.interrupt();
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
  /** WO-0050: the branded WORKSPACE id a draft key belongs to — the same capture discipline.
   *  undefined for every WO key, so a host can arm the draft branches on it alone. */
  const wsId = (key: string): DriveInput['workspaceId'] | undefined => keyWs.get(key);
  /** WO-0050: the key's last drive input (already exposed to restart; the draft pane's resume +
   *  source-count read it — no second capture site). */
  const inputOf = (key: string): DriveInput | undefined => keyInput.get(key);
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
      keyOwner.delete(key); // WO-0088: the capture dies with the fold (a live key never reaches here)
      activeKeys.delete(key);
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
  /** WO-0031c/WO-0088: Zorla kes — the 5s-stuck escape hatch, keyed to ONE drive. The M1 rule:
   *  a keyed port refuses a DEAD key (never the unkeyed sibling stop); the unkeyed fallback is
   *  for unkeyed realizations only. */
  const abort = (key: string): Promise<void> =>
    runner.abortDrive
      ? keyOwner.has(key)
        ? runner.abortDrive(keyOwner.get(key)!)
        : Promise.resolve()
      : runner.abort();
  /** WO-0045: queue an operator note into the RUNNING drive (WO-0088: keyed — exactly that key's
   *  drive). The count arrives via the folded steer_queued event (the noteId rides it — the pending
   *  list's retract handle). False when this key's drive is not live or the transport refused
   *  (CLI without msg_lifecycle_v1). */
  const steer = (key: string, note: string): Promise<boolean> => {
    if (!activeKeys.has(key)) return Promise.resolve(false);
    if (runner.steerDrive) return runner.steerDrive(keyOwner.get(key) ?? '', note).then((id) => id !== null);
    return runner.steer?.(note) ?? Promise.resolve(false);
  };
  /** WO-0045: pull a queued note back (live drive — best-effort; stopped drive — the mirror route
   *  through the data port, see retractNote below). */
  const retract = (key: string, noteId: string): Promise<boolean> => {
    if (!activeKeys.has(key)) return Promise.resolve(false);
    if (runner.retractSteerDrive) return runner.retractSteerDrive(keyOwner.get(key) ?? '', noteId);
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
    activeSnapshots,
    activitySnapshot,
    start,
    restart,
    decide,
    interrupt,
    abort,
    note,
    forgetWo,
    sessionId,
    woId,
    wsId,
    inputOf,
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
    set onPlanReady(cb: (key: string) => void) {
      onPlanReady = cb;
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

/** Bind the App to the RUNNING drives (the board overlay's source — WO-0088: N at once, one entry
 *  per WO-keyed drive). The array's identity is stable between real transitions (see
 *  activeSnapshots), so this re-renders only on drive start, status transitions and the end —
 *  never per streamed transcript line. */
export function useActiveDrives(store: DriveStore): ActiveDriveSnapshot[] {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.activeSnapshots(),
    () => store.activeSnapshots(),
  );
}

/** WO-0060: bind the App to the live drive's limit/running facts for the appbar chip — the same
 *  identity-stable discipline as useActiveDrives (activitySnapshot's primitive content-compare
 *  owns it: never a re-render per streamed line, never per windows-pull emit). */
export function useDriveActivity(store: DriveStore): DriveActivity | undefined {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.activitySnapshot(),
    () => store.activitySnapshot(),
  );
}
