// e2e/lock.mjs — the host-wide E2E lock (WO-0101 step 1). One Electron suite per MACHINE: parallel
// worktrees each ran their own e2e/ui.mjs and the stacked suites (load ~100, 25+ Electron processes)
// hung the heaviest spec on every run (measured 2026-09-23). The lock is a directory — `mkdir` is
// atomic, so two suites starting in the same second cannot both win (a `ps` look-then-run races).
//
// Rules: a held lock is WAITED on, never skipped (no bypass flag); a lock whose owner process is
// gone (crash, kill -9) or which is older than the stale bound is taken over; the lock is released
// on normal exit, uncaught errors (both fire 'exit'), SIGINT, SIGTERM and SIGHUP — never left behind by Ctrl-C.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_DIR = process.env.DOCKET_E2E_LOCK_DIR ?? join(homedir(), '.docket', 'e2e.lock');
const STALE_MS = Number(process.env.DOCKET_E2E_LOCK_STALE_MIN ?? 90) * 60_000;
const POLL_MS = Number(process.env.DOCKET_E2E_LOCK_POLL_MS ?? 2_000);
const LOG_EVERY_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readOwner = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
  } catch {
    return undefined; // mid-creation (dir made, owner not yet written) or already gone
  }
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, just not ours to signal
  }
};

// The pid can be reused by an unrelated process after a crash, so age bounds staleness too.
const isStale = (owner) => !alive(owner.pid) || Date.now() - owner.startedAt > STALE_MS;

// A dir with no owner.json is a suite caught between mkdir and write — or one that died there.
const ORPHAN_MS = 10_000;
const orphaned = () => {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs > ORPHAN_MS;
  } catch {
    return false;
  }
};

const describe = (owner) =>
  `${owner.cwd} (pid ${owner.pid}, ${Math.round((Date.now() - owner.startedAt) / 60_000)} dk)`;

// Takeover without stealing a FRESH lock: rename the stale dir aside (atomic), then confirm the
// moved dir still carries the stale owner's token. If another waiter won the race and a live
// suite's lock got moved instead, put it back.
const takeOver = (stale) => {
  const aside = `${LOCK_DIR}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(LOCK_DIR, aside);
  } catch {
    return; // someone else moved or released it first — retry the mkdir
  }
  const moved = readOwner(aside);
  if (moved && moved.token !== stale.token) {
    try {
      renameSync(aside, LOCK_DIR);
    } catch {
      // the slot was re-taken in between; the moved owner's release is a no-op on a missing dir
    }
    return;
  }
  rmSync(aside, { recursive: true, force: true });
  console.log(`  e2e kilidi: bayat kilit devralındı — ${describe(stale)}`);
};

export async function acquireE2eLock(label = process.cwd()) {
  const token = randomUUID();
  const owner = { pid: process.pid, cwd: label, token, startedAt: Date.now() };
  mkdirSync(join(LOCK_DIR, '..'), { recursive: true });
  const waitStart = Date.now();
  let lastLog = 0;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(join(LOCK_DIR, 'owner.json'), JSON.stringify(owner));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readOwner(LOCK_DIR);
    if (held ? isStale(held) : orphaned()) {
      takeOver(held ?? { pid: 0, cwd: '(sahipsiz)', token: undefined, startedAt: Date.now() });
      continue;
    }
    if (Date.now() - lastLog >= LOG_EVERY_MS) {
      lastLog = Date.now();
      const waited = Math.round((Date.now() - waitStart) / 1000);
      console.log(`  e2e kilidi: sırada (${waited} sn) — koşan: ${held ? describe(held) : 'başlıyor'}`);
    }
    await sleep(POLL_MS);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // release only what we own — a takeover may already have moved our dir aside
    if (readOwner(LOCK_DIR)?.token === token) rmSync(LOCK_DIR, { recursive: true, force: true });
  };
  process.on('exit', release);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.once(sig, () => {
      release();
      process.exit(code);
    });
  }
  if (Date.now() - waitStart > POLL_MS) {
    console.log(`  e2e kilidi: alındı (${Math.round((Date.now() - waitStart) / 1000)} sn bekledi)`);
  }
  return release;
}
