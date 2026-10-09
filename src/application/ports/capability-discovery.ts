// capability-discovery.ts — the port that reads capability sources inside the config directory
// of accounts the user adopted (docs/v2/application.md § 1, A-90). Reads only: the scan never
// writes into an identityDir, and a candidate never carries a byte beyond the fields its type
// names — no environment values, no credentials (R-64).
import type { AccountId, CapabilityCandidate } from '../../domain/index';

/** The one account shape the scan reads: its id (each find's only source) and the config tree. */
export interface CapabilityScanAccount {
  readonly id: AccountId;
  readonly provider: string; // provider def id (data); decides the scan map row
  readonly identityDir?: string; // absolute; absent = nothing to scan (machine login, endpoint)
}

export interface CapabilityDiscovery {
  /** Raw per-account finds — `sources` is exactly the one account each was found in; unmerged
   *  (the use case merges, R-63). `identity` carries the R-62 form of the find's own fields. */
  scan(accounts: readonly CapabilityScanAccount[]): Promise<readonly CapabilityCandidate[]>;
}
