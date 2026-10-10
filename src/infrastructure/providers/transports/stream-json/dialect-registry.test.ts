// The built-in dialect registry (P-47 step 2): the registry stays the extension point a new
// stream-json provider lands in — one entry, no transport change — even while only one built-in
// dialect exists. The neutral fake dialect below is registered through the factory's injection
// seam exactly the way a real one lands in the built-in map.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRepo, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { Result, RoleDef, RunId } from '../../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../../domain/index';
import type { ProviderDef } from '../../defs/index';
import { createProviderTransportFactory } from '../../discovery/transport-factory';
import { BUILTIN_STREAM_DIALECTS } from './dialect-registry';
import type { StreamDialect } from './stream-json';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-dialect-registry-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

/** A neutral dialect: {say} → text, {end} → finished; everything else is not recognised. */
const neutralDialect: StreamDialect = {
  id: 'p-x',
  parse: (line) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null;
    const record = line as Record<string, unknown>;
    if (typeof record['say'] === 'string') return [{ type: 'text', at: 1, delta: record['say'] }];
    if (record['end'] === 'completed') return [{ type: 'finished', at: 2, reason: 'completed' }];
    return null;
  },
};

const defOf = (binPath: string): ProviderDef => ({
  id: 'p-x',
  displayName: 'Probe CLI',
  bins: [binPath],
  versionArgs: ['--version'],
  transport: 'stream-json',
  streamDialect: 'p-x',
  config: { mechanism: 'env-var', name: 'P_X_HOME' },
  buildLaunch: (input) => ({ args: [], env: { P_X_HOME: input.configDir }, stdin: 'prompt' }),
  resume: 'none',
  capabilities: {
    structuredStream: true,
    permissionAsk: false,
    resume: false,
    mcp: false,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/p-x' },
  mark: null,
});

/** The account a factory resolves the def through: provider p-x (p-y in the second case). */
const accountOf = (provider: string): AccountRepo['get'] => async () =>
  ({ id: ACCOUNT, provider, label: 'probe', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });

const request = (cwd: string): RunRequest => ({
  runId: RUN_ID,
  cwd,
  runDir: cwd,
  role: ROLE,
  route: { accountId: ACCOUNT },
  prompt: 'do the work',
  capabilities: [],
});

const unwrap = (started: Result<RunHandle, TransportError>): RunHandle => {
  if (!started.ok) throw new Error(`expected a started run, got ${started.error.code}`);
  return started.value;
};

describe('stream dialect registry (P-47)', () => {
  it('P-47: the registry carries exactly the built-in stream-json definitions dialects', () => {
    // The registry and the definitions cannot drift: every built-in stream-json def finds its
    // dialect here, and no entry exists without one.
    const dialectIds = Object.keys(BUILTIN_STREAM_DIALECTS).sort();
    expect(dialectIds).toEqual(['agy']);
    expect(dialectIds.length).toBe(1);
  });

  it('P-47: the stream-json dialect registry works with a neutral fixture provider', async () => {
    // A fake CLI speaking the neutral dialect's two lines; the fixture registers it through the
    // factory's injection seam, the same map shape the built-in registry is.
    const bin = join(root, 'p-x-cli.cjs');
    writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdout.write('{"say":"one"}\\n{"end":"completed"}\\n');\n`);
    chmodSync(bin, 0o755);
    const resolver = createProviderTransportFactory({
      defs: [defOf(bin)],
      accounts: { get: accountOf('p-x') },
      secrets: { get: async () => undefined },
      clock: { now: () => 0 },
      baseEnv: {},
      binPaths: { 'p-x': bin },
      streamDialects: { ...BUILTIN_STREAM_DIALECTS, 'p-x': neutralDialect },
    });
    const transport = await resolver.forAccount(ACCOUNT);
    if (transport === undefined) throw new Error('no transport resolved');

    const started = await transport.start(request(root));
    const events: AgentEvent[] = [];
    for await (const event of unwrap(started).events) events.push(event);

    expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
    expect(events[0]).toMatchObject({ type: 'text', delta: 'one' });
    expect(events[1]).toMatchObject({ type: 'finished', reason: 'completed' });

    // An id without an entry surfaces as unsupported when the transport starts, never a crash.
    const unknown = await createProviderTransportFactory({
      defs: [{ ...defOf(bin), id: 'p-y', streamDialect: 'p-y' }],
      accounts: { get: accountOf('p-y') },
      secrets: { get: async () => undefined },
      clock: { now: () => 0 },
      baseEnv: {},
      binPaths: { 'p-y': bin },
      streamDialects: { ...BUILTIN_STREAM_DIALECTS, 'p-x': neutralDialect },
    }).forAccount(ACCOUNT);
    if (unknown === undefined) throw new Error('no transport resolved');
    const refused = await unknown.start(request(root));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.error.code).toBe('unsupported');
  });
});
