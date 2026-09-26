// The app-server transport: a JSON-RPC 2.0 client over the child's stdio behind the AgentTransport
// façade, written from the protocol's own documentation — initialize handshake, thread creation
// (or resume), one turn per prompt, approval requests answered by the user, account rate limits
// read at start-up and pushed as updates. Contract: docs/v2/providers.md → "Codex app-server
// transport (P-12 … P-14)".
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { AgentTransport, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { AgentEvent, Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { createSystemClock } from '../../../system/index';
import type { ProviderDef } from '../../defs/index';
import { buildChildEnv, writeRunConfig, type RunCapability } from '../../launch/index';
import { describeApprovalRequest, type ApprovalAsk } from './approvals';
import { isRecord, rateLimitEvents } from './rate-limits';
import { mapServerNotification } from './server-messages';

const CLIENT_INFO = { name: 'docket', title: 'Docket', version: '0.0.0' } as const;

// How long stop() lets its final writes (deny answers, the interrupt) reach the server before the
// process group dies; without this grace the kill could beat the pipe.
const STOP_GRACE_MS = 150;

/** The protocol tags the text variant of turn input with `text_elements` — its own field name,
 * kept verbatim so the wire stays exactly as documented. */
const textInput = (text: string): Readonly<Record<string, unknown>> => ({
  type: 'text',
  text,
  text_elements: [],
});

const stringField = (holder: unknown, key: string): string | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'string' ? value : undefined;
};

const nestedString = (holder: unknown, key: string, nestedKey: string): string | undefined =>
  isRecord(holder) && isRecord(holder[key]) ? stringField(holder[key], nestedKey) : undefined;

/** Single-consumer push channel: buffers events between await points, ends after a finish. */
interface Channel<T> {
  push(value: T): void;
  close(): void;
  readonly stream: AsyncIterable<T>;
}

function createChannel<T>(): Channel<T> {
  const buffered: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const iterator: AsyncIterator<T> = {
    next: (): Promise<IteratorResult<T>> =>
      new Promise((resolve) => {
        const value = buffered.length > 0 ? buffered.shift() : undefined;
        if (value !== undefined) {
          resolve({ value, done: false });
          return;
        }
        if (closed) {
          resolve({ value: undefined, done: true });
          return;
        }
        waiters.push(resolve);
      }),
  };

  return {
    push: (value: T): void => {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter === undefined) {
        buffered.push(value);
        return;
      }
      waiter({ value, done: false });
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
    },
    stream: {
      [Symbol.asyncIterator]: (): AsyncIterator<T> => iterator,
    },
  };
}

interface PendingAsk {
  /** The request id exactly as the server sent it, so the response round-trips. */
  readonly rawId: number | string;
  readonly ask: ApprovalAsk;
}

export function createAppServerTransport(def: ProviderDef): AgentTransport {
  const clock = createSystemClock();

  return {
    start: async (request: RunRequest): Promise<Result<RunHandle, TransportError>> => {
      if (def.bins.length === 0) {
        // An empty candidate list is how the factory encodes "discovery found no binary";
        // re-searching PATH behind discovery's back would spawn an unprobed path.
        return err({ code: 'not_installed', message: `provider ${def.id} has no binary on this machine` });
      }
      const bin = def.bins[0];
      try {
        accessSync(bin);
      } catch {
        return err({ code: 'not_installed', message: `provider ${def.id} binary is not present` });
      }

      const runCapabilities: RunCapability[] = [];
      for (const capability of request.capabilities) {
        if (capability.kind === 'context') continue; // context reaches the CLI through the prompt, not launch files
        if (capability.kind === 'mcp') {
          const env: Record<string, string> = {};
          for (const [name, value] of Object.entries(capability.env)) {
            if ('literal' in value) {
              env[name] = value.literal;
              continue;
            }
            // This transport's fixed signature carries no vault; a secret reference it cannot
            // resolve must fail the run instead of writing an unresolved value to disk.
            return err({
              code: 'not_logged_in',
              message: `capability ${capability.id} has an unresolvable secret reference`,
            });
          }
          runCapabilities.push({
            kind: 'mcp',
            id: capability.id,
            name: capability.name,
            command: capability.command,
            args: [...capability.args],
            env,
          });
          continue;
        }
        runCapabilities.push({ ...capability });
      }

      const runConfig = await writeRunConfig(request.cwd, def, runCapabilities);
      const launch = def.buildLaunch({
        prompt: request.prompt,
        configDir: runConfig.configDir,
        ...(request.resume === undefined ? {} : { resume: request.resume }),
      });

      // The ambient environment reaches the child only through the launch allowlist; the def's
      // own launch environment (the run-scoped config mechanism) rides on top of it.
      const parentEnv: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined) parentEnv[name] = value;
      }
      const env = { ...buildChildEnv(def.id, parentEnv, {}), ...runConfig.env, ...launch.env };

      const child = spawn(bin, [...launch.args, ...runConfig.args], {
        cwd: request.cwd,
        env,
        // Own process group on POSIX, so a stop can address the whole tree with one signal.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (child.stdout === null || child.stdin === null || child.stderr === null) {
        child.kill();
        return err({ code: 'spawn_failed', message: `provider ${def.id} could not be started with pipes` });
      }
      const stdout = child.stdout;
      const stderr = child.stderr;
      const stdin = child.stdin;
      // Drained and discarded: stderr may quote environment values and never enters records.
      stderr.resume();

      const events = createChannel<AgentEvent>();
      const pending = new Map<number, { resolve(result: unknown): void; reject(message: string): void }>();
      const pendingAsks = new Map<string, PendingAsk>();
      const decoder = new StringDecoder('utf8');
      let remainder = '';
      let finished = false;
      let connectionClosed = false;
      let nextRequestId = 1;
      let threadId: string | undefined;
      let activeTurnId: string | undefined;

      const push = (event: AgentEvent): void => {
        events.push(event);
      };

      const killGroup = (): void => {
        if (child.pid === undefined || process.platform === 'win32') {
          child.kill('SIGTERM');
          return;
        }
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // The group is already gone; nothing to signal.
        }
      };

      const finishWith = (event: AgentEvent): void => {
        if (finished) return;
        finished = true;
        events.push(event);
        events.close();
        pendingAsks.clear();
        // The run is over for the consumer; no process of the group may outlive it.
        killGroup();
      };

      const failRun = (): void => {
        finishWith({ type: 'finished', at: clock.now(), reason: 'failed' });
      };

      const settlePending = (message: string): void => {
        if (connectionClosed) return;
        connectionClosed = true;
        for (const entry of pending.values()) entry.reject(message);
        pending.clear();
      };

      const requestRpc = (method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> =>
        new Promise((resolve, reject) => {
          if (connectionClosed) {
            reject('the app-server connection is closed');
            return;
          }
          const id = nextRequestId;
          nextRequestId += 1;
          pending.set(id, { resolve, reject });
          stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
        });

      const sendResponse = (id: number | string, result: Readonly<Record<string, unknown>>): void => {
        if (connectionClosed) return;
        stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
      };

      const handleServerRequest = (id: unknown, method: string, params: unknown): void => {
        if (typeof id !== 'number' && typeof id !== 'string') return; // unusable id: cannot be answered
        const ask = describeApprovalRequest(method, params);
        // Requests the protocol does not require this client to answer are ignored (logged);
        // answering inventions of a newer server would speak for the user.
        if (ask === undefined) return;
        const askId = String(id);
        pendingAsks.set(askId, { rawId: id, ask });
        push({
          type: 'permission_ask',
          at: clock.now(),
          id: askId,
          tool: ask.tool,
          ...(ask.target === undefined ? {} : { target: ask.target }),
          options: ['allow', 'deny'],
        });
      };

      const handleNotification = (method: string, params: unknown): void => {
        if (method === 'turn/started') {
          const turnId = nestedString(params, 'turn', 'id');
          if (turnId !== undefined) activeTurnId = turnId;
          return;
        }
        if (method === 'turn/completed') activeTurnId = undefined;
        if (method === 'account/rateLimits/updated') {
          const snapshot = isRecord(params) ? params['rateLimits'] : undefined;
          for (const event of rateLimitEvents(snapshot, clock.now(), 'pushed')) push(event);
          return;
        }
        for (const event of mapServerNotification(method, params, clock.now())) {
          if (event.type === 'finished') {
            finishWith(event);
            continue;
          }
          push(event);
        }
      };

      const handleLine = (line: string): void => {
        if (finished || line === '') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // The wire is JSON lines; a malformed line cannot be attributed to any rule and is
          // dropped rather than fatal.
          return;
        }
        if (!isRecord(parsed)) return;
        const method = stringField(parsed, 'method');
        if (method !== undefined) {
          if ('id' in parsed) handleServerRequest(parsed['id'], method, parsed['params']);
          else handleNotification(method, parsed['params']);
          return;
        }
        const id = parsed['id'];
        if (typeof id !== 'number') return; // responses carry this client's numeric ids
        const entry = pending.get(id);
        if (entry === undefined) return; // unknown or already settled: ignored
        pending.delete(id);
        if (isRecord(parsed['error'])) {
          entry.reject(stringField(parsed['error'], 'message') ?? `error code ${String(parsed['error']['code'])}`);
          return;
        }
        entry.resolve(parsed['result']);
      };

      const pump = async (): Promise<void> => {
        try {
          for await (const chunk of stdout) {
            const text = remainder + decoder.write(chunk);
            const lines = text.split('\n');
            remainder = lines.pop() ?? '';
            for (const line of lines) handleLine(line.endsWith('\r') ? line.slice(0, -1) : line);
            if (finished) break;
          }
          // A last line without a trailing newline is still a line; the decoder may also hold a
          // multi-byte character cut across the final chunk boundary.
          const tail = remainder + decoder.end();
          remainder = '';
          if (tail !== '') handleLine(tail.endsWith('\r') ? tail.slice(0, -1) : tail);
          // The stream closed without a completed turn: the run has failed.
          failRun();
        } catch {
          if (!finished) {
            push({ type: 'error', at: clock.now(), class: 'crash', message: 'The agent stream ended unexpectedly.' });
            failRun();
          }
        }
      };
      void pump();

      // 'close' (not 'exit') settles the run: it fires only once the process has ended and the
      // stdio streams have drained, so buffered messages are never lost to a fast exit.
      let onClose: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        onClose = resolve;
      });
      child.on('close', () => {
        settlePending('the app-server process exited');
        failRun();
        onClose();
      });
      child.on('error', () => {
        settlePending('the app-server process could not be started');
        if (!finished) {
          push({ type: 'error', at: clock.now(), class: 'crash', message: 'The agent process could not be started.' });
          failRun();
        }
        // stop() may be waiting on the closed promise; an error that arrives after the run
        // settled must still release it, in case no close event follows.
        onClose();
      });

      const runHandshake = async (): Promise<void> => {
        try {
          await requestRpc('initialize', {
            clientInfo: CLIENT_INFO,
            capabilities: { experimentalApi: false, requestAttestation: false },
          });
          // Seed the account's quota before any turn runs. The read is not awaited — a server
          // that cannot or will not answer it must not delay or fail the prompt.
          void requestRpc('account/rateLimits/read')
            .then((response) => {
              const snapshot = isRecord(response) ? response['rateLimits'] : undefined;
              for (const event of rateLimitEvents(snapshot, clock.now(), 'polled')) push(event);
            })
            .catch(() => {
              // A failed quota read is silent by design; the run itself is unaffected.
            });
          const threadResponse =
            request.resume === undefined
              ? await requestRpc('thread/start', { cwd: request.cwd })
              : await requestRpc('thread/resume', { threadId: request.resume.sessionRef });
          const newThreadId = nestedString(threadResponse, 'thread', 'id');
          if (newThreadId === undefined) throw new Error('the thread response carried no thread id');
          threadId = newThreadId;
          push({ type: 'session_started', at: clock.now(), sessionRef: newThreadId });
          const turnResponse = await requestRpc('turn/start', { threadId, input: [textInput(request.prompt)] });
          const turnId = nestedString(turnResponse, 'turn', 'id');
          if (turnId !== undefined) activeTurnId = turnId;
        } catch (message) {
          if (finished) return;
          push({
            type: 'error',
            at: clock.now(),
            class: 'protocol',
            message: `The app-server session could not be opened: ${String(message)}`,
          });
          failRun();
        }
      };
      void runHandshake();

      const handle: RunHandle = {
        events: events.stream,
        answerPermission: (askId: string, decision: 'allow' | 'deny'): void => {
          const entry = pendingAsks.get(askId);
          if (entry === undefined) return; // unknown or already answered: ignored
          pendingAsks.delete(askId);
          sendResponse(entry.rawId, entry.ask.response(decision));
        },
        steer: (note: string): void => {
          // Steering rides the protocol's own turn/steer, which needs the live turn as its
          // precondition; without one there is nothing to attach the note to.
          if (threadId === undefined || activeTurnId === undefined || connectionClosed) return;
          void requestRpc('turn/steer', {
            threadId,
            input: [textInput(note)],
            expectedTurnId: activeTurnId,
          }).catch(() => {
            // The turn may end while the steer is in flight; the run's own events settle it.
          });
        },
        stop: async (): Promise<void> => {
          // Every open approval is answered deny: nothing is ever auto-approved, and killing the
          // process would otherwise leave the server blocked on an answer that never comes.
          for (const [askId, entry] of [...pendingAsks]) {
            pendingAsks.delete(askId);
            sendResponse(entry.rawId, entry.ask.response('deny'));
          }
          if (threadId !== undefined && activeTurnId !== undefined && !connectionClosed) {
            void requestRpc('turn/interrupt', { threadId, turnId: activeTurnId }).catch(() => {
              // Teardown races the reply; the kill below settles the connection either way.
            });
          }
          await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS));
          finishWith({ type: 'finished', at: clock.now(), reason: 'cancelled' });
          await closed;
        },
      };
      // The def's `stdin: 'prompt'` describes the CLI's one-shot contract; over this protocol
      // stdin belongs to JSON-RPC and stays open for the whole run (the prompt travels in
      // turn/start), so it is deliberately never written or ended here.
      return ok(handle);
    },
  };
}
