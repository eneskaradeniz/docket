// The stream-json transport framework: line framing over the CLI's stdout, a per-provider
// dialect that maps parsed objects to AgentEvents, a raw fallback for every line that yields
// no event, and the exactly-one-finished invariant. Contract: docs/v2/providers.md →
// "stream-json transport (P-9, P-10)"; the dialect itself (P-11) is a plug-in, not part of
// this framework.
import { accessSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AgentTransport, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { AccountId, AgentEvent, CostKind, Result, RunId } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { createSystemClock, registeredSpawn } from '../../../system/index';
import { homeRootEnvOf, type ProviderDef } from '../../defs/index';
import { buildChildEnv, writeRunConfig, type RunAccountHome, type RunCapability, type RunMcpServer } from '../../launch/index';
import { prepareAgyDelivery, type AgyDeliveryCapability } from './agy-delivery';

/** Per-run context handed to every parse call (G4): the route's cost kind, resolved once per
 *  run the same way the SDK mapper resolves its own context. */
export interface DialectContext {
  readonly costKind: CostKind;
}

export interface StreamDialect {
  readonly id: string;
  /** One parsed stdout object → its events. `null` = the dialect does not recognise the
   * object (the transport degrades the line to a raw event); `[]` = recognised but silent. */
  parse(line: unknown, context: DialectContext): readonly AgentEvent[] | null;
  /** CLIs whose stdin speaks NDJSON need the prompt wrapped in their input envelope; without
   * this the prompt is written as one bare text line (print-mode semantics). */
  readonly wrapInput?: (prompt: string) => string;
}

/** One permission ask as the bridge delivers it (P-63): the Docket tool name the ask child already
 *  mapped — no second mapping happens here — its one identifying string when the mapping has one,
 *  and the CLI's conversation id. */
export interface AgyAskRequest {
  readonly tool: string;
  readonly target?: string;
  readonly conversationId?: string;
}

/** The app-side permission channel of one agy run (P-63). The mcp module owns the implementation;
 *  the providers module spells the shape itself because the infrastructure module map allows it no
 *  mcp import, and the composition root passes the real bridge through the factory config — the
 *  type check at that call site is what pins the two spellings together. */
export interface AgyAskBridge {
  register(runId: RunId, waiter: (ask: AgyAskRequest) => Promise<'allow' | 'deny'>): void;
  unregister(runId: RunId): void;
}

/** The built-in capability that carries a run's Docket token in its env (the mcp-attach spelling). */
const DOCKET_PAGES_ID = 'docket-pages';

/** Whether the run holds a Docket RUN token: the docket-pages capability with a non-empty token of
 *  the run kind (P-63). The listener stays the authority — it resolves the token itself — this
 *  check only decides whether the transport offers a waiter at all; a chat turn registers nothing. */
const holdsDocketRunToken = (capabilities: readonly RunCapability[]): boolean =>
  capabilities.some(
    (capability) =>
      capability.kind === 'mcp' &&
      capability.id === DOCKET_PAGES_ID &&
      capability.env['DOCKET_MCP_TOKEN'] !== '' &&
      capability.env['DOCKET_MCP_KIND'] === 'run',
  );

/** The machine's ~/.gitconfig when it exists — the one non-secret ambient file a redirected home
 * passes across (P-67), so the agent's commits keep their identity; undefined when the machine
 * has none, and nothing is ever symlinked or copied beside it. */
const gitconfigOf = (machineHome: string | undefined): string | undefined => {
  if (machineHome === undefined) return undefined;
  const path = join(machineHome, '.gitconfig');
  return existsSync(path) ? path : undefined;
};

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

export function createStreamJsonTransport(
  def: ProviderDef,
  dialect: StreamDialect,
  agyAskBridge?: AgyAskBridge,
  costKindOf?: (accountId: AccountId) => Promise<CostKind>,
  identityDirOf?: (accountId: AccountId) => Promise<string | undefined>,
): AgentTransport {
  const clock = createSystemClock();
  // A transport built without a resolver is test wiring; the production factory always injects
  // the registry resolver. The fallback is the subscription branch default — every stream-json
  // CLI in the launch set rides a subscription login, matching the SDK route environment's
  // fallback for an account no route kind covers.
  const resolveCostKind = costKindOf ?? (async () => 'equivalent' as const);

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
      // The route's cost kind is run-scoped (G4): resolved once here, before the first line can
      // arrive, and handed to every dialect parse call.
      const dialectContext: DialectContext = { costKind: await resolveCostKind(request.route.accountId) };

      // agy is the one stream-json CLI with a run-scoped delivery surface (P-62): its capabilities
      // ride a .agents tree under the run's config directory, not only the generic config files.
      const agyTree: AgyDeliveryCapability[] = [];
      const runCapabilities: RunCapability[] = [];
      for (const capability of request.capabilities) {
        if (capability.kind === 'command') continue; // rendered as instruction text upstream (R-141)
        if (capability.kind === 'context') {
          // agy reads run-scoped rule files (P-62); for every other stream-json CLI context
          // reaches the agent through the prompt, not launch files.
          if (def.id === 'agy') agyTree.push(capability);
          continue;
        }
        if (capability.kind === 'plugin') {
          // Bundles are unpacked upstream (R-140); agy loads a path bundle from its .agents tree
          // (P-62) — a marketplace source is already omitted in translation (R-149).
          if (def.id === 'agy' && capability.source.kind === 'path') {
            agyTree.push({
              kind: 'plugin',
              id: capability.id,
              name: capability.name,
              path: capability.source.path,
            });
          }
          continue;
        }
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
          const resolved: RunMcpServer = {
            kind: 'mcp',
            id: capability.id,
            name: capability.name,
            command: capability.command,
            args: [...capability.args],
            env,
          };
          runCapabilities.push(resolved);
          if (def.id === 'agy') agyTree.push(resolved);
          continue;
        }
        runCapabilities.push({ ...capability });
        if (def.id === 'agy') agyTree.push({ ...capability });
      }

      // P-67: a home-rooted CLI of an account with an identity directory runs with that
      // directory as its HOME. The machine home is read from the allowlisted environment first —
      // it names the gitconfig the redirect would hide — and the run config writer then points
      // HOME at the account's directory, never at a run directory.
      const parentEnv: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined) parentEnv[name] = value;
      }
      const machineEnv = buildChildEnv(def.id, parentEnv, {});
      const identityDir = homeRootEnvOf(def) === undefined ? undefined : await identityDirOf?.(request.route.accountId);
      const machineGitconfig = identityDir === undefined ? undefined : gitconfigOf(machineEnv.HOME);
      const accountHome: RunAccountHome | undefined =
        identityDir === undefined
          ? undefined
          : { identityDir, ...(machineGitconfig === undefined ? {} : { machineGitconfig }) };
      const runConfig = await writeRunConfig(request.runDir, def, runCapabilities, accountHome);
      if (def.id === 'agy') {
        // Same guard as the SDK delivery: a capability the measured surface cannot carry is a
        // typed start error, never a crash mid-launch.
        try {
          await prepareAgyDelivery(runConfig.configDir, agyTree);
        } catch {
          return err({ code: 'unsupported', message: 'agy capability delivery failed' });
        }
      }
      const launch = def.buildLaunch({
        prompt: request.prompt,
        configDir: runConfig.configDir,
        ...(request.resume === undefined ? {} : { resume: request.resume }),
        ...(request.effort === undefined ? {} : { effort: request.effort }),
        ...(request.route.model === undefined ? {} : { model: request.route.model }),
      });

      // The ambient environment reaches the child only through the launch allowlist; the def's
      // own launch environment (the run-scoped config mechanism) rides on top of it.
      const env = { ...machineEnv, ...runConfig.env, ...launch.env };

      // The registry's graceful stop lands here once the finish path below exists: a managed quit
      // ends this run `cancelled` through the same event the handle's own stop() pushes.
      let stopRun: () => void = () => undefined;
      const child = registeredSpawn(
        bin,
        [...launch.args, ...runConfig.args],
        {
          cwd: request.cwd,
          env,
          // Own process group on POSIX, so a stop can address the whole tree with one signal.
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
        { kind: 'agent', label: `${def.id} run ${request.runId}`, stop: () => stopRun() },
      );
      if (child.stdout === null || child.stdin === null || child.stderr === null) {
        child.kill();
        return err({ code: 'spawn_failed', message: `provider ${def.id} could not be started with pipes` });
      }
      const stdout = child.stdout;
      const stderr = child.stderr;
      // Drained and discarded: stderr may quote environment values and never enters records.
      stderr.resume();

      const events = createChannel<AgentEvent>();
      const decoder = new StringDecoder('utf8');
      let remainder = '';
      let finished = false;

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

      // P-63: the run's permission channel. Only agy carries one, and only while the run holds a
      // Docket run token: the bridge then keeps this run's waiter, an agy_permission_ask over
      // mcp.sock becomes a permission_ask on this stream, and nothing but handle.answerPermission —
      // the executor's existing decision path — settles it. Registration happens after the only
      // start failure that follows it, so a dead start leaves no waiter behind.
      let settleAsk: ((askId: string, decision: 'allow' | 'deny') => void) | undefined;
      let closeAskChannel: (() => void) | undefined;
      if (agyAskBridge !== undefined && def.id === 'agy' && holdsDocketRunToken(runCapabilities)) {
        const asks = new Map<string, (decision: 'allow' | 'deny') => void>();
        let askCount = 0;
        settleAsk = (askId, decision) => {
          const settle = asks.get(askId);
          if (settle === undefined) return; // unknown or already answered: ignored
          asks.delete(askId);
          settle(decision);
        };
        agyAskBridge.register(request.runId, async (ask) => {
          askCount += 1;
          const askId = `ask-${askCount}`;
          events.push({
            type: 'permission_ask',
            at: clock.now(),
            id: askId,
            tool: ask.tool,
            ...(ask.target === undefined ? {} : { target: ask.target }),
            options: ['allow', 'deny'],
          });
          const decision = await new Promise<'allow' | 'deny'>((resolve) => asks.set(askId, resolve));
          asks.delete(askId);
          return decision;
        });
        closeAskChannel = () => {
          // Every end path answers the still-open asks deny — a dying run never leaves a hook child
          // waiting on a decision nothing will make — and the bridge forgets the run, so a late ask
          // meets the fail-closed no-channel answer.
          for (const settle of asks.values()) settle('deny');
          asks.clear();
          agyAskBridge.unregister(request.runId);
        };
      }

      const finishWith = (event: AgentEvent): void => {
        if (finished) return;
        finished = true;
        closeAskChannel?.();
        closeAskChannel = undefined;
        events.push(event);
        events.close();
        // The run is over for the consumer; no process of the group may outlive it.
        killGroup();
      };
      stopRun = (): void => {
        finishWith({ type: 'finished', at: clock.now(), reason: 'cancelled' });
      };

      const failRun = (): void => {
        finishWith({ type: 'finished', at: clock.now(), reason: 'failed' });
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
        let mapped: readonly AgentEvent[] | null;
        try {
          mapped = dialect.parse(parsed, dialectContext);
        } catch {
          // A dialect bug must never throw into the event stream; the line degrades to raw.
          mapped = null;
        }
        if (mapped === null) {
          events.push({ type: 'raw', at: clock.now(), line });
          return;
        }
        for (const event of mapped) {
          if (finished) break;
          if (event.type === 'finished') {
            finishWith(event);
            continue;
          }
          events.push(event);
        }
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
          // A last line without a trailing newline is still a line; the decoder may also hold
          // a multi-byte character cut across the final chunk boundary.
          const tail = remainder + decoder.end();
          remainder = '';
          if (tail !== '') handleLine(tail.endsWith('\r') ? tail.slice(0, -1) : tail);
          // The stream closed without a dialect finished: the run has failed.
          failRun();
        } catch {
          if (!finished) {
            events.push({ type: 'error', at: clock.now(), class: 'crash', message: 'The agent stream ended unexpectedly.' });
            failRun();
          }
        }
      };
      void pump();

      // 'close' (not 'exit') settles the run: it fires only once the process has ended and the
      // stdio streams have drained, so buffered lines — including a dialect finished — are
      // never lost to a fast exit.
      let onClose: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        onClose = resolve;
      });
      child.on('close', () => {
        failRun();
        onClose();
      });
      child.on('error', () => {
        if (!finished) {
          events.push({ type: 'error', at: clock.now(), class: 'crash', message: 'The agent process could not be started.' });
          failRun();
        }
        // stop() may be waiting on the closed promise; an error that arrives after the run
        // settled must still release it, in case no close event follows.
        onClose();
      });

      const stdin = child.stdin;
      if (launch.stdin === 'prompt') {
        const payload =
          dialect.wrapInput === undefined ? request.prompt : dialect.wrapInput(request.prompt);
        stdin.write(payload.endsWith('\n') ? payload : `${payload}\n`);
      }
      // One-shot prompt protocol: the CLI reads stdin to EOF, so EOF must arrive right away.
      stdin.end();

      const handle: RunHandle = {
        events: events.stream,
        answerPermission: (askId: string, decision: 'allow' | 'deny'): void => {
          // The agy bridge is the one ask channel this transport kind answers (P-63); without it
          // asks a dialect emits stay informational, exactly as before.
          settleAsk?.(askId, decision);
        },
        steer: (note: string): void => {
          if (stdin.writableEnded) return; // the one-shot prompt closed stdin; the note is dropped
          stdin.write(`${note}\n`);
        },
        stop: async (): Promise<void> => {
          finishWith({ type: 'finished', at: clock.now(), reason: 'cancelled' });
          await closed;
        },
      };
      return ok(handle);
    },
  };
}
