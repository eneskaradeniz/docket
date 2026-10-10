// stores/update.ts — the app-update store (U-24): the one standing both update surfaces read —
// the title bar's button and the settings panel's Güncelleme section. It mirrors the `app.update`
// query (the checker's state verbatim, A-32), re-queries on `update.changed`, and issues the two
// intents as the actor with their CommandResult mapped through results.ts (U-8). A download
// mutates the checker while `app.update.apply` is still in flight — the design checker walks its
// percent steps over seconds, and the real updater will report through its own later channel —
// while `update.changed` fires only once the command resolves, so the store polls the query
// through the flight: without the poll the button could never show a percent. The poll interval
// is injected so tests walk it in milliseconds.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LampTone } from './candidates';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

/** The coarse change events the api emits (docs/v2/ui.md, U-12); only the update channel moves
 *  this store — the work-order events are the other stores' business. */
export type UpdateChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  // The chat members (U-97) ride the same push channel; stores that do not serve a chat ignore them.
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type UpdateChangeSignal = (listener: (change: UpdateChange) => void) => () => void;

/** The `app.update` reply as the wire reports it — the checker's UpdateState verbatim (A-32):
 *  `current` is the running app's version, `next` the one waiting. */
export type UpdateStatus =
  | { readonly kind: 'none'; readonly current: string }
  | { readonly kind: 'available'; readonly current: string; readonly next: string }
  | { readonly kind: 'downloading'; readonly current: string; readonly next: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly current: string; readonly next: string }
  | { readonly kind: 'error'; readonly current: string; readonly reason: 'offline' | 'failed' };

/** What the title bar's button (and the Güncelleme section's apply action) make of a status:
 *  visible only while an update waits or has landed, a percent standing that is disabled, and
 *  the apply/restart label pair. Invisible standings carry no meaningful label — the caller
 *  renders nothing and never reads it. */
export interface UpdateButtonPlan {
  readonly visible: boolean;
  readonly labelKey: LabelKey;
  readonly percent: number | null;
  readonly disabled: boolean;
}

/** The lamp hue of a status line (U-28): up to date proceed, an update waiting or ready signal, a
 *  download in flight dim, a failed check error. */
export const updateStatusTone = (kind: UpdateStatus['kind']): LampTone =>
  kind === 'none' ? 'proceed' : kind === 'available' || kind === 'ready' ? 'signal' : kind === 'error' ? 'error' : 'dim';

/** Pure (U-24): the button plan for a status. The input is never mutated. */
export const updateButton = (status: UpdateStatus): UpdateButtonPlan => {
  switch (status.kind) {
    case 'available':
      return { visible: true, labelKey: 'update.button.now', percent: null, disabled: false };
    case 'downloading':
      return { visible: true, labelKey: 'update.button.now', percent: status.percent, disabled: true };
    case 'ready':
      return { visible: true, labelKey: 'update.button.restart', percent: null, disabled: false };
    default:
      return { visible: false, labelKey: 'update.button.now', percent: null, disabled: true };
  }
};

export interface UpdateStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: UpdateChangeSignal;
  /** Every issued command travels as this actor — the update surfaces act as the user. */
  readonly actor: Actor;
  /** The in-flight apply's poll interval; composition keeps the default, tests shrink it. */
  readonly pollMs?: number;
}

/** An intent's answer the way the settings panel shows outcomes (U-8): which command, its
 *  result, and the copy key for it. */
export interface UpdateIntentOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface UpdateStoreState {
  /** Null until the first query answers. */
  readonly status: UpdateStatus | null;
  /** True while `app.update.check` is in flight — the check button's disabled standing. */
  readonly checking: boolean;
  readonly lastOutcome: UpdateIntentOutcome | null;
}

export interface UpdateStore {
  load(): Promise<void>;
  /** Re-checks now (`app.update.check`); the new state arrives through `update.changed`. */
  check(): Promise<void>;
  /** Starts the download and install (`app.update.apply`); allowed while available or ready. */
  apply(): Promise<void>;
  state(): UpdateStoreState;
  subscribe(listener: () => void): () => void;
}

export const createUpdateStore = (deps: UpdateStoreDeps): UpdateStore => {
  const { api, changes, actor } = deps;
  const pollMs = deps.pollMs ?? 400;

  let state: UpdateStoreState = { status: null, checking: false, lastOutcome: null };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply — a poll's answer must not overwrite the
  // standing a newer query already landed.
  let attempts = 0;

  const set = (next: UpdateStoreState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    const reply: unknown = await api.query({ type: 'app.update' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // A failed query keeps the previous status — absence must never read as "you are current"
      // (A-32's stance, held the same way on a failed read).
      return;
    }
    // The contract of the query: a reply that is not a failure is the checker's state verbatim.
    set({ ...state, status: reply as UpdateStatus });
  };

  const runIntent = async (command: Command): Promise<UpdateIntentOutcome> => {
    const result = await api.command(actor, command);
    const outcome: UpdateIntentOutcome = {
      command: command.type,
      result,
      labelKey: commandResultKey(command.type, result),
    };
    set({ ...state, lastOutcome: outcome });
    return outcome;
  };

  const check = async (): Promise<void> => {
    set({ ...state, checking: true });
    await runIntent({ type: 'app.update.check' });
    set({ ...state, checking: false });
    // The command's effect arrives out-of-band (A-33) — re-query rather than wait for the event.
    await load();
  };

  // One flight at a time: a second apply while one walks would race the checker's own guard.
  let applying = false;
  const apply = async (): Promise<void> => {
    if (applying) return;
    applying = true;
    // The walk mutates the checker mid-flight and the event fires only at its end, so the poll
    // carries the percent standings while the command runs (see the module header).
    const poll = setInterval(() => {
      void load();
    }, pollMs);
    try {
      await runIntent({ type: 'app.update.apply' });
    } finally {
      clearInterval(poll);
      applying = false;
      await load();
    }
  };

  changes((change) => {
    if (change.type !== 'update.changed') return;
    void load();
  });

  return {
    load,
    check,
    apply,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
