// Probe resolver wiring tests: the resolver hands each provider's probe the injected spawn and
// clock, so pollQuota can reach agy, codex and claude-code through one QuotaProbeResolver. The
// provider-specific mappings are covered by the probes' own test files; these tests pin the
// wiring: right probe per def id, spawn passed through, unknown ids unresolved, and the
// http_monitor route kinds resolved from their accounts and the vault against the fake monitor
// endpoint.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import { parseUlid } from '../../../domain/index';

import { createQuotaProbeResolver } from './probe-resolver';
import { createFakeMonitorPool, FAKE_MONITOR_TOKEN, type FakeMonitorPool } from './zai/fixtures/fake-monitor-server-harness';

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`bad ulid fixture: ${input}`);
  return parsed.value;
};

const CODEX_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'codex',
  'fixtures',
  'fake-quota-server.cjs',
);

let root: string;
let monitors: FakeMonitorPool;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-probe-resolver-'));
  monitors = createFakeMonitorPool();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  monitors.dispose();
});

const AGY_PAYLOAD = `{"status": "SUCCESS", "num_turns": 0, "command": { "name": "usage", "data": { "groups": [
  { "name": "Gemini Models", "description": "Models within this group: Gemini Flash",
    "buckets": [ { "id": "gemini-5h", "name": "Five Hour Limit Remaining", "window": "5h",
      "remaining_fraction": 1, "reset_time": "2026-09-29T15:24:06Z" } ] } ] } } }`;

const writeAgyBin = (): string => {
  const dir = join(root, 'agy-bin');
  mkdirSync(dir, { recursive: true });
  const binPath = join(dir, 'agy');
  writeFileSync(binPath, `#!/bin/sh\ncat <<'DOCKET_PAYLOAD'\n${AGY_PAYLOAD}\nDOCKET_PAYLOAD\n`);
  chmodSync(binPath, 0o755);
  return binPath;
};

const makeResolver = (codexScenario: string | undefined) => {
  const codexDir = join(root, `codex-${codexScenario ?? 'none'}`);
  mkdirSync(codexDir, { recursive: true });
  const logPath = join(codexDir, 'rpc.log');
  return createQuotaProbeResolver({
    now: () => 1_790_000_000_000,
    spawn: (command, args, options) => {
      if (codexScenario === undefined || command !== join(codexDir, 'codex')) {
        return nodeSpawn(command, [...args], { timeout: options.timeout });
      }
      // Only the codex call is scripted onto the fixture; anything else spawns for real.
      return nodeSpawn(process.execPath, [CODEX_FIXTURE, codexScenario, logPath, ...args], {
        timeout: options.timeout,
      });
    },
  });
};

describe('createQuotaProbeResolver', () => {
  it('wires the agy probe: a poll through the resolver runs the fake binary and returns its readings', async () => {
    const resolver = makeResolver(undefined);
    const probe = resolver.forProvider('agy');
    if (probe === undefined) throw new Error('agy probe not registered');

    const result = await probe.poll('agy', writeAgyBin());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value[0]?.pool.label).toBe('Gemini Models');
  });

  it('wires the codex probe: a poll through the resolver reads the app-server rate limits', async () => {
    const resolver = makeResolver('happy');
    const probe = resolver.forProvider('codex');
    if (probe === undefined) throw new Error('codex probe not registered');

    const result = await probe.poll('codex', join(root, 'codex-happy', 'codex'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value[0]?.pool.label).toBe('Codex');
    expect(result.value[0]?.meter.source).toBe('polled');
  });

  it('wires the claude probe: its provider gate runs before any usage call is made', async () => {
    const resolver = makeResolver(undefined);
    const probe = resolver.forProvider('claude-code');
    if (probe === undefined) throw new Error('claude probe not registered');

    const result = await probe.poll('codex', '/fake/claude-bin');

    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
  });

  it('a provider without a probe resolves to undefined', () => {
    const resolver = makeResolver(undefined);

    expect(resolver.forProvider('gemini')).toBeUndefined();
  });

  it('wires the http_monitor route kinds: a poll through the resolver reads the account endpoint over the real fetch', async () => {
    const server = await monitors.start({
      status: 200,
      body: JSON.stringify({
        data: {
          limits: [
            { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 40, nextResetTime: 1_759_100_000_000 },
            { type: 'TIME_LIMIT', unit: 5, percentage: 10, nextResetTime: 1_762_000_000_000 },
          ],
        },
      }),
    });
    const account: AccountRecord = {
      id: ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA2'),
      provider: 'claude-code',
      label: 'GLM Coding',
      authMode: 'api_key',
      limitPolicy: 'wait_resume',
      routeKind: 'zai-glm',
      endpoint: server.endpoint,
      secretRef: 'token-acct-glm',
      caps: [],
    };
    // No injected fetch: the resolver's default global fetch must carry the poll.
    const resolver = createQuotaProbeResolver({
      now: () => 1_790_000_000_000,
      accounts: { list: async () => [account] },
      secrets: { get: async (ref) => (ref === 'token-acct-glm' ? FAKE_MONITOR_TOKEN : undefined) },
    });
    const probe = resolver.forProvider('zai-glm');
    if (probe === undefined) throw new Error('zai-glm probe not registered');

    const result = await probe.poll('zai-glm', null);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.pool).toEqual({ label: 'GLM Coding', kind: 'allowance', appliesTo: [{ prefix: 'glm-' }] });
    expect(server.requests()).toEqual([
      { method: 'GET', url: '/api/monitor/usage/quota/limit', auth: 'raw-match' },
    ]);
  });

  it('without the account and vault ports the http_monitor route kinds resolve to nothing', () => {
    const resolver = makeResolver(undefined);

    expect(resolver.forProvider('zai-glm')).toBeUndefined();
  });
});
