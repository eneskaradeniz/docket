// Probe resolver wiring tests: the resolver hands each provider's probe the injected spawn and
// clock, so pollQuota can reach agy, codex and claude-code through one QuotaProbeResolver. The
// provider-specific mappings are covered by the probes' own test files; these tests pin the
// wiring: right probe per def id, spawn passed through, unknown ids unresolved.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createQuotaProbeResolver } from './probe-resolver';

const CODEX_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'codex',
  'fixtures',
  'fake-quota-server.cjs',
);

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-probe-resolver-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
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
});
