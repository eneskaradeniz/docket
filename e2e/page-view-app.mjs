// e2e/page-view-app.mjs — the hostile-page world's launcher (J-12): a throwaway home holding one
// published page (e2e/seed-page-view.ts) whose HTML attacks everything outside its own origin, a
// local counting HTTP probe the page aims its exfiltration at, stub CLI binaries first on PATH, and
// the BUILT app on top with HOME and DOCKET_DATA_DIR aimed at that fixture and the dev bridge armed
// (the only way to read what the page view's session saw). Hermetic like the roadmap world: every
// home-derived root resolves through $HOME, the variables that can steer a root away from it are
// stripped, no account exists, no keychain write happens, no agent runs and nothing can spend. The
// caller holds the host lock, as launchDesignApp does.
//
// How the probe port reaches the world: the probe server listens on port 0 (the OS picks a free
// one) BEFORE seeding, and the port is passed to the seed as its second argument, which writes it
// into the page's HTML. The probe's hit list stays in this process; the journey reads it directly.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

import { assertProfileIsolated, freshProfile } from './profile.mjs';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

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

/** A local counting probe on ONE free port, at three levels: HTTP requests (`hits`, request
 *  lines), raw TCP connections (`connections`, which also catches a preconnect or a WebSocket
 *  handshake that never became an HTTP request) and UDP datagrams (`datagrams`, e.g. WebRTC STUN
 *  — CSP does not govern those). Anything above zero is an escape from the view. */
export async function startProbe() {
  const hits = [];
  const counts = { connections: 0, datagrams: 0 };
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    response.statusCode = 204;
    response.end();
  });
  server.on('connection', () => {
    counts.connections += 1;
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address();
  // UDP and TCP port spaces are separate: the datagram socket binds the same number.
  const udp = createSocket('udp4');
  udp.on('message', () => {
    counts.datagrams += 1;
  });
  await new Promise((done, fail) => {
    udp.once('error', fail);
    udp.bind(port, '127.0.0.1', done);
  });
  return {
    port,
    hits,
    get connections() {
      return counts.connections;
    },
    get datagrams() {
      return counts.datagrams;
    },
    close: async () => {
      udp.close();
      await new Promise((done) => server.close(() => done()));
    },
  };
}

/** Seed the throwaway home and return the parsed SEED manifest plus the stub bin dir. */
export function seedPageView(probePort) {
  if (!existsSync(join(ROOT, 'e2e', 'seed-page-view.ts'))) throw new Error('e2e/seed-page-view.ts is missing');
  const home = mkdtempSync(join(tmpdir(), 'docket-page-view-home-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  // Stubs that fail fast: the startup quota poll and the discovery probes resolve their CLIs from
  // PATH, and none of them may reach a real binary.
  for (const name of ['claude', 'codex', 'agy', 'copilot', 'cursor', 'opencode']) {
    const stub = join(bin, name);
    writeFileSync(stub, '#!/bin/sh\nexit 1\n');
    chmodSync(stub, 0o755);
  }
  const out = execFileSync('npx', ['tsx', 'e2e/seed-page-view.ts', home, String(probePort)], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((l) => l.startsWith('SEED='));
  if (line === undefined) throw new Error('the page-view seed printed no SEED= line');
  return { ...JSON.parse(line.slice(5)), bin };
}

/** Launch the built app on the hostile-page world; the dev bridge answering is the readiness signal. */
export async function launchPageViewApp() {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run the npm script (it builds first)');
  }
  const probe = await startProbe();
  const seed = seedPageView(probe.port);
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
  await page.waitForFunction(
    () => typeof window.docket?.pageView?.open === 'function' && typeof window.docketDev?.call === 'function',
    undefined,
    { timeout: 30_000 },
  );
  // The preload exposes window.docketDev unconditionally, so its presence proves nothing: the
  // handler behind it exists only when devBridgeEnabled holds (flag, unpackaged, data dir outside
  // <HOME>/.docket). Readiness is a real op answering.
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
  return { app, page, seed, probe };
}
