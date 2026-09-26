// agy quota probe — one `agy -p "/usage" --output-format json` run mapped to meter readings.
// Contract: docs/v2/providers.md → "Quota probes (P-18 … P-21)" (P-19); the payload and mapping
// are observed ones from docs/v2/quota.md → "Observed: Antigravity /usage". Only the spawn
// function is injected, so tests drive the real child-process machinery with fake binaries.
import type { ChildProcess } from 'node:child_process';

import type { EpochMs } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { QuotaProbe } from '../../../../application/index';

import { parseAgyUsage } from './usage-parser';

const AGY_DEF_ID = 'agy';
const USAGE_ARGS: readonly string[] = ['-p', '/usage', '--output-format', 'json'];
const DEFAULT_TIMEOUT_MS = 15_000;

/** The narrow spawn surface the probe needs; the real node spawn satisfies it directly. */
export type UsageSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => ChildProcess;

export interface AgyUsageProbeDeps {
  readonly spawn: UsageSpawn;
  /** Observation time stamped onto every reading; injected so tests stay deterministic. */
  readonly now: () => EpochMs;
  readonly timeoutMs?: number;
}

interface UsageOutcome {
  readonly exitCode: number | null; // null = killed early or never ran
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const runUsage = (
  spawn: UsageSpawn,
  command: string,
  timeoutMs: number,
): Promise<UsageOutcome> =>
  new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...USAGE_ARGS], { timeout: timeoutMs });
    } catch {
      resolve({ exitCode: null, timedOut: false, spawnFailed: true, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, spawnFailed, stdout, stderr });
    };
    // The injected spawn is asked to time out too; this timer is the backstop for one that ignores it.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // A failed spawn (e.g. no such binary) reports 'error' and may never report 'close'.
    child.on('error', () => {
      spawnFailed = true;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });

export function createAgyUsageProbe(deps: AgyUsageProbeDeps): QuotaProbe {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    poll: async (defId, binPath) => {
      if (defId !== AGY_DEF_ID) return err('unknown_provider');
      // Without a path hint the bare binary name is left to the platform resolver.
      const outcome = await runUsage(deps.spawn, binPath ?? AGY_DEF_ID, timeoutMs);
      if (outcome.spawnFailed) return err('not_installed');
      if (outcome.timedOut || outcome.exitCode === null || outcome.exitCode !== 0) return err('probe_failed');
      // The observed run printed the payload on stderr; the parser reads whichever stream has it.
      const readings = parseAgyUsage(outcome.stdout, outcome.stderr, deps.now());
      return readings === null ? err('probe_failed') : ok(readings);
    },
  };
}
