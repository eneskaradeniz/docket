// In-memory machine-side ports — scripted commands, scans, evidence and worktrees.
import type { Result, WorkOrderId, WorkspaceSlug } from '../../../domain/index';

import type { CommandResult, CommandRunner, EvidenceChecker, SecretScanner, Worktrees } from '../workspace-tools';

export interface FakeCommandRunner extends CommandRunner {
  /** Scripts the result for an exact command string; same-command scripts are consumed in order. */
  script(command: string, result: CommandResult): void;
  /** Every run call, in order. */
  calls(): readonly { readonly cwd: string; readonly command: string; readonly timeoutMs: number }[];
}

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeSecretScanner extends SecretScanner {
  /** Sets the finding count every later scan reports. */
  setFindings(findings: number): void;
  /** The scanned directories, in order. */
  calls(): readonly string[];
}

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeEvidenceChecker extends EvidenceChecker {
  /** Restricts which `path:line` pointers count as resolved; empty by default. */
  setResolvable(pointers: readonly string[]): void;
}

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeWorktrees extends Worktrees {
  /** Makes ensure fail with no_repo for that workspace (a missing checkout on the machine). */
  markNoRepo(workspace: WorkspaceSlug): void;
}

const SUCCESS: CommandResult = { exitCode: 0, durationMs: 0, outputTail: '' };

export const createFakeCommandRunner = (): FakeCommandRunner => {
  const scripts: { readonly command: string; readonly result: CommandResult }[] = [];
  const calls: { readonly cwd: string; readonly command: string; readonly timeoutMs: number }[] = [];

  return {
    script: (command: string, result: CommandResult): void => {
      scripts.push({ command, result });
    },

    run: async (cwd: string, command: string, timeoutMs: number): Promise<CommandResult> => {
      calls.push({ cwd, command, timeoutMs });
      const scriptedAt = scripts.findIndex((entry) => entry.command === command);
      if (scriptedAt === -1) return { ...SUCCESS };
      const [entry] = scripts.splice(scriptedAt, 1);
      return { ...entry.result };
    },

    calls: (): readonly { readonly cwd: string; readonly command: string; readonly timeoutMs: number }[] => [...calls],
  };
};

export const createFakeSecretScanner = (): FakeSecretScanner => {
  let findings = 0;
  const scanned: string[] = [];
  return {
    setFindings: (count: number): void => {
      findings = count;
    },
    scan: async (cwd: string): Promise<{ readonly findings: number }> => {
      scanned.push(cwd);
      return { findings };
    },
    calls: (): readonly string[] => [...scanned],
  };
};

export const createFakeEvidenceChecker = (): FakeEvidenceChecker => {
  const resolvable = new Set<string>();
  return {
    setResolvable: (pointers: readonly string[]): void => {
      resolvable.clear();
      for (const pointer of pointers) resolvable.add(pointer);
    },
    // Every pointer must resolve, so an empty list is vacuously true.
    resolvePointers: async (_cwd: string, pointers: readonly string[]): Promise<boolean> =>
      pointers.every((pointer) => resolvable.has(pointer)),
  };
};

export const createFakeWorktrees = (): FakeWorktrees => {
  const withoutRepo = new Set<WorkspaceSlug>();
  return {
    markNoRepo: (workspace: WorkspaceSlug): void => {
      withoutRepo.add(workspace);
    },
    ensure: async (workspace: WorkspaceSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>> =>
      withoutRepo.has(workspace)
        ? { ok: false, error: 'no_repo' }
        : { ok: true, value: { path: `/fake/worktrees/${workspace}/${workOrderId}` } },
  };
};
