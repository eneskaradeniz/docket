// e2e/chat-app.mjs — the Docket AI chat world's launcher (J-15): the page-view world (one project,
// one work order, the hostile page — e2e/seed-page-view.ts) plus the chat seed on top of it
// (e2e/seed-chat.ts: an older conversation for the history and one project conversation whose
// assistant message carries a page, a table, a draft and a proposal with its pending action), the
// stub CLI binaries first on PATH, and the BUILT app with HOME and DOCKET_DATA_DIR aimed at that
// fixture and the dev bridge armed (the page view's trace is how the journey proves the native view
// yields to the panel). Hermetic like the other worlds: no account exists, no keychain write
// happens, no agent runs and nothing can spend; a message sent from the panel finds no account and
// the runner refuses the turn with its "auth" notice — there is no model in this world, so the
// streamed text itself is covered by the store's tests, never by this journey. No product switch
// exists for any of it: the world is nothing but seeded data. The caller holds the host lock.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

import { ROOT, seedPageView, startProbe } from './page-view-app.mjs';
import { assertProfileIsolated, freshProfile } from './profile.mjs';

/** The variables that can steer a discovery root away from $HOME (same list as the other worlds). */
const REAL_MACHINE_VARS = [
  'XDG_DATA_HOME',
  'COPILOT_HOME',
  'NVM_DIR',
  'FNM_DIR',
  'NPM_CONFIG_PREFIX',
  'npm_config_prefix',
  'CLAUDE_CONFIG_DIR',
];

/** Seeds the page world, then the chat on top of it; answers the merged manifest. */
export function seedChat(probePort) {
  const base = seedPageView(probePort);
  const out = execFileSync('npx', ['tsx', 'e2e/seed-chat.ts', base.home, base.pageId], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((l) => l.startsWith('SEED='));
  if (line === undefined) throw new Error('the chat seed printed no SEED= line');
  return { ...base, ...JSON.parse(line.slice(5)) };
}

/** Launch the built app on the chat world; the dev bridge answering is the readiness signal. The
 *  page's own errors (uncaught exceptions and console errors) are collected from the first window on. */
export async function launchChatApp() {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run the npm script (it builds first)');
  }
  const probe = await startProbe();
  const seed = seedChat(probe.port);
  const profile = freshProfile();
  console.log(`profile: ${profile.dir}`);
  const env = {
    ...process.env,
    HOME: seed.home,
    DOCKET_DATA_DIR: seed.dataDir,
    DOCKET_DEV_BRIDGE: '1',
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
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForFunction(
    () => typeof window.docket?.pageView?.open === 'function' && typeof window.docketDev?.call === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const reply = await page.evaluate(() => window.docketDev.call('page_view.trace'));
      if (JSON.parse(reply.payload).ok === true) break;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`the dev bridge never answered (${String(error).split('\n')[0]}); devBridgeEnabled requires DOCKET_DEV_BRIDGE=1, an unpackaged app and a data dir outside <HOME>/.docket`);
      }
    }
    if (Date.now() > deadline) throw new Error('the dev bridge answered but page_view.trace was not ok');
    await new Promise((done) => setTimeout(done, 250));
  }
  return { app, page, seed, probe, errors };
}
