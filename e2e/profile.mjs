// e2e/profile.mjs — the per-launch Chromium profile. Every harness that launches Electron would
// otherwise share one user-data dir on the dev machine (appData + the app name): the renderer's
// localStorage — the board's Kanban ⇄ Liste choice (U-18), the tree's sort, the palette's
// history, the theme — persists there, so one run's leftovers walk into the next run and flake
// it locally (J-2, #792); a clean CI machine never sees it because every CI run starts with an
// empty profile. The same channel is two-way: the harness's own settings land in the profile the
// operator's own dev sessions read.
//
// The cure is the same shape as the DOCKET_DATA_DIR seam: the launch, not the app, is pointed at
// a throwaway dir. Chromium's --user-data-dir switch is that pointer, and Electron honours it
// before the app boots (PreSandboxStartup overrides the user-data path-service entry — the same
// key app.getPath('userData') and the renderer's localStorage storage read through), so the app
// needs no seam of its own and the walk keeps measuring the real app. The switch must precede
// the app path: playwright passes its own flags first and the caller's args after, and arguments
// after the app path belong to the app.
//
// The dirs are left behind on purpose, like the seeds' homes: a failed run's profile is the
// record of what the renderer actually saw, and the OS temp dir reaps them.
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fresh throwaway profile for one Electron launch: spread `args` before the app path. */
export function freshProfile(prefix = 'docket-e2e-profile-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, args: [`--user-data-dir=${dir}`] };
}

/** Fails the launch the day the switch stops being honoured — an Electron upgrade could drop the
 *  handling, and without this check isolation would regress silently and the leak would return
 *  as a local-only ghost. darwin's /var is /private/var, so the resolved forms are compared. */
export async function assertProfileIsolated(app, dir) {
  const actual = await app.evaluate(({ app: electron }) => electron.getPath('userData'));
  if (realpathSync(actual) !== realpathSync(dir)) {
    throw new Error(`profile isolation failed: userData is ${actual}, wanted ${dir}`);
  }
}
