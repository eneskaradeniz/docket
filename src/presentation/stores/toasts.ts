// stores/toasts.ts — the one toast service (U-50): every toast in the app — command results
// (U-8), the wizard's completion, a new project, any other — goes through the one `toast`
// call; no screen draws a toast of its own. The service owns the stack (at most three visible,
// the oldest leaving outright when a fourth arrives), the self-dismiss (5 s; warn and error
// 8 s), the hover/focus hold that pauses a toast and resumes it where it stood, and the close.
// The clock is injected so tests walk the durations in fake time; the app's service runs on the
// window's own timers below.
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';

/** The four voices a toast can carry; the type picks the colour, the glyph and the duration. */
export type ToastType = 'success' | 'info' | 'warn' | 'error';

/** The one call's whole input: a voice, the copy to show, and the text the copy button hands to
 *  the clipboard (U-50a) — a refusal's raw code rides only there, never in the text. */
export interface ToastInput {
  readonly type: ToastType;
  readonly text: string;
  readonly copy?: string;
}

/** One standing toast, as the host renders it. */
export interface ToastItem {
  readonly id: number;
  readonly type: ToastType;
  readonly text: string;
  readonly copy: string | undefined;
  /** The toast's own duration — the host's progress line drains over exactly this long. */
  readonly durationMs: number;
}

/** How long a toast stands before it dismisses itself (U-50): 5 s, with warn and error 8 s. */
export const TOAST_MS: Readonly<Record<ToastType, number>> = {
  success: 5000,
  info: 5000,
  warn: 8000,
  error: 8000,
};

/** At most three toasts stay visible; a fourth drops the oldest outright. */
export const MAX_VISIBLE_TOASTS = 3;

/** The time the service runs on: `now` for the pause arithmetic, a pair of timer calls for the
 *  self-dismiss. The handle is opaque — the window and the node test clock return different
 *  shapes. Injected so tests drive seconds in fake milliseconds. */
export interface ToastClock {
  readonly now: () => number;
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const windowClock: ToastClock = {
  now: () => Date.now(),
  // globalThis, not window: the module also loads in the node test environment, where only the
  // call itself would touch the clock.
  set: (fn, ms) => globalThis.setTimeout(fn, ms),
  // The cast is typing-only: the handle came from the matching `setTimeout` above, whatever
  // shape the platform gave it.
  clear: (handle) => globalThis.clearTimeout(handle as number),
};

export interface ToastStore {
  readonly state: () => readonly ToastItem[];
  readonly subscribe: (listener: () => void) => () => void;
  /** The one call (U-50). */
  readonly toast: (input: ToastInput) => void;
  /** Removes a toast at once and stops its timer — the close button's call. */
  readonly close: (id: number) => void;
  /** Holds a toast open (a hover or a focus) — its remaining time stands still. */
  readonly pause: (id: number) => void;
  /** Lets a held toast run again from where the pause caught it. */
  readonly resume: (id: number) => void;
}

/** One live entry: the item plus the timing the pause/resume arithmetic reads. */
interface ToastEntry {
  readonly item: ToastItem;
  handle: unknown;
  /** When the running leg of the timer started. */
  shownAt: number;
  /** How long remains, measured from `shownAt`. */
  remainingMs: number;
}

export const createToastStore = (clock: ToastClock = windowClock): ToastStore => {
  let nextId = 1;
  // Newest first: the host renders the stack top-down in this order.
  let entries: ToastEntry[] = [];
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const find = (id: number): ToastEntry | undefined => entries.find((entry) => entry.item.id === id);

  const stopTimer = (entry: ToastEntry): void => {
    if (entry.handle === null) return;
    clock.clear(entry.handle);
    entry.handle = null;
  };

  const drop = (id: number): void => {
    const entry = find(id);
    if (entry === undefined) return;
    stopTimer(entry);
    entries = entries.filter((candidate) => candidate.item.id !== id);
    emit();
  };

  const startTimer = (entry: ToastEntry): void => {
    stopTimer(entry);
    entry.shownAt = clock.now();
    entry.handle = clock.set(() => drop(entry.item.id), entry.remainingMs);
  };

  return {
    state: () => entries.map((entry) => entry.item),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toast: (input) => {
      const entry: ToastEntry = {
        item: { id: nextId, type: input.type, text: input.text, copy: input.copy, durationMs: TOAST_MS[input.type] },
        handle: null,
        shownAt: clock.now(),
        remainingMs: TOAST_MS[input.type],
      };
      nextId += 1;
      entries = [entry, ...entries];
      // The cap drops the oldest outright: a stack of three is the most the operator reads.
      while (entries.length > MAX_VISIBLE_TOASTS) {
        const oldest = entries[entries.length - 1];
        if (oldest === undefined) break;
        stopTimer(oldest);
        entries = entries.slice(0, -1);
      }
      startTimer(entry);
      emit();
    },
    close: drop,
    pause: (id) => {
      const entry = find(id);
      if (entry === undefined || entry.handle === null) return;
      stopTimer(entry);
      entry.remainingMs = Math.max(0, entry.remainingMs - (clock.now() - entry.shownAt));
    },
    resume: (id) => {
      const entry = find(id);
      if (entry === undefined || entry.handle !== null) return;
      startTimer(entry);
    },
  };
};

/** The app's one service; the shell's host is its only renderer. */
export const toastStore: ToastStore = createToastStore();

/** The one call (U-50): `toast({ type, text })` from anywhere in the presentation layer. */
export const toast = (input: ToastInput): void => toastStore.toast(input);

/** What a store's intent outcome looks like — the result with its U-8 copy key. */
export interface ToastOutcome {
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

// An outcome toasts once: the same object reaching the effect again (a locale swap re-running
// it, a remounted panel) must not repeat a toast that already left.
const toastedOutcomes = new WeakSet<object>();

/** How an intent outcome becomes the one toast (U-8's copy through U-50's call, U-50a's copy
 *  button): ok reads success; a refusal reads error with the code's label as its text and the
 *  code itself behind the copy button — once per outcome. */
export const toastOutcome = (locale: Locale, outcome: ToastOutcome): void => {
  if (toastedOutcomes.has(outcome)) return;
  toastedOutcomes.add(outcome);
  toast({
    type: outcome.result.ok ? 'success' : 'error',
    text: t(locale, outcome.labelKey),
    copy: outcome.result.ok ? undefined : outcome.result.code,
  });
};
