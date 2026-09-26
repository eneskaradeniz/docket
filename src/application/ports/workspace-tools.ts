// Machine-side ports — what gates and runs need from the local machine.
import type { Result, WorkOrderId, WorkspaceSlug } from '../../domain/index';

export interface CommandResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly outputTail: string;
}

export interface CommandRunner {
  run(cwd: string, command: string, timeoutMs: number): Promise<CommandResult>;
}

export interface SecretScanner {
  scan(cwd: string): Promise<{ readonly findings: number }>;
}

export interface EvidenceChecker {
  /** True when every `path:line` pointer names an existing file and line in `cwd`. */
  resolvePointers(cwd: string, pointers: readonly string[]): Promise<boolean>;
}

export interface Worktrees {
  ensure(workspace: WorkspaceSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>>;
}
