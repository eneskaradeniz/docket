// src/cli/create.ts — pure argv→input mappers for the CLI's bootstrap commands (WO-0024 / TD-032):
// `create-workspace` and `create-work-order`. Pure by the layer rule — plain strings in, plain data
// out; no Node, no store, and no branded-identity construction (ADR-0003: identities are constructed
// only in src/adapters/, applied at the store boundary by index.ts — the composition root).
//
// Why mappers and not the host's parseArgs: parseArgs is last-value-wins, so a repeatable `--track`
// (or `--repo`) collapses to its last occurrence; these parse their own argv (flag order preserved).
// The validation mirrors the GUI's WoCreateModal — title non-empty, review-mode exactly one of
// gates|every-step (rejected, never silently defaulted), tracks = workspace code repos minus the
// decision store — so a CLI-born WO is shaped identically to a GUI-born one. Shaping argv is all these
// do; resolving --workspace (id or label) and track slugs against store data is index.ts's job.
import type { CreateWorkspaceInput, ReviewMode } from '../core/source';

/** Every mapper outcome: they never throw — the handler prints `error` and exits 2 (a usage error). */
export type Parsed<T> = { ok: true; input: T } | { ok: false; error: string };

/** parseCreateWorkOrderArgs' output: everything but the branded ids, which index.ts applies at the store. */
export interface CreateWorkOrderDraft {
  workspace: string; // workspace id OR label — resolved by the command handler against the store
  title: string;
  description: string; // '' when --description is absent (→ order.md Objective body)
  tracks: string[]; // requested repo slugs, deduped, argv order; [] = all code tracks (resolveTracks)
  reviewMode: ReviewMode; // 'gates' default
  contextFiles: string[]; // no CLI flag yet (the GUI picks files) — always [], kept for the store input
}

/** The last path segment of a repo path — the slug the store brands as a RepoId (its `repoBase`). */
export function repoSlugOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo';
}

// --- the shared tokenizer: skips the global --db pair (consumed by index.ts wherever it sits) and the
//     command token itself; every command flag here takes a value, so a valueless flag is recorded as
//     `undefined` and rejected by flagError below. A value starting with `--` is read as the next flag —
//     the same limitation the host's parseArgs has. ---
interface Flag {
  key: string;
  value: string | undefined;
}

function tokenize(argv: string[], command: string): { flags: Flag[]; stray: string[] } {
  const flags: Flag[] = [];
  const stray: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      if (a === '--db') {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) i++; // swallow --db's value too
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags.push({ key: a.slice(2), value: undefined });
      else {
        flags.push({ key: a.slice(2), value: next });
        i++;
      }
      continue;
    }
    if (a === command) continue; // the command token, wherever the caller put it
    stray.push(a);
  }
  return { flags, stray };
}

/** First flag-level problem: an unknown option (typo guard) or one missing its value. */
function flagError(flags: Flag[], known: readonly string[]): string | undefined {
  for (const f of flags) {
    if (!known.includes(f.key)) return `unknown option --${f.key} (known: ${known.map((k) => `--${k}`).join(', ')})`;
    if (f.value === undefined) return `--${f.key} requires a value`;
  }
  return undefined;
}

function lastOf(flags: Flag[], key: string): string | undefined {
  let v: string | undefined;
  for (const f of flags) if (f.key === key && f.value !== undefined) v = f.value;
  return v;
}

function allOf(flags: Flag[], key: string): string[] {
  const out: string[] = [];
  for (const f of flags) if (f.key === key && f.value !== undefined) out.push(f.value);
  return out;
}

/**
 * `create-workspace --label L --repo PATH [--repo PATH]... [--decision-store PATH]` → CreateWorkspaceInput
 * (no branded fields, so the input type itself is constructible here). The decision store must be one of
 * the given repos: the store resolves it by repo slug over the workspace's connections and silently falls
 * back to cwd otherwise — an error here is the honest failure (order.md would land in the wrong tree).
 */
export function parseCreateWorkspaceArgs(argv: string[]): Parsed<CreateWorkspaceInput> {
  const { flags, stray } = tokenize(argv, 'create-workspace');
  const err =
    flagError(flags, ['label', 'repo', 'decision-store']) ??
    (stray.length ? `unexpected argument "${stray[0]}" (this command takes flags only)` : undefined);
  if (err) return { ok: false, error: err };
  const label = lastOf(flags, 'label');
  const repos = allOf(flags, 'repo');
  const decisionStore = lastOf(flags, 'decision-store');
  if (label === undefined || !label.trim()) return { ok: false, error: 'missing required --label <text>' };
  if (!repos.length) return { ok: false, error: 'missing required --repo <path> (repeatable: one per workspace repo)' };
  for (const p of repos) if (!p.trim()) return { ok: false, error: '--repo path cannot be empty' };
  const decisionStorePath = decisionStore?.trim() || undefined;
  if (decisionStorePath !== undefined) {
    const slugs = repos.map((p) => repoSlugOf(p.trim()));
    if (!slugs.includes(repoSlugOf(decisionStorePath))) {
      return {
        ok: false,
        error: `--decision-store ${decisionStorePath} is not one of the workspace repos (${slugs.join(', ')}) — pass a --repo for it too`,
      };
    }
  }
  return {
    ok: true,
    input: { label: label.trim(), repos: repos.map((p) => ({ path: p.trim() })), decisionStorePath },
  };
}

/**
 * `create-work-order --workspace W --title T [--description D] [--track SLUG]... [--review-mode gates|every-step]`
 * → a plain-string draft (index.ts resolves W and the slugs, then brands). W is an id or a label; an
 * invalid review-mode is an error naming both values, never a silent default.
 */
export function parseCreateWorkOrderArgs(argv: string[]): Parsed<CreateWorkOrderDraft> {
  const { flags, stray } = tokenize(argv, 'create-work-order');
  const err =
    flagError(flags, ['workspace', 'title', 'description', 'track', 'review-mode']) ??
    (stray.length ? `unexpected argument "${stray[0]}" (this command takes flags only)` : undefined);
  if (err) return { ok: false, error: err };
  const workspace = lastOf(flags, 'workspace');
  const title = lastOf(flags, 'title');
  const description = lastOf(flags, 'description');
  const reviewModeRaw = lastOf(flags, 'review-mode');
  if (workspace === undefined || !workspace.trim()) return { ok: false, error: 'missing required --workspace <id-or-label>' };
  if (title === undefined || !title.trim()) return { ok: false, error: 'missing required --title <text>' };
  if (reviewModeRaw !== undefined && reviewModeRaw !== 'gates' && reviewModeRaw !== 'every-step') {
    return { ok: false, error: `invalid --review-mode "${reviewModeRaw}" — use gates or every-step` };
  }
  const tracks: string[] = [];
  for (const t of allOf(flags, 'track')) {
    if (!t.trim()) return { ok: false, error: '--track requires a non-empty repo slug' };
    if (!tracks.includes(t.trim())) tracks.push(t.trim());
  }
  return {
    ok: true,
    input: {
      workspace: workspace.trim(),
      title: title.trim(),
      description: (description ?? '').trim(),
      tracks,
      reviewMode: reviewModeRaw ?? 'gates',
      contextFiles: [],
    },
  };
}

/**
 * Track resolution, the mirror of WoCreateModal's option list (PRODUCT.md §Decisions 6): a multi-repo
 * workspace's dedicated decision-store repo is not a track; a single-repo workspace keeps its one repo
 * (code and docs/ both). No request → all code tracks. Both params come from the workspace as the store
 * hydrates it (plain slugs — RepoId is assignable to string).
 */
export function resolveTracks(
  repos: string[],
  decisionStore: string,
  requested: string[],
): { ok: true; tracks: string[] } | { ok: false; error: string } {
  const options = repos.length > 1 ? repos.filter((r) => r !== decisionStore) : repos;
  if (requested.length) {
    for (const t of requested) {
      if (t === decisionStore && repos.length > 1) {
        return {
          ok: false,
          error: `"${t}" is the workspace decision store, not a track — it is excluded unless it is the only repo (valid: ${options.join(', ') || 'none'})`,
        };
      }
      if (!options.includes(t)) {
        return { ok: false, error: `unknown track "${t}" — not a repo of this workspace (valid: ${options.join(', ') || 'none'})` };
      }
    }
    return { ok: true, tracks: requested };
  }
  if (!options.length) return { ok: false, error: 'workspace has no code-repo tracks to run on' };
  return { ok: true, tracks: options };
}
