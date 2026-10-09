// Capability scan: reads capability sources inside the config directory of accounts the user
// adopted. Contract: docs/v2/infrastructure.md I-42/I-43. Reads only — nothing is ever written
// into an identityDir, and parsing drops everything the candidate type cannot carry: for the
// state file only each server's key and command string survive (args, env names and values,
// headers and credential-carrying URLs are dropped before anything is returned or logged), and
// only its top-level user-scope servers key is read — per-project state is never touched.
import { constants, open, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import type { CapabilityDiscovery, CapabilityScanAccount } from '../../../application/index';
import type { CapabilityCandidate } from '../../../domain/index';
import { identityOfCandidate } from '../../../domain/index';

/** Row caps (I-42): a file over its row's cap is skipped silently — never an error, never logged
 *  with content. The memory file is hand-written instructions, never machine-grown, so it keeps
 *  the small cap; the state file grows with the user's project history (active users commonly
 *  pass 256 KiB) and only its top-level mcpServers is read, so it carries its own larger cap. */
export const CAPABILITY_SCAN_MEMORY_MAX_BYTES = 256 * 1024;
export const CAPABILITY_SCAN_STATE_MAX_BYTES = 4 * 1024 * 1024;

const PROVIDER_ID = 'claude-code';
const MEMORY_FILE_NAME = 'CLAUDE.md';
const STATE_FILE_NAME = '.claude.json';

/** The narrow file-system surface the scan needs; tests inject an in-memory one. Every failure
 *  of `readText` is `undefined` — a skipped file, never a thrown error. */
export interface CapabilityScanFs {
  listEntries(dir: string): Promise<readonly string[]>;
  isDirectory(path: string): Promise<boolean>;
  /** Text of the file, `undefined` when it does not exist, escapes its directory, is over
   *  `maxBytes`, is not a regular file, holds a NUL byte or is not UTF-8. */
  readText(path: string, maxBytes: number): Promise<string | undefined>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** I-43, the memory row: one context candidate for the user-level memory file — the path is
 *  referenced, never copied; the description is the first non-empty line. */
const parseMemoryFile = (
  text: string,
  account: CapabilityScanAccount,
  path: string,
): readonly CapabilityCandidate[] => {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  return [
    {
      identity: identityOfCandidate('context', MEMORY_FILE_NAME),
      kind: 'context',
      name: MEMORY_FILE_NAME,
      sources: [account.id],
      path,
      ...(firstLine === undefined ? {} : { description: firstLine }),
    },
  ];
};

/** I-43, the state-file row: the user-scope servers only. An entry survives only with a string
 *  `command` (the stdio form) — a remote entry's URL is dropped, and a candidate has no field
 *  for one, so the entry yields nothing rather than an unimportable row. */
const parseStateFile = (
  text: string,
  account: CapabilityScanAccount,
): readonly CapabilityCandidate[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const servers = parsed['mcpServers'];
  if (!isRecord(servers)) return [];
  const found: CapabilityCandidate[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    const command = entry['command'];
    if (typeof command !== 'string') continue;
    found.push({
      identity: identityOfCandidate('mcp', name, command),
      kind: 'mcp',
      name,
      sources: [account.id],
      command,
    });
  }
  return found;
};

interface ScanRow {
  readonly file: string;
  readonly maxBytes: number;
  readonly parse: (text: string, account: CapabilityScanAccount, path: string) => readonly CapabilityCandidate[];
}

/** I-42's scan map: the fixed file names each provider's own layout proves, at the config root.
 *  claude-code: the user memory file and the CLI's state file (its user-scope servers). Every
 *  other provider has no row — no finds — until a row is evidenced (the PR's table). */
const SCAN_ROWS: Readonly<Record<string, readonly ScanRow[]>> = {
  [PROVIDER_ID]: [
    { file: MEMORY_FILE_NAME, maxBytes: CAPABILITY_SCAN_MEMORY_MAX_BYTES, parse: parseMemoryFile },
    { file: STATE_FILE_NAME, maxBytes: CAPABILITY_SCAN_STATE_MAX_BYTES, parse: parseStateFile },
  ],
};

export function createCapabilityScan(options: { readonly fs: CapabilityScanFs }): CapabilityDiscovery {
  const { fs } = options;
  return {
    async scan(accounts) {
      const found: CapabilityCandidate[] = [];
      for (const account of accounts) {
        // A-90: no identityDir (machine login, compatible endpoint) — nothing on this disk to scan.
        if (account.identityDir === undefined) continue;
        const rows = SCAN_ROWS[account.provider];
        if (rows === undefined) continue;
        try {
          if (!(await fs.isDirectory(account.identityDir))) continue;
        } catch {
          continue; // a missing or broken config directory yields no candidates
        }
        for (const row of rows) {
          const path = join(account.identityDir, row.file);
          let text: string | undefined;
          try {
            text = await fs.readText(path, row.maxBytes);
          } catch {
            continue; // one unreadable file never stops the scan
          }
          if (text === undefined) continue;
          try {
            found.push(...row.parse(text, account, path));
          } catch {
            continue; // nor does one unparseable one
          }
        }
      }
      return found;
    },
  };
}

/** The real reader over node:fs. The adapter only asks for row file names at the config root, so
 *  the containing directory is the path's own dirname: the symlink-resolved file must lie under
 *  the symlink-resolved root (the resolved root plus a separator, never a string-coincidence
 *  prefix), and the final component is re-vetted at open — O_NOFOLLOW against a symlink swapped
 *  in after the realpath, O_NONBLOCK so a FIFO cannot block the read. */
export function createNodeCapabilityScanFs(): CapabilityScanFs {
  return {
    async listEntries(dir) {
      return readdir(dir);
    },
    async isDirectory(path) {
      return (await stat(path)).isDirectory();
    },
    async readText(path, maxBytes) {
      try {
        const realRoot = await realpath(dirname(path));
        const realTarget = await realpath(path);
        if (!realTarget.startsWith(realRoot + sep)) return undefined;
        const handle = await open(realTarget, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const s = await handle.stat();
          if (!s.isFile()) return undefined;
          if (s.size > maxBytes) return undefined;
          // The read is capped so a file that grew past the limit never loads past it.
          const cap = Buffer.alloc(maxBytes);
          const { bytesRead } = await handle.read(cap, 0, maxBytes, 0);
          const buffer = cap.subarray(0, bytesRead);
          if (buffer.includes(0)) return undefined;
          return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } finally {
          await handle.close();
        }
      } catch {
        return undefined; // every failure is a silently skipped file
      }
    },
  };
}

export function createNodeCapabilityScan(): CapabilityDiscovery {
  return createCapabilityScan({ fs: createNodeCapabilityScanFs() });
}
