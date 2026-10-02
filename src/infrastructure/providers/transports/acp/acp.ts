// The Agent Client Protocol transport: a JSON-RPC 2.0 client over the agent process's stdio,
// written from the public ACP specification (newline-delimited UTF-8 messages;
// initialize → session/new | session/load → session/prompt; session/update notifications;
// session/request_permission answered only by the user, or denied by stop()). Contract:
// docs/v2/providers.md → "ACP transport (P-15 … P-17)".
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { AgentTransport, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { AgentEvent, Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { createSystemClock } from '../../../system/index';
import { providerLevelOf, type ProviderDef } from '../../defs/index';
import { buildChildEnv, writeRunConfig, type RunCapability } from '../../launch/index';
import { ACP_INITIALIZE_PARAMS, ACP_PROTOCOL_VERSION } from './connection';
import { mapSessionUpdate, transcriptEntryOf, type TranscriptEntry } from './map-update';
import { buildResumePrompt } from './resume-summary';

const METHOD_NOT_FOUND = -32601;
const CRASH_MESSAGE = 'The agent session ended unexpectedly.';

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

type UnknownRecord = Readonly<Record<string, unknown>>;

const asRecord = (value: unknown): UnknownRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The values of a select config option: plain entries, or the entries a group wraps. */
const optionValues = (options: unknown): readonly string[] => {
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const raw of options) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const value = asString(entry.value);
    if (value !== undefined) values.push(value);
    else values.push(...optionValues(entry.options));
  }
  return values;
};

/** The id of the session's config option named by `target` (its reserved category, or its own id),
 *  when it offers `value`. A value the session does not offer is not sent: the agent would refuse
 *  it and the run keeps its default. */
const effortOptionId = (
  session: UnknownRecord | null,
  target: { readonly category?: string; readonly configId?: string },
  value: string,
): string | undefined => {
  const options = session === null ? undefined : session.configOptions;
  if (!Array.isArray(options)) return undefined;
  for (const raw of options) {
    const option = asRecord(raw);
    if (option === null) continue;
    const id = asString(option.id);
    const matches = target.configId !== undefined ? id === target.configId : option.category === target.category;
    if (!matches) continue;
    if (id !== undefined && optionValues(option.options).includes(value)) return id;
  }
  return undefined;
};

type RpcSettled =
  | { readonly kind: 'result'; readonly result: unknown }
  | { readonly kind: 'error'; readonly message: string };

interface PermissionOption {
  readonly optionId: string;
  readonly kind: string;
}

interface PendingAsk {
  readonly rpcId: number;
  readonly options: readonly PermissionOption[];
}

/** Maps a stop reason to the run's finish reason; refusal and unknown reasons did not succeed. */
const finishReasonOf = (stopReason: unknown): Extract<AgentEvent, { readonly type: 'finished' }>['reason'] => {
  switch (stopReason) {
    case 'end_turn':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'max_tokens':
    case 'max_turn_requests':
      return 'limit';
    default:
      return 'failed';
  }
};

/** The option the user's binary decision maps onto, if the agent offered one. */
const pickOptionId = (options: readonly PermissionOption[], decision: 'allow' | 'deny'): string | undefined => {
  const prefix = decision === 'allow' ? 'allow' : 'reject';
  const match = options.find((option) => option.kind.startsWith(prefix));
  return match === undefined ? undefined : match.optionId;
};

export function createAcpTransport(def: ProviderDef): AgentTransport {
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
        if (capability.kind === 'context') continue; // context reaches the agent through the prompt, not session files
        if (capability.kind === 'mcp') {
          const env: Record<string, string> = {};
          for (const [name, value] of Object.entries(capability.env)) {
            if ('literal' in value) {
              env[name] = value.literal;
              continue;
            }
            // This transport's fixed signature carries no vault; a secret reference it cannot
            // resolve must fail the run instead of travelling unresolved into session files.
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
        ...(request.effort === undefined ? {} : { effort: request.effort }),
        ...(request.route.model === undefined ? {} : { model: request.route.model }),
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
      // Drained and discarded: stderr is agent logging and may quote environment values.
      stderr.resume();
      // Writing to a dead agent's stdin (a late answer, a concurrent stop) must not crash the client.
      stdin.on('error', (): void => {});

      const events = createChannel<AgentEvent>();
      const pendingRequests = new Map<number, (settled: RpcSettled) => void>();
      const pendingAsks = new Map<string, PendingAsk>();
      const transcript: TranscriptEntry[] = [];
      const decoder = new StringDecoder('utf8');
      let remainder = '';
      let finished = false;
      let nextRequestId = 0;
      let askCount = 0;
      let establishedSessionId: string | undefined;

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

      const finishWith = (event: Extract<AgentEvent, { readonly type: 'finished' }>): void => {
        if (finished) return;
        finished = true;
        events.push(event);
        events.close();
        // The run is over for the consumer; no process of the group may outlive it.
        killGroup();
      };

      const failRun = (): void => {
        finishWith({ type: 'finished', at: clock.now(), reason: 'failed' });
      };

      const failPending = (message: string): void => {
        // A dead agent never answers; unblock the handshake so the run can settle.
        for (const settle of pendingRequests.values()) settle({ kind: 'error', message });
        pendingRequests.clear();
      };

      const writeMessage = (message: unknown): void => {
        if (stdin.writableEnded || finished) return;
        stdin.write(`${JSON.stringify(message)}\n`);
      };

      const requestRpc = (method: string, params: unknown): Promise<RpcSettled> => {
        nextRequestId += 1;
        const id = nextRequestId;
        return new Promise((resolve) => {
          pendingRequests.set(id, resolve);
          writeMessage({ jsonrpc: '2.0', id, method, params });
        });
      };

      const settleResponse = (id: number, message: UnknownRecord): void => {
        const settle = pendingRequests.get(id);
        if (settle === undefined) return; // unknown or already settled (e.g. after stop)
        pendingRequests.delete(id);
        if ('error' in message) {
          // The agent's own error text is not relayed: it may quote environment values. The
          // numeric code carries the diagnosis without the payload.
          const error = asRecord(message.error);
          const code = error === null ? undefined : error.code;
          settle({ kind: 'error', message: `the agent answered with an RPC error${typeof code === 'number' ? ` (code ${code})` : ''}` });
          return;
        }
        settle({ kind: 'result', result: message.result });
      };

      const handlePermissionRequest = (id: number, params: unknown): void => {
        const record = asRecord(params);
        const toolCall = record === null ? null : asRecord(record.toolCall);
        const options: PermissionOption[] = [];
        if (record !== null && Array.isArray(record.options)) {
          for (const raw of record.options) {
            const option = asRecord(raw);
            if (option === null) continue;
            const optionId = asString(option.optionId);
            if (optionId === undefined) continue;
            options.push({ optionId, kind: asString(option.kind) ?? 'other' });
          }
        }
        const locations = toolCall === null ? [] : Array.isArray(toolCall.locations) ? toolCall.locations : [];
        const location = locations.length > 0 ? asRecord(locations[0]) : null;
        const target = location === null ? undefined : asString(location.path);
        askCount += 1;
        const askId = `ask-${askCount}`;
        pendingAsks.set(askId, { rpcId: id, options });
        events.push({
          type: 'permission_ask',
          at: clock.now(),
          id: askId,
          tool:
            (toolCall === null ? undefined : asString(toolCall.name)) ??
            (toolCall === null ? undefined : asString(toolCall.title)) ??
            (toolCall === null ? undefined : asString(toolCall.toolCallId)) ??
            'tool',
          ...(target === undefined ? {} : { target }),
          options: options.map((option) => option.optionId),
        });
      };

      const handleAgentRequest = (id: number, method: string, params: unknown): void => {
        if (method === 'session/request_permission') {
          handlePermissionRequest(id, params);
          return;
        }
        // The protocol lets the agent call further client methods (filesystem, terminals,
        // elicitation); this client advertises none of them, so the honest answer is
        // method-not-found — the agent is never left waiting, and unknown requests are not fatal.
        writeMessage({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `method "${method}" is not available` } });
      };

      const handleUpdate = (params: unknown): void => {
        const record = asRecord(params);
        if (record === null) return;
        const sessionId = asString(record.sessionId);
        // During session/load the replay streams before the session id is established; afterwards
        // only our own session's updates matter (an agent may host several).
        if (establishedSessionId !== undefined && sessionId !== establishedSessionId) return;
        const entry = transcriptEntryOf(record.update);
        if (entry !== null) transcript.push(entry);
        let mapped: readonly AgentEvent[] | null;
        try {
          mapped = mapSessionUpdate(record.update, clock.now());
        } catch {
          // A mapper bug must never throw into the event stream; the update degrades to raw.
          mapped = null;
        }
        if (mapped === null) {
          events.push({ type: 'raw', at: clock.now(), line: JSON.stringify(record.update) });
          return;
        }
        for (const event of mapped) {
          if (finished) break;
          events.push(event);
        }
      };

      const handleLine = (line: string): void => {
        if (finished || line === '') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          events.push({ type: 'raw', at: clock.now(), line });
          return;
        }
        const message = asRecord(parsed);
        if (message === null) {
          events.push({ type: 'raw', at: clock.now(), line });
          return;
        }
        const method = asString(message.method);
        if (typeof message.id === 'number' && method !== undefined) {
          handleAgentRequest(message.id, method, message.params);
          return;
        }
        if (method !== undefined) {
          if (method === 'session/update') handleUpdate(message.params);
          return; // any other notification is ignored, never fatal
        }
        if (typeof message.id === 'number') {
          settleResponse(message.id, message);
          return;
        }
        // Anything else is not a JSON-RPC message; it is ignored rather than failing the run.
      };

      // 'close' (not 'exit') settles the run: it fires only once the process has ended and the
      // stdio streams have drained, so a prompt response sent just before exit is never lost.
      let onClose = (): void => {};
      const closed = new Promise<void>((resolve) => {
        onClose = resolve;
      });
      child.on('close', () => {
        failRun();
        failPending('the agent exited before answering');
        onClose();
      });
      child.on('error', () => {
        if (!finished) {
          events.push({ type: 'error', at: clock.now(), class: 'crash', message: 'The agent process could not be started.' });
          failRun();
        }
        failPending('the agent process could not be started');
        // stop() may be waiting on the closed promise; an error that arrives after the run
        // settled must still release it, in case no close event follows.
        onClose();
      });

      const stdoutPump = async (): Promise<void> => {
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
        } catch {
          // A torn stream surfaces through the close handler's finished event.
        }
      };
      void stdoutPump();

      const protocolFail = (message: string): void => {
        events.push({ type: 'error', at: clock.now(), class: 'protocol', message });
        failRun();
      };

      const handshake = async (): Promise<void> => {
        const initialised = await requestRpc('initialize', ACP_INITIALIZE_PARAMS);
        if (initialised.kind === 'error') {
          protocolFail('The agent did not complete the Agent Client Protocol handshake.');
          return;
        }
        const agentResult = asRecord(initialised.result);
        const version = agentResult === null ? undefined : agentResult.protocolVersion;
        if (version !== ACP_PROTOCOL_VERSION) {
          protocolFail('The agent speaks a different Agent Client Protocol version.');
          return;
        }
        const capabilities = agentResult === null ? null : asRecord(agentResult.agentCapabilities);
        const loadSupported = capabilities !== null && capabilities.loadSession === true;

        // The run-scoped MCP servers ride inside the session request, exactly as the launch
        // module's files hold them; the config-dir mechanism (env or flag) rides on the process.
        const mcpServers = Object.entries(runConfig.mcpServers).map(([name, server]) => ({
          name,
          command: server.command,
          args: [...server.args],
          env: Object.entries(server.env).map(([key, value]) => ({ name: key, value })),
        }));

        let sessionId: string | undefined;
        let resumeFellBack = false;
        if (request.resume !== undefined && loadSupported) {
          const loaded = await requestRpc('session/load', {
            sessionId: request.resume.sessionRef,
            cwd: request.cwd,
            mcpServers,
          });
          if (loaded.kind === 'result') {
            sessionId = request.resume.sessionRef;
          } else {
            resumeFellBack = true;
          }
        } else if (request.resume !== undefined) {
          // The protocol forbids session/load against an agent that does not advertise it.
          resumeFellBack = true;
        }
        if (sessionId === undefined) {
          const created = await requestRpc('session/new', { cwd: request.cwd, mcpServers });
          if (created.kind === 'error') {
            protocolFail('The agent refused to create a session.');
            return;
          }
          const createdSession = asRecord(created.result);
          const createdId = createdSession === null ? undefined : asString(createdSession.sessionId);
          if (createdId === undefined) {
            protocolFail('The agent created a session without a session id.');
            return;
          }
          sessionId = createdId;
          const effortValue = providerLevelOf(def.levelNames, request.effort);
          if (def.effortArg?.kind === 'session-option' && effortValue !== undefined) {
            const configId = effortOptionId(createdSession, def.effortArg, effortValue);
            // A refused effort leaves the session on its own default; it never fails the run.
            if (configId !== undefined) {
              await requestRpc('session/set_config_option', { sessionId, configId, value: effortValue });
            }
          }
        }
        establishedSessionId = sessionId;
        events.push({ type: 'session_started', at: clock.now(), sessionRef: sessionId });
        const promptText = resumeFellBack ? buildResumePrompt(request.prompt, transcript) : request.prompt;
        const turn = await requestRpc('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: promptText }],
        });
        if (turn.kind === 'error') {
          protocolFail('The agent refused the prompt turn.');
          return;
        }
        const turnResult = asRecord(turn.result);
        finishWith({
          type: 'finished',
          at: clock.now(),
          reason: finishReasonOf(turnResult === null ? undefined : turnResult.stopReason),
        });
      };

      const runHandshake = async (): Promise<void> => {
        try {
          await handshake();
        } catch {
          if (!finished) {
            events.push({ type: 'error', at: clock.now(), class: 'crash', message: CRASH_MESSAGE });
            failRun();
          }
        }
      };
      void runHandshake();

      const handle: RunHandle = {
        events: events.stream,
        answerPermission: (askId: string, decision: 'allow' | 'deny'): void => {
          const entry = pendingAsks.get(askId);
          if (entry === undefined) return; // unknown or already answered: ignored
          pendingAsks.delete(askId);
          const optionId = pickOptionId(entry.options, decision);
          // A decision the agent offered no option for (e.g. allow with only reject options) is
          // answered with the cancelled outcome — never an approval the user did not make.
          writeMessage({
            jsonrpc: '2.0',
            id: entry.rpcId,
            result: {
              outcome:
                optionId === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId },
            },
          });
        },
        steer: (): void => {
          // The protocol has no mid-turn injection: a second session/prompt is legal only after
          // the current turn responds, so a steering note has no channel — dropped, never queued.
        },
        stop: async (): Promise<void> => {
          // The only automated permission answer is this deny, in the protocol's cancelled form.
          for (const [askId, entry] of [...pendingAsks]) {
            pendingAsks.delete(askId);
            writeMessage({ jsonrpc: '2.0', id: entry.rpcId, result: { outcome: { outcome: 'cancelled' } } });
          }
          if (establishedSessionId !== undefined) {
            writeMessage({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: establishedSessionId } });
          }
          finishWith({ type: 'finished', at: clock.now(), reason: 'cancelled' });
          await closed;
        },
      };
      return ok(handle);
    },
  };
}
