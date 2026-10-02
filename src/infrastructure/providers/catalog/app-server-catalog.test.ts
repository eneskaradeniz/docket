// App-server live model list tests (P-29 section 3, source 'app-server'). The provider is a
// scripted fake app-server process (the transport's own fixture, extended with model/list
// scenarios) speaking newline-delimited JSON-RPC 2.0 over stdio; every message in both
// directions lands in the log so the tests assert the exact wire traffic — above all that no
// thread and no turn is ever started, because a listing must spend no quota.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';
import type { AppServerSpawn } from '../transports/app-server/index';
import { listAppServerRouteModels } from './app-server-catalog';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'app-server', 'fixtures', 'fake-app-server.cjs');

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-app-server-catalog-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function ulidOf(suffix: string): AccountId {
  const parsed = parseUlid<'account'>(`01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const ACCOUNT: AccountId = ulidOf('AV');

const codexAccount = (overrides?: Partial<AccountRecord>): AccountRecord => ({
  id: ACCOUNT,
  provider: 'codex',
  label: 'main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...(overrides === undefined ? {} : overrides),
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

const clientRequests = (logPath: string): readonly LoggedEntry[] =>
  readLog(logPath).filter((entry) => entry.dir === 'in' && entry.msg['method'] !== undefined);

interface Harness {
  readonly calls: SpawnCall[];
  readonly logPath: string;
  readonly children: ChildProcess[];
  readonly spawn: AppServerSpawn;
}

/** A spawn that records the launch and runs the fixture script for the given scenario. */
const makeSpawn = (scenario: string): Harness => {
  sequence += 1;
  const dir = join(root, `listing-${sequence}`);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'rpc.log');
  const calls: SpawnCall[] = [];
  const children: ChildProcess[] = [];
  const spawn: AppServerSpawn = (command, args) => {
    calls.push({ command, args: [...args] });
    // The fixture rides on the node binary: a checked-in script cannot carry a portable exec bit.
    // No lifetime cap here: the connection's per-request ceiling and its close bound the child.
    const child = nodeSpawn(process.execPath, [FIXTURE, scenario, logPath]);
    children.push(child);
    return child;
  };
  return { calls, logPath, children, spawn };
};

const exited = async (child: ChildProcess | undefined, withinMs: number): Promise<boolean> => {
  if (child === undefined) return false;
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const done = (value: boolean): void => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(false), withinMs);
    child.once('exit', () => done(true));
  });
};

describe('listAppServerRouteModels (P-29)', () => {
  it('P-29: one model/list page maps every row — id, displayName, per-model effort sets with unknown levels filtered', async () => {
    const harness = makeSpawn('model-list');

    const listed = await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    // The launch is the provider's documented app-server mode, resolved from the account's provider.
    expect(harness.calls).toEqual([{ command: 'codex', args: ['app-server'] }]);
    expect(listed.value).toEqual([
      { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      { id: 'gpt-5.3-mini', displayName: 'GPT-5.3 mini', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.3-nano', displayName: 'GPT-5.3 nano', efforts: ['low', 'high'] },
      { id: 'gpt-5.3', displayName: 'GPT-5.3' },
    ]);
  });

  it('P-29: initialize opens the connection and model/list follows — no thread, no turn, no prompt is ever sent', async () => {
    const harness = makeSpawn('model-list');

    await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    const sent = clientRequests(harness.logPath);
    expect(sent.map((entry) => entry.msg['method'])).toEqual(['initialize', 'model/list']);
    // Nothing the client sent names a thread or a turn, and nothing carries prompt-like input.
    for (const entry of sent) {
      expect(String(entry.msg['method'])).not.toMatch(/thread|turn|prompt|input/i);
      expect(JSON.stringify(entry.msg['params'] ?? {})).not.toMatch(/text|prompt|input/i);
    }
  });

  it('P-29: pages follow nextCursor until the server answers null', async () => {
    const harness = makeSpawn('model-list-two');

    const listed = await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(listed.value).toEqual([
      { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      { id: 'gpt-5.3-mini', displayName: 'GPT-5.3 mini', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    ]);
    const sent = clientRequests(harness.logPath);
    expect(sent.map((entry) => entry.msg['method'])).toEqual(['initialize', 'model/list', 'model/list']);
    expect(sent[1]?.msg['params']).toEqual(undefined);
    expect(sent[2]?.msg['params']).toEqual({ cursor: 'page-2' });
  });

  it('P-29: a list that never ends fails at ten pages — an error, never a silently truncated list', async () => {
    const harness = makeSpawn('model-list-forever');

    const listed = await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'malformed', message: 'the model list never finished paginating' },
    });
    expect(clientRequests(harness.logPath).filter((entry) => entry.msg['method'] === 'model/list')).toHaveLength(10);
  }, 10_000);

  it('P-29: a server that never answers the list fails at the timeout and the connection is closed', async () => {
    const harness = makeSpawn('model-list-timeout');

    const listed = await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn, timeoutMs: 300 });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'the app-server request did not answer in time' },
    });
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: a connection that dies before the list arrives fails as a closed connection', async () => {
    const harness = makeSpawn('exit-early');

    const listed = await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('unreachable');
    expect(listed.error.code).toBe('spawn_failed');
  }, 10_000);

  it('P-29: the connection is closed once the answer lands — the child does not outlive the listing', async () => {
    const harness = makeSpawn('model-list');

    await listAppServerRouteModels(codexAccount(), { spawn: harness.spawn });

    expect(await exited(harness.children[0], 3_000)).toBe(true);
  });

  it('P-29: a provider with no app-server launch is refused without spawning anything', async () => {
    const harness = makeSpawn('model-list');

    const listed = await listAppServerRouteModels(codexAccount({ provider: 'some-other-cli' }), { spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'unsupported', message: 'the provider has no app-server model list' },
    });
    expect(harness.calls).toEqual([]);
  });
});
