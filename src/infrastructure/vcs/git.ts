// Direct git subprocess execution: no shell, minimal environment, timeouts enforced.
import { spawn } from 'node:child_process';

import type { GitProbe } from '../../application/index';

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

// Only PATH and HOME (plus SystemRoot on Windows) flow through: git must not pick up identity,
// config-injection or other parent variables, yet still locate the binary and its own global config.
function buildGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' };
  for (const name of ['PATH', 'HOME']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'];
    if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;
  }
  return env;
}

export function runGit(
  cwd: string,
  args: readonly string[],
  options?: { readonly timeoutMs?: number },
): Promise<GitResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<GitResult>((resolve, reject) => {
    // shell: false — every argument reaches the git binary verbatim.
    const child = spawn('git', [...args], { cwd, env: buildGitEnv(), shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish(127); // conventional "command not found": a missing git binary is a result
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error('git spawn failed'));
    });

    child.on('close', (code) => {
      // A SIGKILL from the timeout surfaces as a signal close (null code); report 124,
      // the conventional timeout exit status.
      finish(timedOut ? 124 : (code ?? -1));
    });
  });
}

/** The GitProbe port over the same direct-git discipline: a checkout answers
 *  `rev-parse --is-inside-work-tree` with exit 0 and `true`; everything else — a bare
 *  repository, a missing folder, a non-repo — is not a work tree. */
export function createGitProbe(): GitProbe {
  return {
    isWorkTree: async (path: string): Promise<boolean> => {
      const result = await runGit(path, ['rev-parse', '--is-inside-work-tree']);
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    },
  };
}
