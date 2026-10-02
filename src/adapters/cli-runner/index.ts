// src/adapters/cli-runner — the GENERIC CLI-spawn adapter (WO-0105 / Faz B, ADR-0014's
// addendum). Implements the `SessionRunner` port over any vendor's machine-readable NDJSON
// stream, parametrized by a `CliRunnerDef` — the second vendor path ADR-0014 names ("the CLI's
// stream-json mode"), written once: every subsequent vendor is a definition file, not a new
// adapter (one spawn call site, N definitions).
//
// Engine-owned, vendor-blind: spawn + stdin prompt + line-split stdout + signal/exit handling.
// Honesty rules carried over from the SDK adapter:
// - an interrupt-requested exit closes CALM (`interrupted`, WO-0039 — never the fail card);
// - a clean exit with no terminal event is an ERROR (the honest "stream ended without a
//   result"), never a fabricated turn_complete (WO-0026/TD-030);
// - the plan fallback: a plan drive whose stream ends with a result and no plan_ready emits
//   plan_ready before turn_complete (the SDK adapter's exact fallback, engine-level);
// - events lacking `at` are receive-stamped (WO-0046's liveness anchor).
//
// Port honesty: a CLI exec has no permission callback — `decide`/`pendingAsks` are absent (the
// port's optionals), the def's per-role sandbox arguments are the fence-equivalent (each
// vendor's probe documents the residual surface before wiring — Faz C's gate), and there is no
// mid-turn input channel — steering is absent (the port's optional-implementers clause).
import { spawn, type ChildProcess } from 'node:child_process';
import { isPlanDrive } from '../../core/runner';
import type { DriveInput, RunnerEvent, SessionRunner } from '../../core/runner';
import type { ProviderStatus } from '../../core/app-settings';
import type { CliParseState, CliRunnerDef } from './def';
import { candidatesOf } from './def';

// WO-0107: discovery lives beside the defs (same vendor vocabulary home); re-exported so the
// composition root imports the adapter surface from ONE place.
export { detectVendors } from './discover';
export type { VendorDetection } from './discover';
export type { CliRunnerDef } from './def';

// The push-queue shape the SDK adapter uses (src/adapters/runner): lets the exit path push
// events into the drive() stream. Local copy — adapters do not import each other's internals.
class AsyncQueue<T> {
  private buf: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  push(v: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.buf.push(v);
  }
  next(): Promise<IteratorResult<T>> {
    if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
    return new Promise((res) => this.waiters.push(res));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined as unknown as T, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

/** One parsed event batch → receive-stamped (events whose `at` is unset get the adapter's now —
 *  WO-0046's liveness anchor; a def's parser may stamp its own, this only fills gaps). */
function stampAt(events: RunnerEvent[]): RunnerEvent[] {
  const at = new Date().toISOString();
  return events.map((e) => (('at' in e && (e as { at?: string }).at === undefined) ? ({ ...e, at } as RunnerEvent) : e));
}

export interface CliRunnerOptions {
  /** Host-injected env layered UNDER the profile env (the SDK adapter's RunnerOptions shape). */
  env?: Record<string, string>;
}

export function createCliRunner(def: CliRunnerDef, runnerOpts: CliRunnerOptions = {}): SessionRunner {
  let child: ChildProcess | undefined;
  let interruptRequested = false;

  async function runDrive(input: DriveInput, queue: AsyncQueue<RunnerEvent>): Promise<void> {
    const cwd = input.cwd ?? process.cwd();
    const state: CliParseState = {};
    const spawnInput = {
      role: input.role,
      mode: input.mode,
      prompt: input.prompt,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.resume !== undefined ? { resume: input.resume } : {}),
      cwd,
    };
    // Env composition, the SDK adapter's exact rule: the inherited environment, then the host's
    // pairs, then the drive's backend PROFILE env (WO-0098), then the def's own pairs.
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(runnerOpts.env ?? {}),
      ...(input.profile?.env ?? {}),
      ...(def.spawnEnv ?? {}),
    };
    let sawTerminal = false; // a turn_complete or error the vendor's stream itself produced
    let stderrTail = '';
    let stdoutBuf = '';

    const emit = (events: RunnerEvent[]): void => {
      for (const e of stampAt(events)) {
        if (e.kind === 'turn_complete' || e.kind === 'error') sawTerminal = true;
        queue.push(e);
      }
    };

    const parseAndEmit = (line: string): void => {
      emit(def.parseLine(line, state));
    };

    const spawnNext = (candidates: readonly string[]): void => {
      const bin = candidates[0];
      if (bin === undefined) {
        // every candidate resolved to nothing — the honest executable-missing close
        queue.push({ kind: 'error', message: `executable not found: ${[def.bin, ...(def.fallbackBins ?? [])].join(', ')}`, code: 'executable_missing' });
        queue.close();
        return;
      }
      let c: ChildProcess;
      try {
        c = spawn(bin, def.buildArgs(spawnInput), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        queue.push({ kind: 'error', message: (e as Error)?.message ?? String(e) });
        queue.close();
        return;
      }
      child = c;
      c.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' && child === c) {
          child = undefined;
          spawnNext(candidates.slice(1)); // the fallback-bin chain
          return;
        }
        if (child === c) {
          queue.push({ kind: 'error', message: err.message });
          queue.close();
        }
      });
      c.stdout?.setEncoding('utf8');
      c.stdout?.on('data', (chunk: string) => {
        stdoutBuf += chunk;
        let nl = stdoutBuf.indexOf('\n');
        while (nl !== -1) {
          parseAndEmit(stdoutBuf.slice(0, nl));
          stdoutBuf = stdoutBuf.slice(nl + 1);
          nl = stdoutBuf.indexOf('\n');
        }
      });
      c.stderr?.setEncoding('utf8');
      c.stderr?.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-2000); // the classification window, bounded
      });
      c.on('close', (code, signal) => {
        if (child !== c) return; // a superseded spawn (fallback chain) already took over
        child = undefined;
        if (stdoutBuf.trim() !== '') parseAndEmit(stdoutBuf); // a final line without its newline
        if (sawTerminal) {
          // the vendor closed its own turn honestly — nothing to synthesise
        } else if (interruptRequested) {
          // WO-0039's discipline: an intentional stop closes CALM, never the fail card
          queue.push({ kind: 'interrupted' });
        } else {
          // WO-0026/TD-030's discipline: never a fabricated turn_complete. A clean exit that
          // the vendor's stream never terminated names exactly what happened.
          const raw =
            code === 0
              ? 'stream ended without a result message (exit 0)'
              : stderrTail.trim() !== ''
                ? stderrTail.trim()
                : `process exited (${code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`})`;
          queue.push({ kind: 'error', message: raw, ...(def.classifyError?.(raw) !== undefined ? { code: def.classifyError!(raw) } : {}) });
        }
        queue.close();
      });
      // The prompt rides stdin (the E2BIG-safe posture) unless the def builds it into argv.
      if (def.promptViaStdin !== false) {
        c.stdin?.write(input.prompt);
        c.stdin?.end();
      } else {
        c.stdin?.end();
      }
    };

    interruptRequested = false;
    spawnNext(candidatesOf(def));
  }

  return {
    drive(input: DriveInput): AsyncIterable<RunnerEvent> {
      const queue = new AsyncQueue<RunnerEvent>();
      let planReady = false;
      void runDrive(input, queue);
      return (async function* stream() {
        while (true) {
          const r = await queue.next();
          if (r.done) return;
          const ev = r.value;
          // The plan fallback (isPlanDrive is core's pure predicate): a plan drive that never
          // saw plan_ready but ended with a result — the result IS the plan (the SDK adapter's
          // exact fallback, engine-level; never fired for a non-plan drive).
          if (ev.kind === 'plan_ready') planReady = true;
          if (isPlanDrive(input) && ev.kind === 'turn_complete' && !planReady && ev.result) {
            planReady = true;
            yield { kind: 'plan_ready', planText: ev.result };
          }
          yield ev;
        }
      })();
    },
    // Port honesty: a CLI exec surfaces NO asks (there is no permission callback to hold), so
    // these are the port's required surface as honest no-ops — decide() on an id this runner
    // never held is already the port's unknown-id contract (a no-op).
    async decide(): Promise<void> {
      /* no held asks can exist */
    },
    async pendingAsks(): Promise<[]> {
      return [];
    },
    async interrupt(): Promise<void> {
      interruptRequested = true;
      child?.kill('SIGINT');
    },
    // WO-0031c: FORCED stop — a CLI child has nothing softer than the signal; SIGKILL is the
    // honest harder mechanism (the GUI's real force stays main-side: the generator return).
    async abort(): Promise<void> {
      child?.kill('SIGKILL');
    },
  };
}

// ===== The zero-prompt vendor check (the checkProvider twin for def vendors) =====

/** The probe's ceiling — a binary that never answers is a failed check, not a hung button. */
const PROBE_TIMEOUT_MS = 15_000;

function runProbe(bin: string, args: readonly string[], env: Record<string, string>, timeoutMs: number): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      c.kill('SIGKILL');
      reject(new Error(`probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    c.stdout?.setEncoding('utf8');
    c.stderr?.setEncoding('utf8');
    c.stdout?.on('data', (ch: string) => (out += ch));
    c.stderr?.on('data', (ch: string) => (out += ch));
    c.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err);
    });
    c.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: out, code });
    });
  });
}

/**
 * The spawn-free-of-tokens vendor check: the version probe (present/missing), then the def's
 * declared AUTH probe when one exists. Never sends a prompt — zero tokens, zero writes. An
 * absent authProbe answers { ok: true, source: 'installed' } for a binary that runs — the
 * honest "installed, login state unknown" (never a guessed auth).
 */
export async function checkCliVendor(def: CliRunnerDef, env?: Record<string, string>): Promise<ProviderStatus> {
  const composed: Record<string, string> = { ...(process.env as Record<string, string>), ...(env ?? {}), ...(def.spawnEnv ?? {}) };
  const bins = candidatesOf(def);
  for (const bin of bins) {
    try {
      await runProbe(bin, def.versionArgs ?? ['--version'], composed, def.authProbe?.timeoutMs ?? PROBE_TIMEOUT_MS);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') continue; // the fallback-bin chain
      return { ok: false, code: 'timeout', message: err.message };
    }
    if (!def.authProbe) return { ok: true, source: 'installed' };
    try {
      const auth = await runProbe(bin, def.authProbe.args, composed, def.authProbe.timeoutMs ?? PROBE_TIMEOUT_MS);
      return def.authProbe.parse(auth.stdout, auth.code) ?? { ok: true, source: 'installed' };
    } catch (e) {
      return { ok: false, code: 'timeout', message: (e as Error).message };
    }
  }
  return { ok: false, code: 'executable_missing', message: `executable not found: ${bins.join(', ')}` };
}
