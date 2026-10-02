// agy usage probe tests — rule P-19 (docs/v2/providers.md → "Quota probes"). The probe runs a
// real fake binary through the real child-process machinery (discovery-test style); only the
// spawn function is wrapped, to record the command line. The payload fixture is the observed
// one from docs/v2/quota.md → "Observed: Antigravity /usage".
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgyUsageProbe, type UsageSpawn } from './usage-probe';

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-agy-usage-probe-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const PAYLOAD = `{"status": "SUCCESS", "num_turns": 0, "command": { "name": "usage", "data": { "groups": [
  { "name": "Gemini Models", "description": "Models within this group: Gemini Flash, Gemini Pro",
    "buckets": [ { "id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly",
      "remaining_fraction": 0.6869, "reset_time": "2026-09-29T15:24:06Z" } ] } ] } } }`;

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
}

interface BinScript {
  readonly payloadStream?: 'stdout' | 'stderr'; // where the usage payload is printed (exit 0)
  readonly output?: string; // plain text to print instead of a payload
  readonly exit?: number; // exit code (default 0)
  readonly hang?: boolean; // never answer
}

const binBody = (script: BinScript): string => {
  if (script.hang === true) return 'exec /bin/sleep 30';
  if (script.output !== undefined) return `echo "${script.output}"\nexit ${script.exit ?? 0}`;
  const payload = `cat <<'DOCKET_PAYLOAD'\n${PAYLOAD}\nDOCKET_PAYLOAD`;
  const redirect = script.payloadStream === 'stderr' ? ' >&2' : '';
  return `${payload}${redirect}\nexit ${script.exit ?? 0}`;
};

const makeProbe = (
  script: BinScript | undefined,
  options: { readonly timeoutMs?: number } = {},
): {
  readonly calls: SpawnCall[];
  readonly binPath: string | null; // the spawned fake binary, or null when none was written
  readonly probe: ReturnType<typeof createAgyUsageProbe>;
} => {
  sequence += 1;
  const binDir = join(root, `bin-${sequence}`);
  let binPath: string | null = null;
  if (script !== undefined) {
    mkdirSync(binDir, { recursive: true });
    binPath = join(binDir, 'agy');
    writeFileSync(binPath, `#!/bin/sh\n${binBody(script)}\n`);
    chmodSync(binPath, 0o755);
  }
  const calls: SpawnCall[] = [];
  const spawn: UsageSpawn = (command, args) => {
    calls.push({ command, args: [...args] });
    return nodeSpawn(command, [...args], { timeout: 5_000 });
  };
  return {
    calls,
    binPath,
    probe: createAgyUsageProbe({ spawn, now: () => 1_790_000_000_000, timeoutMs: options.timeoutMs }),
  };
};

describe('createAgyUsageProbe', () => {
  it('P-19: runs `agy -p /usage --output-format json` and parses the payload from stderr', async () => {
    const { calls, binPath, probe } = makeProbe({ payloadStream: 'stderr' });
    if (binPath === null) throw new Error('fixture binary missing');

    const result = await probe.poll('agy', binPath);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(calls).toEqual([{ command: binPath, args: ['-p', '/usage', '--output-format', 'json'] }]);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.pool.label).toBe('Gemini Models');
    expect(result.value[0]?.meter).toEqual({
      label: 'Weekly Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 0.6869,
      resetsAt: Date.parse('2026-09-29T15:24:06Z'),
      resetPrecision: 'exact',
      observedAt: 1_790_000_000_000,
      source: 'polled',
    });
  });

  it('P-19: without a bin path the bare binary name is spawned, and a stdout payload parses too', async () => {
    const { calls, binPath, probe } = makeProbe({ payloadStream: 'stdout' });
    if (binPath === null) throw new Error('fixture binary missing');
    const previousPath = process.env.PATH;
    process.env.PATH = `${join(binPath, '..')}:${previousPath}`;
    try {
      const result = await probe.poll('agy', null);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value).toHaveLength(1);
      // Applicability follows the group table (P-39): the Gemini group draws from gemini-* models.
      expect(result.value[0]?.pool.appliesTo).toEqual([{ prefix: 'gemini-' }]);
      expect(calls).toEqual([{ command: 'agy', args: ['-p', '/usage', '--output-format', 'json'] }]);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('P-19: a missing binary reports not_installed', async () => {
    const { calls, probe } = makeProbe(undefined);

    const result = await probe.poll('agy', join(root, 'nowhere', 'agy'));

    expect(result).toEqual({ ok: false, error: 'not_installed' });
    expect(calls).toHaveLength(1);
  });

  it('P-19: a non-zero exit or an unparseable answer reports probe_failed', async () => {
    const failing = makeProbe({ payloadStream: 'stdout', exit: 1 });
    const failingPath = failing.binPath;
    if (failingPath !== null) {
      expect(await failing.probe.poll('agy', failingPath)).toEqual({ ok: false, error: 'probe_failed' });
    }

    const silent = makeProbe({ output: 'agy: nothing to report' });
    const silentPath = silent.binPath;
    if (silentPath !== null) {
      expect(await silent.probe.poll('agy', silentPath)).toEqual({ ok: false, error: 'probe_failed' });
    }
  });

  it('P-19: a hung query is killed at the timeout and reported as probe_failed', async () => {
    const { binPath, probe } = makeProbe({ hang: true }, { timeoutMs: 300 });
    if (binPath === null) throw new Error('fixture binary missing');

    const result = await probe.poll('agy', binPath);

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  }, 10_000);

  it('P-19: a foreign provider id is refused without spawning anything', async () => {
    const { calls, probe } = makeProbe({ payloadStream: 'stdout' });

    const result = await probe.poll('codex', null);

    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
    expect(calls).toEqual([]);
  });
});
