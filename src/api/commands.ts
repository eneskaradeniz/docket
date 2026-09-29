// api/commands.ts — the write side of the boundary. Exact contract: docs/v2/application.md § 4.
// Plain JSON-serialisable shapes only; ids travel as strings and are parsed in api.ts (A-21).
export type Command =
  | { readonly type: 'workOrder.open'; readonly repo: string; readonly title: string; readonly flow?: string; readonly task?: string }
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'proposal.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' }
  | { readonly type: 'permission.answer'; readonly runId: string; readonly askId: string; readonly decision: 'allow' | 'deny' }
  | { readonly type: 'deploy.approve'; readonly workOrderId: string; readonly gate: string; readonly commit: string; readonly confirmedEnvironment?: string }
  | { readonly type: 'account.save'; readonly id?: string; readonly provider: string; readonly label: string; readonly authMode: string; readonly plan?: string }
  | { readonly type: 'account.remove'; readonly id: string }
  | { readonly type: 'binding.save'; readonly role: string; readonly accounts: { readonly accountId: string; readonly model?: string }[] };

export type CommandResult =
  | { readonly ok: true; readonly id?: string }
  /** `roles` rides only `binding_exists`: the roles whose bindings still reference the account. */
  | { readonly ok: false; readonly code: string; readonly roles?: readonly string[] };
