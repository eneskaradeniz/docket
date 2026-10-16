// scope-match.ts — module-internal containment helpers shared by the two halves of the write
// scope: the completed-run verdict (stage-output.ts) and the before-the-ask guard (write-scope.ts).
// Not re-exported through the module index; the lexical frame is the string it is given (no
// node:path, no symlink knowledge — the executor's sandbox owns the filesystem truth).

/** Trims trailing separators off a configured root; an empty result means "not set". */
export const trimSlashes = (root: string): string => {
  let end = root.length;
  while (end > 0 && root[end - 1] === '/') end -= 1;
  return root.slice(0, end);
};

export const underRoot = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`);

/** `*` matches inside one segment; `**` matches across segments, including none. */
const segmentMatches = (pattern: string, segment: string): boolean => {
  if (pattern === '*') return true;
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === segment;
  let from = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    if (part.length === 0) continue;
    const at = segment.indexOf(part, from);
    if (at < 0) return false;
    if (i === 0 && !pattern.startsWith('*') && at !== 0) return false;
    from = at + part.length;
  }
  const last = parts[parts.length - 1] ?? '';
  return pattern.endsWith('*') || segment.endsWith(last);
};

const globMatches = (glob: string, path: string): boolean => {
  const g = glob.split('/');
  const p = path.split('/');
  const walk = (gi: number, pi: number): boolean => {
    if (gi === g.length) return pi === p.length;
    const part = g[gi] ?? '';
    if (part === '**') {
      if (walk(gi + 1, pi)) return true;
      if (pi >= p.length) return false;
      return walk(gi, pi + 1);
    }
    if (pi >= p.length) return false;
    if (!segmentMatches(part, p[pi] ?? '')) return false;
    return walk(gi + 1, pi + 1);
  };
  return walk(0, 0);
};

export const matchesAny = (globs: readonly string[], path: string): boolean => {
  for (const glob of globs) {
    if (globMatches(glob, path)) return true;
  }
  return false;
};
