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
  it('P-29: the available-models shape maps rows with bracketed ids verbatim and no thought levels', async () => {
    const harness = makeSpawn('models-cursor');

    const listed = await listAcpSessionModels(accountOf('cursor'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    // The launch is the provider's documented ACP mode, resolved from the account's provider.
    expect(harness.calls).toEqual([{ command: 'cursor-agent', args: ['acp'] }]);
    // The bracketed variant suffix stays part of the id — it is the value the session expects —
    // and the same model arriving through both shapes lists exactly once.
    expect(listed.value).toEqual([
      { id: 'default[]', displayName: 'Auto' },
      { id: 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', displayName: 'grok-4.7' },
      { id: 'claude-opus-5-5[context=300k,effort=medium,fast=false]', displayName: 'claude-opus-5-5' },
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

  it('P-29: the kilo listing reads the model select whole, offers no level for a model with only thinking, never prompts, and launches with the switches', async () => {
    const harness = makeSpawn('models-kilo');
    const envs: Array<Readonly<Record<string, string>> | undefined> = [];
    const spawn: AcpSpawn = (command, args, options) => {
      envs.push(options.env);
      return harness.spawn(command, args, options);
    };

    const listed = await listAcpSessionModels(accountOf('kilo'), { baseEnv: { PATH: '/bin' }, spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'kilo', args: ['acp'] }]);
    expect(envs[0]).toMatchObject({ KILO_DISABLE_CLAUDE_CODE: '1', KILO_DISABLE_CLAUDE_CODE_SKILLS: '1' });
    expect(listed.value.map((model) => model.id)).toEqual([
      'kilo/google/gemini-3-pro-image',
      'kilo/anthropic/claude-opus-5',
      'kilo/z-ai/glm-5.1',
      'kilo/kilo-auto/free',
    ]);
    // The session's own levels belong to its default model, and `thinking` names no level.
    expect(listed.value.every((model) => model.efforts === undefined)).toBe(true);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).not.toContain('session/prompt');
    expect(methods).not.toContain('session/set_config_option');
  });

  it('P-29: a slow cold start is not cut short by a caller ceiling below the kilo floor', async () => {
    const harness = makeSpawn('models-silent');
    // A 300 ms ceiling would end the wait almost at once; the floor keeps it open well past that.
    const pending = listAcpSessionModels(accountOf('kilo'), { baseEnv: {}, spawn: harness.spawn, timeoutMs: 300 });
    const early = await Promise.race([pending, new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 1_000))]);
    expect(early).toBe('open');
    harness.children[0]?.kill();
    await pending;
  }, 15_000);

  it('P-29: an atomcode session with a configured provider lists the model select, reads the levels through its names, launches with telemetry off and never prompts', async () => {
    const harness = makeSpawn('models-atomcode-configured');
    const listed = await listAcpSessionModels(accountOf('atomcode'), {
      baseEnv: {},
      spawn: harness.spawn,
      levelNames: { none: 'off', high: 'high', max: 'max' },
    });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'atomcode', args: ['acp', '--no-telemetry'] }]);
    expect(listed.value.map((model) => model.id)).toEqual(['deepseek-chat', 'glm-5.2']);
    expect(listed.value.every((model) => model.efforts?.join() === 'none,high,max')).toBe(true);
    const methods = clientRequests(harness.logPath).map((entry) => entry.msg['method']);
    expect(methods).not.toContain('session/prompt');
    expect(methods).not.toContain('session/set_config_option');
    expect(methods).toContain('session/close');
  });

  it('P-29: an atomcode session without a model option (no provider configured) is an empty list, not a failure', async () => {
    const harness = makeSpawn('models-atomcode');
    const listed = await listAcpSessionModels(accountOf('atomcode'), { baseEnv: {}, spawn: harness.spawn });
    expect(listed).toEqual({ ok: true, value: [] });
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).not.toContain('session/prompt');
  });

  it('P-29: a missing model option stays a malformed answer for a provider that always has one', async () => {
    const harness = makeSpawn('models-atomcode');
    const listed = await listAcpSessionModels(accountOf('kilo'), { baseEnv: {}, spawn: harness.spawn });
    expect(listed.ok).toBe(false);
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

  it('P-29: the available-models list of a hermes session keeps provider:model ids whole and offers no thought levels', async () => {
    const harness = makeSpawn('models-hermes');

    const listed = await listAcpSessionModels(accountOf('hermes'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('unreachable');
    expect(harness.calls).toEqual([{ command: 'hermes', args: ['acp'] }]);
    // Colons and slashes inside an id are the provider's own syntax; nothing is split or rewritten.
    expect(listed.value).toEqual([
      { id: 'nous:hermes-4-405b', displayName: 'Hermes 4 405B' },
      { id: 'openrouter:vendor/some-model:free', displayName: 'some-model (free)' },
      { id: 'custom:local:llama-3', displayName: 'llama-3' },
    ]);
    expect(listed.value.every((row) => row.efforts === undefined)).toBe(true);
    // No prompt is ever sent, and the session is closed only where the agent advertises it.
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new']);
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-29: a hermes session closes when the agent advertises close', async () => {
    const harness = makeSpawn('models-hermes-close');

    const listed = await listAcpSessionModels(accountOf('hermes'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed.ok).toBe(true);
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new', 'session/close']);
  });

  it('P-45: the login refusal of session/new is a not_logged_in error that relays no agent text, and the child is gone', async () => {
    const harness = makeSpawn('session-login-refused');

    const listed = await listAcpSessionModels(accountOf('hermes'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'not_logged_in', message: 'the provider has no login on this machine' },
    });
    expect(clientRequests(harness.logPath).map((entry) => entry.msg['method'])).toEqual(['initialize', 'session/new']);
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-45: another error at session/new stays an ordinary refusal, not a login state', async () => {
    const harness = makeSpawn('session-internal-error');

    const listed = await listAcpSessionModels(accountOf('hermes'), { baseEnv: {}, spawn: harness.spawn });

    expect(listed).toEqual({
      ok: false,
      error: { code: 'unsupported', message: 'the agent refused the session request' },
    });
  });

  it('P-29: a hermes agent that never answers fails at the timeout and does not outlive the listing', async () => {
    const harness = makeSpawn('models-silent');

    const listed = await listAcpSessionModels(accountOf('hermes'), { baseEnv: {}, spawn: harness.spawn, timeoutMs: 300 });

    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('unreachable');
    expect(listed.error.code).toBe('timeout');
    expect(await exited(harness.children[0], 3_000)).toBe(true);
  }, 10_000);
});
