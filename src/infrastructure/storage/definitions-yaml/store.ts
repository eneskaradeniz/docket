// Definition store over YAML files: global root merged with per-project and per-repo overrides.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { DefinitionScope, DefinitionStore } from '../../../application/index';
import type { DefinitionIssue, Definitions, ProjectDef, Result, RoadmapIssue } from '../../../domain/index';
import { err, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';
import type { ProjectPaths, RepoPaths } from '../../system/index';

import type { DefinitionKind } from './targets';
import { hashContent, parseTarget } from './targets';

export interface YamlStoreConfig {
  readonly globalRoot: string;
  readonly repos: RepoPaths;
  readonly projects: ProjectPaths;
}

const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, maxAliasCount: 100 } as const;
const KINDS: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities'];
const DOCKET_DIR = '.docket';
const EXTENSION = '.yaml';
const PROJECT_FILE = 'project.yaml';
const ROADMAP_FILE = 'roadmap.yaml';
const REPO_FILE = 'repo.yaml';

type ScopeLabel = 'global' | 'project' | 'repo';
type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/** The parser reports position and excerpt on later lines; issues carry the reason only. */
const firstLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? '';
};

const issuePath = (label: ScopeLabel, target: string): string => `${label}:${target}`;

type ParsedDocument =
  | { readonly ok: true; readonly mapping: UnknownRecord }
  | { readonly ok: false; readonly problem: DefinitionIssue };

const parseDocument = (label: ScopeLabel, target: string, text: string): ParsedDocument => {
  try {
    const document = parseYaml(text, YAML_OPTIONS);
    if (!isRecord(document)) {
      return { ok: false, problem: { path: issuePath(label, target), code: 'wrong_type', message: 'yaml: document must be a mapping' } };
    }
    return { ok: true, mapping: document };
  } catch (error) {
    return { ok: false, problem: { path: issuePath(label, target), code: 'wrong_type', message: `yaml: ${firstLine(error)}` } };
  }
};

/** A file to parse: straight off disk, or a candidate that stands in for it. */
interface FileSlot {
  readonly target: string;
  readonly text: string;
}

interface CandidateFile extends FileSlot {
  readonly label: ScopeLabel;
}

/** File names of a kind folder, sorted; a missing folder is an empty list. */
const listFolder = async (folder: string): Promise<readonly string[]> => {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
};

const readKindSlots = async (
  root: string,
  scope: DefinitionScope,
  kind: DefinitionKind,
): Promise<readonly FileSlot[]> => {
  const slots: FileSlot[] = [];
  for (const name of await listFolder(join(root, kind))) {
    const target = `${kind}/${name}`;
    if (parseTarget(scope, target) === undefined) continue;
    slots.push({ target, text: await readFile(join(root, target), 'utf8') });
  }
  return slots;
};

const stemOf = (target: string): string =>
  target.slice(target.indexOf('/') + 1, -EXTENSION.length);

/** Replaces the slot for the target, or inserts it where the file would sit in file-name order —
 * exactly the list the folder would hold if the candidate were written. */
const applyCandidate = (slots: readonly FileSlot[], candidate: FileSlot): readonly FileSlot[] => {
  const remaining = slots.filter((slot) => slot.target !== candidate.target);
  const at = remaining.filter((slot) => slot.target < candidate.target).length;
  return [...remaining.slice(0, at), candidate, ...remaining.slice(at)];
};

interface KindEntry {
  readonly id: string;
  readonly mapping: UnknownRecord;
}

interface KindLoad {
  readonly entries: readonly KindEntry[];
  readonly problems: readonly DefinitionIssue[];
}

const loadKind = async (
  root: string,
  label: ScopeLabel,
  scope: DefinitionScope,
  kind: DefinitionKind,
  candidate: CandidateFile | undefined,
): Promise<KindLoad> => {
  const fromDisk = await readKindSlots(root, scope, kind);
  const slots = candidate === undefined ? fromDisk : applyCandidate(fromDisk, candidate);

  const entries: KindEntry[] = [];
  const problems: DefinitionIssue[] = [];
  for (const slot of slots) {
    const parsed = parseDocument(label, slot.target, slot.text);
    if (!parsed.ok) {
      problems.push(parsed.problem);
      continue;
    }
    const id = parsed.mapping['id'];
    if (typeof id !== 'string' || id !== stemOf(slot.target)) {
      problems.push({ path: issuePath(label, slot.target), code: 'invalid_slug', message: 'id does not match file name' });
      continue;
    }
    entries.push({ id, mapping: parsed.mapping });
  }
  return { entries, problems };
};

/** Root-order merge (S3): earlier roots first; a later entry with the same id replaces it in its
 * position; entries no earlier root knows follow in their own file-name order. */
const mergeKind = (layers: readonly (readonly KindEntry[])[]): readonly UnknownRecord[] => {
  const merged: KindEntry[] = [];
  const indexById = new Map<string, number>();
  for (const layer of layers) {
    for (const entry of layer) {
      const index = indexById.get(entry.id);
      if (index === undefined) {
        indexById.set(entry.id, merged.length);
        merged.push(entry);
      } else {
        merged[index] = entry;
      }
    }
  }
  return merged.map((entry) => entry.mapping);
};

interface PipelineInput {
  /** The scope the repo folder is listed under; a global-scope run passes `{ kind: 'global' }`. */
  readonly scope: DefinitionScope;
  readonly repoRoot: string | undefined;
  readonly projectRoot: string | undefined;
  /** True when a repo is required: `load` and repo-scope candidates; a global run has none. */
  readonly expectRepo: boolean;
  readonly candidate: CandidateFile | undefined;
}

/** A roadmap candidate folds into DefinitionIssues: the roadmap code travels in the message. */
const validateRoadmapCandidate = (
  content: string,
  projectDef: ProjectDef | undefined,
): Result<void, readonly DefinitionIssue[]> => {
  let document: unknown;
  try {
    document = parseYaml(content, YAML_OPTIONS);
  } catch {
    // Anything that is not a document is not a roadmap object; validateRoadmap says so itself.
    document = undefined;
  }
  const result = validateRoadmap(document, projectDef);
  if (result.ok) return ok(undefined);
  return err(
    result.error.map((issue: RoadmapIssue): DefinitionIssue => ({
      path: `roadmap.${issue.path}`,
      code: 'wrong_type',
      message: `${issue.code}: ${issue.message}`,
    })),
  );
};

/** Reads and parses one scope-fixed file (project.yaml / repo.yaml); missing → undefined. */
const readFixedFile = async (
  root: string | undefined,
  label: ScopeLabel,
  file: string,
): Promise<Result<{ readonly mapping: UnknownRecord } | undefined, DefinitionIssue>> => {
  if (root === undefined) return ok(undefined);
  let text: string;
  try {
    text = await readFile(join(root, file), 'utf8');
  } catch (error) {
    if (isMissing(error)) return ok(undefined);
    throw error;
  }
  const parsed = parseDocument(label, file, text);
  return parsed.ok ? ok({ mapping: parsed.mapping }) : err(parsed.problem);
};

/** Validates a parsed project.yaml mapping with the project rules alone: roles/flows are not
 * required in a project.yaml, so the validator sees explicit empty lists. */
const validateProjectMapping = (
  mapping: UnknownRecord,
): Result<ProjectDef, readonly DefinitionIssue[]> => {
  const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: mapping });
  if (!validated.ok) return err(validated.error);
  return validated.value.project === undefined
    ? err([{ path: PROJECT_FILE, code: 'missing_field', message: 'project is required' }])
    : ok(validated.value.project);
};

export function createYamlDefinitionStore(config: YamlStoreConfig): DefinitionStore {
  // Per-instance write serialization: one queue per absolute path, so check-and-rename is atomic
  // within the process and two concurrent writers with the same expectedHash cannot both pass.
  const writes = new Map<string, Promise<unknown>>();
  let tempCounter = 0;

  /** The pipeline behind `load` and `validateCandidate`: read every file, collect every file problem,
   * then validate the merged definitions — never the other way round. */
  const runDefinitionsPipeline = async (
    input: PipelineInput,
  ): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
    if (input.expectRepo && input.repoRoot === undefined) {
      return err([{ path: 'repo', code: 'missing_field', message: 'repo is not registered' }]);
    }

    const problems: DefinitionIssue[] = [];
    const merged: Record<DefinitionKind, readonly UnknownRecord[]> = { roles: [], flows: [], capabilities: [] };

    for (const kind of KINDS) {
      const globalLoad = await loadKind(
        config.globalRoot,
        'global',
        { kind: 'global' },
        kind,
        input.candidate?.label === 'global' && input.candidate.target.startsWith(`${kind}/`) ? input.candidate : undefined,
      );
      problems.push(...globalLoad.problems);

      let projectLoad: KindLoad | undefined;
      if (input.projectRoot !== undefined) {
        projectLoad = await loadKind(
          input.projectRoot,
          'project',
          input.scope,
          kind,
          input.candidate?.label === 'project' && input.candidate.target.startsWith(`${kind}/`) ? input.candidate : undefined,
        );
        problems.push(...projectLoad.problems);
      }

      let repoLoad: KindLoad | undefined;
      if (input.repoRoot !== undefined) {
        repoLoad = await loadKind(
          input.repoRoot,
          'repo',
          input.scope,
          kind,
          input.candidate?.label === 'repo' && input.candidate.target.startsWith(`${kind}/`) ? input.candidate : undefined,
        );
        problems.push(...repoLoad.problems);
      }

      merged[kind] = mergeKind([globalLoad.entries, projectLoad?.entries ?? [], repoLoad?.entries ?? []]);
    }

    // The project's own project.yaml is a file like any other when the project root is known:
    // unparsable content is a file problem, a missing file simply carries no project defaults.
    let projectMapping: UnknownRecord | undefined;
    if (input.projectRoot !== undefined) {
      if (input.candidate?.label === 'project' && input.candidate.target === PROJECT_FILE) {
        const parsed = parseDocument('project', PROJECT_FILE, input.candidate.text);
        if (parsed.ok) projectMapping = parsed.mapping;
        else problems.push(parsed.problem);
      } else {
        const read = await readFixedFile(input.projectRoot, 'project', PROJECT_FILE);
        if (!read.ok) problems.push(read.error);
        else projectMapping = read.value?.mapping;
      }
    }

    let repoMapping: UnknownRecord | undefined;
    if (input.repoRoot !== undefined) {
      if (input.candidate?.label === 'repo' && input.candidate.target === REPO_FILE) {
        const parsed = parseDocument('repo', REPO_FILE, input.candidate.text);
        if (parsed.ok) repoMapping = parsed.mapping;
        else problems.push(parsed.problem);
      } else {
        const read = await readFixedFile(input.repoRoot, 'repo', REPO_FILE);
        if (!read.ok) problems.push(read.error);
        else repoMapping = read.value?.mapping;
      }
    }

    if (problems.length > 0) return err(problems);
    if (input.expectRepo && repoMapping === undefined) {
      return err([{ path: 'repo', code: 'missing_field', message: `${REPO_FILE} is required` }]);
    }

    const definitionsInput: Record<string, unknown> = {
      roles: merged.roles,
      flows: merged.flows,
      capabilities: merged.capabilities,
    };
    if (projectMapping !== undefined) definitionsInput['project'] = projectMapping;
    if (repoMapping !== undefined) definitionsInput['repo'] = repoMapping;
    return validateDefinitions(definitionsInput);
  };

  const enqueue = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const tail = writes.get(key) ?? Promise.resolve();
    const run = tail.then(task, task);
    writes.set(key, run.then(() => undefined, () => undefined));
    return run;
  };

  const writeAtomic = async (
    file: string,
    content: string,
    expectedHash: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>> => {
    let currentHash = '';
    try {
      currentHash = hashContent(await readFile(file, 'utf8'));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (currentHash !== expectedHash) return err('stale');

    const folder = dirname(file);
    await mkdir(folder, { recursive: true });
    const temp = join(folder, `.${basename(file)}.${(tempCounter += 1)}.tmp`);
    await writeFile(temp, content, 'utf8');
    try {
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    return ok({ hash: hashContent(content) });
  };

  /** Reads and validates the project.yaml under a project root; the reader behind both
   * `readProjectAt` and the roadmap's project context. Loader-level failures carry the bare
   * file name as their path — the attach flow tells them apart by exactly that. */
  const projectAtRoot = async (root: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>> => {
    let text: string;
    try {
      text = await readFile(join(root, PROJECT_FILE), 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return err([{ path: PROJECT_FILE, code: 'missing_field', message: `${PROJECT_FILE} is required` }]);
      }
      throw error;
    }
    let document: unknown;
    try {
      document = parseYaml(text, YAML_OPTIONS);
    } catch (error) {
      return err([{ path: PROJECT_FILE, code: 'wrong_type', message: `yaml: ${firstLine(error)}` }]);
    }
    if (!isRecord(document)) {
      return err([{ path: PROJECT_FILE, code: 'wrong_type', message: 'yaml: document must be a mapping' }]);
    }
    return validateProjectMapping(document);
  };

  /** The scope's own folder, and — for a repo scope — its project's folder too. */
  const scopeRoots = async (
    scope: DefinitionScope,
  ): Promise<{ readonly own: string | undefined; readonly project: string | undefined }> => {
    if (scope.kind === 'global') return { own: config.globalRoot, project: undefined };
    if (scope.kind === 'project') {
      const path = await config.projects.mainRepoPath(scope.project);
      return { own: path === undefined ? undefined : join(path, DOCKET_DIR), project: undefined };
    }
    const owning = await config.projects.projectOf(scope.repo);
    const projectPath = owning === undefined ? undefined : await config.projects.mainRepoPath(owning);
    const path = await config.repos.path(scope.repo);
    return {
      own: path === undefined ? undefined : join(path, DOCKET_DIR),
      project: projectPath === undefined ? undefined : join(projectPath, DOCKET_DIR),
    };
  };

  return {
    load: async (repo) => {
      const roots = await scopeRoots({ kind: 'repo', repo });
      return runDefinitionsPipeline({
        scope: { kind: 'repo', repo },
        repoRoot: roots.own,
        projectRoot: roots.project,
        expectRepo: true,
        candidate: undefined,
      });
    },

    readProjectAt: async (path) => projectAtRoot(join(path, DOCKET_DIR)),

    loadRoadmap: async (project) => {
      const mainPath = await config.projects.mainRepoPath(project);
      if (mainPath === undefined) return undefined;
      const root = join(mainPath, DOCKET_DIR);

      let text: string;
      try {
        text = await readFile(join(root, ROADMAP_FILE), 'utf8');
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }

      let document: unknown;
      try {
        document = parseYaml(text, YAML_OPTIONS);
      } catch (error) {
        return err([{ path: ROADMAP_FILE, code: 'wrong_type', message: `yaml: ${firstLine(error)}` }]);
      }
      if (!isRecord(document)) {
        return err([{ path: ROADMAP_FILE, code: 'wrong_type', message: 'yaml: document must be a mapping' }]);
      }
      // The roadmap's task targets are checked against the project that owns it; a project.yaml
      // that no longer parses there still yields a roadmap, just without membership checks.
      const projectDef = await projectAtRoot(root);
      return validateRoadmap(document, projectDef.ok ? projectDef.value : undefined);
    },

    readFile: async (scope, target) => {
      if (parseTarget(scope, target) === undefined) return undefined;
      const root = (await scopeRoots(scope)).own;
      if (root === undefined) return undefined;
      try {
        const content = await readFile(join(root, target), 'utf8');
        return { content, hash: hashContent(content) };
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    writeFile: async (scope, target, content, expectedHash) => {
      if (parseTarget(scope, target) === undefined) {
        throw new Error(`not a definition file: ${target}`);
      }
      const root = (await scopeRoots(scope)).own;
      if (root === undefined) {
        throw new Error(
          scope.kind === 'global'
            ? 'no global root'
            : scope.kind === 'project'
              ? `unknown project: ${scope.project}`
              : `unknown repo: ${scope.repo}`,
        );
      }
      const file = join(root, target);
      return enqueue(file, () => writeAtomic(file, content, expectedHash));
    },

    repoPath: async (repo) => config.repos.path(repo),

    validateCandidate: async (scope, target, content) => {
      if (parseTarget(scope, target) === undefined) {
        return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
      }
      if (target === ROADMAP_FILE) {
        const root = (await scopeRoots(scope)).own;
        if (scope.kind !== 'project' || root === undefined) return validateRoadmapCandidate(content, undefined);
        const read = await projectAtRoot(root);
        return validateRoadmapCandidate(content, read.ok ? read.value : undefined);
      }

      const roots = await scopeRoots(scope);
      const result = await runDefinitionsPipeline({
        scope,
        // A repo scope validates the repo's own merged definitions; the project root rides along
        // only then. Project and global scopes validate without a repo.
        repoRoot: scope.kind === 'repo' ? roots.own : undefined,
        projectRoot: scope.kind === 'repo' ? roots.project : roots.own,
        expectRepo: scope.kind === 'repo',
        candidate: { label: scope.kind === 'global' ? 'global' : scope.kind, target, text: content },
      });
      return result.ok ? ok(undefined) : err(result.error);
    },
  };
}
