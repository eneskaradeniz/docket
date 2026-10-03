// use-cases/checkpoints.ts — the checkpoint commit service (P-38 item 4): one commit through the
// port, the single path the executor's cadence (A-57) and the pack's stage base (A-59) use.
// Contract: docs/v2/application.md → "Instructions, checkpoints, handoff (#581)".
import type { Result, RunId } from '../../domain/index';

import type { AppDeps, CheckpointError, CheckpointRef } from '../ports/index';

export async function commitCheckpoint(
  deps: Pick<AppDeps, 'checkpoints'>,
  input: { readonly cwd: string; readonly runId: RunId; readonly seq: number },
): Promise<Result<CheckpointRef, CheckpointError>> {
  return deps.checkpoints.commit(input);
}
