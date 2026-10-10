// e2e/roadmap-app.mjs — the roadmap world's launcher (J-10): a throwaway home holding two real
// repos and a four-phase roadmap (e2e/seed-roadmap.ts), stub CLI binaries first on PATH, and the
// BUILT app on top with HOME and DOCKET_DATA_DIR aimed at that fixture. Hermetic like the wizard
// world: every home-derived root resolves through $HOME, the variables that can steer a root
// away from it are stripped, no account exists (so no agent can ever start and nothing can
// spend), and no keychain write happens — the walk's only commands are the phase controls. The
// caller holds the host lock, as launchDesignApp does.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

import { assertProfileIsolated, freshProfile } from './profile.mjs';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** The variables that can steer a discovery root away from $HOME (same list as the wizard world). */
const REAL_MACHINE_VARS = [
  'XDG_DATA_HOME',
  'COPILOT_HOME',
  'NVM_DIR',
  'FNM_DIR',
  'NPM_CONFIG_PREFIX',
  'npm_config_prefix',
  'CLAUDE_CONFIG_DIR',
];

/** Seed the throwaway home and return the parsed SEED manifest plus the stub bin dir. */
export function seedRoadmap() {
  if (!existsSync(join(ROOT, 'e2e', 'seed-roadmap.ts'))) throw new Error('e2e/seed-roadmap.ts is missing');
  const home = mkdtempSync(join(tmpdir(), 'docket-roadmap-home-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  // Stubs that fail fast: the startup quota poll and the discovery probes resolve their CLIs from
  // PATH, and none of them may reach a real binary.
  for (const name of ['claude', 'codex', 'agy', 'copilot', 'cursor', 'opencode']) {
    const stub = join(bin, name);
    writeFileSync(stub, '#!/bin/sh\nexit 1\n');
    chmodSync(stub, 0o755);
  }
  const out = execFileSync('npx', ['tsx', 'e2e/seed-roadmap.ts', home], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((l) => l.startsWith('SEED='));
  if (line === undefined) throw new Error('the roadmap seed printed no SEED= line');
  return { ...JSON.parse(line.slice(5)), bin };
}

/** Launch the built app on the roadmap world; the sidebar is the readiness signal. */
export async function launchRoadmapApp() {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run the npm script (it builds first)');
  }
  const seed = seedRoadmap();
  const profile = freshProfile();
  console.log(`profile: ${profile.dir}`);
  const env = {
    ...process.env,
    HOME: seed.home,
    DOCKET_DATA_DIR: seed.dataDir,
    DOCKET_UPDATE_FAKE: '0.9.0',
    PATH: `${seed.bin}:${process.env.PATH ?? ''}`,
  };
  for (const name of REAL_MACHINE_VARS) delete env[name];
  const app = await electron.launch({
    args: [...profile.args, join(ROOT, 'dist-electron', 'main.js')],
    env,
  });
  await assertProfileIsolated(app, profile.dir);
  const page = await app.firstWindow();
  await page.waitForSelector('nav', { timeout: 30_000 });
  return { app, page, seed };
}
