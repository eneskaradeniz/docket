// Claude Code quota probe — one SDK get_usage read mapped to meter readings. Contract:
// docs/v2/providers.md → "Quota probes" (P-21), P-39 in docs/v2/provider-capabilities.md §13,
// and the Claude Code row of docs/v2/quota.md. The usage source is injected: the poll itself
// never trusts a stored reading, so every value it returns comes from the payload of this one
// call.
import type { EpochMs } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { QuotaProbe } from '../../../../application/index';

import { mapClaudeGetUsage } from './usage-mapper';

const CLAUDE_DEF_ID = 'claude-code';

/** Where the probe gets its get_usage payload; the SDK-backed source is the real one. */
export type GetUsage = (binPath: string | null) => Promise<unknown>;

/** Diagnostic sink for the mapper's notes; field names and counts only, never values. Default:
 * silent, like the compatible-endpoint monitor's sink. */
export type ProbeNote = (message: string) => void;

export interface ClaudeUsageProbeDeps {
  readonly getUsage: GetUsage;
  /** Observation time stamped onto every reading; injected so tests stay deterministic. */
  readonly now: () => EpochMs;
  readonly note?: ProbeNote;
}

export function createClaudeUsageProbe(deps: ClaudeUsageProbeDeps): QuotaProbe {
  const note: ProbeNote = deps.note ?? (() => {});
  return {
    poll: async (defId, binPath) => {
      if (defId !== CLAUDE_DEF_ID) return err('unknown_provider');
      let payload: unknown;
      try {
        payload = await deps.getUsage(binPath);
      } catch {
        return err('probe_failed');
      }
      const mapped = mapClaudeGetUsage(payload, deps.now());
      if (!mapped.ok) {
        note(
          mapped.unrecognized.length === 0
            ? 'get_usage payload unreadable: no recognizable fields'
            : `get_usage payload unreadable; unrecognized fields: ${mapped.unrecognized.join(', ')}`,
        );
        return err('probe_failed');
      }
      for (const message of mapped.notes) note(message);
      return ok(mapped.readings);
    },
  };
}
