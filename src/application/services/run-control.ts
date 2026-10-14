// services/run-control.ts — the live-handle registry behind `run.stop` and `run.steer`
// (A-361 … A-365 of docs/v2/application.md). The permission-board pattern: in-process state
// composed beside the ports, never a port itself. The run executor attaches the transport's own
// handle right after the successful start and detaches it on every end path — the same finally
// that revokes the run token — so the command path reaches exactly the run that is still live,
// and nothing in this surface ever throws.
import type { Result, RunId } from '../../domain/index';

/** The live handle the executor registers; the transport's own `RunHandle` satisfies this shape,
 *  so the executor attaches it as-is. */
export interface RunControlHandle {
  stop(): Promise<void>;
  steer(note: string): void;
}

export type RunControlStopError = 'not_found' | 'not_active';
export type RunControlSteerError = 'not_found' | 'not_active' | 'bad_input';

/** The steer note's whole bound (A-364): trimmed first, then 1…this many characters. */
export const STEER_NOTE_MAX_CHARS = 2000;

export interface RunControl {
  /** The executor, after the transport start succeeded (A-361). */
  attach(runId: RunId, handle: RunControlHandle): void;
  /** The executor, on every end path — the same finally that revokes the run token (A-361). */
  detach(runId: RunId): void;
  /** The runs a stop or a steer can still reach, in attach order. */
  active(): readonly RunId[];
  stop(runId: RunId): Result<RunId, RunControlStopError>;
  steer(runId: RunId, note: string): Result<RunId, RunControlSteerError>;
}

export function createRunControl(): RunControl {
  // runId → live handle. The keys are the answer `active()` lists.
  const handles = new Map<RunId, RunControlHandle>();
  // Ever-attached ids: a detached run answers `not_active` (A-363), while an id this process
  // never attached answers `not_found` — the registry is process-local like the board, so after
  // a relaunch nothing is stoppable (the orphans are the child registry's, I-101).
  const known = new Set<RunId>();
  // Stop requested while the handle is still attached: the executor's end path has not detached
  // yet, so a repeated command in that window is A-362's ok no-op, never a second stop() call.
  const stopping = new Set<RunId>();

  return {
    attach: (runId, handle) => {
      known.add(runId);
      handles.set(runId, handle);
    },

    detach: (runId) => {
      handles.delete(runId);
      stopping.delete(runId);
    },

    active: () => [...handles.keys()],

    stop: (runId) => {
      const handle = handles.get(runId);
      if (handle === undefined) {
        return { ok: false, error: known.has(runId) ? ('not_active' as const) : ('not_found' as const) };
      }
      if (stopping.has(runId)) return { ok: true, value: runId };
      stopping.add(runId);
      // The transport's stop ends its stream with `finished { reason: 'cancelled' }` (I-30) and
      // the executor's own end path does every write that follows, so a rejected stop changes
      // nothing the operator can lose — it is swallowed rather than surfaced as a command error.
      void handle.stop().catch(() => undefined);
      return { ok: true, value: runId };
    },

    steer: (runId, note) => {
      // The note is validated before any lookup: operator text the transport would echo back as
      // a user message is bounded here or never leaves (A-364).
      const trimmed = note.trim();
      if (trimmed.length < 1 || trimmed.length > STEER_NOTE_MAX_CHARS) {
        return { ok: false, error: 'bad_input' as const };
      }
      const handle = handles.get(runId);
      if (handle === undefined) {
        return { ok: false, error: known.has(runId) ? ('not_active' as const) : ('not_found' as const) };
      }
      handle.steer(trimmed);
      return { ok: true, value: runId };
    },
  };
}
