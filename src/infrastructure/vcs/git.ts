// Direct git subprocess execution: no shell, minimal environment, timeouts enforced.
import type { GitProbe, RepoFingerprint } from '../../application/index';

import { registeredSpawn } from '../system/index';

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
    const child = registeredSpawn('git', [...args], { cwd, env: buildGitEnv(), shell: false, windowsHide: true }, { kind: 'git', label: `git ${args[0] ?? ''}`.trim() });
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

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
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

/** The head commit of a branch in a checkout, or undefined when the branch (or the work tree) is
 *  absent: the remote-checks poll reads the checks of that one sha, never a name that could move
 *  under it between the poll and the forge's answer. */
export async function branchHead(cwd: string, branch: string): Promise<string | undefined> {
  const result = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (result.exitCode !== 0) return undefined;
  const sha = result.stdout.trim();
  return sha === '' ? undefined : sha;
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

/** A folder's repo identity: the root commit of `rev-parse --show-toplevel`'s repo plus the
 *  normalised `origin` URL when present. `undefined` when the path is not a git work tree with
 *  commits. Normalisation trims whitespace and strips one trailing `.git` — nothing stronger, so
 *  an ssh remote keeps its form. */
export async function readRepoFingerprint(path: string): Promise<RepoFingerprint | undefined> {
  const toplevel = await runGit(path, ['rev-parse', '--show-toplevel']);
  if (toplevel.exitCode !== 0) return undefined;
  const root = toplevel.stdout.trim();
  if (root === '') return undefined;

  const roots = await runGit(root, ['rev-list', '--max-parents=0', 'HEAD']);
  if (roots.exitCode !== 0) return undefined;
  // rev-list walks newest → oldest, so the last root line is the history's first commit.
  const lines = roots.stdout.trim().split('\n');
  const rootCommit = lines[lines.length - 1] ?? '';
  if (rootCommit === '') return undefined;

  const origin = await runGit(root, ['remote', 'get-url', 'origin']);
  if (origin.exitCode !== 0) return { rootCommit };
  const normalised = origin.stdout.trim().replace(/\.git$/, '');
  return normalised === '' ? { rootCommit } : { rootCommit, remote: normalised };
}
