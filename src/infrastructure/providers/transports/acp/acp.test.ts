// Fake-agent round-trips for the Agent Client Protocol transport (docs/v2/providers.md →
// "ACP transport (P-15 … P-17)"). The agent is a scripted node process speaking ACP JSON-RPC
// over stdio (./fake-agent.cjs); it logs every exchanged message to a file, so the tests assert
// on the client's exact wire behaviour. No real agent CLI is ever spawned.
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { CapabilityDef, Result, RoleDef, RunId } from '../../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../../domain/index';
import type { ProviderDef } from '../../defs/index';
import { createAcpTransport } from './acp';

const FAKE_AGENT_BIN = fileURLToPath(new URL('./fake-agent.cjs', import.meta.url));

let root: string;
let runCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-acp-'));
  // The fixture launches through its shebang; the executable bit must survive every checkout.
  chmodSync(FAKE_AGENT_BIN, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
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

const MCP_CAPABILITY: CapabilityDef = {
  kind: 'mcp',
  id: slugOf<'capability'>('demo-mcp'),
  name: 'Demo MCP',
  command: 'demo-mcp-server',
  args: ['--stdio'],
  env: { DEMO_TOKEN: { literal: 'demo-token-value' } },
};

const CONTEXT_CAPABILITY: CapabilityDef = {
  kind: 'context',
  id: slugOf<'capability'>('design-doc'),
  name: 'Design doc',
  path: 'docs/design.md',
};

const acpDef = (scenario: string, logPath: string): ProviderDef => ({
  id: 'fake-acp',
  displayName: 'Fake ACP Agent',
  bins: [FAKE_AGENT_BIN],
  versionArgs: ['--version'],
  transport: 'acp',
  config: { mechanism: 'env-var', name: 'FAKE_ACP_HOME' },
  // The scenario and the log path are how a test scripts its fake agent.
  buildLaunch: () => ({ args: [scenario, logPath], env: {}, stdin: 'none' }),
  resume: 'protocol',
  capabilities: {
    structuredStream: true,
    permissionAsk: 'unknown',
    resume: true,
    mcp: true,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-acp' },
  mark: null,
});

interface RequestOptions {
  readonly capabilities?: readonly CapabilityDef[];
  readonly resume?: { readonly sessionRef: string };
}

const requestOf = (cwd: string, options: RequestOptions = {}): RunRequest => ({
  runId: RUN_ID,
  cwd,
  role: ROLE,
  route: { accountId: ACCOUNT },
  prompt: 'do the work',
  capabilities: options.capabilities ?? [],
  ...(options.resume === undefined ? {} : { resume: options.resume }),
});

const unwrap = (started: Result<RunHandle, TransportError>): RunHandle => {
  if (!started.ok) throw new Error(`expected a started run, got ${started.error.code}`);
  return started.value;
};

const runCwd = (): string => {
  runCount += 1;
  return join(root, `run-${runCount}`);
};

const startRun = async (
  scenario: string,
  request: RunRequest,
): Promise<{ readonly handle: RunHandle; readonly logPath: string }> => {
  const logPath = join(request.cwd, 'agent-log.jsonl');
  const transport = createAcpTransport(acpDef(scenario, logPath));
  return { handle: unwrap(await transport.start(request)), logPath };
};

const collect = async (events: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> => {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const sleep = (ms: number): Promise<'timeout'> =>
  new Promise((resolve) => {
    setTimeout((): void => resolve('timeout'), ms);
  });

// --- the fake agent's log: every message the client sent (dir 'in') and received (dir 'out') ---

interface LogEntry {
  readonly dir: 'in' | 'out';
  readonly line: string;
}

type WireMessage = Readonly<Record<string, unknown>>;

const readLog = (path: string): readonly LogEntry[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogEntry);

const clientMessages = (path: string): readonly WireMessage[] =>
  readLog(path)
    .filter((entry) => entry.dir === 'in')
    .map((entry) => JSON.parse(entry.line) as WireMessage);

const clientMethodSequence = (messages: readonly WireMessage[]): readonly string[] =>
  messages
    .filter((message) => typeof message.method === 'string')
    .map((message) => message.method as string);

const messageOf = (messages: readonly WireMessage[], method: string): WireMessage => {
  const found = messages.find((message) => message.method === method);
  if (found === undefined) throw new Error(`expected the client to have sent ${method}`);
  return found;
};

const paramsOf = (message: WireMessage): Readonly<Record<string, unknown>> => {
  const params = message.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error(`malformed params on ${String(message.method)}`);
  }
  return params as Readonly<Record<string, unknown>>;
};

const promptTextOf = (message: WireMessage): string => {
  const blocks = paramsOf(message).prompt;
  if (!Array.isArray(blocks) || blocks[0] === undefined || typeof blocks[0] !== 'object' || blocks[0] === null) {
    throw new Error('malformed prompt blocks');
  }
  const text = (blocks[0] as Readonly<Record<string, unknown>>).text;
  if (typeof text !== 'string') throw new Error('malformed prompt text');
  return text;
};

/** The responses the client sent to the agent's permission requests. */
const outcomeResponses = (messages: readonly WireMessage[]): readonly WireMessage[] =>
  messages.filter(
    (message) =>
      typeof message.id === 'number' &&
      typeof message.result === 'object' &&
      message.result !== null &&
      !Array.isArray(message.result) &&
      'outcome' in message.result,
  );

// --- tests ---

describe('acp transport', () => {
  it('P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error', async () => {
    const cwd = runCwd();
    const run = await startRun('happy', requestOf(cwd, { capabilities: [MCP_CAPABILITY, CONTEXT_CAPABILITY] }));
    const events = await collect(run.handle.events);

    expect(events.map((event) => event.type)).toEqual([
      'session_started',
      'thinking',
      'tool_call',
      'tool_result',
      'text',
      'usage',
      'raw',
      'finished',
    ]);
    expect(events[0]).toMatchObject({ type: 'session_started', sessionRef: 'sess_fake_1' });
    expect(events[1]).toMatchObject({ type: 'thinking', delta: 'planning' });
    expect(events[2]).toMatchObject({
      type: 'tool_call',
      id: 'call_001',
      name: 'read_file',
      target: '/tmp/docket-acp-fixture/config.json',
    });
    expect(events[3]).toMatchObject({ type: 'tool_result', id: 'call_001', ok: true });
    expect(events[4]).toMatchObject({ type: 'text', delta: 'Working.' });
    // The protocol reports cumulative context tokens, not an input/output split.
    expect(events[5]).toMatchObject({
      type: 'usage',
      inputTokens: 53000,
      outputTokens: 0,
      costUsd: 0.045,
      costKind: 'reported',
    });
    const raw = events[6];
    if (raw.type !== 'raw') throw new Error('expected the unknown update kind to surface as raw');
    expect(raw.line).toContain('wormhole_transmission');
    expect(events[7]).toMatchObject({ type: 'finished', reason: 'completed' });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);

    const messages = clientMessages(run.logPath);
    expect(clientMethodSequence(messages)).toEqual(['initialize', 'session/new', 'session/prompt']);
    const newSession = paramsOf(messageOf(messages, 'session/new'));
    expect(newSession.cwd).toBe(cwd);
    // The MCP capability of the run rides inside session/new, exactly as the files hold it.
    expect(newSession.mcpServers).toEqual([
      {
        name: 'demo-mcp',
        command: 'demo-mcp-server',
        args: ['--stdio'],
        env: [{ name: 'DEMO_TOKEN', value: 'demo-token-value' }],
      },
    ]);
    const prompt = paramsOf(messageOf(messages, 'session/prompt'));
    expect(prompt.sessionId).toBe('sess_fake_1');
    expect(prompt.prompt).toEqual([{ type: 'text', text: 'do the work' }]);
  });

  it('P-15: an agent that dies mid-turn still yields exactly one failed finished', async () => {
    const cwd = runCwd();
    const run = await startRun('die', requestOf(cwd));
    const events = await collect(run.handle.events);

    expect(events.map((event) => event.type)).toEqual(['session_started', 'finished']);
    expect(events[1]).toMatchObject({ type: 'finished', reason: 'failed' });
  });

  it('P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved', async () => {
    const cwd = runCwd();
    const run = await startRun('permission', requestOf(cwd));
    const iterator = run.handle.events[Symbol.asyncIterator]();

    const started = await iterator.next();
    expect(started.value).toMatchObject({ type: 'session_started' });
    const toolCall = await iterator.next();
    expect(toolCall.value).toMatchObject({ type: 'tool_call', id: 'call_001', name: 'edit_file' });
    const ask = await iterator.next();
    const askEvent = ask.value;
    if (askEvent.type !== 'permission_ask') throw new Error(`expected a permission ask, got ${askEvent.type}`);
    expect(askEvent).toMatchObject({
      id: 'ask-1',
      tool: 'edit_file',
      target: '/tmp/docket-acp-fixture/config.json',
      options: ['allow-once', 'reject-once'],
    });

    // The agent is expected to wait: after a quiet window nothing has answered it, so a client
    // that auto-approved would have ended the turn by now.
    await sleep(300);
    expect(outcomeResponses(clientMessages(run.logPath))).toHaveLength(0);

    run.handle.answerPermission(askEvent.id, 'allow');
    const toolResult = await iterator.next();
    expect(toolResult.value).toMatchObject({ type: 'tool_result', id: 'call_001', ok: true });
    const answer = await iterator.next();
    expect(answer.value).toMatchObject({ type: 'text', delta: 'ANSWER:allow-once' });
    const finished = await iterator.next();
    expect(finished.value).toMatchObject({ type: 'finished', reason: 'completed' });
    const drained = await iterator.next();
    expect(drained.done).toBe(true);

    // Exactly one permission response reached the agent, and it is the user's choice.
    const outcomes = outcomeResponses(clientMessages(run.logPath));
    expect(outcomes).toHaveLength(1);
    const outcome = (outcomes[0] as { readonly result: { readonly outcome: unknown } }).result.outcome;
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  it('P-16: stop() is the only automated answer — it denies the open ask and cancels the turn', async () => {
    const cwd = runCwd();
    const run = await startRun('permission', requestOf(cwd));
    const iterator = run.handle.events[Symbol.asyncIterator]();
    await iterator.next(); // session_started
    await iterator.next(); // the tool_call update the agent reports before asking
    const ask = await iterator.next();
    if (ask.value.type !== 'permission_ask') throw new Error('expected a permission ask');

    await run.handle.stop();

    const finished = await iterator.next();
    expect(finished.value).toMatchObject({ type: 'finished', reason: 'cancelled' });
    const drained = await iterator.next();
    expect(drained.done).toBe(true);

    const messages = clientMessages(run.logPath);
    const outcomes = outcomeResponses(messages);
    expect(outcomes).toHaveLength(1);
    const outcome = (outcomes[0] as { readonly result: { readonly outcome: unknown } }).result.outcome;
    expect(outcome).toEqual({ outcome: 'cancelled' });
    expect(messages.some((message) => message.method === 'session/cancel')).toBe(true);
  });

  it('P-17: resume uses session/load with the captured session id and keeps the replayed history', async () => {
    const cwd = runCwd();
    const run = await startRun('load-ok', requestOf(cwd, { resume: { sessionRef: 'sess_prev' } }));
    const events = await collect(run.handle.events);

    // The load replays the conversation before it responds, so the replay precedes the
    // session_started that marks the session as established for this run.
    expect(events.map((event) => event.type)).toEqual(['raw', 'text', 'session_started', 'text', 'finished']);
    const established = events.find((event) => event.type === 'session_started');
    expect(established).toMatchObject({ type: 'session_started', sessionRef: 'sess_prev' });
    // The user's own replayed message has no dedicated event kind; it stays visible as raw.
    const replayedUser = events[0];
    if (replayedUser.type !== 'raw') throw new Error('expected the replayed user message as raw');
    expect(replayedUser.line).toContain('previous work order');
    expect(events[1]).toMatchObject({ type: 'text', delta: 'previous answer' });
    expect(events[3]).toMatchObject({ type: 'text', delta: 'CONTINUED' });
    expect(events[4]).toMatchObject({ type: 'finished', reason: 'completed' });

    const messages = clientMessages(run.logPath);
    expect(clientMethodSequence(messages)).toEqual(['initialize', 'session/load', 'session/prompt']);
    const load = paramsOf(messageOf(messages, 'session/load'));
    expect(load.sessionId).toBe('sess_prev');
    expect(load.cwd).toBe(cwd);
  });

  it('P-17: a failed session/load starts a fresh session/new and prefixes the prompt with a bounded summary of the replayed transcript', async () => {
    const cwd = runCwd();
    const run = await startRun('load-fail', requestOf(cwd, { resume: { sessionRef: 'sess_prev' } }));
    const events = await collect(run.handle.events);

    // Exactly one session_started, naming the fresh session the fallback created — never the
    // id that failed to load.
    const established = events.filter((event) => event.type === 'session_started');
    expect(established).toHaveLength(1);
    expect(established[0]).toMatchObject({ sessionRef: 'sess_fake_fresh' });
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);

    const messages = clientMessages(run.logPath);
    expect(clientMethodSequence(messages)).toEqual([
      'initialize',
      'session/load',
      'session/new',
      'session/prompt',
    ]);
    const text = promptTextOf(messageOf(messages, 'session/prompt'));
    expect(text.startsWith('The previous session could not be loaded')).toBe(true);
    expect(text).toContain('[user] previous work order');
    expect(text).toContain(`[agent] ${'A'.repeat(400)}…`);
    expect(text).not.toContain('A'.repeat(401));
    expect(text.endsWith('do the work')).toBe(true);
    // Bounded: the 6000-character replay must not reach the fresh session in full.
    expect(text.length).toBeLessThan('do the work'.length + 3000);
  });

  it('P-17: an agent that does not advertise loadSession is never sent session/load; the fresh session still gets the summary prefix', async () => {
    const cwd = runCwd();
    const run = await startRun('load-unsupported', requestOf(cwd, { resume: { sessionRef: 'sess_prev' } }));
    const events = await collect(run.handle.events);

    // Exactly one session_started, naming the fresh session the fallback created — never the
    // id that failed to load.
    const established = events.filter((event) => event.type === 'session_started');
    expect(established).toHaveLength(1);
    expect(established[0]).toMatchObject({ sessionRef: 'sess_fake_fresh' });
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);

    const messages = clientMessages(run.logPath);
    expect(clientMethodSequence(messages)).toEqual(['initialize', 'session/new', 'session/prompt']);
    const text = promptTextOf(messageOf(messages, 'session/prompt'));
    expect(text.startsWith('The previous session could not be loaded')).toBe(true);
    expect(text).not.toContain('[user]');
    expect(text).not.toContain('[agent]');
    expect(text.endsWith('do the work')).toBe(true);
  });
});
