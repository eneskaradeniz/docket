// src/adapters/health.ts — the host-side dependency check (WO-0066). The git spawn lives here
// (node-side tsconfig, the store's pattern); the composition root composes it with the forge's
// `health()` and the runner adapter's `checkProvider()` into the `SystemHealthWatch`.
//
// Contract (WO-0062 §8 carried over): exit !== 0 is the universal degraded signal — the stderr
// line (or the spawn failure's message) is the reason, displayable verbatim; an unparseable
// version output is ok WITHOUT a version (absence is absence, never a guess).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyHealth } from '../core/health';

export interface CommandResult {
  exit: number;
  stdout: string;
  stderr: string;
}

/** The ONE seam — production spawns the real binary; tests inject observed shapes. Never rejects. */
export type CommandRunner = (args: string[]) => Promise<CommandResult>;

const execFileP = promisify(execFile);

export function gitProcessRunner(): CommandRunner {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileP('git', args, { encoding: 'utf-8', timeout: 5_000 });
      return { exit: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      return {
        exit: typeof err.code === 'number' ? err.code : 127,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? String(e),
      };
    }
  };
}

export function gitHealth(run: CommandRunner = gitProcessRunner()): Promise<DependencyHealth> {
  return run(['--version']).then((r) => {
    if (r.exit !== 0) {
      const line = r.stderr.split('\n').map((l) => l.trim()).find((l) => l !== '');
      return { tool: 'git', state: { degraded: line ?? `git check failed (exit ${r.exit})` } };
    }
    const version = /git version (\S+)/.exec(r.stdout.trim())?.[1];
    return { tool: 'git', state: 'ok', ...(version !== undefined ? { version } : {}) };
  });
}
