// Gate command execution: exactly the configured environment, own process group, bounded output tail.
import { spawn } from 'node:child_process';
import type { CommandRunner } from '../../application/index';
import { redactSecrets } from './secret-patterns';

export interface CommandRunnerConfig {
  readonly env: Readonly<Record<string, string>>; // the base child environment (built by the composition root); per-call env is added on top
  readonly tailBytes?: number; // default 8192
}

/** Grace between the group SIGTERM and the group SIGKILL: time to flush and shut down cleanly. */
const KILL_GRACE_MS = 5_000;
const DEFAULT_TAIL_BYTES = 8_192;

/** UTF-8 sequence length for a lead byte, or 0 for a stray continuation / invalid byte. */
function leadByteLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1;
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 0;
}

/** Last maxBytes bytes decoded without splitting a UTF-8 sequence: bytes of a character cut in
 *  half are dropped rather than decoded into replacement junk. */
function tailText(all: Buffer, maxBytes: number): string {
  let start = Math.max(0, all.length - maxBytes);
  while (start < all.length) {
    const length = leadByteLength(all[start]);
    if (length === 0 || start + length > all.length) start += 1;
    else break;
  }
  return all.subarray(start).toString('utf8');
}

/** String.split/join instead of RegExp.escape-free replace: env values are plain text. */
function replaceAll(text: string, needle: string, replacement: string): string {
  return text.split(needle).join(replacement);
}

function redactEnvValues(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) {
    if (value.length >= 8) out = replaceAll(out, value, '[env]');
  }
  return out;
}

export function createCommandRunner(config: CommandRunnerConfig): CommandRunner {
  const tailBytes = config.tailBytes ?? DEFAULT_TAIL_BYTES;

  return {
    run(cwd, command, timeoutMs, callEnv) {
      return new Promise((resolve) => {
        const startedAt = Date.now();
        const isWindows = process.platform === 'win32';
        const file = isWindows ? 'cmd.exe' : '/bin/sh';
        const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];
        // The call's env is layered onto the base environment for this call only; on a name
        // clash the call's value wins. Neither process.env nor a previous call's env leaks in.
        const env = { ...config.env, ...callEnv };
        const envValues = [...Object.values(config.env), ...Object.values(callEnv ?? {})];
        // detached: the child leads its own process group, so a timeout can signal the whole
        // tree (a gate command may spawn children of its own) rather than only the shell.
        const child = spawn(file, args, {
          cwd,
          env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const chunks: Buffer[] = [];
        let settled = false;
        let timedOut = false;
        let spawnErrorCode: string | undefined;
        let closed = false;
        let killTimer: NodeJS.Timeout | undefined;
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          signalGroup('SIGTERM');
          killTimer = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
        }, timeoutMs);

        function signalGroup(signal: NodeJS.Signals): void {
          if (typeof child.pid !== 'number') return;
          try {
            if (isWindows) {
              // cmd.exe has no group signals; taskkill /T walks the process tree instead.
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            } else {
              process.kill(-child.pid, signal); // negative pid = the whole group
            }
          } catch {
            // the group may already be gone — nothing left to signal
          }
        }

        function settle(): void {
          if (!closed || settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (killTimer !== undefined) clearTimeout(killTimer);
          const durationMs = Math.max(0, Date.now() - startedAt);
          if (spawnErrorCode !== undefined) {
            resolve({ exitCode: 127, durationMs, outputTail: `spawn failed: ${spawnErrorCode}` });
            return;
          }
          const cleaned = redactSecrets(redactEnvValues(tailText(Buffer.concat(chunks), tailBytes), envValues));
          // sh killed by our group signal reports no numeric code — that is the timeout arm.
          const exitCode = timedOut || typeof closedCode !== 'number' ? 124 : closedCode;
          resolve({ exitCode, durationMs, outputTail: cleaned });
        }

        let closedCode: number | null = null;
        const onOutput = (chunk: Buffer): void => {
          chunks.push(chunk);
        };
        child.stdout.on('data', onOutput);
        child.stderr.on('data', onOutput);
        child.on('error', (error: NodeJS.ErrnoException) => {
          spawnErrorCode = error.code ?? 'unknown';
          settle();
        });
        child.on('close', (code) => {
          closed = true;
          closedCode = code;
          settle();
        });
      });
    },
  };
}
