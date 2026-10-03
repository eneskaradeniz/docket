// In-memory ProjectRepo — projects keyed by id, membership derived from each ProjectDef's repos.
import type { ProjectDef, ProjectSlug, RepoSlug } from '../../../domain/index';

import type { ProjectRepo } from '../project-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeProjectRepo extends ProjectRepo {}

export const createFakeProjectRepo = (): FakeProjectRepo => {
  const byId = new Map<ProjectSlug, ProjectDef>();

  /** First project (in save order) listing the repo owns it — the same "first row" the SQL join
   *  answers with; two projects sharing a repo is a data defect either side must surface alike. */
  const projectOf = (repo: RepoSlug): ProjectDef | undefined => {
    for (const def of byId.values()) {
      if (def.repos.includes(repo)) return def;
    }
    return undefined;
  };

  return {
    save: async (def: ProjectDef): Promise<void> => {
      byId.set(def.id, { ...def, repos: [...def.repos] });
    },

    get: async (project: ProjectSlug): Promise<ProjectDef | undefined> => byId.get(project),

    // Insertion order under a monotonic id source is id order; a stable sort keeps the promise
    // true for any fixture.
    list: async (): Promise<readonly ProjectDef[]> => [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),

    projectOfRepo: async (repo: RepoSlug): Promise<ProjectDef | undefined> => projectOf(repo),

    remove: async (project: ProjectSlug): Promise<void> => {
      byId.delete(project);
    },
  };
};
