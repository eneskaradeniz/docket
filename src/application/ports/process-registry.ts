// Process-registry port — one place that knows every child process Docket starts (agent CLIs of
// every transport, probes, gate commands, git). The quit flow reads it through this port and never
// imports the infrastructure that owns the signals.
import type { EpochMs } from '../../domain/index';

/** Why the child exists; `agent` is user-visible work, the rest is background machinery. */
export type ChildKind = 'agent' | 'probe' | 'gate' | 'git';

/** One live child, as the quit flow and the on-disk mirror see it. */
export interface RegisteredChild {
  readonly pid: number;
  /** The child's process group when it has its own (POSIX detached children); else undefined. */
  readonly pgid: number | undefined;
  readonly kind: ChildKind;
  /** What the site knows about the child (provider id, run id) — never a secret. */
  readonly label: string;
  /** The command's own name, for the start-time/command guard the reaper uses. */
  readonly command: string;
  readonly startedAt: EpochMs;
}

/** What a spawn site registers; `stop` is the site's own graceful stop (a transport ends its run
 *  cancelled through it), and the shutdown runs it before any signal. */
export interface RegisterChildInput extends RegisteredChild {
  readonly stop?: () => void;
}

/** What a bounded stop-all pass did. */
export interface StopAllReport {
  /** Entries the pass started from. */
  readonly total: number;
  /** Entries that were still alive after the SIGTERM grace window and took SIGKILL. */
  readonly killed: number;
  /** True when the grace window closed with entries still unconfirmed dead. */
  readonly timedOut: boolean;
}

export interface ProcessRegistry {
  register(child: RegisterChildInput): void;
  unregister(pid: number): void;
  list(): readonly RegisteredChild[];
  /** Graceful stop (each child's own `stop`), SIGTERM to the groups, a bounded wait, SIGKILL to
   *  whatever is left. Never rejects; a broken child never blocks the quit. */
  stopAll(): Promise<StopAllReport>;
  /** Last-resort synchronous kill of every registered child; never throws, for the `quit` event. */
  killAllSync(): void;
}
