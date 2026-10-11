// Shared Electron launch for the suites. Quiet is the default so a serial run does not put a
// window on screen or take the keyboard. DOCKET_E2E_VISIBLE=1 is the debugging escape and wins
// over a quiet value inherited from the parent environment. The CDP launcher does not use this
// helper, so it stays on screen unless the operator asks.
import { _electron as electron } from 'playwright-core';

/** Copy env and arm quiet mode, unless the visible escape is set. */
export function withQuietEnv(env) {
  const next = { ...env };
  if (next.DOCKET_E2E_VISIBLE === '1') {
    delete next.DOCKET_E2E_QUIET;
    return next;
  }
  next.DOCKET_E2E_QUIET = '1';
  return next;
}

/** Launch the built app. Every suite launch goes through here so the quiet variable cannot be
 *  forgotten, and no launcher sets that variable on its own. */
export async function launchQuietElectron(options) {
  return electron.launch({
    ...options,
    env: withQuietEnv(options.env ?? process.env),
  });
}
