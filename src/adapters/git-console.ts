// src/adapters/git-console.ts — the operator console's git reads (WO-0068, ADR-0018). The spawn
// lives here (node-side tsconfig, health.ts's pattern); the composition root composes these with
// the store's `woRepoPaths` jail into the `docket:console:*` channels — the jail is NEVER the
// adapter's concern, which is why every call takes an already-jailed repoPath.
//
// Contract (health.ts / the forge adapter's shared ruling): exit !== 0 is the universal degraded
// signal — the stderr line (or the spawn failure's message) is the reason, displayable verbatim.
// The adapter never guesses: a repo that cannot be read is the error arm, not a fake clean tree.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoFileChange } from '../core/console';
import { DIFF_LINE_CHAR_CAP, type DiffLine, type LineDiff } from '../core/diff';

export interface CommandResult {
  exit: number;
  stdout: string;
  stderr: string;
}

/** The ONE seam — production spawns the real binary; tests inject observed shapes. Never rejects. */
export type CommandRunner = (args: string[]) => Promise<CommandResult>;

const execFileP = promisify(execFile);

export function gitProcessRunner(): CommandRunner {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileP('git', args, {
        encoding: 'utf-8',
        timeout: 5_000,
        maxBuffer: 16 * 1024 * 1024, // past execFile's 1 MB default — a big status/diff degrades by the contract above, not a buffer error
      });
      return { exit: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      return {
        exit: typeof err.code === 'number' ? err.code : 127,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? String(e),
      };
    }
  };
}

/** The carried line: the first non-empty stderr line, else the given fallback (usually the bare
 *  exit) — the displayable reason, verbatim, like every degraded surface before it. */
export function carriedLine(r: CommandResult, fallback: string): string {
  const line = r.stderr.split('\n').map((l) => l.trim()).find((l) => l !== '');
  return line === undefined || line === '' ? fallback : line;
}

/** One repo's status look: ok with git's own facts, or the error arm with git's line. The
 *  discriminated pair IS the shaped unknown — a failed look must never render as a clean tree.
 *  `branch` is absent on a detached HEAD; `ahead` is absent with no upstream; absence is absence. */
export type StatusResult =
  | { kind: 'ok'; branch?: string; ahead?: number; files: RepoFileChange[] }
  | { kind: 'error'; error: string };

/** `git -C <path> --no-optional-locks status --porcelain=v1 -b --untracked-files=normal`, parsed:
 *  the `## branch...upstream [ahead N]` header (detached → branch stays absent) and each porcelain
 *  line → `{ path, status }`. `core.quotepath` is switched off at the call so a non-ASCII path
 *  arrives verbatim, never as the octal-quoted form a later diff call could not match. Rename and
 *  copy pairs carry `from -> to` — the TARGET path is the file git knows now. The status letter is
 *  the first significant letter of the XY pair ('??' stays '??'). */
export async function gitStatus(run: CommandRunner, repoPath: string): Promise<StatusResult> {
  const r = await run([
    '-C', repoPath,
    '-c', 'core.quotepath=false',
    '--no-optional-locks', 'status', '--porcelain=v1', '-b', '--untracked-files=normal',
  ]);
  if (r.exit !== 0) return { kind: 'error', error: carriedLine(r, `git status failed (exit ${r.exit})`) };
  const files: RepoFileChange[] = [];
  let branch: string | undefined;
  let ahead: number | undefined;
  for (const raw of r.stdout.split('\n')) {
    if (raw === '') continue;
    if (raw.startsWith('## ')) {
      const head = raw.slice(3);
      // A detached HEAD (`HEAD (no branch)`) and an UNBORN branch (`No commits yet on main` — a
      // repo with no commit yet) name no branch to push or open a PR from: branch stays ABSENT,
      // never a guessed name.
      if (!head.startsWith('HEAD (no branch)') && !head.startsWith('No commits yet')) {
        branch = head.split('...')[0]!.split(' ')[0]!.trim();
        const m = /\[ahead (\d+)/.exec(head);
        if (m) ahead = Number(m[1]);
      }
      continue;
    }
    if (raw.length < 4) continue; // porcelain v1 is XY + space + at least one path char — anything else is not a row
    const xy = raw.slice(0, 2);
    let path = raw.slice(3);
    if (xy.includes('R') || xy.includes('C')) {
      const arrow = path.lastIndexOf(' -> ');
      if (arrow !== -1) path = path.slice(arrow + 4);
    }
    files.push({ path, status: xy === '??' ? '??' : (xy[0] !== ' ' ? xy[0] : xy[1])! });
  }
  return {
    kind: 'ok',
    ...(branch !== undefined ? { branch } : {}),
    ...(ahead !== undefined ? { ahead } : {}),
    files,
  };
}

/** ONE file's unified diff, verbatim (`git diff -- <file>` — the working tree against the index).
 *  Untracked files carry no HEAD text: the patch is empty and STAYS empty — the porcelain '??'
 *  letter is the (new file) fact, and `git diff --no-index /dev/null <file>` would be a second
 *  binary surface for a fact the status already carries. A failed spawn resolves '' — a row whose
 *  expansion cannot be read renders as no-diff, never an invented patch. */
export async function gitDiff(run: CommandRunner, repoPath: string, file: string): Promise<string> {
  const r = await run(['-C', repoPath, '--no-optional-locks', 'diff', '--', file]);
  return r.exit !== 0 ? '' : r.stdout;
}

const DIFF_SHOW_CAP = 40; // the ask-card peek's own cap (core/diff unifiedDiffLines' default)

/** git's unified patch → the core/diff `LineDiff` structure, so the composition root's `diffFor`
 *  returns exactly what `diffPeek` returns and the expansion speaks the ask-card peek's grammar.
 *  Header and hunk-lead lines are structure, not content: collection starts at the first `@@` and
 *  a later `@@` line is the next hunk's lead. The `\ No newline at end of file` marker carries no
 *  line of its own. The peek stays CAPPED like every peek — 40 lines shown, each sliced to the
 *  shared char cap, the rest counted as truncated (honest, not silent). */
export function unifiedPatchToDiff(patch: string): LineDiff {
  const all: DiffLine[] = [];
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    if (!inHunk) {
      if (raw.startsWith('@@')) inHunk = true;
      continue;
    }
    if (raw.startsWith('@@')) continue; // the next hunk's lead
    if (raw.startsWith('\\')) continue; // '\ No newline at end of file'
    if (raw.startsWith('+')) all.push({ op: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) all.push({ op: 'del', text: raw.slice(1) });
    else if (raw.startsWith(' ')) all.push({ op: 'ctx', text: raw.slice(1) });
    else break; // the patch's end (the split's trailing '')
  }
  if (!all.some((l) => l.op !== 'ctx')) return { lines: [], truncated: 0 };
  const shown = Math.min(all.length, DIFF_SHOW_CAP);
  return {
    lines: all.slice(0, shown).map((l) => ({
      op: l.op,
      text: l.text.length > DIFF_LINE_CHAR_CAP ? l.text.slice(0, DIFF_LINE_CHAR_CAP) : l.text,
    })),
    truncated: Math.max(0, all.length - shown),
  };
}
