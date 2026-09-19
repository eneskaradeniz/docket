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
  /** WO-0045: queue a steering note into the RUNNING drive — the noteId handle, or null when refused. */
  steer: (note: string) => Promise<string | null>;
  /** WO-0045: pull a queued note back (best-effort — false means it WILL run). */
  retractSteer: (noteId: string) => Promise<boolean>;
};

declare global {
  interface Window {
    docket: {
      source: WorkOrderSource;
    settings: AppSettings;
      runner: RunnerBridge;
      /** WO-0064: the forge observation watch (core's `ForgeWatch`) — reconcile triggers + the
       *  observed cache view; the composition root implements it over the forge adapter. */
      forge?: import('../core/forge').ForgeWatch;
      /** WO-0066: the three dependencies, one look (core's `SystemHealthWatch` — a failed look
       *  resolves undefined; the renderer renders nothing, never bricks). */
      health?: import('../core/health').SystemHealthWatch;
      /** WO-0068: the operator's console (ADR-0018) — the Değişiklikler reads + the four one-click
       *  writes. The group is `changes` (a `console` key would collide with the DOM global); the
       *  writes are the operator's explicit acts, jailed main-side, each resolving the honest
       *  two-arm result — merge confirms in the UI, never here. The write METHODS are declared
       *  nowhere in core (ADR-0018 decision 4): only this bridge shape names them. */
      changes?: {
        changesFor: (workOrderId: import('../core/types').WorkOrderId) => Promise<import('../core/console').RepoChanges[]>;
        diffFor: (workOrderId: import('../core/types').WorkOrderId, repoPath: string, file: string) => Promise<import('../core/diff').LineDiff | null>;
        commit: (workOrderId: import('../core/types').WorkOrderId, repoPath: string, message: string) => Promise<import('../core/console').CommitResult>;
        push: (workOrderId: import('../core/types').WorkOrderId, repoPath: string) => Promise<import('../core/console').PushResult>;
        createPr: (workOrderId: import('../core/types').WorkOrderId, repoPath: string, summary: string) => Promise<import('../core/console').CreatePrResult>;
        merge: (workOrderId: import('../core/types').WorkOrderId, repoPath: string, prNumber: number) => Promise<import('../core/console').MergeResult>;
      };
      pickFolder: () => Promise<string | null>;
      pickFiles: () => Promise<string[] | null>;
      /** WO-0051 / D3: the ✦ dialog's DEPO scan — { docsRoot, files }, structure-root-relative
       *  paths (the absolute root never crosses, ADR-0001). */
      listDecisionDocs: (workspaceId: import('../core/types').WorkspaceId) => Promise<{ docsRoot: string; files: string[] }>;
      /** Diff peek (WO-0031c): capped diff structure for a write-permission card — jailed to the
       *  work order's repo roots (main-side realpath containment). */
      diffPeek: (workOrderId: import('../core/types').WorkOrderId, filePath: string, newContent: string) => Promise<import('../core/diff').LineDiff | null>;
      /** E2E-only scripting channel (WO-0031c) — present only under DOCKET_E2E. WO-0051 / D7:
       *  pickFiles stages the next native-pick answer. */
      e2e?: { emit: (ev: RunnerEvent) => Promise<void>; pickFiles: (paths: string[] | null) => Promise<void> };
    };
  }
}
