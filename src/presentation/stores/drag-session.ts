// stores/drag-session.ts — one list's live drag (U-47): which row is held, where it sits, the
// provisional order the others slide around, the settle a release lands into, and the line the
// live region reads. The component owns the pointer and the pixels; this store owns what renders,
// so the list reads it through useSyncExternalStore — and because that hook compares reads by
// reference, the snapshot is one cached object per change (a fresh object per read would loop
// re-renders, React error #185). The clock is injected so tests freeze the settle clear and the
// announcement reset.
import { dragTop, moveItem, slotAt, slotTop, DRAG_SETTLE_CLEAR_MS, DRAG_THRESHOLD } from './drag-order';

/** What a live drag renders: the held row (once the threshold has crossed), its top edge, the
 *  order the list shows meanwhile (null: the committed order), the row settling home after a
 *  release, and the live region's line. */
export interface DragSessionState {
  readonly heldId: string | null;
  readonly lifted: boolean;
  readonly top: number;
  readonly order: readonly string[] | null;
  readonly settlingId: string | null;
  readonly announcement: string;
}

/** What a release tells the list: the order the drop produced, the row's slot in it, and whether
 *  the move is worth a report — the list reports a finished move once (U-41). */
export interface DragEndResult {
  readonly order: readonly string[];
  readonly to: number;
  readonly moved: boolean;
}

/** The time the settle clear and the announcement reset run on; injected so tests freeze both. */
export interface DragClock {
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface DragSessionStore {
  readonly state: () => DragSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** A press on a grip: the row is a candidate for holding, not yet held. */
  readonly begin: (id: string, committed: readonly string[], pointerY: number) => void;
  /** A pointer move: past the threshold the row lifts and centres under the pointer. */
  readonly track: (id: string, pointerY: number, listTop: number) => void;
  /** A release (a cancel settles the same way): commits the drop and settles the row home. */
  readonly end: (id: string) => DragEndResult | null;
  /** Sets the live region's line; the same words set again clear first so readers repeat them. */
  readonly announce: (text: string) => void;
}

const windowClock: DragClock = {
  set: (fn, ms) => globalThis.setTimeout(fn, ms),
  // The cast is typing-only: the handle came from the matching `setTimeout` above, whatever shape
  // the platform gave.
  clear: (handle) => globalThis.clearTimeout(handle as number),
};

/** The beat a live region needs between two identical lines to read the second one. */
const ANNOUNCE_RESET_MS = 30;

/** The standing state between drags — one reference, so a resting list never reads as a change. */
const REST: DragSessionState = { heldId: null, lifted: false, top: 0, order: null, settlingId: null, announcement: '' };

export const createDragSession = (clock: DragClock = windowClock): DragSessionStore => {
  let state = REST;
  let committed: readonly string[] = [];
  let startY = 0;
  let settleHandle: unknown = null;
  let announceHandle: unknown = null;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const replace = (next: DragSessionState): void => {
    state = next;
    emit();
  };

  const clearSettle = (): void => {
    if (settleHandle === null) return;
    clock.clear(settleHandle);
    settleHandle = null;
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin: (id, order, pointerY) => {
      clearSettle();
      committed = order;
      startY = pointerY;
      replace({ ...REST, announcement: state.announcement, heldId: id, top: slotTop(Math.max(0, order.indexOf(id))) });
    },
    track: (id, pointerY, listTop) => {
      if (state.heldId !== id) return;
      if (!state.lifted && Math.abs(pointerY - startY) < DRAG_THRESHOLD) return;
      const working = state.order ?? committed;
      const top = dragTop(pointerY, listTop, working.length);
      const next = moveItem(working, working.indexOf(id), slotAt(top, working.length));
      replace({ ...state, lifted: true, top, order: next ?? working });
    },
    end: (id) => {
      if (state.heldId !== id) return null;
      const lifted = state.lifted;
      const final = state.order ?? committed;
      const from = committed.indexOf(id);
      const to = final.indexOf(id);
      state = { ...REST, announcement: state.announcement, settlingId: lifted ? id : null };
      emit();
      if (lifted) {
        settleHandle = clock.set(() => {
          settleHandle = null;
          replace({ ...state, settlingId: null });
        }, DRAG_SETTLE_CLEAR_MS);
      }
      return { order: final, to, moved: from !== to };
    },
    announce: (text) => {
      if (announceHandle !== null) {
        clock.clear(announceHandle);
        announceHandle = null;
      }
      // Clear first: a live region that already reads the same words stays silent, so a second
      // move to the same slot must pass through an empty beat to be heard again.
      replace({ ...state, announcement: '' });
      announceHandle = clock.set(() => {
        announceHandle = null;
        replace({ ...state, announcement: text });
      }, ANNOUNCE_RESET_MS);
    },
  };
};
