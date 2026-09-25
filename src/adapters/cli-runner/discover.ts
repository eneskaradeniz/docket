// src/adapters/cli-runner/discover.ts — agent auto-discovery (WO-0107 / Faz D, issue #108).
//
// An Electron-launched process's PATH is thinner than a login shell's (no rc-file additions) —
// the problem nexu-io/open-design solved by scanning PATH PLUS well-known toolchain
// directories (their executables.ts:94-108; the same lesson, our own list). This module finds
// each known vendor's binary in that union, honoring a per-vendor `<ID>_BIN` override (the
// escape hatch when detection still misses), and streams ONE RESULT PER VENDOR as each probe
// finishes — the wizard's "found on this machine" checklist never blocks on all of them.
//
// Detection is READ-ONLY knowledge: the spawn path resolves binaries through child_process's
// own PATH search (plus the override, which candidatesOf carries); this module feeds surfaces
// (the settings' per-vendor row, the onboarding wizard when its Figma-gated visuals land).
import { accessSync, constants as fsConstants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CliRunnerDef } from './def';
import { binEnvKey } from './def';

export type DetectionSource = 'override' | 'path' | 'well-known';

/** One vendor's detection outcome. `path: null` = not found anywhere (the honest absent —
 *  the surface shows nothing, never a guessed install). */
export interface VendorDetection {
  id: string;
  path: string | null;
  source: DetectionSource | null;
}

/** Is there an EXECUTABLE file at `p`? (exists + not a directory + the X bit; ENOENT/EACCES
 *  read as absent, never a throw — detection degrades, it never blocks boot.) */
function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    accessSync(p, fsConstantsX);
    return true;
  } catch {
    return false;
  }
}
const fsConstantsX = fsConstants.X_OK;

/** The PATH entries, in order, deduped (a login-shell-THIN PATH is the whole reason the
 *  well-known set below exists — the order still respects whatever PATH the app did get). */
export function pathDirs(pathEnv: string | undefined): string[] {
  return [...new Set((pathEnv ?? '').split(':').filter((p) => p !== ''))];
}

/**
 * The well-known toolchain directories (open-design's set, our own spelling): Homebrew (both
 * arms), ~/.local/bin, ~/.bun/bin, volta, ~/bin, and every nvm-managed node's bin. Pure over
 * its inputs; `listDir` is injected so tests fake an nvm tree without touching the real home.
 */
export function wellKnownDirs(input: {
  home: string;
  platform: NodeJS.Platform;
  pathEnv: string | undefined;
  listDir?: (p: string) => string[];
}): string[] {
  const { home, platform } = input;
  const listDir = input.listDir ?? ((p: string) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  });
  const out: string[] = [];
  if (platform === 'darwin' || platform === 'linux') {
    out.push('/opt/homebrew/bin', '/usr/local/bin');
    out.push(join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.volta', 'bin'), join(home, 'bin'));
    // nvm: one bin per managed node version (~/.nvm/versions/node/<v>/bin), newest-listed first
    const versionsRoot = join(home, '.nvm', 'versions', 'node');
    const versions = listDir(versionsRoot).sort().reverse();
    for (const v of versions) out.push(join(versionsRoot, v, 'bin'));
  }
  return out.filter((d) => !pathDirs(input.pathEnv).includes(d)); // PATH already covered above
}

/** ONE vendor's probe: the `<ID>_BIN` override first, then each candidate bin name through the
 *  PATH dirs, then the well-known dirs. First executable wins; null when nothing did. */
export function detectOne(def: Pick<CliRunnerDef, 'id' | 'bin' | 'fallbackBins'>, dirs: { path: string[]; wellKnown: string[] }): VendorDetection {
  const override = process.env[binEnvKey(def.id)];
  if (override !== undefined && override !== '' && isExecutableFile(override)) {
    return { id: def.id, path: override, source: 'override' };
  }
  const names = [def.bin, ...(def.fallbackBins ?? [])];
  for (const name of names) {
    for (const dir of dirs.path) {
      const p = join(dir, name);
      if (isExecutableFile(p)) return { id: def.id, path: p, source: 'path' };
    }
  }
  for (const name of names) {
    for (const dir of dirs.wellKnown) {
      const p = join(dir, name);
      if (isExecutableFile(p)) return { id: def.id, path: p, source: 'well-known' };
    }
  }
  return { id: def.id, path: null, source: null };
}

/**
 * Probe every vendor, streaming one result per vendor as it resolves (`onResult` fires per
 * vendor, never batched) — the wizard's checklist fills in as probes finish. The resolved
 * array is the same results in the INPUT order (a stable display order for surfaces).
 */
export async function detectVendors(
  defs: readonly Pick<CliRunnerDef, 'id' | 'bin' | 'fallbackBins'>[],
  opts: { onResult?: (d: VendorDetection) => void; home?: string } = {},
): Promise<VendorDetection[]> {
  const home = opts.home ?? process.env.HOME ?? '~';
  const dirs = {
    path: pathDirs(process.env.PATH),
    wellKnown: wellKnownDirs({ home, platform: process.platform, pathEnv: process.env.PATH }),
  };
  const results = new Map<string, VendorDetection>();
  await Promise.all(
    defs.map(async (def) => {
      const r = detectOne(def, dirs);
      results.set(def.id, r);
      opts.onResult?.(r);
    }),
  );
  return defs.map((def) => results.get(def.id)!);
}
