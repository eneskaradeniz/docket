// AgentTransport over the vendor SDK: injected query keeps tests free of a real agent CLI.
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, McpServerConfig, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  AccountRepo,
  AgentTransport,
  Clock,
  RunHandle,
  RunRequest,
  SecretVault,
  TransportError,
} from '../../../../application/index';
import type { AgentEvent, CostKind, Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { mapSdkMessage, toolTarget } from './map-message';

export type QueryFn = typeof sdkQuery;

export interface SdkTransportConfig {
  readonly clock: Clock;
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // allowlisted environment from the composition root
  readonly query?: QueryFn; // default: the SDK's query
  readonly executablePath?: string; // from discovery (Phase 3); SDK default when absent
}

/** Credential variables never pass through from the allowlist; the vault is their only source. */
const CREDENTIAL_ENV_KEYS: readonly string[] = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

const DENIED_BY_OPERATOR = 'Denied by the operator';
// The vendor's crash text is not relayed into events: it may quote environment values or secrets.
const CRASH_MESSAGE = 'The agent session crashed.';

type FinishReason = 'completed' | 'failed' | 'cancelled';

/** Single-consumer push channel: pumps events and prompt messages between await points. */
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
      // The iterable itself (not a bare iterator) is what the SDK's streaming input expects.
      [Symbol.asyncIterator]: (): AsyncIterator<T> => iterator,
    },
  };
}

export function createSdkTransport(config: SdkTransportConfig): AgentTransport {
  const runQuery = config.query ?? sdkQuery;

  return {
    start: async (request: RunRequest): Promise<Result<RunHandle, TransportError>> => {
      const account = await config.accounts.get(request.route.accountId);
      if (account === undefined) {
        return err({ code: 'unsupported', message: `no account ${request.route.accountId} for this transport` });
      }

      // Environment: the allowlist minus credential variables; the vault is the only key source.
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(config.baseEnv)) {
        if (CREDENTIAL_ENV_KEYS.includes(name)) continue;
        env[name] = value;
      }

      let costKind: CostKind;
      if (account.authMode === 'api_key') {
        const secretRef = account.secretRef;
        const apiKey = secretRef === undefined ? undefined : await config.secrets.get(secretRef);
        if (apiKey === undefined) {
          return err({ code: 'not_logged_in', message: 'the account has no api key in the vault' });
        }
        env.ANTHROPIC_API_KEY = apiKey;
        costKind = 'reported';
      } else if (account.authMode === 'subscription') {
        costKind = 'equivalent';
      } else {
        return err({ code: 'unsupported', message: `auth mode ${account.authMode} is not supported by this transport` });
      }

      const mcpServers: Record<string, McpServerConfig> = {};
      for (const capability of request.capabilities) {
        if (capability.kind !== 'mcp') continue;
        const serverEnv: Record<string, string> = {};
        for (const [name, value] of Object.entries(capability.env)) {
          if ('literal' in value) {
            serverEnv[name] = value.literal;
            continue;
          }
          const secret = await config.secrets.get(value.secretRef);
          if (secret === undefined) {
            return err({
              code: 'not_logged_in',
              message: `capability ${capability.id} has an unresolvable secret reference`,
            });
          }
          serverEnv[name] = secret;
        }
        mcpServers[capability.id] = { command: capability.command, args: [...capability.args], env: serverEnv };
      }

      const abortController = new AbortController();
      const prompt = createChannel<SDKUserMessage>();
      const events = createChannel<AgentEvent>();
      const pendingAsks = new Map<string, (decision: 'allow' | 'deny') => void>();
      let finished = false;
      let askCount = 0;

      const closeRun = (): void => {
        events.close();
        prompt.close();
        // A finish settles every still-open ask so the SDK callback never dangles.
        for (const settle of pendingAsks.values()) settle('deny');
        pendingAsks.clear();
      };

      const finishRun = (reason: FinishReason): void => {
        if (finished) return;
        finished = true;
        events.push({ type: 'finished', at: config.clock.now(), reason });
        closeRun();
      };

      const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
        askCount += 1;
        const askId = `ask-${askCount}`;
        const target = toolTarget(input);
        events.push({
          type: 'permission_ask',
          at: config.clock.now(),
          id: askId,
          tool: toolName,
          ...(target === undefined ? {} : { target }),
          options: ['allow', 'deny'],
        });
        const decision = await new Promise<'allow' | 'deny'>((resolve) => {
          const settle = (settled: 'allow' | 'deny'): void => {
            signal.removeEventListener('abort', onAbort);
            resolve(settled);
          };
          const onAbort = (): void => settle('deny');
          signal.addEventListener('abort', onAbort, { once: true });
          pendingAsks.set(askId, settle);
        });
        pendingAsks.delete(askId);
        return decision === 'allow'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: DENIED_BY_OPERATOR };
      };

      const options: Options = {
        cwd: request.cwd,
        model: request.route.model,
        resume: request.resume?.sessionRef,
        settingSources: [], // the user's own settings files are never read or written
        systemPrompt: { type: 'preset', preset: 'claude_code', append: request.role.instructions },
        mcpServers,
        env,
        abortController,
        canUseTool,
        pathToClaudeCodeExecutable: config.executablePath,
      };

      const pump = async (): Promise<void> => {
        try {
          const session = runQuery({ prompt: prompt.stream, options });
          for await (const message of session) {
            if (finished) break;
            for (const event of mapSdkMessage(message, config.clock.now(), { costKind })) {
              if (finished) break;
              if (event.type === 'finished') {
                finished = true;
                events.push(event);
                closeRun();
                continue;
              }
              events.push(event);
            }
          }
          // A stream that ends without a result message still has to end with exactly one finished.
          finishRun('failed');
        } catch {
          // An abort from stop() already emitted its own finished; anything else is a crash.
          if (!finished) {
            events.push({ type: 'error', at: config.clock.now(), class: 'crash', message: CRASH_MESSAGE });
            finishRun('failed');
          }
        }
      };

      prompt.push({
        type: 'user',
        message: { role: 'user', content: request.prompt },
        parent_tool_use_id: null,
      });
      void pump();

      const handle: RunHandle = {
        events: events.stream,
        answerPermission: (askId: string, decision: 'allow' | 'deny'): void => {
          const settle = pendingAsks.get(askId);
          if (settle === undefined) return; // unknown or already answered: ignored
          pendingAsks.delete(askId);
          settle(decision);
        },
        steer: (note: string): void => {
          prompt.push({
            type: 'user',
            message: { role: 'user', content: note },
            parent_tool_use_id: null,
          });
        },
        stop: async (): Promise<void> => {
          abortController.abort();
          finishRun('cancelled');
        },
      };
      return ok(handle);
    },
  };
}
