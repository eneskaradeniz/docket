// write-scope.ts — the before-the-ask half of the write scope (R-159, #1235 addendum): may this
// role's write tool touch this target? The verdict is deny-only — it never allows, so an
// unchecked or in-scope write keeps going down the normal ask/risk path. The completed-run half
// is stage-output.ts; the containment helpers are shared through scope-match.ts.
import type { WriteScope } from '../definitions/index';

import { matchesAny, trimSlashes, underRoot } from './scope-match';

/** The write tools the verdict judges, in Docket-tool language. A provider's own spellings arrive
 *  at the executor already translated (the agy bridge maps its write family to `Write`), so the
 *  list knows no provider names. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Run facts the verdict needs. Every field is optional: an absent fact is exactly what makes a
 *  verdict unchecked — the guard denies only what it can see whole. */
export interface WriteScopeContext {
  /** The run's working directory; a relative target resolves against it. */
  readonly cwd?: string;
  /** The work order's worktree — the repo boundary every located scope measures from. */
  readonly worktreeRoot?: string;
  /** The repo's docs root, repo-relative. */
  readonly docsRoot?: string;
  /** The repo's listed test folders, repo-relative globs. */
  readonly testGlobs?: readonly string[];
}

export type WriteScopeDenyReason =
  | 'read-only-role' // scope none: the role writes nowhere
  | 'outside-docs-root'
  | 'outside-worktree'
  | 'outside-test-folders';

export type WriteScopeVerdict =
  | { readonly verdict: 'unchecked' } // no certain deny: the normal ask/risk path decides
  | { readonly verdict: 'deny'; readonly reason: WriteScopeDenyReason };

const UNCHECKED: WriteScopeVerdict = { verdict: 'unchecked' };

/** Lexical normalisation: `.` and `..` fold, duplicate separators collapse, a trailing slash
 *  drops, and `..` at the root stays at the root. Symlinks are never resolved — the comparison
 *  stays a string compare (the same frame risk.ts gives its classifier). */
const normalizeAbsolute = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
};

/** The target as an absolute, normalised path. `~` is never expanded — where a shell would take
 *  it is a fact the string does not carry — and a relative target needs the run's cwd. */
const resolveTarget = (target: string, cwd: string | undefined): string | undefined => {
  if (target.startsWith('~')) return undefined;
  if (target.startsWith('/')) return normalizeAbsolute(target);
  return cwd === undefined || cwd === '' ? undefined : normalizeAbsolute(`${cwd}/${target}`);
};

export function writeScopeVerdict(input: {
  readonly scope: WriteScope;
  readonly tool: string;
  readonly target: string | undefined;
  readonly context: WriteScopeContext;
}): WriteScopeVerdict {
  // Tools that write only indirectly (Bash first among them) are the risk table's and the
  // human's to judge; a target string that never arrived decides nothing.
  if (!WRITE_TOOLS.has(input.tool)) return UNCHECKED;
  if (input.target === undefined || input.target === '') return UNCHECKED;
  // A read-only role writes nowhere, so the target's location is beside the point — no context
  // fact is needed, and even a ~-relative name denies.
  if (input.scope.kind === 'none') return { verdict: 'deny', reason: 'read-only-role' };
  // The four located kinds all measure from the worktree; the globs of a `paths` scope are not
  // this guard's contract, so they stay unchecked.
  if (input.scope.kind === 'paths') return UNCHECKED;
  if (input.context.worktreeRoot === undefined || input.context.worktreeRoot === '') return UNCHECKED;
  const target = resolveTarget(input.target, input.context.cwd);
  if (target === undefined) return UNCHECKED;
  const worktreeRoot = normalizeAbsolute(input.context.worktreeRoot);
  switch (input.scope.kind) {
    case 'repo':
      return underRoot(worktreeRoot, target) ? UNCHECKED : { verdict: 'deny', reason: 'outside-worktree' };
    case 'docs': {
      // A missing or empty docs root is never defaulted to: a deny measured against a guessed
      // root would not be certain.
      const root = trimSlashes(input.context.docsRoot ?? '');
      if (root === '') return UNCHECKED;
      return underRoot(normalizeAbsolute(`${worktreeRoot}/${root}`), target)
        ? UNCHECKED
        : { verdict: 'deny', reason: 'outside-docs-root' };
    }
    case 'tests': {
      const globs = input.context.testGlobs ?? [];
      if (globs.length === 0) return UNCHECKED; // the repo lists no test folders
      if (!underRoot(worktreeRoot, target)) return { verdict: 'deny', reason: 'outside-test-folders' };
      return matchesAny(globs, target.slice(worktreeRoot.length + 1))
        ? UNCHECKED
        : { verdict: 'deny', reason: 'outside-test-folders' };
    }
    default:
      return UNCHECKED;
  }
}
