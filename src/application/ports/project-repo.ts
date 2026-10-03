// Persistence port for attached projects — the persisted mirror of every attached project's
// project.yaml, kept queryable without touching the checkout (query joins read it).
import type { ProjectDef, ProjectSlug, RepoSlug } from '../../domain/index';

export interface ProjectRepo {
  save(def: ProjectDef): Promise<void>; // upsert (attach / project.yaml change)
  get(project: ProjectSlug): Promise<ProjectDef | undefined>;
  list(): Promise<readonly ProjectDef[]>; // id asc
  projectOfRepo(repo: RepoSlug): Promise<ProjectDef | undefined>;
  remove(project: ProjectSlug): Promise<void>;
}
