// use-cases/roadmap.ts — read helpers for the two-layer roadmap (project phases and repo roadmaps).
import type { ProjectSlug, RepoRoadmap, RepoSlug, Result, Roadmap, RoadmapIssue } from '../../domain/index';

import type { AppDeps } from '../ports/index';

export type ProjectRoadmapRead =
  | { readonly ok: true; readonly roadmap: Roadmap }
  | { readonly ok: false; readonly code: 'not_found' | 'definitions_invalid' };

export type RepoRoadmapRead =
  | { readonly ok: true; readonly roadmap: RepoRoadmap }
  | { readonly ok: false; readonly code: 'not_found' | 'definitions_invalid' };

/** The validated project roadmap at projects/<project>/roadmap.yaml. */
export async function readProjectRoadmap(
  deps: Pick<AppDeps, 'definitions' | 'projects'>,
  project: ProjectSlug,
): Promise<ProjectRoadmapRead> {
  if ((await deps.projects.get(project)) === undefined) return { ok: false, code: 'not_found' };
  const loaded = await deps.definitions.loadRoadmap(project);
  if (loaded === undefined) return { ok: false, code: 'not_found' };
  if (!loaded.ok) return { ok: false, code: 'definitions_invalid' };
  return { ok: true, roadmap: loaded.value };
}

/** The validated repo roadmap at repos/<repo>/roadmap.yaml. */
export async function readRepoRoadmap(
  deps: Pick<AppDeps, 'definitions'>,
  repo: RepoSlug,
): Promise<RepoRoadmapRead> {
  const loaded = await deps.definitions.loadRepoRoadmap(repo);
  if (loaded === undefined) return { ok: false, code: 'not_found' };
  if (!loaded.ok) return { ok: false, code: 'definitions_invalid' };
  return { ok: true, roadmap: loaded.value };
}

const reposReferencedBy = (roadmap: Roadmap): readonly RepoSlug[] => {
  const slugs = new Set<RepoSlug>();
  for (const phase of roadmap.phases) {
    for (const item of phase.items ?? []) {
      if (item.kind === 'repo_item') slugs.add(item.ref.repo);
    }
  }
  return [...slugs];
};

/** Loads every repo roadmap a project roadmap's phase items reference (missing files are omitted). */
export async function loadRepoRoadmapsForProject(
  deps: Pick<AppDeps, 'definitions'>,
  roadmap: Roadmap,
): Promise<readonly RepoRoadmap[]> {
  const out: RepoRoadmap[] = [];
  for (const repo of reposReferencedBy(roadmap)) {
    const loaded: Result<RepoRoadmap, readonly RoadmapIssue[]> | undefined = await deps.definitions.loadRepoRoadmap(repo);
    if (loaded !== undefined && loaded.ok) out.push(loaded.value);
  }
  return out;
}
