// Probe resolver: one QuotaProbe per provider that has one, so pollQuota can reach every
// provider's usage surface through a single QuotaProbeResolver. Contract: docs/v2/providers.md
// → "Quota probes (P-18 … P-21)". The spawn is injectable so tests can script every probe's
// child process; production passes the real node spawn.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { EpochMs } from '../../../domain/index';
import type { QuotaProbe, QuotaProbeResolver } from '../../../application/index';

import { createAgyUsageProbe, type UsageSpawn } from './agy/index';
import { createClaudeUsageProbe } from './claude/index';
import { createSdkGetUsage } from './claude/sdk-usage-source';
import { createCodexRateLimitProbe } from './codex/index';

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
}

const realSpawn: QuotaProbeSpawn = (command, args, options) =>
  nodeSpawn(command, [...args], { timeout: options.timeout });

export function createQuotaProbeResolver(config: ProbeResolverConfig): QuotaProbeResolver {
  const spawn: UsageSpawn = config.spawn ?? realSpawn;
  const probes: Readonly<Record<string, QuotaProbe>> = {
    agy: createAgyUsageProbe({ spawn, now: config.now }),
    codex: createCodexRateLimitProbe({ spawn, now: config.now }),
    'claude-code': createClaudeUsageProbe({ getUsage: createSdkGetUsage({}), now: config.now }),
  };
  return {
    forProvider: (defId) => probes[defId],
  };
}
