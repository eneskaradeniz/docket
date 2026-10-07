// e2e/launch-cdp.mjs — `node e2e/launch-cdp.mjs` (after npm run build). Opens the BUILT app with
// Chromium's remote debugging port on 9222 (DOCKET_CDP_PORT overrides it) and DOCKET_DATA_DIR
// aimed at a fresh temp directory, so another session can attach to the real running app —
// playwright: chromium.connectOverCDP('http://localhost:9222') — and read a live screen. The port
// and the data path are printed once the port answers; Ctrl-C stops the app and removes the temp
// directory.
//
// DOCKET_CDP_DATA_DIR=<absolute path> swaps the temp directory for a dedicated test directory
// that is KEPT between launches: provider accounts live in the data directory's encrypted SQLite
// vault, so an account entered once (by the operator, through the app's own account step) is
// still logged in on the next launch — a fresh temp dir is an empty vault and every token account
// reads not_logged_in.
//
// The operator's ~/.docket is never written: the app's only storage seam is DOCKET_DATA_DIR, the
// launcher itself writes nothing there, and a DOCKET_CDP_DATA_DIR that equals or lies inside
// ~/.docket is refused — the real directory holds the operator's live accounts and records, which
// a test run must not touch. That is also why this launcher does not take the host e2e lock —
// the lock directory lives under ~/.docket, and moving it elsewhere would stop excluding the
// suites this tool can collide with anyway.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

// Resolves a path whose tail may not exist yet through its nearest existing ancestor. Parents are
// followed rather than refused (/tmp on macOS is a symlink), but where they land is what the
// ~/.docket check must compare against — the final component itself is refused as a symlink
// separately, before this runs.
const realPathThroughAncestors = (p) => {
  let current = p;
  const missingTail = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...missingTail);
    } catch (error) {
      // realpathSync has no throwIfNoEntry option — only a missing tail walks up; other
      // failures (permissions, loops) stay errors.
      if (error.code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) return undefined;
    missingTail.unshift(basename(current));
    current = dirname(current);
  }
};

const contains = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const requestedDataDir = process.env.DOCKET_CDP_DATA_DIR;
let dataDir;
let keepDataDir = false;
if (requestedDataDir === undefined) {
  dataDir = mkdtempSync(join(tmpdir(), 'docket-cdp-'));
} else {
  if (!isAbsolute(requestedDataDir)) {
    console.error(`DOCKET_CDP_DATA_DIR must be an absolute path: ${requestedDataDir}`);
    process.exit(2);
  }
  if (lstatSync(requestedDataDir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    console.error(`DOCKET_CDP_DATA_DIR is a symbolic link: ${requestedDataDir}`);
    process.exit(2);
  }
  // Both the plain and the resolved forms are compared, because a non-symlink path can still sit
  // inside ~/.docket through a symlinked parent.
  const plain = resolve(requestedDataDir);
  const real = realPathThroughAncestors(plain);
  const docketHome = resolve(homedir(), '.docket');
  const realDocketHome = realPathThroughAncestors(docketHome);
  const candidates = real === undefined ? [plain] : [plain, real];
  const anchors = realDocketHome === undefined ? [docketHome] : [docketHome, realDocketHome];
  if (candidates.some((candidate) => anchors.some((anchor) => contains(anchor, candidate)))) {
    console.error(`DOCKET_CDP_DATA_DIR must not be ~/.docket or a path inside it: ${requestedDataDir}`);
    process.exit(2);
  }
  // 0700: the kept directory holds the app's encrypted account vault, so no other user may read
  // it even though it lives outside the per-user temp sandbox.
  mkdirSync(requestedDataDir, { recursive: true, mode: 0o700 });
  dataDir = requestedDataDir;
  keepDataDir = true;
}

// Under plain node the electron module resolves to the path of its binary — the same resolution
// playwright's own electron launcher builds on.
const nodeRequire = createRequire(import.meta.url);
const electronBinary = nodeRequire('electron');

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
  // A kept directory is the point of DOCKET_CDP_DATA_DIR: removing it would log every account
  // out again, so only the launcher-created temp directory is cleaned up.
  if (!keepDataDir) rmSync(dataDir, { recursive: true, force: true });
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
if (keepDataDir) {
  console.log(`cdp: data dir ${dataDir} (kept)`);
  console.log('cdp: Ctrl-C stops the app; the data dir is kept for the next launch');
} else {
  console.log(`cdp: data dir ${dataDir}`);
  console.log('cdp: Ctrl-C stops the app and removes the data dir');
}
