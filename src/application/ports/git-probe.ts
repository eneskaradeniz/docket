// The machine's answer to the one git question the attach flow needs: is this path a checkout?
// Kept separate from Vcs so use cases can ask without gaining worktree powers.
export interface GitProbe {
  /** True when `path` is an existing git work tree (a checkout, not a bare repository). */
  isWorkTree(path: string): Promise<boolean>;
}
