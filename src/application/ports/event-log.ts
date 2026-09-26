// Audit-trail port — every state-changing use case appends one entry here.
import type { AccountId, Actor, EpochMs, ProposalId, RoleSlug, RunId, Ulid, WorkOrderId } from '../../domain/index';

export type AuditAction =
  | 'work_order.opened' | 'work_order.blocked' | 'work_order.unblocked' | 'work_order.closed'
  | 'run.started' | 'run.finished' | 'gate.decided' | 'permission.answered'
  | 'proposal.created' | 'proposal.decided' | 'account.saved' | 'account.removed' | 'binding.saved';

export type AuditSubject =
  | { readonly kind: 'work_order'; readonly id: WorkOrderId }
  | { readonly kind: 'run'; readonly id: RunId }
  | { readonly kind: 'proposal'; readonly id: ProposalId }
  | { readonly kind: 'account'; readonly id: AccountId }
  | { readonly kind: 'binding'; readonly role: RoleSlug };

export interface AuditEntry {
  readonly id: Ulid<'audit'>;
  readonly at: EpochMs;
  readonly actor: Actor;
  readonly action: AuditAction;
  readonly subject: AuditSubject;
  /** Targets only (paths, command names, gate ids). Never secrets or environment values. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export interface EventLog {
  append(entry: AuditEntry): Promise<void>;
  list(subject: AuditSubject, limit: number): Promise<readonly AuditEntry[]>; // newest first
}
