// The stream-json transport framework: line framing over the CLI's stdout, a per-provider
// dialect that maps parsed objects to AgentEvents, a raw fallback for every line that yields
// no event, and the exactly-one-finished invariant. Contract: docs/v2/providers.md →
// "stream-json transport (P-9, P-10)"; the dialect itself (P-11) is a plug-in, not part of
// this framework.
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { AgentTransport, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { AgentEvent, Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { createSystemClock } from '../../../system/index';
import type { ProviderDef } from '../../defs/index';
import { buildChildEnv, writeRunConfig, type RunCapability } from '../../launch/index';

export interface StreamDialect {
  readonly id: string;
  /** One parsed stdout object → its events. `null` = the dialect does not recognise the
   * object (the transport degrades the line to a raw event); `[]` = recognised but silent. */
  parse(line: unknown): readonly AgentEvent[] | null;
  /** CLIs whose stdin speaks NDJSON need the prompt wrapped in their input envelope; without
   * this the prompt is written as one bare text line (print-mode semantics). */
  readonly wrapInput?: (prompt: string) => string;
}

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

export function createStreamJsonTransport(def: ProviderDef, dialect: StreamDialect): AgentTransport {
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
        ...(request.effort === undefined ? {} : { effort: request.effort }),
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

      const finishWith = (event: AgentEvent): void => {
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
          mapped = dialect.parse(parsed);
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
        answerPermission: (): void => {
          // No line protocol carries answers back to the CLI; asks a dialect emits are
          // informational. A dialect that needs answering brings its own channel.
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
