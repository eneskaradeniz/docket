// An empty directory outside every repo, for runs that need a cwd but no checkout.
export interface ScratchDir {
  readonly path: string;
  dispose(): Promise<void>;
}

export interface ScratchDirs {
  create(purpose: 'account-test'): Promise<ScratchDir>;
}
