// Validates agent-cited `path:line` pointers against the real worktree on disk.
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { EvidenceChecker } from '../../application/index';

interface LineSpec {
  readonly start: number;
  readonly end: number;
}

// `<line>` or `<start>-<end>`, 1-based.
function parseLineSpec(spec: string): LineSpec | undefined {
  const single = /^(\d+)$/.exec(spec);
  const range = /^(\d+)-(\d+)$/.exec(spec);
  const start = Number(single?.[1] ?? range?.[1]);
  const end = Number(single?.[1] ?? range?.[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (start < 1 || end < start) return undefined;
  return { start, end };
}

// A trailing newline closes the last line; it does not open an empty extra line.
function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function isInsideCwd(realCwd: string, realTarget: string): boolean {
  const rel = relative(realCwd, realTarget);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

async function resolveOne(cwd: string, pointer: string): Promise<boolean> {
  const sep = pointer.lastIndexOf(':');
  if (sep <= 0 || sep === pointer.length - 1) return false; // no path, or no line spec
  const relPath = pointer.slice(0, sep);
  const spec = parseLineSpec(pointer.slice(sep + 1));
  if (spec === undefined || relPath.length === 0 || isAbsolute(relPath)) return false;

  let realCwd: string;
  let realTarget: string;
  try {
    realCwd = await realpath(cwd);
    // realpath resolves both `..` chains and symlinks, so containment is judged on the real target.
    realTarget = await realpath(resolve(cwd, relPath));
  } catch {
    return false; // cwd or target missing / unreadable
  }
  if (!isInsideCwd(realCwd, realTarget)) return false;

  try {
    const info = await stat(realTarget);
    if (!info.isFile()) return false;
    const content = await readFile(realTarget, 'utf8');
    return countLines(content) >= spec.end;
  } catch {
    return false;
  }
}

export function createEvidenceChecker(): EvidenceChecker {
  return {
    async resolvePointers(cwd, pointers) {
      // An empty list cites nothing and proves nothing: false per contract.
      if (pointers.length === 0) return false;
      for (const pointer of pointers) {
        if (!(await resolveOne(cwd, pointer))) return false;
      }
      return true;
    },
  };
}
