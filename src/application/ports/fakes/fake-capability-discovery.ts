// In-memory CapabilityDiscovery — the port's contract, not a loose stand-in (I-45, the I-41
// stance): an account without identityDir answers nothing, a configured broken directory is an
// empty find, never a throw, and every find's sources become exactly the scanning account's id.
// The file-level parsing is the adapter's own semantics; the fake stays at the port's altitude.
import type { CapabilityCandidate } from '../../../domain/index';
import type { CapabilityDiscovery, CapabilityScanAccount } from '../capability-discovery';

export interface FakeCapabilityDiscovery extends CapabilityDiscovery {
  /** Seeds what a scan of `dir` finds; each find's sources become exactly [the account's id]. */
  seed(dir: string, finds: readonly CapabilityCandidate[]): void;
  /** The next scan of `dir` is an empty find — a broken config directory, never a throw. */
  breakDir(dir: string): void;
  /** A copy of every account set handed to `scan` so far (A-2: results are the caller's data). */
  scans(): readonly (readonly CapabilityScanAccount[])[];
}

export const createFakeCapabilityDiscovery = (): FakeCapabilityDiscovery => {
  const findsByDir = new Map<string, readonly CapabilityCandidate[]>();
  const broken = new Set<string>();
  const seen: (readonly CapabilityScanAccount[])[] = [];

  return {
    seed(dir, finds) {
      findsByDir.set(dir, finds.map((find) => ({ ...find })));
    },
    breakDir(dir) {
      broken.add(dir);
    },
    scans() {
      return seen.map((accounts) => accounts.map((account) => ({ ...account })));
    },
    async scan(accounts) {
      seen.push(accounts.map((account) => ({ ...account })));
      const found: CapabilityCandidate[] = [];
      for (const account of accounts) {
        // A-90: no identityDir (machine login, compatible endpoint) — its capabilities are not on
        // this disk in a Docket-known layout, so the scan yields nothing for it.
        if (account.identityDir === undefined) continue;
        if (broken.has(account.identityDir)) continue;
        const seeded = findsByDir.get(account.identityDir);
        if (seeded === undefined) continue;
        for (const find of seeded) {
          // The port's law: `sources` is exactly the one account each was found in — whatever a
          // test seeded, the fake overrides it, so a use-case test cannot pass by seeding sources.
          found.push({ ...find, sources: [account.id] });
        }
      }
      return found;
    },
  };
};
