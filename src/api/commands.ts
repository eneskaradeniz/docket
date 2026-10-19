// api/commands.ts — the write side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts (A-21).
import type { SyncMode } from '../domain/index';
import type { McpStatusView } from './queries';

export type Command =
  | {
      readonly type: 'workOrder.open';
      readonly project: string;
      readonly repo: string;
      readonly title: string;
      readonly description?: string;
      readonly flow?: string;
      readonly task?: string;
      readonly stageSkip?: { readonly stages: readonly string[]; readonly reason: string; readonly approved?: boolean };
    }
  | { readonly type: 'task.open'; readonly project: string; readonly task: string }
  | { readonly type: 'roadmap.runPhase'; readonly project: string; readonly phase: string } // ok → { ok: true, phaseRun } (A-98)
  | { readonly type: 'roadmap.pausePhase'; readonly project: string; readonly phase: string } // errors: not_running (A-110)
  | { readonly type: 'roadmap.resumePhase'; readonly project: string; readonly phase: string } // errors: not_paused (A-110)
  | { readonly type: 'project.attach'; readonly path: string; readonly repos?: readonly { readonly repo: string; readonly path: string }[] }
  | { readonly type: 'project.create'; readonly mode: 'existing'; readonly path: string; readonly name: string }
  | { readonly type: 'project.create'; readonly mode: 'blank'; readonly parent: string; readonly name: string } // ok → { ok: true, id: <project slug> }
  | { readonly type: 'project.export'; readonly project: string } // ok → { path, counts } (A-342)
  | { readonly type: 'project.importBundle'; readonly path: string } // ok → { warnings, renames } (A-342)
  | { readonly type: 'repo.register'; readonly project: string; readonly repo: string; readonly path: string }
  | { readonly type: 'setup.apply'; readonly project: string; readonly path: string; readonly proposal: unknown }
  | { readonly type: 'repo.unregister'; readonly project: string; readonly repo: string }
  | { readonly type: 'repo.relink'; readonly repoId: string; readonly path: string } // errors: not_found, folder_not_found, fingerprint_mismatch (A-341)
  | { readonly type: 'repo.saveFlow'; readonly repo: string; readonly flow: RepoFlowInput } // ok → { ok: true }; errors: not_found, definitions_invalid, stale, account_not_connected (A-345, A-354)
  // The widened autonomy chain's set-level commands (A-403, D-10 chain a): user actor only — the
  // api names the operator, so a non-user actor never rides this wire. `null` clears the layer;
  // errors: user_only, invalid_autonomy_level, above_ceiling, auto_requires_spend_cap,
  // auto_requires_max_attempts (+ not_found/definitions_invalid/stale where a load or a file
  // write sits behind them); repo.setAutonomy's maxLevel is ceiling_not_available until chain (c).
  | { readonly type: 'workOrder.setAutonomy'; readonly id: string; readonly level: AutonomyLevelInput }
  | { readonly type: 'repo.setAutonomy'; readonly repo: string; readonly level?: AutonomyLevelInput; readonly maxLevel?: AutonomyLevelInput }
  | { readonly type: 'project.setAutonomy'; readonly project: string; readonly level: AutonomyLevelInput }
  | { readonly type: 'settings.setAutonomy'; readonly level?: AutonomyLevelInput; readonly maxLevel?: AutonomyLevelInput }
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  // The work order's git lifecycle (GI-2): push the branch, open its pull request, merge it (the
  // human step — a command, never a side effect), release the branch and worktree. All four speak
  // for the operator like every other command: no actor field exists on the wire (A-376).
  | { readonly type: 'workOrder.push'; readonly id: string } // errors: not_found, no_repo, forge_unavailable, forge_error (A-371)
  | { readonly type: 'workOrder.openPr'; readonly id: string; readonly base: string; readonly title?: string } // ok → { pr } (A-372); errors: bad_input, not_pushed, pr_exists (answers the stored ref), forge_error
  | { readonly type: 'workOrder.mergePr'; readonly id: string; readonly number: number } // errors: not_found (also a stale number — the explicit-approval pin), forge_error (A-373)
  | { readonly type: 'workOrder.mergeLocal'; readonly id: string; readonly base: string } // forge-less repos only; `base` is the branch the operator saw checked out (the approval pin) — errors: bad_input, forge_configured, already_merged, no_repo, no_branch, dirty_checkout, base_not_checked_out, conflict (merge aborted, tree clean), git_failed (A-425)
  | { readonly type: 'workOrder.releaseBranch'; readonly id: string } // errors: branch_not_merged, no_repo, git_failed (A-374)
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'gate.attest'; readonly workOrderId: string; readonly gate: string; readonly noChangeNeeded: boolean } // answers when the changes gate's attestation is recorded
  | { readonly type: 'proposal.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' }
  | { readonly type: 'permission.answer'; readonly runId: string; readonly askId: string; readonly decision: 'allow' | 'deny' }
  // Stopping and steering the live run of a stage (A-361 … A-365). Both speak for the operator
  // like every other command — no actor field exists on the wire.
  | { readonly type: 'run.stop'; readonly runId: string } // errors: not_found (unknown id), not_active (no live run) (A-362, A-363)
  | { readonly type: 'run.steer'; readonly runId: string; readonly note: string } // errors: bad_input (note), not_found, not_active (A-364), unsupported (A-366)
  | { readonly type: 'deploy.approve'; readonly workOrderId: string; readonly gate: string; readonly commit: string; readonly confirmedEnvironment?: string }
  | { readonly type: 'account.save'; readonly id?: string; readonly provider: string; readonly label: string; readonly authMode: string; readonly plan?: string; readonly reserve?: { readonly short?: number; readonly long?: number }; readonly limitPolicy?: string }
  | { readonly type: 'account.adopt'; readonly sourcePath: string; readonly label: string; readonly importToken?: boolean }
  // P-67: the chosen-identity-directory form — a home-rooted account's HOME, adopted without a scan.
  | { readonly type: 'account.adopt'; readonly provider: string; readonly identityDir: string; readonly label: string }
  | { readonly type: 'account.remove'; readonly id: string }
  | { readonly type: 'account.test'; readonly id: string; readonly model?: string } // answers when the test has ended: { ok: true } or { ok: false, code: AccountTestError }
  | { readonly type: 'account.cap.save'; readonly id: string; readonly scope: string; readonly amountUsd: number; readonly warnPercent: number }
  | { readonly type: 'account.cap.remove'; readonly id: string; readonly scope: string }
  | { readonly type: 'account.consent.grant'; readonly id: string; readonly model: string; readonly cap?: { readonly scope: string; readonly amountUsd: number; readonly warnPercent: number } }
  | { readonly type: 'account.consent.revoke'; readonly id: string; readonly model: string }
  | { readonly type: 'binding.save'; readonly role: string; readonly accounts: { readonly accountId: string; readonly model?: string }[]; readonly thinking?: { readonly level?: string; readonly effort?: string }; readonly tier?: string }
  | { readonly type: 'settings.setDispatch'; readonly global: number; readonly perRepo: number; readonly perAccount: Readonly<Record<string, number>>; readonly mode?: 'fixed' | 'auto' } // errors: invalid_limits, unknown_account
  | { readonly type: 'quota.refresh'; readonly id?: string } // answers { ok: true } after the polls end (A-81)
  | { readonly type: 'capabilities.import'; readonly identities: readonly string[] }
  | {
      readonly type: 'capabilities.importMachine';
      readonly providers: readonly string[];
      readonly keys: readonly string[];
      readonly secretRefs?: Readonly<Record<string, string>>;
    }
  | { readonly type: 'page.comment'; readonly page: string; readonly version: number; readonly text: string; readonly anchor?: string } // errors: the domain's PageError codes (A-158)
  | { readonly type: 'page.requestApproval'; readonly page: string }
  | { readonly type: 'page.decide'; readonly page: string; readonly decision: 'approved' | 'rejected'; readonly version: number }
  | { readonly type: 'page.pin'; readonly page: string; readonly pinned: boolean } // errors: not_found, too_many_pinned (A-200)
  // The chat surface (6e-5). Every command acts as the operator the api's own actor names; a `by`
  // or `actor` field in the payload is never read (A-256). Ids are strings, parsed at the edge.
  | { readonly type: 'chat.start'; readonly scope: ChatScopeInput; readonly message?: string; readonly refs?: readonly ChatRefInput[]; readonly attachments?: readonly string[] } // ok → { conversation, turn? } (A-256)
  | { readonly type: 'chat.send'; readonly conversation: string; readonly text: string; readonly refs?: readonly ChatRefInput[]; readonly attachments?: readonly string[] } // ok → { turn } (A-257)
  | { readonly type: 'chat.cancel'; readonly conversation: string }
  | { readonly type: 'chat.pin'; readonly conversation: string; readonly pinned: boolean }
  | { readonly type: 'chat.delete'; readonly conversation: string } // cancels an active turn first (A-258)
  | { readonly type: 'chat.attach'; readonly conversation?: string; readonly name: string; readonly fileType: string; readonly base64: string } // ok → { attachment } (A-259); `fileType` because the union's own discriminant is `type`
  | { readonly type: 'chat.draft.confirm'; readonly draft: string } // ok → { workOrder, code } (A-262)
  | { readonly type: 'chat.draft.drop'; readonly draft: string }
  | { readonly type: 'chat.action.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' }
  | { readonly type: 'chat.action.undo'; readonly id: string }
  | { readonly type: 'chat.grant'; readonly conversation: string; readonly classes: readonly string[]; readonly minutes: number } // ok → { id } (A-262)
  | { readonly type: 'chat.revoke'; readonly grant: string }
  | { readonly type: 'app.update.check' }
  | { readonly type: 'app.update.apply' }
  // The Docket AI setup conversation (A-357 … A-359): one command starts it, one answers its read
  // asks; the messages themselves ride `chat.send` unchanged.
  | { readonly type: 'setup.ai.start'; readonly repoPath: string; readonly draft?: string } // ok → { conversation } (A-357); no_provider (A-340), mcp_down (A-381)
  | { readonly type: 'setup.read.answer'; readonly conversation: string; readonly path: string; readonly allow: boolean } // ok → { ok: true } (A-358)
  /** The quit modal is on screen (answer to `quit.requested`); without it the shell falls back to the native dialog. */
  | { readonly type: 'quit.ack' }
  /** The operator's answer to the in-app quit confirmation: true = Kapat ve durdur, false = Vazgeç. */
  | { readonly type: 'quit.answer'; readonly accept: boolean }
  | { readonly type: 'memory.acceptProposal'; readonly id: string }
  | { readonly type: 'memory.rejectProposal'; readonly id: string }
  | { readonly type: 'memory.setAutoAccept'; readonly scope: 'global' | 'project' | 'repo'; readonly enabled: boolean }
  | { readonly type: 'memory.addNote'; readonly text: string; readonly scope: 'global' | 'project' | 'repo'; readonly scopeId?: string }
  | { readonly type: 'definitions.save'; readonly kind: 'plugin' | 'mcp' | 'skill' | 'command' | 'hook'; readonly definition: unknown } // ok → { version }; failures → definitions_invalid + issues (A-352)
  | { readonly type: 'definitions.archive'; readonly kind: 'roles'; readonly id: string } // ok → { ok: true }; blocked → { ok: false, code: 'blocked', reasons } (A-355)
  | { readonly type: 'definitions.delete'; readonly kind: 'roles'; readonly id: string } // ok → { ok: true }; blocked → { ok: false, code: 'blocked', reasons } (A-355)
  | { readonly type: 'tracker.link'; readonly repo: string; readonly tracker: 'github'; readonly scope: string; readonly mode: SyncMode }
  | { readonly type: 'tracker.unlink'; readonly repo: string }
  | { readonly type: 'tracker.sync'; readonly repo: string }
  | {
      readonly type: 'tracker.resolveConflict';
      readonly repo: string;
      readonly conflict: {
        readonly issue: string;
        readonly field: 'title' | 'body' | 'state' | 'milestone' | 'labels';
        readonly local: string;
        readonly remote: string;
        readonly detectedAt: number;
      };
      readonly resolution: 'keep_remote' | 'keep_local';
    }
  // Restarts Docket's own MCP listener when it is down and answers the fresh standing; the
  // failure side carries `error`, not `code` (A-381).
  | { readonly type: 'mcp.restore' } // ok → { status: McpStatusView } | { ok: false, error: 'endpoint_unavailable' | 'listener_failed' | 'script_missing' } (A-381)
  // The Settings → Entegrasyonlar rows' one write (U-356): the switch speaks for the operator
  // like every other command — no actor field exists on the wire, and the api's own actor gate
  // answers user_only before the registry is ever called.
  | { readonly type: 'connector.setEnabled'; readonly id: string; readonly enabled: boolean }; // errors: user_only, not_found, invalid, invalid_settings (A-415)

/** A repo flow as the renderer sends it (A-345): the domain's `RepoFlow` with plain string ids
 *  and unparsed stage/binding bodies — api.ts narrows it with the same law the file world
 *  validates under, and the use case re-validates the merged definitions before writing. */
export interface RepoFlowInput {
  readonly flowId: string;
  readonly version: number;
  readonly stages: readonly object[];
  readonly bindings: readonly object[];
}

/** An autonomy level on the wire (A-403): one of the domain's three, or `null` to clear the
 *  layer — api.ts parses the value with the domain's own member law before anything moves. */
export type AutonomyLevelInput = 'manual' | 'balanced' | 'auto' | null;

/** A conversation scope on the wire: the domain's own three shapes with plain string ids. */
export type ChatScopeInput =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'workOrder'; readonly workOrder: string };

/** A reference the renderer sends: `{ kind, id }`, or `{ repo, path }` for a file. The api resolves
 *  each against the operator's own state before anything is appended (A-261). */
export type ChatRefInput =
  | { readonly kind: 'workOrder'; readonly id: string }
  | { readonly kind: 'page'; readonly id: string }
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'repo'; readonly id: string }
  | { readonly kind: 'file'; readonly repo: string; readonly path: string };

/** One identity's import outcome on the wire (A-93): `id` is the target it took or would have
 *  taken, `reason` the rejection code — each null exactly when the other field is set. */
export interface CapabilityImportResultView {
  readonly identity: string;
  readonly status: 'imported' | 'already_present' | 'rejected';
  readonly id: string | null;
  readonly reason: string | null;
}

export interface MachineImportResultView {
  readonly key: string;
  readonly status: 'imported' | 'rejected';
  readonly id: string | null;
  readonly version: number | null;
  readonly reason: string | null;
}

/** What `roadmap.runPhase` answers (A-98): per task the work orders it opened, and the failures
 *  collected without stopping the other tasks (A-99). */
export interface PhaseRunView {
  readonly opened: readonly { readonly task: string; readonly workOrders: readonly string[] }[];
  readonly failed: readonly { readonly task: string; readonly workOrder?: string; readonly error: string }[];
}

export type CommandResult =
  /** `results` rides only `capabilities.import`: one row per requested identity, in input order.
   *  `phaseRun` rides only `roadmap.runPhase`. The chat fields ride only their own commands:
   *  `conversation`+`turn` (chat.start), `turn` (chat.send), `attachment` (chat.attach),
   *  `workOrder`+`code` (chat.draft.confirm), `id` (chat.grant).
   *  `path`+`counts` ride `project.export`, `warnings`+`renames` ride `project.importBundle` (A-342). */
  | {
      readonly ok: true;
      readonly id?: string;
      readonly results?: readonly CapabilityImportResultView[];
      readonly machineResults?: readonly MachineImportResultView[];
      readonly phaseRun?: PhaseRunView;
      readonly conversation?: string;
      readonly turn?: string;
      readonly attachment?: string;
      readonly workOrder?: string;
      readonly code?: string;
      readonly report?: { readonly warnings: readonly string[]; readonly renames: readonly { readonly id: string; readonly to: string }[] };
      readonly path?: string;
      readonly counts?: { readonly projects: number; readonly repos: number; readonly definitions: number; readonly memoryNotes: number };
      readonly warnings?: readonly string[];
      readonly renames?: readonly { readonly id: string; readonly to: string }[];
      readonly version?: number;
      /** Rides only `mcp.restore` (A-381): the standing the restart ended with. */
      readonly status?: McpStatusView;
      /** Rides only `workOrder.openPr` (A-372): the pull request that was opened, or — on
       *  `pr_exists` — the stored one the refusal answers with. */
      readonly pr?: { readonly number: number; readonly url: string };
      /** Warning count of non-done work orders whose pre-clamp level exceeds the ceiling (A-406). */
      readonly ordersAbove?: number;
      /** Rides only `setup.apply`: false when repos/<slug>/repo.yaml already existed and nothing was written. */
      readonly wroteRepoYaml?: boolean;
    }
  /** `validModelIds` rides only `unknown_model` (A-389): the catalog ids valid for that account's route.
   *  `roles` rides only `binding_exists`: the roles whose bindings still reference the account.
   *  `accounts` rides only `account_not_connected` on repo.saveFlow (A-354): every disconnected
   *  stage chain entry as `{ stage, accountId }`.
   *  `issues` rides `definitions_invalid` on bundle import (A-342).
   *  `definitionIssues` rides `definitions_invalid` on definitions.save (A-352).
   *  `reasons` rides `blocked` on definitions.archive / definitions.delete (A-355).
   *  `pr` rides `pr_exists` on workOrder.openPr (A-372): the stored pull request the refusal
   *  answers with.
   *  `error` rides only `mcp.restore` (A-381): its typed refusal instead of a `code`. */
  | {
      readonly ok: false;
      readonly code: string;
      readonly validModelIds?: readonly string[];
      readonly roles?: readonly string[];
      readonly accounts?: readonly { readonly stage: string; readonly accountId: string }[];
      readonly issues?: readonly string[];
      readonly definitionIssues?: readonly { readonly path: string; readonly code: string; readonly message: string }[];
      readonly reasons?: readonly { readonly kind: string; readonly workOrders?: readonly string[]; readonly of?: string; readonly repo?: string; readonly stage?: string }[];
      readonly pr?: { readonly number: number; readonly url: string };
      readonly error?: 'endpoint_unavailable' | 'listener_failed' | 'script_missing';
    };
