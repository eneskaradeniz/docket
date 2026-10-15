// services/permission-board.ts — the in-process registry behind `permission.answer` (U-11 of
// docs/v2/ui.md). The executor's gate wiring buffers every open ask here, so the write path
// reaches exactly the run that is still waiting: an ask stays listed until a human answers it or
// its run ends, and nothing in the board's surface ever throws. The board also lists the asks the
// permission policy answered itself — the live half of a record whose durable half is the audit
// entry's policy actor.
import type { AutonomyLevel, EpochMs, PolicyId, Result, RunId } from '../../domain/index';

import type { PermissionGate } from './run-executor';

/** One ask waiting for a human decision, as the UI lists it. */
export interface OpenAsk {
  readonly runId: RunId;
  readonly askId: string;
  readonly since: EpochMs;
}

/** One ask the permission policy answered on the user's behalf (D-10): the deciding rule set and
 *  the level in force, beside the ask's own identity. */
export interface AutoDecision {
  readonly runId: RunId;
  readonly askId: string;
  readonly tool: string;
  readonly at: EpochMs;
  readonly policy: PolicyId;
  readonly level: AutonomyLevel;
}

export type PermissionBoardError = 'not_found';

/** The lifetime hooks the run executor wires around each run: register when the run record opens,
 *  unregister when it closes — unregistering drops the run's still-open asks and its listed auto
 *  decisions. */
export interface BoardHooks {
  register(runId: RunId): void;
  unregister(runId: RunId): void;
  /** Records one policy decision, beside the audit entry the executor writes for it. */
  recordAutoDecision(entry: AutoDecision): void;
}

/** The board is the executor's gate (`onAsk` parks the run) and its registry (`answer` releases it). */
export interface PermissionBoard extends PermissionGate, BoardHooks {
  /** The unanswered asks, oldest first. */
  openAsks(): readonly OpenAsk[];
  /** The policy decisions of the runs still alive, oldest first — nothing here survives the
   *  process; the audit entry's policy actor is the durable record. */
  autoDecided(): readonly AutoDecision[];
  answer(askId: string, decision: 'allow' | 'deny'): Result<RunId, PermissionBoardError>;
}

interface BufferedAsk {
  readonly ask: OpenAsk;
  /** The parked run's continuation; answering resolves it with the decision. */
  readonly release: (decision: 'allow' | 'deny') => void;
}

export function createPermissionBoard(): PermissionBoard {
  // askId → buffered ask; the Map's insertion order keeps the listing oldest-first.
  const asks = new Map<string, BufferedAsk>();
  // The runs the executor has announced and not yet ended.
  const runs = new Set<RunId>();
  let autoDecisions: readonly AutoDecision[] = [];

  return {
    register: (runId) => {
      runs.add(runId);
    },

    unregister: (runId) => {
      runs.delete(runId);
      for (const [askId, buffered] of asks) {
        if (buffered.ask.runId === runId) asks.delete(askId);
      }
      autoDecisions = autoDecisions.filter((entry) => entry.runId !== runId);
    },

    recordAutoDecision: (entry) => {
      autoDecisions = [...autoDecisions, entry];
    },

    // Only a run the executor announced can park on the board: its lifetime is what makes the ask
    // answerable and droppable. Anything else would wedge its stream on a promise nobody could
    // release, so it fails closed instead.
    onAsk: (runId, ask) =>
      runs.has(runId)
        ? new Promise<'allow' | 'deny'>((resolve) => {
            asks.set(ask.id, { ask: { runId, askId: ask.id, since: ask.at }, release: resolve });
          })
        : Promise.resolve('deny'),

    openAsks: () => [...asks.values()].map((buffered) => buffered.ask),

    autoDecided: () => [...autoDecisions],

    answer: (askId, decision) => {
      const buffered = asks.get(askId);
      if (buffered === undefined) return { ok: false, error: 'not_found' };
      asks.delete(askId);
      buffered.release(decision);
      return { ok: true, value: buffered.ask.runId };
    },
  };
}
