// In-memory machine-side ports — scripted commands, scans, evidence and worktrees.
import { redactSecretShapes, type Result, type RepoSlug, type WorkOrderId } from '../../../domain/index';

import type { CommandResult, CommandRunner, EvidenceChecker, SecretScanner, Worktrees } from '../repo-tools';

export interface FakeCommandRunner extends CommandRunner {
  /** Scripts the result for an exact command string; same-command scripts are consumed in order. */
  script(command: string, result: CommandResult): void;
  /** Every run call, in order. */
  calls(): readonly {
    readonly cwd: string;
    readonly command: string;
    readonly timeoutMs: number;
    readonly env?: Readonly<Record<string, string>>;
  }[];
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
  /** Makes ensure fail with no_repo for that repo (a missing checkout on the machine). */
  markNoRepo(repo: RepoSlug): void;
  /** Records that this work order already has a worktree. Does not create one. */
  markExisting(repo: RepoSlug, workOrderId: WorkOrderId): void;
  /** How many times `ensure` ran. A read that must not create a worktree stays at zero. */
  ensureCalls(): number;
}

/** Must match `MEMORY_PROPOSAL_SCAN_PREFIX` in `services/docket-tools.ts` (A-356). */
const MEMORY_PROPOSAL_SCAN_PREFIX = '\0docket:memory-proposal-scan\0';

const SUCCESS: CommandResult = { exitCode: 0, durationMs: 0, outputTail: '' };

export const createFakeCommandRunner = (): FakeCommandRunner => {
  const scripts: { readonly command: string; readonly result: CommandResult }[] = [];
  const calls: {
    readonly cwd: string;
    readonly command: string;
    readonly timeoutMs: number;
    readonly env?: Readonly<Record<string, string>>;
  }[] = [];

  return {
    script: (command: string, result: CommandResult): void => {
      scripts.push({ command, result });
    },

    run: async (
      cwd: string,
      command: string,
      timeoutMs: number,
      env?: Readonly<Record<string, string>>,
    ): Promise<CommandResult> => {
      calls.push({
        cwd,
        command,
        timeoutMs,
        // A copy: the caller mutating its record afterwards must not change what was recorded.
        ...(env === undefined ? {} : { env: { ...env } }),
      });
      const scriptedAt = scripts.findIndex((entry) => entry.command === command);
      if (scriptedAt === -1) return { ...SUCCESS };
      const [entry] = scripts.splice(scriptedAt, 1);
      return { ...entry.result };
    },

    calls: (): readonly {
      readonly cwd: string;
      readonly command: string;
      readonly timeoutMs: number;
      readonly env?: Readonly<Record<string, string>>;
    }[] => [...calls],
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
      if (cwd.startsWith(MEMORY_PROPOSAL_SCAN_PREFIX)) {
        const text = cwd.slice(MEMORY_PROPOSAL_SCAN_PREFIX.length);
        return { findings: redactSecretShapes(text) !== text ? 1 : 0 };
      }
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

const worktreePath = (repo: RepoSlug, workOrderId: WorkOrderId): string => `/fake/worktrees/${repo}/${workOrderId}`;

export const createFakeWorktrees = (): FakeWorktrees => {
  const withoutRepo = new Set<RepoSlug>();
  const listed = new Set<string>();
  let ensures = 0;
  const keyOf = (repo: RepoSlug, workOrderId: WorkOrderId): string => `${repo}/${workOrderId}`;
  return {
    markNoRepo: (repo: RepoSlug): void => {
      withoutRepo.add(repo);
    },
    markExisting: (repo: RepoSlug, workOrderId: WorkOrderId): void => {
      listed.add(keyOf(repo, workOrderId));
    },
    ensureCalls: (): number => ensures,
    ensure: async (repo: RepoSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>> => {
      ensures += 1;
      return withoutRepo.has(repo)
        ? { ok: false, error: 'no_repo' }
        : { ok: true, value: { path: worktreePath(repo, workOrderId) } };
    },
    existing: async (repo: RepoSlug, workOrderId: WorkOrderId): Promise<{ readonly path: string } | undefined> =>
      withoutRepo.has(repo) || !listed.has(keyOf(repo, workOrderId)) ? undefined : { path: worktreePath(repo, workOrderId) },
  };
};
