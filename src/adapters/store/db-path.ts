// src/adapters/store/db-path.ts — the app home: ~/.docket/docket.db (WO-0075), with a one-time
// rename-migration from the Electron-userData location docket.db lived in before. PURE at the
// decision layer: (env, home, platform) in, path decision out — the filesystem ops are injectable
// and the composition root (electron/main.ts) is the only production caller. Node builtins here
// are the adapter layer's own (the c3 ban covers core/ui/renderer only).
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface DbPathDecision {
  dbPath: string;
  /** true when the legacy Electron-userData db was renamed into ~/.docket on THIS call. */
  migrated: boolean;
}

/** Where docket.db lived until WO-0075 (the Electron userData convention, per platform). Computed
 *  from home + env (not Electron) so the resolver stays pure and the migration is testable. */
export function legacyDbPath(home: string, platform: string, env: { APPDATA?: string }): string {
  const base =
    platform === 'darwin' ? join(home, 'Library', 'Application Support', 'docket')
      : platform === 'win32' ? join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'docket')
        : join(home, '.config', 'docket');
  return join(base, 'docket.db');
}

export interface PathIo {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string) => void;
  renameSync: (from: string, to: string) => void;
}

const defaultIo: PathIo = {
  existsSync,
  mkdirSync: (path) => void mkdirSync(path, { recursive: true }),
  renameSync,
};

/** The app home is `~/.docket` — the dotdir convention of this tool's own peers (git, ssh, gh,
 *  claude): ONE path, every platform, findable by hand and backupable as a folder.
 *
 *  `env.DOCKET_DB_PATH` overrides verbatim (the E2E driver's seam — no migration logic ever runs
 *  on an explicit path: the caller owns it). Otherwise: new missing + legacy present → mkdir the
 *  home and RENAME (never copy — two live dbs is a split-brain) exactly once; every other shape
 *  (new exists, legacy missing) touches nothing. An un-migratable legacy (rename throws) is
 *  FAIL-SAFE: the legacy file stays the truth rather than risk it. */
export function resolveDbPath(
  env: { DOCKET_DB_PATH?: string; APPDATA?: string },
  home: string,
  platform: string,
  io: PathIo = defaultIo,
): DbPathDecision {
  if (env.DOCKET_DB_PATH) return { dbPath: env.DOCKET_DB_PATH, migrated: false };
  const dbPath = join(home, '.docket', 'docket.db');
  const legacy = legacyDbPath(home, platform, env);
  if (!io.existsSync(dbPath) && io.existsSync(legacy)) {
    try {
      io.mkdirSync(join(home, '.docket'));
      io.renameSync(legacy, dbPath);
      return { dbPath, migrated: true };
    } catch {
      return { dbPath: legacy, migrated: false };
    }
  }
  return { dbPath, migrated: false };
}
