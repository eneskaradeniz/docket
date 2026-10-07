// e2e/launch-cdp.mjs — `node e2e/launch-cdp.mjs` (after npm run build). Opens the BUILT app with
// Chromium's remote debugging port on 9222 (DOCKET_CDP_PORT overrides it) and DOCKET_DATA_DIR
// aimed at a fresh temp directory, so another session can attach to the real running app —
// playwright: chromium.connectOverCDP('http://localhost:9222') — and read a live screen. The port
// and the temp path are printed once the port answers; Ctrl-C stops the app and removes the temp
// directory.
//
// The operator's ~/.docket is never written: the app's only storage seam is DOCKET_DATA_DIR, and
// the launcher itself writes nothing there. That is also why this launcher does not take the host
// e2e lock — the lock directory lives under ~/.docket, and moving it elsewhere would stop excluding
// the suites this tool can collide with anyway.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const PORT = Number(process.env.DOCKET_CDP_PORT ?? 9222);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  console.error(`DOCKET_CDP_PORT is not a port number: ${process.env.DOCKET_CDP_PORT}`);
  process.exit(2);
}

if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
  console.error('the built app is missing — run npm run build first');
  process.exit(1);
}

// Under plain node the electron module resolves to the path of its binary — the same resolution
// playwright's own electron launcher builds on.
const nodeRequire = createRequire(import.meta.url);
const electronBinary = nodeRequire('electron');

const dataDir = mkdtempSync(join(tmpdir(), 'docket-cdp-'));
const child = spawn(
  electronBinary,
  // The debugging switch must precede the app path: arguments after it belong to the app.
  [`--remote-debugging-port=${PORT}`, join(ROOT, 'dist-electron', 'main.js')],
  { env: { ...process.env, DOCKET_DATA_DIR: dataDir }, stdio: 'inherit' },
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  // A wedged browser must not keep the launcher — and the temp dir — alive forever.
  setTimeout(() => child.kill('SIGKILL'), 5000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  if (!stopping) console.error(`cdp: the app exited on its own (code ${code ?? 'signal'})`);
  process.exit(stopping ? 0 : 1);
});

// Attaching too early is a connection refused; the poll prints the port only once it truly
// answers, so the printed URL is one a reader can open.
const startedAt = Date.now();
for (;;) {
  try {
    const response = await fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch {
    // the port is not up yet
  }
  if (Date.now() - startedAt > 30_000) {
    console.error('cdp: the debugging port never answered — stopping the app');
    stop();
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`cdp: port ${PORT} answering at http://localhost:${PORT}/json/version`);
console.log(`cdp: data dir ${dataDir}`);
console.log('cdp: Ctrl-C stops the app and removes the data dir');
