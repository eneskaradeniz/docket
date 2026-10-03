// In-memory DefinitionStore — seeded JSON files merged the way the real store merges them.
//
// Files are JSON strings: the domain validators take parsed YAML/JSON, and a fake only needs the
// deterministic variant of that. Every file holds a partial Definitions object; `load` merges the
// global files with the repo's project defaults and the repo's own (project ids override global
// ids, repo ids override both).
import type {
  DefinitionIssue,
  Definitions,
  ProjectDef,
  ProjectSlug,
  RepoDef,
  Roadmap,
  RoadmapIssue,
  Result,
  RepoSlug,
} from '../../../domain/index';
import { err, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';

import type { DefinitionFile, DefinitionScope, DefinitionStore } from '../definition-store';

/** The target the fake keeps a roadmap at, in the project scope. */
export const FAKE_ROADMAP_TARGET = 'roadmap.json';

/** The target the fake reads `readProjectAt` from, keyed by checkout path. */
const PROJECT_AT_FILE = 'project.yaml';

export interface FakeDefinitionStore extends DefinitionStore {
  /** Seeds a file directly, bypassing the hash protection — the initial-state setter for tests. */
  seed(scope: DefinitionScope, target: string, content: string): void;
  /** Overrides what repoPath reports; undefined marks the repo as without a checkout. */
  setRepoPath(repo: RepoSlug, path: string | undefined): void;
  /** Registers an attached project: membership (repo → project) and its ProjectDef mirror. */
  setProject(def: ProjectDef): void;
  /** Seeds the project.yaml content `readProjectAt` finds at a checkout path. */
  seedProjectAt(path: string, content: string): void;
  /** Seeds the repo.yaml content a checkout path already holds (scaffoldProject refuses it). */
  seedRepoAt(path: string, content: string): void;
  /** The repo.yaml content scaffoldProject wrote at a checkout path. */
  repoAt(path: string): string | undefined;
  /** Makes the next scaffoldProject answer `io_failed`, writing nothing. */
  failNextScaffold(): void;
}

interface StoredFile extends DefinitionFile {
  readonly target: string;
  readonly scope: DefinitionScope;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

interface Body {
  readonly target: string;
  readonly content: string;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scopeKey = (scope: DefinitionScope): string =>
  scope.kind === 'global' ? 'global' : scope.kind === 'project' ? `project:${scope.project}` : `repo:${scope.repo}`;

// FNV-1a over UTF-16 units, two 32-bit lanes: a deterministic digest without a hash package.
// Fixture-scale collision odds are irrelevant; equal content always hashes equal.
const contentHash = (content: string): string => {
  let low = 0xcbf29ce4n;
  let high = 0x84222325n;
  for (let i = 0; i < content.length; i++) {
    const unit = BigInt(content.charCodeAt(i));
    low = ((low ^ unit) * 0x100000001b3n) & 0xffffffffn;
    high = ((high + unit * BigInt(i + 1)) * 0x100000001b3n) & 0xffffffffn;
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
};

// validateCandidate reports DefinitionIssues per the contract, so roadmap-only codes fold into the
// closest definition code and the original code travels in the message.
const DEFINITION_CODE_BY_ROADMAP_CODE: Readonly<Record<string, DefinitionIssue['code']>> = {
  invalid_slug: 'invalid_slug',
  duplicate_id: 'duplicate_id',
  missing_field: 'missing_field',
  wrong_type: 'wrong_type',
};

const toDefinitionIssues = (issues: readonly RoadmapIssue[]): readonly DefinitionIssue[] =>
  issues.map((issue) => ({
    path: issue.path,
    code: DEFINITION_CODE_BY_ROADMAP_CODE[issue.code] ?? 'wrong_type',
    message: `roadmap ${issue.code}: ${issue.message}`,
  }));

/** First-seen position, last value: entries appended later (the repo's) win per id. */
const overrideById = (items: readonly unknown[]): unknown[] => {
  const result: unknown[] = [];
  const indexById = new Map<string, number>();
  for (const item of items) {
    const id = isRecord(item) && typeof item.id === 'string' ? item.id : undefined;
    if (id === undefined) {
      result.push(item);
      continue;
    }
    const at = indexById.get(id);
    if (at === undefined) {
      indexById.set(id, result.length);
      result.push(item);
    } else result[at] = item;
  }
  return result;
};

/** Merges parsed file bodies into the untyped shape validateDefinitions narrows. */
const mergeBodies = (bodies: readonly UnknownRecord[]): unknown => {
  const roles: unknown[] = [];
  const flows: unknown[] = [];
  const capabilities: unknown[] = [];
  let repo: unknown;
  let project: unknown;
  for (const body of bodies) {
    if (Array.isArray(body.roles)) roles.push(...body.roles);
    if (Array.isArray(body.flows)) flows.push(...body.flows);
    if (Array.isArray(body.capabilities)) capabilities.push(...body.capabilities);
    if (body.repo !== undefined) repo = body.repo;
    if (body.project !== undefined) project = body.project;
  }
  const merged: Record<string, unknown> = {
    roles: overrideById(roles),
    flows: overrideById(flows),
    capabilities: overrideById(capabilities),
  };
  if (repo !== undefined) merged.repo = repo;
  if (project !== undefined) merged.project = project;
  return merged;
};

export const createFakeDefinitionStore = (): FakeDefinitionStore => {
  const files = new Map<string, StoredFile>();
  const pathsByRepo = new Map<RepoSlug, string | undefined>();
  const projects: ProjectDef[] = [];
  const projectAt = new Map<string, string>();
  const repoFileAt = new Map<string, string>();
  let failScaffold = false;

  const keyOf = (scope: DefinitionScope, target: string): string => `${scopeKey(scope)}\n${target}`;

  const filesOf = (scope: DefinitionScope): readonly StoredFile[] =>
    [...files.values()]
      .filter((file) => scopeKey(file.scope) === scopeKey(scope))
      .sort((a, b) => (a.target < b.target ? -1 : 1));

  /** The first registered project listing the repo — the membership answer projectOfRepo gives. */
  const projectOf = (repo: RepoSlug): ProjectDef | undefined => {
    for (const def of projects) {
      if (def.repos.includes(repo)) return def;
    }
    return undefined;
  };

  const projectDefOf = async (project: ProjectSlug): Promise<ProjectDef | undefined> => {
    // The ProjectDef mirror first; a seeded project body stands in when no mirror was registered,
    // so a test can drive the roadmap arm with files alone.
    const mirror = projects.find((def) => def.id === project);
    if (mirror !== undefined) return mirror;
    const file = files.get(keyOf({ kind: 'project', project }, 'defs.json'));
    if (file === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (!isRecord(parsed) || !isRecord(parsed['project'])) return undefined;
      const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: parsed['project'] });
      return validated.ok ? validated.value.project : undefined;
    } catch {
      return undefined;
    }
  };

  const parseJson = (target: string, content: string): Result<unknown, DefinitionIssue> => {
    try {
      return ok(JSON.parse(content));
    } catch {
      return err({ path: target, code: 'wrong_type', message: `${target} is not valid JSON` });
    }
  };

  /** Parses a file body; malformed JSON becomes an issue instead of an exception. */
  const parseBody = (target: string, content: string): Result<UnknownRecord, DefinitionIssue> => {
    const parsed = parseJson(target, content);
    if (!parsed.ok) return err(parsed.error);
    if (!isRecord(parsed.value)) return err({ path: target, code: 'wrong_type', message: `${target} must be a JSON object` });
    return ok(parsed.value);
  };

  /** Roadmap files report RoadmapIssues, so they narrow through their own parser. */
  const parseRoadmapBody = (target: string, content: string): Result<UnknownRecord, RoadmapIssue> => {
    const parsed = parseJson(target, content);
    if (!parsed.ok) {
      return err({ path: parsed.error.path, code: 'wrong_type', message: parsed.error.message });
    }
    if (!isRecord(parsed.value)) return err({ path: target, code: 'wrong_type', message: `${target} must be a JSON object` });
    return ok(parsed.value);
  };

  /**
   * The file bodies of a scope, with `replace` swapped in for its target: global files first, then
   * the owning project's, then the repo's, then the replacement — so a repo candidate still
   * overrides the globals and the project. A global or project scope has no repo overlay; a repo
   * scope carries its project's files when the project is known.
   */
  const bodiesFor = (
    scope: DefinitionScope,
    replace: Body | undefined,
  ): Result<readonly UnknownRecord[], DefinitionIssue> => {
    const owning = scope.kind === 'repo' ? projectOf(scope.repo) : undefined;
    const projectScope: DefinitionScope | undefined =
      scope.kind === 'project' ? scope : owning === undefined ? undefined : { kind: 'project', project: owning.id };

    const globalFiles = filesOf({ kind: 'global' }).filter(
      (file) => replace === undefined || !(scope.kind === 'global' && file.target === replace.target),
    );
    const projectFiles =
      projectScope === undefined
        ? []
        : filesOf(projectScope).filter((file) => replace === undefined || file.target !== replace.target);
    const repoFiles = scope.kind === 'repo'
      ? filesOf(scope).filter((file) => replace === undefined || file.target !== replace.target)
      : [];

    const ordered: readonly Body[] = [
      ...globalFiles,
      ...(replace !== undefined && scope.kind === 'global' ? [replace] : []),
      ...projectFiles,
      ...repoFiles,
      ...(replace !== undefined && (scope.kind === 'project' || scope.kind === 'repo') ? [replace] : []),
    ];

    const bodies: UnknownRecord[] = [];
    for (const body of ordered) {
      const parsed = parseBody(body.target, body.content);
      if (!parsed.ok) return err(parsed.error);
      bodies.push(parsed.value);
    }
    return ok(bodies);
  };

  return {
    seed: (scope: DefinitionScope, target: string, content: string): void => {
      files.set(keyOf(scope, target), { target, content, hash: contentHash(content), scope });
    },

    setRepoPath: (repo: RepoSlug, path: string | undefined): void => {
      pathsByRepo.set(repo, path);
    },

    setProject: (def: ProjectDef): void => {
      const existing = projects.findIndex((candidate) => candidate.id === def.id);
      if (existing === -1) projects.push({ ...def, repos: [...def.repos] });
      else projects[existing] = { ...def, repos: [...def.repos] };
    },

    seedProjectAt: (path: string, content: string): void => {
      projectAt.set(path, content);
    },

    seedRepoAt: (path: string, content: string): void => {
      repoFileAt.set(path, content);
    },

    repoAt: (path: string): string | undefined => repoFileAt.get(path),

    failNextScaffold: (): void => {
      failScaffold = true;
    },

    // Library copies land as global files keyed by kind and id; an existing id is never touched.
    installBuiltins: async (library): Promise<{ readonly written: readonly string[] }> => {
      const written: string[] = [];
      const install = (kind: 'roles' | 'flows', id: string, value: unknown): void => {
        const target = `${kind}/${id}.json`;
        const key = keyOf({ kind: 'global' }, target);
        if (files.has(key)) return;
        const content = JSON.stringify({ [kind]: [value] });
        files.set(key, { target, content, hash: contentHash(content), scope: { kind: 'global' } });
        written.push(target);
      };
      for (const role of library.roles) install('roles', role.id, role);
      for (const flow of library.flows) install('flows', flow.id, flow);
      return { written };
    },

    // Both files are checked before either is written, like the real store.
    scaffoldProject: async (
      path: string,
      project: ProjectDef,
      repo: RepoDef,
    ): Promise<Result<void, 'project_yaml_exists' | 'repo_yaml_exists' | 'io_failed'>> => {
      if (projectAt.has(path)) return err('project_yaml_exists');
      if (repoFileAt.has(path)) return err('repo_yaml_exists');
      if (failScaffold) {
        failScaffold = false;
        return err('io_failed');
      }
      projectAt.set(path, JSON.stringify(project));
      repoFileAt.set(path, JSON.stringify(repo));
      return ok(undefined);
    },

    load: async (repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
      const collected = bodiesFor({ kind: 'repo', repo }, undefined);
      if (!collected.ok) return err([collected.error]);
      return validateDefinitions(mergeBodies(collected.value));
    },

    readProjectAt: async (path: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>> => {
      const content = projectAt.get(path);
      if (content === undefined) {
        return err([{ path: PROJECT_AT_FILE, code: 'missing_field', message: `${PROJECT_AT_FILE} is required` }]);
      }
      const parsed = parseJson(PROJECT_AT_FILE, content);
      if (!parsed.ok) return err([parsed.error]);
      if (!isRecord(parsed.value)) {
        return err([{ path: PROJECT_AT_FILE, code: 'wrong_type', message: `${PROJECT_AT_FILE} must be a JSON object` }]);
      }
      // A project.yaml carries the project alone; the validator sees explicit empty lists.
      const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: parsed.value });
      return validated.ok && validated.value.project !== undefined
        ? ok(validated.value.project)
        : err(validated.ok ? [{ path: PROJECT_AT_FILE, code: 'missing_field', message: 'project is required' }] : validated.error);
    },

    loadRoadmap: async (project: ProjectSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined> => {
      const file = files.get(keyOf({ kind: 'project', project }, FAKE_ROADMAP_TARGET));
      if (file === undefined) return undefined;
      const parsed = parseRoadmapBody(FAKE_ROADMAP_TARGET, file.content);
      if (!parsed.ok) return err([parsed.error]);
      return validateRoadmap(parsed.value, await projectDefOf(project));
    },

    readFile: async (scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined> => {
      const file = files.get(keyOf(scope, target));
      return file === undefined ? undefined : { content: file.content, hash: file.hash };
    },

    // '' means "must not exist", mirroring the contract; any other mismatch is a stale write.
    writeFile: async (
      scope: DefinitionScope,
      target: string,
      content: string,
      expectedHash: string,
    ): Promise<Result<{ readonly hash: string }, 'stale'>> => {
      const current = files.get(keyOf(scope, target));
      const currentHash = current === undefined ? '' : current.hash;
      if (currentHash !== expectedHash) return err('stale');
      const hash = contentHash(content);
      files.set(keyOf(scope, target), { target, content, hash, scope });
      return ok({ hash });
    },

    repoPath: async (repo: RepoSlug): Promise<string | undefined> =>
      pathsByRepo.has(repo) ? pathsByRepo.get(repo) : `/fake/repos/${repo}`,

    // Writes nothing: the candidate only ever enters the merge, never the store.
    validateCandidate: async (
      scope: DefinitionScope,
      target: string,
      content: string,
    ): Promise<Result<void, readonly DefinitionIssue[]>> => {
      if (target === FAKE_ROADMAP_TARGET) {
        const parsed = parseRoadmapBody(target, content);
        if (!parsed.ok) return err(toDefinitionIssues([parsed.error]));
        const projectDef = scope.kind === 'project' ? await projectDefOf(scope.project) : undefined;
        const validated = validateRoadmap(parsed.value, projectDef);
        return validated.ok ? ok(undefined) : err(toDefinitionIssues(validated.error));
      }
      const collected = bodiesFor(scope, { target, content });
      if (!collected.ok) return err([collected.error]);
      const validated = validateDefinitions(mergeBodies(collected.value));
      return validated.ok ? ok(undefined) : err(validated.error);
    },
  };
};
