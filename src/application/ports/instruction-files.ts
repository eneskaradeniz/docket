// Instruction-file port (P-37): the repo's own instruction files, read as data for the effective
// instructions. Reads only — the instructions path never writes to the repo (A-56).
import type { RepoInstructionFile } from '../../domain/index';

export interface InstructionFiles {
  /** Reads the named files at the worktree root. Absent names are skipped; files over 1 MiB or
   *  with a NUL byte in the first 8 KiB are skipped (the scanner's limits). Never writes. */
  read(cwd: string, names: readonly string[]): Promise<readonly RepoInstructionFile[]>;
}
