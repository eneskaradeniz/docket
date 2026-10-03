// Codex quota probe tests — rule P-20 (docs/v2/providers.md → "Quota probes"). The probe is
// driven through a scripted fake app-server process (fixtures/fake-quota-server.cjs) speaking
// newline-delimited JSON-RPC 2.0 over stdio, exactly like the transport's fake-server tests; no
// real CLI install is involved. The fixture appends every message in both directions to a log
// file so the tests assert the exact wire traffic.
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCodexRateLimitProbe, type CodexSpawn } from './codex-probe';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-quota-server.cjs');

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-codex-quota-probe-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
}

interface LoggedEntry {
  readonly dir: string;
  readonly msg: Record<string, unknown>;
}

const readLog = (logPath: string): readonly LoggedEntry[] =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LoggedEntry);

const clientRequests = (logPath: string): readonly string[] =>
  readLog(logPath)
    .filter((entry) => entry.dir === 'in' && entry.msg['method'] !== undefined)
    .map((entry) => String(entry.msg['method']));

const makeProbe = (
  scenario: string | undefined,
  options: { readonly timeoutMs?: number } = {},
): {
  readonly calls: SpawnCall[];
  readonly logPath: string;
  readonly probe: ReturnType<typeof createCodexRateLimitProbe>;
} => {
  sequence += 1;
  const dir = join(root, `probe-${sequence}`);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'rpc.log');
  const calls: SpawnCall[] = [];
  const spawn: CodexSpawn = (command, args, spawnOptions) => {
    calls.push({ command, args: [...args] });
    if (scenario === undefined) return nodeSpawn(command, [...args], { timeout: spawnOptions.timeout });
    // The fixture rides on the node binary: a checked-in script cannot carry a portable exec bit.
    return nodeSpawn(process.execPath, [FIXTURE, scenario, logPath, ...args], { timeout: spawnOptions.timeout });
  };
  return {
    calls,
    logPath,
    probe: createCodexRateLimitProbe({ spawn, now: () => 1_790_000_000_000, timeoutMs: options.timeoutMs }),
  };
};

describe('createCodexRateLimitProbe', () => {
  it('P-20: reads rate limits through the app-server connection and maps primary/secondary windows to meters with exact resets, source polled', async () => {
    const { calls, logPath, probe } = makeProbe('happy');

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // The connection is the documented app-server mode of the CLI, with the probed binary.
    expect(calls).toEqual([{ command: '/fake/codex-bin', args: ['app-server'] }]);
    expect(clientRequests(logPath)).toEqual(['initialize', 'account/rateLimits/read']);

    expect(result.value).toHaveLength(2);
    const [primary, secondary] = result.value;
    expect(primary?.pool).toEqual({ label: 'Codex', kind: 'allowance', appliesTo: 'all' });
    expect(primary?.meter).toEqual({
      label: 'primary',
      cadence: 'rolling_from_first_use',
      durationMs: 18_000_000, // windowDurationMins 300, stated by the server itself
      unit: 'fraction',
      used: 0.4,
      limit: 1,
      remaining: 0.6,
      resetsAt: 1_759_000_000_000, // the protocol states seconds; domain times are milliseconds
      resetPrecision: 'exact',
      observedAt: 1_790_000_000_000,
      source: 'polled',
    });
    expect(secondary?.pool).toEqual({ label: 'Codex', kind: 'allowance', appliesTo: 'all' });
    expect(secondary?.meter).toEqual({
      label: 'secondary',
      cadence: 'rolling_from_first_use',
      durationMs: 604_800_000, // windowDurationMins 10080 (≈ weekly)
      unit: 'fraction',
      used: 0.1,
      limit: 1,
      remaining: 0.9,
      resetsAt: 1_759_600_000_000,
      resetPrecision: 'exact',
      observedAt: 1_790_000_000_000,
      source: 'polled',
    });
  });

  it('P-20: the recorded free-plan answer — one codex pool, a single 30-day window — maps from windowDurationMins, never from an assumed cadence', async () => {
    const { probe } = makeProbe('free-plan');

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // The recorded shape has no secondary window and no credits: exactly one reading, its whole
    // duration stated by the server itself (43200 minutes — a month, not five hours or a week).
    expect(result.value).toHaveLength(1);
    const [reading] = result.value;
    expect(reading?.pool).toEqual({ label: 'codex', kind: 'allowance', appliesTo: 'all' });
    expect(reading?.meter).toEqual({
      label: 'primary',
      cadence: 'rolling_from_first_use',
      durationMs: 2_592_000_000, // windowDurationMins 43200, the server's own statement
      unit: 'fraction',
      used: 0.01,
      limit: 1,
      remaining: 0.99,
      resetPrecision: 'unknown',
      observedAt: 1_790_000_000_000,
      source: 'polled',
    });
  });

  it('P-20: absent window values stay absent — no duration without windowDurationMins, no reset without resetsAt, no pool label without limitName', async () => {
    const { probe } = makeProbe('sparse');

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toHaveLength(1);
    const reading = result.value[0];
    // A label-less snapshot still names its pool, stably, so the poll reconciles into the same
    // pool as every other label-less poll.
    expect(reading?.pool).toEqual({ label: 'codex', kind: 'allowance', appliesTo: 'all' });
    expect(reading?.meter).toEqual({
      label: 'primary',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      used: 0.8,
      limit: 1,
      remaining: 0.2,
      resetPrecision: 'unknown',
      observedAt: 1_790_000_000_000,
      source: 'polled',
    });
    expect('durationMs' in (reading?.meter ?? {})).toBe(false);
    expect('resetsAt' in (reading?.meter ?? {})).toBe(false);
  });

  it('P-20: a missing binary reports not_installed', async () => {
    const { probe } = makeProbe(undefined);

    const result = await probe.poll('codex', join(root, 'nowhere', 'codex'), { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'not_installed' });
  });

  it('P-20: a rate-limit read answered with an error reports probe_failed', async () => {
    const { probe } = makeProbe('rpc-error');

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-20: a server that dies before answering the read reports probe_failed', async () => {
    const { probe } = makeProbe('exit-early');

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  }, 10_000);

  it('P-20: a hung server is killed at the timeout and reported as probe_failed', async () => {
    const { probe } = makeProbe('hang', { timeoutMs: 300 });

    const result = await probe.poll('codex', '/fake/codex-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  }, 10_000);

  it('P-20: a foreign provider id is refused without spawning anything', async () => {
    const { calls, probe } = makeProbe('happy');

    const result = await probe.poll('agy', '/fake/agy-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
    expect(calls).toEqual([]);
  });
});
