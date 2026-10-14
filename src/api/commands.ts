// api/commands.ts — the write side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts (A-21).
import type { McpStatusView } from './queries';

export type Command =
  | { readonly type: 'workOrder.open'; readonly project: string; readonly repo: string; readonly title: string; readonly description?: string; readonly flow?: string; readonly task?: string }
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
  | { readonly type: 'repo.unregister'; readonly project: string; readonly repo: string }
  | { readonly type: 'repo.relink'; readonly repoId: string; readonly path: string } // errors: not_found, folder_not_found, fingerprint_mismatch (A-341)
  | { readonly type: 'repo.saveFlow'; readonly repo: string; readonly flow: RepoFlowInput } // ok → { ok: true }; errors: not_found, definitions_invalid, stale, account_not_connected (A-345, A-354)
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'gate.attest'; readonly workOrderId: string; readonly gate: string; readonly noChangeNeeded: boolean } // answers when the changes gate's attestation is recorded
  | { readonly type: 'proposal.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' }
  | { readonly type: 'permission.answer'; readonly runId: string; readonly askId: string; readonly decision: 'allow' | 'deny' }
  // Stopping and steering the live run of a stage (A-361 … A-365). Both speak for the operator
  // like every other command — no actor field exists on the wire.
  | { readonly type: 'run.stop'; readonly runId: string } // errors: not_found (unknown id), not_active (no live run) (A-362, A-363)
  | { readonly type: 'run.steer'; readonly runId: string; readonly note: string } // errors: bad_input (note), not_found, not_active (A-364)
  | { readonly type: 'deploy.approve'; readonly workOrderId: string; readonly gate: string; readonly commit: string; readonly confirmedEnvironment?: string }
  | { readonly type: 'account.save'; readonly id?: string; readonly provider: string; readonly label: string; readonly authMode: string; readonly plan?: string; readonly reserve?: { readonly short?: number; readonly long?: number }; readonly limitPolicy?: string }
  | { readonly type: 'account.adopt'; readonly sourcePath: string; readonly label: string; readonly importToken?: boolean }
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
  | { readonly type: 'mcp.restore' }; // ok → { status: McpStatusView } | { ok: false, error: 'endpoint_unavailable' | 'listener_failed' | 'script_missing' } (A-381)

/** A repo flow as the renderer sends it (A-345): the domain's `RepoFlow` with plain string ids
 *  and unparsed stage/binding bodies — api.ts narrows it with the same law the file world
 *  validates under, and the use case re-validates the merged definitions before writing. */
export interface RepoFlowInput {
  readonly flowId: string;
  readonly version: number;
  readonly stages: readonly object[];
  readonly bindings: readonly object[];
}

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
    }
  /** `roles` rides only `binding_exists`: the roles whose bindings still reference the account.
   *  `accounts` rides only `account_not_connected` on repo.saveFlow (A-354): every disconnected
   *  stage chain entry as `{ stage, accountId }`.
   *  `issues` rides `definitions_invalid` on bundle import (A-342).
   *  `definitionIssues` rides `definitions_invalid` on definitions.save (A-352).
   *  `reasons` rides `blocked` on definitions.archive / definitions.delete (A-355).
   *  `error` rides only `mcp.restore` (A-381): its typed refusal instead of a `code`. */
  | {
      readonly ok: false;
      readonly code: string;
      readonly roles?: readonly string[];
      readonly accounts?: readonly { readonly stage: string; readonly accountId: string }[];
      readonly issues?: readonly string[];
      readonly definitionIssues?: readonly { readonly path: string; readonly code: string; readonly message: string }[];
      readonly reasons?: readonly { readonly kind: string; readonly workOrders?: readonly string[]; readonly of?: string; readonly repo?: string; readonly stage?: string }[];
      readonly error?: 'endpoint_unavailable' | 'listener_failed' | 'script_missing';
    };
