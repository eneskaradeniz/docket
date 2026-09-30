// app-update — the app bar's update story: one query and two intents over the UpdateChecker
// port, which is composed beside AppDeps (no repo data, no audit action), so the use cases take
// the port directly — the polled quota probes' resolver precedent.
import type { Result } from '../../domain/index';
import { err } from '../../domain/index';

import type { UpdateChecker, UpdateState } from '../ports';

/** The state the composed checker holds right now. */
export async function getUpdateState(updates: UpdateChecker): Promise<UpdateState> {
  return updates.state();
}

/** Re-checks now; the answer is the new state. */
export async function checkForUpdates(updates: UpdateChecker): Promise<UpdateState> {
  return updates.check();
}

/** Starts the download and install; allowed only while an update is available or already ready. */
export async function applyUpdate(updates: UpdateChecker): Promise<Result<void, 'not_available'>> {
  // The guard reads the state here so the rule lives in the one layer every caller shares; the
  // checker implementations enforce it again as the port's own promise.
  const state = await updates.state();
  if (state.kind !== 'available' && state.kind !== 'ready') return err('not_available');
  return updates.apply();
}
