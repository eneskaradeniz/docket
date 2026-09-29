// In-memory BindingRepo — role bindings stored per scope level.
import type { RoleBinding, RoleSlug } from '../../../domain/index';

import type { BindingRepo, BindingScope } from '../binding-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeBindingRepo extends BindingRepo {}

// Canonical key per level; slugs and ULIDs never contain the separator, so keys are unambiguous.
const scopeKey = (scope: BindingScope): string =>
  scope.level === 'global'
    ? 'global'
    : scope.level === 'repo'
      ? `repo:${scope.repo}`
      : `workOrder:${scope.workOrderId}`;

export const createFakeBindingRepo = (): FakeBindingRepo => {
  // The scope is stored beside the binding so listAll can report it without parsing keys back.
  const byScopeAndRole = new Map<string, { readonly scope: BindingScope; readonly binding: RoleBinding }>();

  return {
    save: async (scope: BindingScope, binding: RoleBinding): Promise<void> => {
      byScopeAndRole.set(`${scopeKey(scope)}\n${binding.role}`, { scope, binding: { ...binding } });
    },

    get: async (scope: BindingScope, role: RoleSlug): Promise<RoleBinding | undefined> =>
      byScopeAndRole.get(`${scopeKey(scope)}\n${role}`)?.binding,

    // Map iteration order is insertion order, and an upsert keeps the original position: save order.
    listAll: async (): Promise<readonly { readonly scope: BindingScope; readonly binding: RoleBinding }[]> =>
      [...byScopeAndRole.values()].map((entry) => ({ scope: entry.scope, binding: { ...entry.binding } })),
  };
};
