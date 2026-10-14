// copy-from.ts — pure copy-from snapshot for multi-repo setup (R-147).

export interface RepoSetupSnapshot {
  readonly flow: unknown;
  readonly defaultLimitPolicy: string;
  readonly commandSets: Readonly<Record<string, readonly string[]>>;
}

export interface SetupRepoProposal {
  readonly id: string;
  readonly flow: unknown;
  readonly defaultLimitPolicy: string;
  readonly commandSets: Readonly<Record<string, readonly string[]>>;
  readonly docsRoot: string;
  readonly testGlobs: readonly string[];
}

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneCommandSets = (commandSets: Readonly<Record<string, readonly string[]>>): Readonly<Record<string, readonly string[]>> => {
  const out: Record<string, readonly string[]> = {};
  for (const [key, values] of Object.entries(commandSets)) out[key] = [...values];
  return out;
};

export function copyFromRepo(
  source: RepoSetupSnapshot,
  detected: { readonly docsRoot: string; readonly testGlobs: readonly string[] },
): { readonly repo: SetupRepoProposal; readonly copiedPaths: readonly string[] } {
  const flow = cloneValue(source.flow);
  const defaultLimitPolicy = source.defaultLimitPolicy;
  const commandSets = cloneCommandSets(source.commandSets);
  const copiedPaths: string[] = ['flow', 'defaultLimitPolicy', 'commandSets'];
  return {
    repo: {
      id: '',
      flow,
      defaultLimitPolicy,
      commandSets,
      docsRoot: detected.docsRoot,
      testGlobs: [...detected.testGlobs],
    },
    copiedPaths,
  };
}
