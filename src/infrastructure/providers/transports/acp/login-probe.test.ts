// Login probe over the scripted fake agent (docs/v2/providers.md → P-45): the probe opens one ACP
// session and reads the answer; it never sends a prompt and never leaves a child behind.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_PROVIDER_DEFS } from '../../defs/index';
import type { AcpSpawn } from './connection';
import { loginStateOfSessionError, probeAcpLogin, type NotLoggedInRule } from './login-probe';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fake-agent.cjs');

const rule: NotLoggedInRule = (() => {
  const found = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'hermes')?.authProbe?.acpSession?.notLoggedIn;
  if (found === undefined) throw new Error('the hermes definition carries no login rule');
  return found;
})();

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-acp-login-probe-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Harness {
  readonly logPath: string;
  readonly children: ChildProcess[];
  readonly spawn: AcpSpawn;
}

const makeSpawn = (scenario: string): Harness => {
  sequence += 1;
  const dir = join(root, `probe-${sequence}`);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'agent-log.jsonl');
  const children: ChildProcess[] = [];
  const spawn: AcpSpawn = () => {
    const child = nodeSpawn(process.execPath, [FIXTURE, scenario, logPath]);
    children.push(child);
    return child;
  };
  return { logPath, children, spawn };
};

const methodsSent = (logPath: string): readonly unknown[] =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { dir: string; line: string })
    .filter((entry) => entry.dir === 'in')
    .map((entry) => (JSON.parse(entry.line) as Record<string, unknown>)['method']);

const exited = async (child: ChildProcess | undefined, withinMs: number): Promise<boolean> => {
  if (child === undefined) return false;
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), withinMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
};

const probe = (harness: Harness, timeoutMs?: number): Promise<boolean | null> =>
  probeAcpLogin({ command: 'hermes', args: ['acp'], env: {}, rule, spawn: harness.spawn, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

describe('ACP login probe (P-45)', () => {
  it('P-45: an ACP login probe reads an opened session as logged in, the documented refusal as logged out and any other answer as unknown', async () => {
    expect(await probe(makeSpawn('models-hermes'))).toBe(true);
    expect(await probe(makeSpawn('session-login-refused'))).toBe(false);
    // Same JSON-RPC code, other text; an error that is not an object; an agent that dies; one that
    // never answers: none of them is evidence of a logout.
    expect(await probe(makeSpawn('session-internal-error'))).toBeNull();
    expect(await probe(makeSpawn('session-garbled'))).toBeNull();
    expect(await probe(makeSpawn('models-die'))).toBeNull();
    expect(await probe(makeSpawn('models-silent'), 300)).toBeNull();
  }, 20_000);

  it('P-45: the probe sends initialize and session/new only — never a prompt — and closes the session when the agent advertises it', async () => {
    const plain = makeSpawn('models-hermes');
    const closing = makeSpawn('models-hermes-close');
    const refused = makeSpawn('session-login-refused');

    await probe(plain);
    await probe(closing);
    await probe(refused);

    expect(methodsSent(plain.logPath)).toEqual(['initialize', 'session/new']);
    expect(methodsSent(closing.logPath)).toEqual(['initialize', 'session/new', 'session/close']);
    expect(methodsSent(refused.logPath)).toEqual(['initialize', 'session/new']);
  });

  it('P-45: the child never outlives the probe, on success and on error', async () => {
    const ok = makeSpawn('models-hermes');
    const refused = makeSpawn('session-login-refused');

    await probe(ok);
    await probe(refused);

    expect(await exited(ok.children[0], 3_000)).toBe(true);
    expect(await exited(refused.children[0], 3_000)).toBe(true);
  }, 10_000);

  it('P-45: a spawn that fails leaves the login unknown', async () => {
    const failing: AcpSpawn = () => {
      throw new Error('no such binary');
    };
    expect(await probeAcpLogin({ command: 'hermes', args: ['acp'], env: {}, rule, spawn: failing })).toBeNull();
  });

  it('P-45: only a protocol error with the rule’s code and text is a logout', () => {
    const refusal = { code: 'protocol', message: 'x', rpc: { code: -32603, text: 'Internal error\nHermes is not connected to any AI provider yet.' } } as const;
    expect(loginStateOfSessionError(refusal, rule)).toBe(false);
    expect(loginStateOfSessionError({ ...refusal, rpc: { code: -32602, text: refusal.rpc.text } }, rule)).toBeNull();
    expect(loginStateOfSessionError({ ...refusal, rpc: { code: -32603, text: 'disk full' } }, rule)).toBeNull();
    expect(loginStateOfSessionError({ code: 'protocol', message: 'x' }, rule)).toBeNull();
    expect(loginStateOfSessionError({ code: 'timeout', message: 'x', rpc: refusal.rpc }, rule)).toBeNull();
  });
});
