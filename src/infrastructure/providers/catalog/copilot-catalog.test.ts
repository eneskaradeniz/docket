// Copilot live model list tests (P-29 section 3, source 'acp-session'). The provider is a
// scripted fake ACP agent (a fixture in this folder) speaking newline-delimited JSON-RPC 2.0
// over stdio; every message in both directions lands in the log so the tests assert the exact
// wire traffic — above all that no prompt turn is ever started, because a listing must spend
// no credits. The recorded shapes the scenarios mirror come from the operator's probe capture
// of the plan-limited session answer.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId, type RouteKindRecord } from '../../../domain/index';
import type { AppServerSpawn } from '../transports/app-server/index';
import { listCopilotRouteModels } from './copilot-catalog';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-acp-session.cjs');

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-copilot-catalog-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function ulidOf(suffix: string): AccountId {
  const parsed = parseUlid<'account'>(`01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const ACCOUNT: AccountId = ulidOf('CP');

const copilotAccount = (overrides?: Partial<AccountRecord>): AccountRecord => ({
  id: ACCOUNT,
  provider: 'copilot',
  label: 'main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...(overrides === undefined ? {} : overrides),
});

/** The route's tier data as the registry fixes it for the Copilot login: every tier names a
 * quality setting of the automatic choice, not a model id. */
const SETTINGS_ROUTE: Pick<RouteKindRecord, 'tierModels'> = {
  tierModels: { strong: 'intelligence', balanced: 'balance', fast: 'efficiency' },
};

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

describe('listCopilotRouteModels (P-29)', () => {
  it('P-29: a plan-limited answer that names only the automatic choice lists its three quality settings', async () => {
    const harness = makeSpawn('auto-only');

    const listed = await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    // The launch is the provider's documented ACP mode, resolved from the account's provider.
    expect(harness.calls).toEqual([{ command: 'copilot', args: ['--acp', '--stdio'] }]);
    // The recorded answer repeats the automatic token in three degenerate rows; the choice's
    // selectable forms are the settings the route names, in tier order — no bare automatic
    // entry, because it is a router, not a model.
    expect(listed.value).toEqual([{ id: 'intelligence' }, { id: 'balance' }, { id: 'efficiency' }]);
  });

  it('P-29: an answer with several models keeps every id verbatim and appends the settings the automatic choice offers', async () => {
    const harness = makeSpawn('several-models');

    const listed = await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(listed.value).toEqual([
      { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
      { id: 'claude-opus-5.5', displayName: 'Claude Opus 5.5' },
      { id: 'intelligence' },
      { id: 'balance' },
      { id: 'efficiency' },
    ]);
  });

  it('P-29: an answer whose model option is absent still lists through the session models field', async () => {
    const harness = makeSpawn('models-field-only');

    const listed = await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(listed.value.map((model) => model.id)).toEqual([
      'gpt-5.6-luna',
      'claude-opus-5.5',
      'intelligence',
      'balance',
      'efficiency',
    ]);
  });

  it('P-29: initialize opens the handshake and session/new follows — no prompt, no turn is ever sent', async () => {
    const harness = makeSpawn('auto-only');

    await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    const sent = clientRequests(harness.logPath);
    expect(sent.map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new']);
    // Nothing the client sent names a prompt or a turn, and nothing carries prompt-like input —
    // a listing must start no model call and spend no credits.
    for (const entry of sent) {
      expect(String(entry.msg['method'])).not.toMatch(/prompt|turn|input/i);
      expect(JSON.stringify(entry.msg['params'] ?? {})).not.toMatch(/text|prompt|input/i);
    }
  });

  it('P-29: an answer that reports no model list at all is a malformed error, never an invented list', async () => {
    const harness = makeSpawn('no-model-option');

    const listed = await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'malformed', message: 'the session answer carries no model list' },
    });
  });

  it('P-29: an agent that never answers fails at the timeout and the connection is closed', async () => {
    const harness = makeSpawn('silent');

    const listed = await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, {
      spawn: harness.spawn,
      timeoutMs: 300,
    });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'the acp request did not answer in time' },
    });
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: the connection is closed once the answer lands — the child does not outlive the listing', async () => {
    const harness = makeSpawn('auto-only');

    await listCopilotRouteModels(copilotAccount(), SETTINGS_ROUTE, { spawn: harness.spawn });

    expect(await exited(harness.children[0], 3_000)).toBe(true);
  });

  it('P-29: a route that fixes no settings keeps the automatic choice itself, an unknown model', async () => {
    const harness = makeSpawn('auto-only');

    const listed = await listCopilotRouteModels(copilotAccount(), {}, { spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(listed.value).toEqual([{ id: 'auto', displayName: 'Auto' }]);
  });

  it('P-29: a provider with no acp launch is refused without spawning anything', async () => {
    const harness = makeSpawn('auto-only');

    const listed = await listCopilotRouteModels(
      copilotAccount({ provider: 'some-other-cli' }),
      SETTINGS_ROUTE,
      { spawn: harness.spawn },
    );

    expect(listed).toEqual({
      ok: false,
      error: { code: 'unsupported', message: 'the provider has no acp session model list' },
    });
    expect(harness.calls).toEqual([]);
  });
});
