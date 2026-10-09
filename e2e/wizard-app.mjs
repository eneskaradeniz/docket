// e2e/wizard-app.mjs — the wizard world's launcher: a throwaway home holding two fixture account
// config directories (the same MCP server in both, a second server in one), a throwaway data dir
// seeded (e2e/seed-wizard.ts) with the two adopted accounts pointing at them, and the BUILT app
// on top — no project anywhere, which is the wizard's own precondition. J-9 drives this
// (docs/v2/ui.md → "Verifying the shell"); the caller holds the host lock, as launchDesignApp
// does. No keychain write and no agent run ever happens in this world: the accounts are already
// adopted, and the only command the walk issues is the capability import.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

import { assertProfileIsolated, freshProfile } from './profile.mjs';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** One `.claude.json` state file: only its user-scope servers survive the scan (I-42), and only
 *  each entry's name and string command build an identity (R-62/R-63). */
const stateFile = (servers) => JSON.stringify({ mcpServers: servers });

/** The fixture config directories the capability scan reads. The shared `fetch` server lands in
 *  both — one identity, one row in two groups (R-63's merge, U-59's groups); `db` lands in one,
 *  so the second group holds a row of its own. */
export function makeWizardHome() {
  const home = mkdtempSync(join(tmpdir(), 'docket-wizard-home-'));
  const dirs = {
    home,
    a: join(home, 'configs', 'asistan-a'),
    b: join(home, 'configs', 'asistan-b'),
  };
  const fetch = { command: 'npx', args: ['-y', 'fetch-mcp'] };
  mkdirSync(dirs.a, { recursive: true });
  mkdirSync(dirs.b, { recursive: true });
  writeFileSync(join(dirs.a, '.claude.json'), stateFile({ fetch }));
  writeFileSync(join(dirs.b, '.claude.json'), stateFile({ fetch, db: { command: 'docker', args: ['run', 'db-mcp'] } }));
  return dirs;
}

/** Seed the throwaway data dir and return the parsed SEED manifest. */
export function seedWizard(dirs) {
  if (!existsSync(join(ROOT, 'e2e', 'seed-wizard.ts'))) throw new Error('e2e/seed-wizard.ts is missing');
  const dataDir = join(dirs.home, '.docket');
  const out = execFileSync('npx', ['tsx', 'e2e/seed-wizard.ts', dataDir, dirs.a, dirs.b], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((l) => l.startsWith('SEED='));
  if (line === undefined) throw new Error('the wizard seed printed no SEED= line');
  return JSON.parse(line.slice(5));
}

/** Launch the built app on the wizard world; the wizard itself is the readiness signal. */
export async function launchWizardApp() {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run the npm script (it builds first)');
  }
  const dirs = makeWizardHome();
  const seed = seedWizard(dirs);
  const profile = freshProfile();
  console.log(`profile: ${profile.dir}`);
  const app = await electron.launch({
    args: [...profile.args, join(ROOT, 'dist-electron', 'main.js')],
    env: { ...process.env, DOCKET_DATA_DIR: seed.dataDir, DOCKET_UPDATE_FAKE: '0.9.0' },
  });
  await assertProfileIsolated(app, profile.dir);
  const page = await app.firstWindow();
  await page.waitForSelector('[data-wizard]', { timeout: 30_000 });
  return { app, page, seed };
}
