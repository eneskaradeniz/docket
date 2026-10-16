// Whether a completed run landed a file inside the role's write scope.
// Path shape is the page-path rule: a path that fails it (traversal, absolute, `..`) is outside
// every scope, so `docs/../src/x` cannot count as a docs write.
import type { WriteScope } from '../definitions/index';
import { validatePagePath } from '../pages/index';

import { matchesAny, trimSlashes, underRoot } from './scope-match';

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
