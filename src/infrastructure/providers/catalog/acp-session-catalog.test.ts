// ACP-session live model list tests (P-29 section 3, source 'acp-session'). The agent is the
// transport's own scripted fake (fake-agent.cjs, extended with session/new answers that carry
// models and config options), speaking newline-delimited JSON-RPC 2.0 over stdio; every message
// in both directions lands in the log so the tests assert the exact wire traffic — above all that
// session/prompt is never sent and no turn ever starts, because a listing must spend no quota.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';
import type { AcpSpawn } from '../transports/acp/index';
import { listAcpSessionModels } from './acp-session-catalog';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'acp', 'fake-agent.cjs');

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-acp-session-catalog-'));
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

const accountOf = (provider: string): AccountRecord => ({
  id: ACCOUNT,
  provider,
  label: 'main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
}

interface RawLogEntry {
  readonly dir: string;
  readonly line: string;
}

/** One logged wire message: the fake agent records the raw line, so a reader parses it back. */
interface LoggedMessage {
  readonly dir: string;
  readonly msg: Record<string, unknown>;
}

const readLog = (logPath: string): readonly LoggedMessage[] =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RawLogEntry)
    .map((entry) => ({ dir: entry.dir, msg: JSON.parse(entry.line) as Record<string, unknown> }));

const clientRequests = (logPath: string): readonly LoggedMessage[] =>
  readLog(logPath).filter((entry) => entry.dir === 'in' && entry.msg['method'] !== undefined);

interface Harness {
  readonly calls: SpawnCall[];
  readonly logPath: string;
  readonly children: ChildProcess[];
  readonly spawn: AcpSpawn;
}

/** A spawn that records the launch and runs the fixture script for the given scenario. */
const makeSpawn = (scenario: string): Harness => {
  sequence += 1;
  const dir = join(root, `listing-${sequence}`);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'agent-log.jsonl');
  const calls: SpawnCall[] = [];
  const children: ChildProcess[] = [];
  const spawn: AcpSpawn = (command, args) => {
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

describe('listAcpSessionModels (P-29)', () => {
  it('P-29: the available-models shape maps rows with bracketed ids verbatim, their embedded window read, and no thought levels', async () => {
    const harness = makeSpawn('models-cursor');

    const listed = await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    // The launch is the provider's documented ACP mode, resolved from the account's provider.
    expect(harness.calls).toEqual([{ command: 'cursor-agent', args: ['acp'] }]);
    // The bracketed variant suffix stays part of the id — it is the value the session expects —
    // and the same model arriving through both shapes lists exactly once. The window the id's own
    // `context=` parameter states rides the row (A-63): `k` and `m` magnitudes both map, a value
    // that is not one leaves the row without a window.
    expect(listed.value).toEqual([
      { id: 'default[]', displayName: 'Auto' },
      { id: 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', displayName: 'grok-4.7', contextWindow: 256000 },
      { id: 'claude-opus-5-5[context=300k,effort=medium,fast=false]', displayName: 'claude-opus-5-5', contextWindow: 300000 },
      { id: 'claude-opus-4-8[context=1m,effort=high,fast=false]', displayName: 'claude-opus-4-8', contextWindow: 1000000 },
      { id: 'grok-4.6[context=vast,reasoning_effort=high,fast=false]', displayName: 'grok-4.6' },
    ]);
  });

  it('P-29: the config-option shape lists the model select and maps thought levels, dropping levels the domain does not know', async () => {
    const harness = makeSpawn('models-opencode');

    const listed = await listAcpSessionModels(accountOf('opencode'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'opencode', args: ['acp'] }]);
    expect(listed.value).toEqual([
      { id: 'opencode/big-pickle', displayName: 'opencode/Big Pickle', efforts: ['low', 'high', 'max'] },
      { id: 'opencode/fledge-alpha-free', displayName: 'opencode/Fledge Alpha Free', efforts: ['low', 'high', 'max'] },
      { id: 'opencode/space-bunny-free', displayName: 'opencode/Space Bunny Free', efforts: ['low', 'high', 'max'] },
    ]);
  });

  it('P-29: a listing whose model list rides the initialize answer gives each model its own levels and the default row, and never opens a session even though session/new would be refused', async () => {
    const harness = makeSpawn('models-init-state');
    const envs: Array<Readonly<Record<string, string>> | undefined> = [];
    const spawn: AcpSpawn = (command, args, options) => {
      envs.push(options.env);
      return harness.spawn(command, args, options);
    };

    const listed = await listAcpSessionModels(accountOf('acp-x'), { baseEnv: { PATH: '/bin', XAI_API_KEY: 'ambient' }, spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'acp-x', args: ['acp'] }]);
    expect(envs[0]).not.toHaveProperty('XAI_API_KEY');
    // 'ludicrous' names no level, so it is not offered; a model without levels carries none. The
    // initialize answer's own `totalContextTokens` rides each row that reports a positive integer
    // (A-63); a string value is not a window, so that row carries none.
    expect(listed.value).toEqual([
      { id: 'grok-4.6', displayName: 'Grok 4.6', efforts: ['xhigh', 'high', 'medium', 'low'], isDefault: true, contextWindow: 256000 },
      { id: 'grok-4.5', displayName: 'Grok 4.5', efforts: ['high', 'medium', 'low'], contextWindow: 256000 },
      { id: 'grok-code-fast', displayName: 'Grok Code Fast' },
    ]);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).toEqual(['initialize']);
  });

  it('P-29: a slow cold start is not cut short by a caller ceiling below the table entry floor', async () => {
    const harness = makeSpawn('models-silent');
    // A 300 ms ceiling would end the wait almost at once; the floor keeps it open well past that.
    const pending = listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: harness.spawn, timeoutMs: 300 });
    const early = await Promise.race([pending, new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 1_000))]);
    expect(early).toBe('open');
    harness.children[0]?.kill();
    await pending;
  }, 15_000);

  it('P-29: a session listing the model select reads the levels through the provider level names and never prompts', async () => {
    const harness = makeSpawn('models-optional-configured');
    const listed = await listAcpSessionModels(accountOf('acp-x'), {
      baseEnv: {},
      spawn: harness.spawn,
      levelNames: { none: 'off', high: 'high', max: 'max' },
    });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'acp-x', args: ['acp'] }]);
    expect(listed.value.map((model) => model.id)).toEqual(['deepseek-chat', 'glm-5.2']);
    expect(listed.value.every((model) => model.efforts?.join() === 'none,high,max')).toBe(true);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).not.toContain('session/prompt');
    expect(methods).not.toContain('session/set_config_option');
    expect(methods).toContain('session/close');
  });

  it('P-29: a session without a model option (no provider configured) is an empty list, not a failure, where the entry allows it', async () => {
    const harness = makeSpawn('models-optional');
    const listed = await listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: harness.spawn });
    expect(listed).toEqual({ ok: true, value: [] });
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).not.toContain('session/prompt');
  });

  it('P-29: a session whose thought-level select carries a category of its own is read through the level names and never prompts', async () => {
    const harness = makeSpawn('models-thinking');
    const listed = await listAcpSessionModels(accountOf('acp-x'), {
      baseEnv: { MISTRAL_API_KEY: 'sk-ambient' },
      spawn: harness.spawn,
      levelNames: { none: 'off', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'acp-x', args: ['acp'] }]);
    expect(listed.value.map((model) => [model.id, model.displayName])).toEqual([
      ['mistral-medium-3.5', 'mistral-latest'],
      ['local', 'devstral'],
    ]);
    expect(listed.value.every((model) => model.efforts?.join() === 'none,low,medium,high,max')).toBe(true);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).not.toContain('session/prompt');
    expect(methods).not.toContain('session/set_config_option');
    expect(methods).toContain('session/close');
  });

  it('P-29: a missing model option stays a malformed answer for a provider that always has one', async () => {
    const harness = makeSpawn('models-optional');
    const listed = await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: harness.spawn });
    expect(listed.ok).toBe(false);
  });

  it('P-29: a listing whose selects are named by id alone still finds the model select and keeps provider/model entries whole', async () => {
    const harness = makeSpawn('models-by-id');
    const listed = await listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'acp-x', args: ['acp'] }]);
    expect(listed.value.map((model) => model.id)).toEqual(['deepseek-flash/deepseek-flash', 'deepseek-pro/deepseek-v4-pro']);
    // The default model offers only `auto`, which names no level.
    expect(listed.value.every((model) => model.efforts === undefined)).toBe(true);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).not.toContain('session/prompt');
    expect(methods).not.toContain('session/set_config_option');
  });

  it('P-43: advertised thought levels are read back through the level names, dropping values that name no level', async () => {
    const harness = makeSpawn('models-opencode');

    const listed = await listAcpSessionModels(accountOf('opencode'), {
      baseEnv: {},
      spawn: harness.spawn,
      levelNames: { xhigh: 'max', none: 'low' },
    });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    // 'high' and 'default' are provider values no entry names, so they are not offered.
    expect(listed.value.map((row) => row.efforts)).toEqual([['none', 'xhigh'], ['none', 'xhigh'], ['none', 'xhigh']]);
  });

  it('P-29: the session opens in a scratch working directory with no MCP servers and session/prompt is never sent', async () => {
    const harness = makeSpawn('models-opencode');

    const listed = await listAcpSessionModels(accountOf('opencode'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    const sent = clientRequests(harness.logPath);
    // A listing is initialize → session/new → close-when-advertised; nothing else exists on the wire.
    expect(sent.map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new', 'session/close']);
    const newSession = sent[1]?.msg['params'] as Record<string, unknown>;
    expect(typeof newSession['cwd']).toBe('string');
    // The scratch directory is the machine's own temporary tree, never a repo the user owns.
    expect(String(newSession['cwd'])).toContain(tmpdir());
    expect(newSession['mcpServers']).toEqual([]);
    for (const entry of sent) {
      expect(String(entry.msg['method'])).not.toBe('session/prompt');
      expect(JSON.stringify(entry.msg['params'] ?? {})).not.toMatch(/prompt|text/i);
    }
  });

  it('P-29: the session is closed when the agent advertises sessionCapabilities.close and never asked otherwise; the child never outlives the listing', async () => {
    const cursorHarness = makeSpawn('models-cursor');
    const opencodeHarness = makeSpawn('models-opencode');

    await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: cursorHarness.spawn });
    await listAcpSessionModels(accountOf('opencode'), { baseEnv: {}, spawn: opencodeHarness.spawn });

    // The protocol forbids session/close against an agent that does not advertise it.
    const cursorMethods = clientRequests(cursorHarness.logPath).map((entry) => entry.msg['method']);
    expect(cursorMethods).toEqual(['initialize', 'session/new']);
    const closeRequest = clientRequests(opencodeHarness.logPath).find((entry) => entry.msg['method'] === 'session/close');
    expect((closeRequest?.msg['params'] as Record<string, unknown>)?.['sessionId']).toBe('sess_fake_1');
    expect(await exited(cursorHarness.children[0], 3_000)).toBe(true);
    expect(await exited(opencodeHarness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: a session answer that carries no model shape fails as malformed', async () => {
    const harness = makeSpawn('happy');

    const listed = await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'malformed', message: 'the session answer carries no model list' },
    });
  });

  it('P-29: an agent that never answers session/new fails at the timeout and the connection is closed', async () => {
    const harness = makeSpawn('models-silent');

    const listed = await listAcpSessionModels(accountOf('opencode'), {
      baseEnv: {},
      spawn: harness.spawn,
      timeoutMs: 300,
    });

    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('unreachable');
    expect(listed.error.code).toBe('timeout');
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: an agent that dies at session/new fails as a closed connection and does not outlive the listing', async () => {
    const harness = makeSpawn('models-die');

    const listed = await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('unreachable');
    expect(listed.error.code).toBe('spawn_failed');
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: a provider with no ACP session launch is refused without spawning anything', async () => {
    const harness = makeSpawn('models-cursor');

    const listed = await listAcpSessionModels(accountOf('some-other-cli'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'unsupported', message: 'the provider has no ACP session model list' },
    });
    expect(harness.calls).toEqual([]);
  });

  it('P-45: the login refusal of session/new is a not_logged_in error that relays no agent text, and the child is gone', async () => {
    const harness = makeSpawn('session-login-refused');

    const listed = await listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'not_logged_in', message: 'the provider has no login on this machine' },
    });
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new']);
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-45: another error at session/new stays an ordinary refusal, not a login state', async () => {
    const harness = makeSpawn('session-internal-error');

    const listed = await listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'unsupported', message: 'the agent refused the session request' },
    });
  });

  it('P-47: the modelOptionOptional and minTimeoutMs launch options work with a neutral fixture provider', async () => {
    // No built-in launch entry exercises these options today (P-47); the fixture entry keeps them
    // driven, so the next definition that needs either lands as one table entry with no code
    // change. The optional-model answer lists nothing rather than failing, and the entry's floor
    // keeps the connection open past a caller ceiling below it.
    const empty = await listAcpSessionModels(accountOf('acp-x'), {
      baseEnv: {},
      spawn: makeSpawn('models-optional').spawn,
    });
    expect(empty).toEqual({ ok: true, value: [] });

    const silent = makeSpawn('models-silent');
    const pending = listAcpSessionModels(accountOf('acp-x'), { baseEnv: {}, spawn: silent.spawn, timeoutMs: 300 });
    const early = await Promise.race([pending, new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 1_000))]);
    expect(early).toBe('open');
    silent.children[0]?.kill();
    await pending;
  }, 15_000);

});
