// api/commands.ts — the write side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts (A-21).
export type Command =
  | { readonly type: 'workOrder.open'; readonly project: string; readonly repo: string; readonly title: string; readonly flow?: string; readonly task?: string }
  | { readonly type: 'task.open'; readonly project: string; readonly task: string }
  | { readonly type: 'roadmap.runPhase'; readonly project: string; readonly phase: string } // ok → { ok: true, phaseRun } (A-98)
  | { readonly type: 'project.attach'; readonly path: string; readonly repos?: readonly { readonly repo: string; readonly path: string }[] }
  | { readonly type: 'project.create'; readonly mode: 'existing'; readonly path: string; readonly name: string }
  | { readonly type: 'project.create'; readonly mode: 'blank'; readonly parent: string; readonly name: string } // ok → { ok: true, id: <project slug> }
  | { readonly type: 'repo.register'; readonly project: string; readonly repo: string; readonly path: string }
  | { readonly type: 'repo.unregister'; readonly project: string; readonly repo: string }
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'gate.attest'; readonly workOrderId: string; readonly gate: string; readonly noChangeNeeded: boolean } // answers when the changes gate's attestation is recorded
  | { readonly type: 'proposal.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' }
  | { readonly type: 'permission.answer'; readonly runId: string; readonly askId: string; readonly decision: 'allow' | 'deny' }
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
  | { readonly type: 'quota.refresh'; readonly id?: string } // answers { ok: true } after the polls end (A-81)
  | { readonly type: 'capabilities.import'; readonly identities: readonly string[] }
  | { readonly type: 'app.update.check' }
  | { readonly type: 'app.update.apply' };

/** One identity's import outcome on the wire (A-93): `id` is the target it took or would have
 *  taken, `reason` the rejection code — each null exactly when the other field is set. */
export interface CapabilityImportResultView {
  readonly identity: string;
  readonly status: 'imported' | 'already_present' | 'rejected';
  readonly id: string | null;
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
   *  `phaseRun` rides only `roadmap.runPhase`. */
  | { readonly ok: true; readonly id?: string; readonly results?: readonly CapabilityImportResultView[]; readonly phaseRun?: PhaseRunView }
  /** `roles` rides only `binding_exists`: the roles whose bindings still reference the account. */
  | { readonly ok: false; readonly code: string; readonly roles?: readonly string[] };
