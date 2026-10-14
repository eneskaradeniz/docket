// import-plan.ts — pure import queue planning for multi-repo setup (R-148).

export interface DiscoveredRepo {
  readonly name: string;
  readonly path: string;
  readonly isGit: boolean;
}

export type SkipReason = 'not_a_git_repo' | 'already_in_project' | 'duplicate_path';

export interface ImportRow {
  readonly name: string;
  readonly path: string;
  readonly state: 'queued' | 'skipped';
  readonly reason?: SkipReason;
}

export interface ImportPlan {
  readonly rows: readonly ImportRow[];
  readonly overflow: number;
}

const compareDiscovered = (left: DiscoveredRepo, right: DiscoveredRepo): number => {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return left.path.localeCompare(right.path);
};

export function planImport(
  found: readonly DiscoveredRepo[],
  inProjectPaths: readonly string[],
  max: number,
): ImportPlan {
  const inProject = new Set(inProjectPaths);
  const seen = new Set<string>();
  const sorted = [...found].sort(compareDiscovered);
  const rows: ImportRow[] = [];
  let queued = 0;
  let eligible = 0;
  for (const repo of sorted) {
    if (!repo.isGit) {
      rows.push({ name: repo.name, path: repo.path, state: 'skipped', reason: 'not_a_git_repo' });
      continue;
    }
    if (inProject.has(repo.path)) {
      rows.push({ name: repo.name, path: repo.path, state: 'skipped', reason: 'already_in_project' });
      continue;
    }
    if (seen.has(repo.path)) {
      rows.push({ name: repo.name, path: repo.path, state: 'skipped', reason: 'duplicate_path' });
      continue;
    }
    seen.add(repo.path);
    eligible += 1;
    if (queued < max) {
      rows.push({ name: repo.name, path: repo.path, state: 'queued' });
      queued += 1;
    }
  }
  const overflow = eligible > max ? eligible - max : 0;
  return { rows, overflow };
}
