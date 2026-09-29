// SQLite-backed project repository: the persisted mirror of every attached project's project.yaml.
// Membership rides in project_repos so repo → project resolves without scanning ProjectDef JSON.
import type { ProjectRepo } from '../../../application/index';
import type { ProjectDef, ProjectSlug, RepoSlug } from '../../../domain/index';
import type { ProjectPaths } from '../../system/index';

import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

const recordFromRow = (row: DataRow): ProjectDef => {
  if (typeof row.data !== 'string') throw new Error('projects row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  return parsed as ProjectDef;
};

export function createSqliteProjectRepo(db: DocketDb): ProjectRepo {
  return {
    // The def and its membership rows change together: a half-updated join would answer
    // projectOfRepo with the previous project's members.
    save: async (def: ProjectDef): Promise<void> => {
      db.transaction(() => {
        db.raw
          .prepare(
            'INSERT INTO projects (slug, name, main_repo, data) VALUES (?, ?, ?, ?) ' +
              'ON CONFLICT (slug) DO UPDATE SET name = excluded.name, main_repo = excluded.main_repo, data = excluded.data',
          )
          .run(def.id, def.name, def.mainRepo, JSON.stringify(def));
        db.raw.prepare('DELETE FROM project_repos WHERE project = ?').run(def.id);
        const insert = db.raw.prepare('INSERT INTO project_repos (project, repo) VALUES (?, ?)');
        for (const repo of def.repos) insert.run(def.id, repo);
      });
    },

    get: async (project: ProjectSlug): Promise<ProjectDef | undefined> => {
      const row = db.raw.prepare('SELECT data FROM projects WHERE slug = ?').get(project);
      return row === undefined ? undefined : recordFromRow(row);
    },

    list: async (): Promise<readonly ProjectDef[]> =>
      db.raw
        .prepare('SELECT data FROM projects ORDER BY slug ASC')
        .all()
        .map((row) => recordFromRow(row)),

    // The first membership row wins; projects sharing a repo is a data defect the schema cannot
    // express uniquely, and the registry-level upsert keeps one answer stable.
    projectOfRepo: async (repo: RepoSlug): Promise<ProjectDef | undefined> => {
      const row = db.raw
        .prepare(
          'SELECT p.data AS data FROM projects p JOIN project_repos r ON r.project = p.slug WHERE r.repo = ? ORDER BY p.slug ASC LIMIT 1',
        )
        .get(repo);
      return row === undefined ? undefined : recordFromRow(row);
    },

    remove: async (project: ProjectSlug): Promise<void> => {
      db.transaction(() => {
        db.raw.prepare('DELETE FROM project_repos WHERE project = ?').run(project);
        db.raw.prepare('DELETE FROM projects WHERE slug = ?').run(project);
      });
    },
  };
}

/** The path views over the registries: which project owns a repo, and where its main repo checks out. */
export function createSqliteProjectPaths(db: DocketDb): ProjectPaths {
  return {
    projectOf: async (repo: RepoSlug): Promise<ProjectSlug | undefined> => {
      const row = db.raw.prepare('SELECT project FROM project_repos WHERE repo = ? ORDER BY project ASC LIMIT 1').get(repo);
      return row === undefined ? undefined : (row.project as ProjectSlug);
    },

    mainRepoPath: async (project: ProjectSlug): Promise<string | undefined> => {
      const row = db.raw
        .prepare('SELECT p.main_repo AS main_repo, r.path AS path FROM projects p LEFT JOIN repos r ON r.slug = p.main_repo WHERE p.slug = ?')
        .get(project);
      if (row === undefined) return undefined;
      return typeof row.path === 'string' ? row.path : undefined;
    },
  };
}
