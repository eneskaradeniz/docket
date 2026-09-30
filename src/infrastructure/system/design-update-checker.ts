// The design seed's scripted updater: an update is always available, and apply walks
// downloading → ready over a few seconds so the operator can review the update story end to
// end. The composition root installs it only through its single DOCKET_UPDATE_FAKE read; the
// step time is injected so the test walks in milliseconds.
import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { UpdateChecker, UpdateState } from '../../application/index';

const PERCENT_STEPS: readonly number[] = [25, 50, 75, 100];

export function createDesignUpdateChecker(current: string, next: string, stepMs = 750): UpdateChecker {
  let state: UpdateState = { kind: 'available', current, next };
  return {
    state: async (): Promise<UpdateState> => state,
    // A re-check never undoes progress: whatever the walk reached is the honest answer.
    check: async (): Promise<UpdateState> => state,
    apply: async (): Promise<Result<void, 'not_available'>> => {
      if (state.kind !== 'available' && state.kind !== 'ready') return err('not_available');
      for (const percent of PERCENT_STEPS) {
        state = { kind: 'downloading', current, next, percent };
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      }
      state = { kind: 'ready', current, next };
      return ok(undefined);
    },
  };
}
