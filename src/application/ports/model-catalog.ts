// The model catalog port: the merged model list of one account's route. Contract:
// docs/v2/provider-capabilities.md section 3 (P-29, layer 3); implemented in
// src/infrastructure/providers/catalog/.
import type { AccountId, CatalogModel } from '../../domain/index';

export interface ModelCatalog {
  /**
   * The merged list for the account's route: live ∪ bundled (live-authoritative when the route
   * kind says so), cached per account and route. `refresh` bypasses the cache; a failed refresh
   * keeps the last good list marked stale rather than rejecting.
   */
  list(accountId: AccountId, options?: { readonly refresh?: boolean }): Promise<readonly CatalogModel[]>;
}
