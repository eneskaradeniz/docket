// Machine-local role → account chain, per level.
import type { RoleBinding, RoleSlug, WorkOrderId, WorkspaceSlug } from '../../domain/index';

export type BindingScope =
  | { readonly level: 'global' }
  | { readonly level: 'workspace'; readonly workspace: WorkspaceSlug }
  | { readonly level: 'workOrder'; readonly workOrderId: WorkOrderId };

export interface BindingRepo {
  save(scope: BindingScope, binding: RoleBinding): Promise<void>;
  get(scope: BindingScope, role: RoleSlug): Promise<RoleBinding | undefined>;
}
