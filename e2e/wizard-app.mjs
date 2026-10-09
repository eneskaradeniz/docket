// e2e/wizard-app.mjs — the wizard world's launcher: a throwaway home holding two fixture account
// config directories (the same MCP server in both, a second server in one), stub CLI binaries, a
// throwaway data dir seeded (e2e/seed-wizard.ts) with the two adopted accounts pointing at them,
// and the BUILT app on top with its HOME aimed at that fixture — no project anywhere, which is
// the wizard's own precondition. Hermetic by construction: every home-derived root the app reads
// (the account candidate scan, the credential importer, the login probes, the toolchain
// fallbacks) resolves through os.homedir(), which honors $HOME, and the one variable that wins
// over it per provider (XDG_DATA_HOME, COPILOT_HOME) is stripped, so nothing under the operator's
// real home is ever read; the stub `claude` first on PATH keeps the startup quota poll and the
// wizard's catalog read from spawning the operator's real CLI. J-9 drives this (docs/v2/ui.md →
// "Verifying the shell"); the caller holds the host lock, as launchDesignApp does. No keychain
// write and no agent run ever happens in this world: the accounts are already adopted, and the
// only command the walk issues is the capability import.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

import { assertProfileIsolated, freshProfile } from './profile.mjs';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** One `.claude.json` state file: only its user-scope servers survive the scan (I-42), and only
 *  each entry's name and string command build an identity (R-62/R-63). */
const stateFile = (servers) => JSON.stringify({ mcpServers: servers });

/** Every discovery root that an environment variable can steer away from $HOME: the opencode
 *  login probe's XDG_DATA_HOME, copilot's COPILOT_HOME, and the toolchain dirs' NVM/FNM/npm
 *  prefixes. Stripped from the launch env so they cannot point back at the real machine; the
 *  ambient CLAUDE_CONFIG_DIR goes with them — the per-account launches set their own. */
const REAL_MACHINE_VARS = [
  'XDG_DATA_HOME',
  'COPILOT_HOME',
  'NVM_DIR',
  'FNM_DIR',
  'NPM_CONFIG_PREFIX',
  'npm_config_prefix',
  'CLAUDE_CONFIG_DIR',
];

/** The fixture config directories the capability scan reads. The shared `fetch` server lands in
 *  both — one identity, one row in two groups (R-63's merge, U-59's groups); `db` lands in one,
 *  so the second group holds a row of its own. The dirs sit under `configs/`, a name the account
 *  scan's `.claude*` pattern never matches, so discovery finds no candidate: the two seeded
 *  accounts are the whole world. */
export function makeWizardHome() {
  const home = mkdtempSync(join(tmpdir(), 'docket-wizard-home-'));
  const dirs = {
    home,
    a: join(home, 'configs', 'asistan-a'),
    b: join(home, 'configs', 'asistan-b'),
    bin: join(home, 'bin'),
  };
  const fetch = { command: 'npx', args: ['-y', 'fetch-mcp'] };
  mkdirSync(dirs.a, { recursive: true });
  mkdirSync(dirs.b, { recursive: true });
  writeFileSync(join(dirs.a, '.claude.json'), stateFile({ fetch }));
  writeFileSync(join(dirs.b, '.claude.json'), stateFile({ fetch, db: { command: 'docker', args: ['run', 'db-mcp'] } }));
  // Stub CLIs, first on the app's PATH: the startup quota poll and the wizard's open-time model
  // catalog read spawn `claude` resolved from PATH, and the discovery probes run the rest — a
  // stub that answers nothing fails each of them fast, offline, and without touching a real
  // binary. Being uninstalled-looking is fine here: provider names still resolve from the
  // builtin defs, and the walk adopts nothing.
  mkdirSync(dirs.bin, { recursive: true });
  for (const name of ['claude', 'codex', 'agy', 'copilot', 'cursor', 'opencode']) {
    const stub = join(dirs.bin, name);
    writeFileSync(stub, '#!/bin/sh\nexit 1\n');
    chmodSync(stub, 0o755);
  }
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
  // HOME is the fixture home and the stub bin dir leads PATH: the app's every home-rooted read
  // and every spawned CLI stays inside the throwaway world (see makeWizardHome).
  const env = {
    ...process.env,
    HOME: dirs.home,
    DOCKET_DATA_DIR: seed.dataDir,
    DOCKET_UPDATE_FAKE: '0.9.0',
    PATH: `${dirs.bin}:${process.env.PATH ?? ''}`,
  };
  for (const name of REAL_MACHINE_VARS) delete env[name];
  const app = await electron.launch({
    args: [...profile.args, join(ROOT, 'dist-electron', 'main.js')],
    env,
  });
  await assertProfileIsolated(app, profile.dir);
  const page = await app.firstWindow();
  await page.waitForSelector('[data-wizard]', { timeout: 30_000 });
  return { app, page, seed, dirs };
}
