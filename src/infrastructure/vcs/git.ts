// Direct git subprocess execution: no shell, minimal environment, timeouts enforced.
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runGit(
  cwd: string,
  args: readonly string[],
  options?: { readonly timeoutMs?: number },
): Promise<GitResult> {
  void [cwd, args, options];
  throw new Error('not implemented');
}
