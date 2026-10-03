// z.ai route probe — the QuotaProbe face of every route kind whose registry entry reads
// quotaProbe 'http_monitor': it lists the accounts riding the polled kind, gives each its own
// monitor source (one cache per account — accounts on one endpoint own separate quotas) and
// merges their readings. The probe is keyed by the route kind id, not the provider id: the
// provider of a compatible endpoint is the CLI itself, whose quota surface is a different probe.
import type { EpochMs } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { AccountRecord, MeterReading, QuotaProbe, QuotaProbeError } from '../../../../application/index';
import { findRouteKind } from '../../registry';

import { createZaiMonitorSource, type MonitorFetch, type MonitorNote, type MonitorSecrets, type ZaiMonitorSource } from './monitor-source';

export interface ZaiRouteProbeDeps {
  readonly accounts: { list(): Promise<readonly AccountRecord[]> };
  readonly secrets: MonitorSecrets;
  readonly fetch: MonitorFetch;
  readonly now: () => EpochMs;
  readonly note?: MonitorNote;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
}

interface AccountSource {
  readonly endpoint: string;
  readonly secretRef: string;
  readonly source: ZaiMonitorSource;
}

export function createZaiRouteProbe(deps: ZaiRouteProbeDeps): QuotaProbe {
  const sources = new Map<string, AccountSource>();

  return {
    poll: async (defId) => {
      const routeKind = findRouteKind(defId);
      if (routeKind === undefined || routeKind.quotaProbe !== 'http_monitor') return err('unknown_provider');

      const riding = (await deps.accounts.list()).filter((account) => account.routeKind === defId);
      // Accounts removed meanwhile must not keep a cached source alive.
      for (const id of [...sources.keys()]) {
        if (!riding.some((account) => account.id === id)) sources.delete(id);
      }

      const readings: MeterReading[] = [];
      let firstError: QuotaProbeError | undefined;
      for (const account of riding) {
        const endpoint = account.endpoint;
        const secretRef = account.secretRef;
        if (endpoint === undefined || secretRef === undefined) continue;

        let entry = sources.get(account.id);
        if (entry === undefined || entry.endpoint !== endpoint || entry.secretRef !== secretRef) {
          entry = {
            endpoint,
            secretRef,
            source: createZaiMonitorSource({
              fetch: deps.fetch,
              now: deps.now,
              endpoint,
              secretRef,
              secrets: deps.secrets,
              note: deps.note,
              timeoutMs: deps.timeoutMs,
              cacheMs: deps.cacheMs,
            }),
          };
          sources.set(account.id, entry);
        }

        const result = await entry.source.read();
        if (result.ok) readings.push(...result.value);
        else if (firstError === undefined) firstError = result.error;
      }

      // A kind with nothing to poll, or whose every poll failed, reports failure; one failing
      // account never hides the readings of the others.
      if (readings.length === 0) return err(firstError ?? 'probe_failed');
      return ok(readings);
    },
  };
}
