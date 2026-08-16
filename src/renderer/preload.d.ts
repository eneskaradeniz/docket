// Renderer-side type for the preload bridge (electron/preload.ts). The exposed
// surface is two ports: the data port (`source`) and the session-runner port
// (`runner`, callback form — the AsyncIterable is realised renderer-side off it,
// because contextBridge does not preserve Symbol-keyed properties). No Node surface
// leaks (ADR-0006/0001).
import type { PermissionAsk } from '../core/runner';
import type { AppSettings } from '../core/app-settings';
import type { WorkOrderSource } from '../core/source';
import type { DriveInput, PermissionDecision, RunnerEvent } from '../core/runner';

/** The runner as exposed across the contextBridge: callback `drive`, not AsyncIterable. */
export type RunnerBridge = {
  drive: (input: DriveInput, onEvent: (ev: RunnerEvent) => void) => Promise<void>;
  decide: (requestId: string, decision: PermissionDecision) => Promise<void>;
  pendingAsks: () => Promise<PermissionAsk[]>;
  interrupt: () => Promise<void>;
  /** Zorla kes (WO-0031c): the 5s-stuck stop's escape hatch — aborts the active drive's generator. */
  abort: () => Promise<void>;
};

declare global {
  interface Window {
    docket: {
      source: WorkOrderSource;
    settings: AppSettings;
      runner: RunnerBridge;
      pickFolder: () => Promise<string | null>;
      pickFiles: () => Promise<string[] | null>;
      /** Diff peek (WO-0031c): capped diff structure for a write-permission card — jailed to the
       *  work order's repo roots (main-side realpath containment). */
      diffPeek: (workOrderId: import('../core/types').WorkOrderId, filePath: string, newContent: string) => Promise<import('../core/diff').LineDiff | null>;
      /** E2E-only scripting channel (WO-0031c) — present only under DOCKET_E2E. */
      e2e?: { emit: (ev: RunnerEvent) => Promise<void> };
    };
  }
}
