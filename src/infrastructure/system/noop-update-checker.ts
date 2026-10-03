// The update checker's infrastructure default: no updater ships yet (the real one — feed check,
// download, install, signing — is a later, operator-approved contract), so this adapter answers
// "you are current" for the app's whole life and touches no network. The version string is
// injected; electron/main.ts passes the Electron app's own version.
import type { Result } from '../../domain/index';
import { err } from '../../domain/index';

import type { UpdateChecker, UpdateState } from '../../application/index';

export function createNoopUpdateChecker(current: string): UpdateChecker {
  const state: UpdateState = { kind: 'none', current };
  return {
    state: async (): Promise<UpdateState> => state,
    check: async (): Promise<UpdateState> => state,
    apply: async (): Promise<Result<void, 'not_available'>> => err('not_available'),
  };
}
