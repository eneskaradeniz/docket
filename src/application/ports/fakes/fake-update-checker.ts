// In-memory UpdateChecker — a scriptable state for the update surface's tests, no clock, no
// network, no timers.
import type { Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

import type { UpdateChecker, UpdateState } from '../update-checker';

export interface FakeUpdateChecker extends UpdateChecker {
  /** Scripts the next `check`: the answer it returns and adopts. */
  queueCheck(state: UpdateState): void;
  /** How many times `apply` was called (refused calls included). */
  applyCalls(): number;
}

export const createFakeUpdateChecker = (initial: UpdateState = { kind: 'none', current: '1.0.0' }): FakeUpdateChecker => {
  let current = initial;
  let queued: UpdateState | undefined;
  let applies = 0;

  return {
    queueCheck: (state: UpdateState): void => {
      queued = state;
    },

    applyCalls: (): number => applies,

    state: async (): Promise<UpdateState> => current,

    check: async (): Promise<UpdateState> => {
      if (queued !== undefined) {
        current = queued;
        queued = undefined;
      }
      return current;
    },

    apply: async (): Promise<Result<void, 'not_available'>> => {
      applies += 1;
      if (current.kind !== 'available' && current.kind !== 'ready') return err('not_available');
      current = { kind: 'downloading', current: current.current, next: current.next, percent: 0 };
      return ok(undefined);
    },
  };
};
