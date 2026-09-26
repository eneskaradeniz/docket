// Claude Code quota probe — one SDK get_usage read mapped to meter readings. Contract:
// docs/v2/providers.md → "Quota probes" (P-21) and the Claude Code row of docs/v2/quota.md.
// The usage source is injected: the poll itself never trusts a stored reading, so every value
// it returns comes from the payload of this one call.
import type { EpochMs } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { QuotaProbe } from '../../../../application/index';

import { mapClaudeGetUsage } from './usage-mapper';

const CLAUDE_DEF_ID = 'claude-code';

/** Where the probe gets its get_usage payload; the SDK-backed source is the real one. */
export type GetUsage = (binPath: string | null) => Promise<unknown>;

export interface ClaudeUsageProbeDeps {
  readonly getUsage: GetUsage;
  /** Observation time stamped onto every reading; injected so tests stay deterministic. */
  readonly now: () => EpochMs;
}

export function createClaudeUsageProbe(deps: ClaudeUsageProbeDeps): QuotaProbe {
  return {
    poll: async (defId, binPath) => {
      if (defId !== CLAUDE_DEF_ID) return err('unknown_provider');
      let payload: unknown;
      try {
        payload = await deps.getUsage(binPath);
      } catch {
        return err('probe_failed');
      }
      const readings = mapClaudeGetUsage(payload, deps.now());
      return readings === null ? err('probe_failed') : ok(readings);
    },
  };
}
