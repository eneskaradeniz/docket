// Fake-server tests for the app-server transport (docs/v2/providers.md → "Codex app-server
// transport (P-12 … P-14)"). The server is a scripted node fixture speaking newline-delimited
// JSON-RPC 2.0 over stdio (fixtures/fake-app-server.cjs); no Codex install is needed. The fixture
// appends every message in both directions to a log file so the tests assert the exact wire
// traffic, not just the event stream.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { Result, RoleDef, RunId } from '../../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../../domain/index';
import type { ProviderDef } from '../../defs/index';
import { createAppServerTransport } from './app-server';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-app-server.cjs');

let root: string;
let runCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-app-server-'));
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

const runDir = (): string => {
  runCount += 1;
  const dir = join(root, `run-${runCount}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

interface Started {
  readonly handle: RunHandle;
  readonly logPath: string;
  readonly cwd: string;
}

const start = async (
  scenario: string,
  options: { readonly resume?: { readonly sessionRef: string } } = {},
): Promise<Started> => {
  const cwd = runDir();
  const logPath = join(cwd, 'rpc.log');
  const def: ProviderDef = {
    id: 'fake-app-server',
    displayName: 'Fake App Server',
    // The fixture rides on the node binary: a checked-in script cannot carry a portable exec bit.
    bins: [process.execPath],
    versionArgs: ['--version'],
    transport: 'app-server',
    config: { mechanism: 'env-var', name: 'FAKE_APP_SERVER_HOME' },
    buildLaunch: () => ({ args: [FIXTURE, scenario, logPath], env: {}, stdin: 'none' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: true,
      resume: true,
      mcp: false,
      hooks: 'unknown',
      skills: 'unknown',
      images: 'unknown',
      quotaReport: 'query',
      costReport: 'none',
    },
    installHint: { url: 'https://example.invalid/fake-app-server' },
  };
  const request: RunRequest = {
    runId: RUN_ID,
    cwd,
    role: ROLE,
    route: { accountId: ACCOUNT },
    prompt: 'do the work',
    capabilities: [],
    ...(options.resume === undefined ? {} : { resume: options.resume }),
  };
  const started: Result<RunHandle, TransportError> = await createAppServerTransport(def).start(request);
  if (!started.ok) throw new Error(`expected a started run, got ${started.error.code}`);
  return { handle: started.value, logPath, cwd };
};

interface LoggedEntry {
  readonly dir: string;
  readonly msg: Record<string, unknown>;
}

const readLog = (logPath: string): readonly LoggedEntry[] =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LoggedEntry);

const collect = async (events: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> => {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const runScenario = async (
  scenario: string,
  options: { readonly resume?: { readonly sessionRef: string } } = {},
): Promise<{ readonly events: readonly AgentEvent[]; readonly logPath: string; readonly cwd: string }> => {
  const { handle, logPath, cwd } = await start(scenario, options);
  return { events: await collect(handle.events), logPath, cwd };
};

const clientRequests = (logPath: string): readonly Record<string, unknown>[] =>
  readLog(logPath)
    .filter((entry) => entry.dir === 'in' && entry.msg['method'] !== undefined)
    .map((entry) => entry.msg);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const finishedOf = (events: readonly AgentEvent[]) => events.filter((event) => event.type === 'finished');

describe('createAppServerTransport', () => {
  describe('lifecycle and tolerance (P-12)', () => {
    it('P-12: the run opens with initialize → thread/start → turn/start and maps the turn stream to AgentEvents', async () => {
      const { events, logPath, cwd } = await runScenario('happy');

      expect(events.map((event) => event.type)).toEqual(['session_started', 'text', 'usage', 'finished']);
      expect(events[0]).toStrictEqual({ type: 'session_started', at: expect.any(Number), sessionRef: 'th_fake_1' });
      expect(events[1]).toStrictEqual({ type: 'text', at: expect.any(Number), delta: 'all done' });
      expect(events[2]).toStrictEqual({
        type: 'usage',
        at: expect.any(Number),
        inputTokens: 600,
        outputTokens: 300,
        cachedInputTokens: 100,
      });
      expect(finishedOf(events)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'completed' }]);

      const requests = clientRequests(logPath);
      expect(requests.map((msg) => msg['method'])).toEqual([
        'initialize',
        'account/rateLimits/read',
        'thread/start',
        'turn/start',
      ]);
      const initialize = requests[0]?.['params'] as Record<string, unknown>;
      expect((initialize['clientInfo'] as Record<string, unknown>)['name']).toBe('docket');
      const threadStart = requests[2]?.['params'] as Record<string, unknown>;
      expect(threadStart['cwd']).toBe(cwd);
      const turnStart = requests[3]?.['params'] as Record<string, unknown>;
      expect(turnStart['threadId']).toBe('th_fake_1');
      expect(turnStart['input']).toEqual([{ type: 'text', text: 'do the work', text_elements: [] }]);
    });

    it('P-12: requests and notifications the client does not know are ignored, never fatal, and the unknown request stays unanswered', async () => {
      const { events, logPath } = await runScenario('unknown');

      expect(events.map((event) => event.type)).toEqual(['session_started', 'text', 'usage', 'finished']);
      expect(events.some((event) => event.type === 'error' || event.type === 'raw')).toBe(false);
      expect(finishedOf(events)).toHaveLength(1);
      // The server sent both an unknown notification and an unknown request; neither broke the
      // run, and no response for the unknown request id ever went back.
      expect(readLog(logPath).some((entry) => entry.dir === 'out' && entry.msg['method'] === 'some/future/notification')).toBe(true);
      expect(readLog(logPath).some((entry) => entry.dir === 'in' && entry.msg['id'] === 999)).toBe(false);
    });

    it('P-12: a server that dies before the turn completes fails the run with exactly one finished', async () => {
      const events = (await runScenario('exit-early')).events;

      // Like every transport: a stream that ends without a completed turn synthesises the single
      // failed finish; no partial session state leaks out as events.
      expect(events.map((event) => event.type)).toEqual(['finished']);
      expect(finishedOf(events)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'failed' }]);
    });

    it('P-12: a handshake answered with a JSON-RPC error fails the run as a protocol error', async () => {
      const events = (await runScenario('handshake-error')).events;

      expect(events.map((event) => event.type)).toEqual(['error', 'finished']);
      expect(events[0]).toMatchObject({ type: 'error', class: 'protocol' });
      expect((events[0] as { readonly message: string }).message).toContain('the thread could not be started');
      expect(finishedOf(events)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'failed' }]);
    });

    it('P-12: a resume reference opens the thread with thread/resume instead of thread/start', async () => {
      const { events, logPath } = await runScenario('happy', { resume: { sessionRef: 'th_previous' } });

      expect(events.map((event) => event.type)).toEqual(['session_started', 'text', 'usage', 'finished']);
      expect(events[0]).toMatchObject({ sessionRef: 'th_resumed' });
      const requests = clientRequests(logPath);
      expect(requests.map((msg) => msg['method'])).toEqual([
        'initialize',
        'account/rateLimits/read',
        'thread/resume',
        'turn/start',
      ]);
      expect((requests[2]?.['params'] as Record<string, unknown>)['threadId']).toBe('th_previous');
    });
  });

  describe('approvals (P-13)', () => {
    it('P-13: an approval request becomes a permission_ask; the user’s allow is delivered as the JSON-RPC response and nothing is ever auto-approved', async () => {
      const { handle, logPath } = await start('approval');
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'permission_ask') {
          // A server window in which an auto-approving client would have answered already.
          await delay(150);
          expect(readLog(logPath).some((entry) => entry.dir === 'in' && entry.msg['id'] === 41)).toBe(false);
          handle.answerPermission(event.id, 'allow');
        }
      }

      expect(collected.map((event) => event.type)).toEqual(['session_started', 'permission_ask', 'text', 'usage', 'finished']);
      expect(collected[1]).toStrictEqual({
        type: 'permission_ask',
        at: expect.any(Number),
        id: '41',
        tool: 'shell',
        target: 'rm -rf /tmp/fake',
        options: ['allow', 'deny'],
      });
      expect(finishedOf(collected)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'completed' }]);
      const answer = readLog(logPath).find((entry) => entry.dir === 'in' && entry.msg['id'] === 41)?.msg;
      expect(answer).toMatchObject({ result: { decision: 'accept' } });
    });

    it('P-13: the user’s deny is delivered as a decline, and a repeated or unknown ask id answers nothing', async () => {
      const { handle, logPath } = await start('approval');
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'permission_ask') {
          handle.answerPermission(event.id, 'deny');
          handle.answerPermission(event.id, 'allow'); // already answered: ignored
          handle.answerPermission('ask-nope', 'allow'); // unknown ask: ignored
        }
      }

      expect(finishedOf(collected)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'completed' }]);
      const answers = readLog(logPath).filter((entry) => entry.dir === 'in' && entry.msg['id'] === 41);
      expect(answers).toHaveLength(1);
      expect(answers[0]?.msg).toMatchObject({ result: { decision: 'decline' } });
    });

    it('P-13: stop() answers pending approvals with deny and cancels the run', async () => {
      const { handle, logPath } = await start('approval-stop');
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'permission_ask') await handle.stop();
      }

      expect(collected.map((event) => event.type)).toEqual(['session_started', 'permission_ask', 'finished']);
      expect(finishedOf(collected)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'cancelled' }]);
      const answer = readLog(logPath).find((entry) => entry.dir === 'in' && entry.msg['id'] === 41)?.msg;
      expect(answer).toMatchObject({ result: { decision: 'decline' } });
      expect(clientRequests(logPath).some((msg) => msg['method'] === 'turn/interrupt')).toBe(true);
    });
  });

  describe('rate limits (P-14)', () => {
    it('P-14: account/rateLimits/read maps the primary and secondary windows to quota_signal meters with exact resets', async () => {
      const { events } = await runScenario('rate-limits');

      // The read happens right after initialize, so both polled readings precede the session event.
      expect(events.slice(0, 2).map((event) => event.type)).toEqual(['quota_signal', 'quota_signal']);
      const quotas = events.filter((event) => event.type === 'quota_signal');
      expect(quotas).toHaveLength(3);
      const [primary, secondary, pushed] = quotas;
      expect(primary).toStrictEqual({
        type: 'quota_signal',
        at: expect.any(Number),
        meter: {
          label: 'primary',
          poolLabel: 'Codex',
          cadence: 'rolling_from_first_use',
          durationMs: 18_000_000, // windowDurationMins 300, stated by the server itself
          unit: 'fraction',
          used: 0.4,
          limit: 1,
          remaining: 0.6,
          resetsAt: 1_759_000_000_000, // the protocol states seconds; domain times are milliseconds
          resetPrecision: 'exact',
          observedAt: expect.any(Number),
          source: 'polled',
        },
      });
      expect(secondary).toMatchObject({
        type: 'quota_signal',
        meter: {
          label: 'secondary',
          poolLabel: 'Codex',
          durationMs: 604_800_000, // windowDurationMins 10080 (≈ weekly)
          used: 0.1,
          remaining: 0.9,
          resetsAt: 1_759_600_000_000,
          resetPrecision: 'exact',
          source: 'polled',
        },
      });
      // The rolling update is a push, and absent values stay absent — never invented.
      expect(pushed).toMatchObject({
        type: 'quota_signal',
        meter: { label: 'primary', used: 0.8, remaining: 0.2, resetPrecision: 'unknown', source: 'pushed' },
      });
      expect('durationMs' in (pushed as { meter: Record<string, unknown> }).meter).toBe(false);
      expect('resetsAt' in (pushed as { meter: Record<string, unknown> }).meter).toBe(false);
      expect('poolLabel' in (pushed as { meter: Record<string, unknown> }).meter).toBe(false);
      expect(finishedOf(events)).toStrictEqual([{ type: 'finished', at: expect.any(Number), reason: 'completed' }]);
    });
  });

  describe('inherited port rules', () => {
    it('steer sends turn/steer with the active turn id while a turn is running', async () => {
      const { handle, logPath } = await start('steer');
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'text') handle.steer('a later note');
      }

      expect(collected.map((event) => event.type)).toEqual(['session_started', 'text', 'text', 'usage', 'finished']);
      const steer = clientRequests(logPath).find((msg) => msg['method'] === 'turn/steer');
      expect(steer?.['params']).toEqual({
        threadId: 'th_fake_1',
        input: [{ type: 'text', text: 'a later note', text_elements: [] }],
        expectedTurnId: 'turn_fake_1',
      });
    });

    it('steer after the turn ended is dropped, not sent to a dead thread', async () => {
      const { handle, logPath } = await start('happy');
      const events = await collect(handle.events);
      handle.steer('too late');

      expect(finishedOf(events)).toHaveLength(1);
      expect(clientRequests(logPath).some((msg) => msg['method'] === 'turn/steer')).toBe(false);
    });

    it('reports not_installed when no resolved binary remains or the binary is missing', async () => {
      const missingDef = (bins: readonly string[]): ProviderDef => ({
        id: 'fake-app-server',
        displayName: 'Fake App Server',
        bins,
        versionArgs: ['--version'],
        transport: 'app-server',
        config: { mechanism: 'env-var', name: 'FAKE_APP_SERVER_HOME' },
        buildLaunch: () => ({ args: [], env: {}, stdin: 'none' }),
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
        installHint: { url: 'https://example.invalid/fake-app-server' },
      });
      const noBin = await createAppServerTransport(missingDef([])).start({
        runId: RUN_ID,
        cwd: runDir(),
        role: ROLE,
        route: { accountId: ACCOUNT },
        prompt: 'do the work',
        capabilities: [],
      });
      expect(noBin.ok).toBe(false);
      if (!noBin.ok) expect(noBin.error.code).toBe('not_installed');

      const notFound = await createAppServerTransport(missingDef([join(root, 'never-written-bin')])).start({
        runId: RUN_ID,
        cwd: runDir(),
        role: ROLE,
        route: { accountId: ACCOUNT },
        prompt: 'do the work',
        capabilities: [],
      });
      expect(notFound.ok).toBe(false);
      if (!notFound.ok) expect(notFound.error.code).toBe('not_installed');
    });
  });
});
