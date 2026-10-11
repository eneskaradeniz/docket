// Whether a completed run landed a file inside the role's write scope.
// Path shape is the page-path rule: a path that fails it (traversal, absolute, `..`) is outside
// every scope, so `docs/../src/x` cannot count as a docs write.
import type { WriteScope } from '../definitions/index';
import { validatePagePath } from '../pages/index';

export type StageOutputVerdict = 'ok' | 'no_output' | 'not_applicable';

/** The finish reason of the run, not the folded outcome. Only `completed` is judged. */
export type StageRunFinish = 'completed' | 'failed' | 'cancelled' | 'limit';

export interface StageOutputInput {
  readonly writeScope: WriteScope;
  readonly changed: readonly string[];
  readonly runOutcome: StageRunFinish;
  /** The repo's docs root. Absent means `docs`. */
  readonly docsRoot?: string;
  /** The repo's test globs. Used only for a `tests` scope. */
  readonly testGlobs?: readonly string[];
}

const DEFAULT_DOCS_ROOT = 'docs';

const trimSlashes = (root: string): string => {
  let end = root.length;
  while (end > 0 && root[end - 1] === '/') end -= 1;
  return root.slice(0, end);
};

const docsRootOf = (input: StageOutputInput): string => {
  const given = input.docsRoot;
  if (given === undefined || trimSlashes(given).length === 0) return DEFAULT_DOCS_ROOT;
  return trimSlashes(given);
};

/** The directory or glob list the reminder names. Absent when this check does not judge the scope. */
export function stageOutputScopeRoot(
  writeScope: WriteScope,
  docsRoot: string | undefined,
  testGlobs: readonly string[] | undefined,
): string | undefined {
  switch (writeScope.kind) {
    case 'docs':
      return docsRoot === undefined || trimSlashes(docsRoot).length === 0 ? DEFAULT_DOCS_ROOT : trimSlashes(docsRoot);
    case 'tests':
      return testGlobs !== undefined && testGlobs.length > 0 ? testGlobs.join(', ') : 'tests';
    case 'paths':
      return writeScope.globs.join(', ');
    default:
      return undefined;
  }
}

const underRoot = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`);

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

const matchesAny = (globs: readonly string[], path: string): boolean => {
  for (const glob of globs) {
    if (globMatches(glob, path)) return true;
  }
  return false;
};

const pathInside = (input: StageOutputInput, path: string): boolean => {
  // The page-path rule refuses traversal before any prefix or glob is considered.
  if (!validatePagePath(path)) return false;
  switch (input.writeScope.kind) {
    case 'docs':
      return underRoot(docsRootOf(input), path);
    case 'tests':
      return matchesAny(input.testGlobs ?? [], path);
    case 'paths':
      return matchesAny(input.writeScope.globs, path);
    default:
      return false;
  }
};

const scopeIsJudged = (scope: WriteScope): boolean =>
  scope.kind === 'docs' || scope.kind === 'tests' || scope.kind === 'paths';

export function stageOutputVerdict(input: StageOutputInput): StageOutputVerdict {
  if (input.runOutcome !== 'completed' || !scopeIsJudged(input.writeScope)) return 'not_applicable';
  for (const path of input.changed) {
    if (pathInside(input, path)) return 'ok';
  }
  return 'no_output';
}
