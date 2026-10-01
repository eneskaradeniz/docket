// Probe resolver: one QuotaProbe per provider that has one, so pollQuota can reach every
// provider's usage surface through a single QuotaProbeResolver. Contract: docs/v2/providers.md
// → "Quota probes (P-18 … P-21)". The spawn is injectable so tests can script every probe's
// child process; production passes the real node spawn. Route kinds that read quota over the
// provider's monitor endpoint (registry quotaProbe 'http_monitor') are keyed by their route kind
// id and share one dispatching probe that picks their accounts at poll time; the account and
// vault ports those polls need arrive with the config, so a composition root without them simply
// resolves no such kind.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { EpochMs } from '../../../domain/index';
import type { AccountRepo, QuotaProbe, QuotaProbeResolver, SecretVault } from '../../../application/index';

import { createAgyUsageProbe, type UsageSpawn } from './agy/index';
import { createClaudeUsageProbe } from './claude/index';
import { createSdkGetUsage } from './claude/sdk-usage-source';
import { createCodexRateLimitProbe } from './codex/index';
import { createZaiRouteProbe, type MonitorFetch } from './zai/index';
import { CAPABILITY_REGISTRY } from '../registry';

export type QuotaProbeSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => ChildProcess;

export interface ProbeResolverConfig {
  /** Observation time handed to every probe; the composition root passes the app clock. */
  readonly now: () => EpochMs;
  /** Injectable spawn for tests; default: the real node spawn. */
  readonly spawn?: QuotaProbeSpawn;
  /** Fetch for the http_monitor route kinds; default: the real global fetch. */
  readonly fetch?: MonitorFetch;
  /** With secrets, enables the http_monitor route kinds; absent: they resolve to nothing. */
  readonly accounts?: Pick<AccountRepo, 'list'>;
  readonly secrets?: Pick<SecretVault, 'get'>;
}

const realSpawn: QuotaProbeSpawn = (command, args, options) =>
  nodeSpawn(command, [...args], { timeout: options.timeout });

export function createQuotaProbeResolver(config: ProbeResolverConfig): QuotaProbeResolver {
  const spawn: UsageSpawn = config.spawn ?? realSpawn;
  const probes: Record<string, QuotaProbe> = {
    agy: createAgyUsageProbe({ spawn, now: config.now }),
    codex: createCodexRateLimitProbe({ spawn, now: config.now }),
    'claude-code': createClaudeUsageProbe({ getUsage: createSdkGetUsage({}), now: config.now }),
  };
  if (config.accounts !== undefined && config.secrets !== undefined) {
    const monitorProbe = createZaiRouteProbe({
      accounts: config.accounts,
      secrets: config.secrets,
      fetch: config.fetch ?? globalThis.fetch,
      now: config.now,
    });
    for (const routeKind of CAPABILITY_REGISTRY.routeKinds) {
      if (routeKind.quotaProbe === 'http_monitor') probes[routeKind.id] = monitorProbe;
    }
  }
  return {
    // With a route kind the lookup answers only that kind's dedicated probe (the http_monitor
    // kinds above); without one it answers the provider's probe, as before route kinds existed.
    forProvider: (defId, routeKind) => probes[routeKind ?? defId],
  };
}
