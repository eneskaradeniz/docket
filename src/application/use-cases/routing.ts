// use-cases/routing.ts — the role and account chain a stage run uses (docs/v2/application.md A-10).
import type { AccountRoute, RoleDef, RoleSlug, Result, WorkOrderId, WorkspaceSlug } from '../../domain/index';
import { applyRoleOverrides, err, resolveBinding } from '../../domain/index';

import type { AppDeps } from '../ports/index';

export type RouteError = 'unknown_role' | 'no_binding' | 'no_account';

/** Resolves the role definition (with overrides) and the account chain for a stage run. */
export async function resolveRoute(
  deps: Pick<AppDeps, 'definitions' | 'bindings' | 'accounts'>,
  input: { readonly workspace: WorkspaceSlug; readonly workOrderId: WorkOrderId; readonly role: RoleSlug },
): Promise<Result<{ readonly role: RoleDef; readonly chain: readonly AccountRoute[] }, RouteError>> {
  // Without loadable definitions the role cannot be shown to exist, which is `unknown_role` by A-10.
  const loaded = await deps.definitions.load(input.workspace);
  if (!loaded.ok) return err('unknown_role');
  const base = loaded.value.roles.find((role) => role.id === input.role);
  if (base === undefined) return err('unknown_role');

  const role = applyRoleOverrides(base, loaded.value.workspace?.roleOverrides ?? []);
  if (!role.active) return err('unknown_role');

  const workOrder = await deps.bindings.get({ level: 'workOrder', workOrderId: input.workOrderId }, input.role);
  const workspace = await deps.bindings.get({ level: 'workspace', workspace: input.workspace }, input.role);
  const global = await deps.bindings.get({ level: 'global' }, input.role);
  const resolved = resolveBinding([
    { level: 'workOrder', value: workOrder },
    { level: 'workspace', value: workspace },
    { level: 'global', value: global },
  ]);
  if (resolved === undefined) return err('no_binding');

  // Only accounts that still exist may serve; the chain keeps the binding's order. Fresh route
  // objects, so a caller can never alias the binding stored in the repo.
  const chain: AccountRoute[] = [];
  for (const route of resolved.value.accounts) {
    if ((await deps.accounts.get(route.accountId)) !== undefined) chain.push({ ...route });
  }
  if (chain.length === 0) return err('no_account');

  return { ok: true, value: { role, chain } };
}
