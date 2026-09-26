// In-memory BindingRepo — role bindings stored per scope level.
import type { RoleBinding, RoleSlug } from '../../../domain/index';

import type { BindingRepo, BindingScope } from '../binding-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeBindingRepo extends BindingRepo {}

// Canonical key per level; slugs and ULIDs never contain the separator, so keys are unambiguous.
const scopeKey = (scope: BindingScope): string =>
  scope.level === 'global'
    ? 'global'
    : scope.level === 'workspace'
      ? `workspace:${scope.workspace}`
      : `workOrder:${scope.workOrderId}`;

export const createFakeBindingRepo = (): FakeBindingRepo => {
  const byScopeAndRole = new Map<string, RoleBinding>();

  return {
    save: async (scope: BindingScope, binding: RoleBinding): Promise<void> => {
      byScopeAndRole.set(`${scopeKey(scope)}\n${binding.role}`, { ...binding });
    },

    get: async (scope: BindingScope, role: RoleSlug): Promise<RoleBinding | undefined> =>
      byScopeAndRole.get(`${scopeKey(scope)}\n${role}`),
  };
};
