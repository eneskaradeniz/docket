// Shared Electron launch for the suites. Quiet is the default so a serial run does not put a
// window on screen or take the keyboard. DOCKET_E2E_VISIBLE=1 is the debugging escape and wins
// over a quiet value inherited from the parent environment. The CDP launcher does not use this
// helper, so it stays on screen unless the operator asks.
import { _electron as electron } from 'playwright-core';

/** The quit confirmation's harness answer: every suite launch auto-accepts the quit prompt, or an
 *  `electronApp.close()` with a run active at the end would hang on a dialog nobody answers. The
 *  app honours it only for an unpackaged build on a data dir outside the operator's real one. */
export const DEFAULT_QUIT_CONFIRM = 'accept';

/** Copy env and arm quiet mode, unless the visible escape is set. A caller that sets
 *  DOCKET_QUIT_CONFIRM itself (even to an empty string, which the app reads as "unset") keeps its
 *  value: managed-quit.mjs drives the prompt per part. */
export function withQuietEnv(env) {
  const next = { ...env };
  if (next.DOCKET_QUIT_CONFIRM === undefined) next.DOCKET_QUIT_CONFIRM = DEFAULT_QUIT_CONFIRM;
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
