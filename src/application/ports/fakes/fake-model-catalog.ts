// In-memory ModelCatalog — the lists a test scripts per account, answered as-is (the port's
// cache, staleness and refresh semantics belong to the infrastructure implementation's tests).
import type { AccountId, CatalogModel } from '../../../domain/index';

import type { ModelCatalog } from '../model-catalog';

export const createFakeModelCatalog = (
  lists: Readonly<Record<string, readonly CatalogModel[]>> = {},
): ModelCatalog => ({
  list: async (accountId: AccountId) => lists[accountId] ?? [],
});
