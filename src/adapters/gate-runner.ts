// src/adapters/gate-runner.ts — the LOCAL GATE's runner (WO-0089), in the git-console family.
//
// DOCKET runs the workspace's declared gate commands itself, in the drive cwd — never the agent
// session (the antreo case: two of three parallel work orders reported gate numbers that were
// wrong; a self-reported gate is not evidence). The runner captures what it measured: exit code
// per declared command + a bounded tail (no parsing in v1), keyed to the repo's HEAD sha at run
// time — the evidence points somewhere, like verification's path:line pointers.
//
// The HOST-WIDE GATE LOCK (a hard dependency on WO-0088's parallel spine): gate commands are
// heavy (a full suite, a build). N drives run at once and N simultaneous suites exhausted RAM in
// the antreo wave — the OS killed processes. ONE lock per host (the composition root creates the
// one instance) serializes every gate run; within a run the declared commands execute serially.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommandRunner } from './git-console';
import type { GateCommandSpec } from '../core/gate-config';
import type { GateCommandResult } from '../core/types';

const execFileP = promisify(execFile);

/** A full suite can legitimately run for minutes — the git console's 5s would lie. */
export const GATE_TIMEOUT_MS = 20 * 60_000;
/** The captured tail's bound — evidence for the operator to read, never an archive. */
export const GATE_TAIL_CHARS = 4096;
const GATE_MAX_BUFFER = 16 * 1024 * 1024; // a big suite log degrades by the tail bound, not a buffer error

/** ONE command's observed spawn. `exit === null` = could not observe an exit (spawn failure,
 *  timeout, signal kill) — the unknown arm; `out` carries both streams for the tail. */
export interface GateSpawnResult {
  exit: number | null;
  out: string;
}

/** The ONE seam — production spawns /bin/sh; tests inject observed shapes. Never rejects. */
export type GateSpawner = (command: string, cwd: string) => Promise<GateSpawnResult>;

export function shellGateSpawner(timeoutMs: number = GATE_TIMEOUT_MS): GateSpawner {
  return async (command, cwd) => {
    try {
      const { stdout, stderr } = await execFileP('/bin/sh', ['-c', command], {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: GATE_MAX_BUFFER,
      });
      return { exit: 0, out: `${stdout}\n${stderr}` };
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string; killed?: boolean };
      const timedOut = err.killed === true;
      return {
        // A numeric code is the measured exit; a spawn failure carries a string code (ENOENT) and
        // a timeout carries none — both are the unknown arm (null), never a fabricated number.
        exit: typeof err.code === 'number' ? err.code : null,
        out: `${err.stdout ?? ''}\n${err.stderr ?? err.message ?? String(e)}${timedOut ? `\n(gate command timed out after ${timeoutMs}ms)` : ''}`,
      };
    }
  };
}

/** The host-wide gate lock: every gate run executes inside `exclusive`, so two runs NEVER run
 *  commands simultaneously (the antreo RAM case). A promise-chain mutex — the queue survives a
 *  failed section (its error reaches its caller; the chain continues). */
export interface GateLock {
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

export function createGateLock(): GateLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn);
      tail = run.catch(() => undefined); // the chain never wedges on a failed run
      return run;
    },
  };
}

const tailOf = (out: string): string => (out.length > GATE_TAIL_CHARS ? out.slice(-GATE_TAIL_CHARS) : out);

/** One full gate run: the sha it ran at + every declared command's measured result. The whole
 *  run — sha look-up AND every command — executes inside the lock, serially. */
export async function runLocalGate(input: {
  spawner: GateSpawner;
  lock: GateLock;
  gitRun: CommandRunner;
  cwd: string;
  commands: GateCommandSpec[];
}): Promise<{ sha: string; at: string; results: GateCommandResult[] }> {
  return input.lock.exclusive(async () => {
    const head = await input.gitRun(['-C', input.cwd, 'rev-parse', 'HEAD']);
    const sha = head.exit === 0 ? head.stdout.trim() : ''; // a cwd git cannot read records honestly empty
    const results: GateCommandResult[] = [];
    for (const spec of input.commands) {
      const r = await input.spawner(spec.command, input.cwd);
      results.push({ command: spec.command, exit: r.exit, expectExit: spec.expectExit, tail: tailOf(r.out) });
    }
    return { sha, at: new Date().toISOString(), results };
  });
}
