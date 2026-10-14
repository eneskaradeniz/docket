// Definition store over YAML files, everything under one global root: the versioned library, the
// repo definitions, the project definitions and the roadmaps. No repository folder is ever opened.
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { DefinitionStore } from '../../../application/index';
import type { DefinitionIssue, Definitions, ProjectDef, Result, RoadmapIssue, VersionRecord } from '../../../domain/index';
import { err, ok, parseSlug, validateDefinitions, validateRepoRoadmap, validateRoadmap } from '../../../domain/index';
import type { RepoSlug } from '../../../domain/index';

import type { DefinitionKind } from './targets';
import { hashContent, parseTarget } from './targets';

export interface YamlStoreConfig {
  readonly globalRoot: string;
}

const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, maxAliasCount: 100 } as const;
// The kinds the merged Definitions object carries; memory rides the same version law but no
// merged view consumes it yet, so loads never scan it.
const LIBRARY_KINDS: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities'];
const LIBRARY_ROOT = 'library';
const PROJECTS_ROOT = 'projects';
const REPOS_ROOT = 'repos';
const EXTENSION = '.yaml';
const VERSION_FILE = /^v([1-9][0-9]*)\.yaml$/;
const PROJECT_FILE = 'project.yaml';
const ROADMAP_FILE = 'roadmap.yaml';
const REPO_FILE = 'repo.yaml';
const ARCHIVED_MARKER = 'archived.yaml';
const REPO_AUX_FILES = ['tracker.yaml', 'tracker-sync.json'] as const;
const isRepoAuxFile = (fileName: string): boolean =>
  (REPO_AUX_FILES as readonly string[]).includes(fileName);

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

const isExisting = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

/** Creates the file only when nothing is there (`wx`); false = it already existed and stays untouched. */
const createExclusive = async (file: string, content: string): Promise<boolean> => {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (isExisting(error)) return false;
    throw error;
  }
};

/** Parses YAML text into a mapping, or reports the file problem as a definition issue. */
const parseMapping = (
  target: string,
  text: string,
): Result<UnknownRecord, DefinitionIssue> => {
  try {
    const document = parseYaml(text, YAML_OPTIONS);
    if (!isRecord(document)) {
      return err({ path: target, code: 'wrong_type', message: 'yaml: document must be a mapping' });
    }
    return ok(document);
  } catch (error) {
    return err({ path: target, code: 'wrong_type', message: `yaml: ${firstLine(error)}` });
  }
};

interface VersionFile {
  readonly version: number;
  readonly name: string;
}

/** The version files of one definition folder, version order; a missing folder is empty. */
const listVersionFiles = async (folder: string): Promise<readonly VersionFile[]> => {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => VERSION_FILE.exec(entry.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ version: Number(match[1]), name: match[0] }))
    .sort((a, b) => a.version - b.version);
};

/** Validates a parsed project.yaml with the project rules alone: roles/flows are not required in
 *  a project.yaml, so the validator sees explicit empty lists. */
const validateProjectMapping = (
  mapping: UnknownRecord,
): Result<ProjectDef, readonly DefinitionIssue[]> => {
  const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: mapping });
  if (!validated.ok) return err(validated.error);
  return validated.value.project === undefined
    ? err([{ path: PROJECT_FILE, code: 'missing_field', message: 'project is required' }])
    : ok(validated.value.project);
};

/** A roadmap candidate folds into DefinitionIssues: the roadmap code travels in the message. */
const validateRepoRoadmapCandidate = (content: string, repo: RepoSlug): Result<void, readonly DefinitionIssue[]> => {
  let document: unknown;
  try {
    document = parseYaml(content, YAML_OPTIONS);
  } catch {
    document = undefined;
  }
  const result = validateRepoRoadmap(document, repo);
  if (result.ok) return ok(undefined);
  return err(
    result.error.map((issue: RoadmapIssue): DefinitionIssue => ({
      path: `roadmap.${issue.path}`,
      code: 'wrong_type',
      message: `${issue.code}: ${issue.message}`,
    })),
  );
};

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

export function createYamlDefinitionStore(config: YamlStoreConfig): DefinitionStore {
  // Per-instance write serialization: one queue per absolute path, so check-and-rename is atomic
  // within the process and two concurrent writers with the same expectedHash cannot both pass.
  const writes = new Map<string, Promise<unknown>>();
  let tempCounter = 0;

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

  /** Reads one scope-fixed file (project.yaml / repo.yaml) from the root; missing → undefined. */
  const readFixedFile = async (
    target: string,
  ): Promise<Result<UnknownRecord | undefined, DefinitionIssue>> => {
    let text: string;
    try {
      text = await readFile(join(config.globalRoot, target), 'utf8');
    } catch (error) {
      if (isMissing(error)) return ok(undefined);
      throw error;
    }
    const parsed = parseMapping(target, text);
    return parsed.ok ? ok(parsed.value) : err(parsed.error);
  };

  /** Reads and validates the project.yaml of a project slug; absent or broken → undefined, so the
   *  roadmap arms still validate without membership checks. */
  const projectDefAt = async (slug: string): Promise<ProjectDef | undefined> => {
    const read = await readFixedFile(`${PROJECTS_ROOT}/${slug}/${PROJECT_FILE}`);
    if (!read.ok || read.value === undefined) return undefined;
    const validated = validateProjectMapping(read.value);
    return validated.ok ? validated.value : undefined;
  };

  const archivedMarker = (kind: DefinitionKind, id: string): string =>
    join(config.globalRoot, LIBRARY_ROOT, kind, id, ARCHIVED_MARKER);

  const isLibraryArchived = async (kind: DefinitionKind, id: string): Promise<boolean> => {
    try {
      await stat(archivedMarker(kind, id));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  };

  const listLibraryIds = async (kind: DefinitionKind): Promise<readonly string[]> => {
    try {
      const ids = (await readdir(join(config.globalRoot, LIBRARY_ROOT, kind), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const active: string[] = [];
      for (const id of ids) {
        if (!(await isLibraryArchived(kind, id))) active.push(id);
      }
      return active.sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  };

  /** One library kind's current definitions: the newest version file of every id. File problems
   *  are collected, never thrown — a load answers every broken file at once. */
  const loadLibraryKind = async (
    kind: DefinitionKind,
  ): Promise<{ readonly entries: readonly UnknownRecord[]; readonly problems: readonly DefinitionIssue[] }> => {
    const entries: UnknownRecord[] = [];
    const problems: DefinitionIssue[] = [];
    const ids = await listLibraryIds(kind);
    for (const id of ids) {
      const versions = await listVersionFiles(join(config.globalRoot, LIBRARY_ROOT, kind, id));
      const newest = versions[versions.length - 1];
      if (newest === undefined) continue;
      const target = `${LIBRARY_ROOT}/${kind}/${id}/${newest.name}`;
      let text: string;
      try {
        text = await readFile(join(config.globalRoot, target), 'utf8');
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      const parsed = parseMapping(target, text);
      if (!parsed.ok) {
        problems.push(parsed.error);
        continue;
      }
      const bodyId = parsed.value['id'];
      if (typeof bodyId !== 'string' || bodyId !== id) {
        problems.push({ path: target, code: 'invalid_slug', message: 'id does not match folder name' });
        continue;
      }
      entries.push(parsed.value);
    }
    return { entries, problems };
  };

  // The library's histories read straight off the version files; recordedAt is the file's own
  // mtime (a version file is never rewritten, so it stays the write time), and nothing in the
  // layout marks a version archived yet.
  const versionsOf = async (kind: DefinitionKind, id: string): Promise<readonly VersionRecord<unknown>[]> => {
    const archived = await isLibraryArchived(kind, id);
    const records: VersionRecord<unknown>[] = [];
    for (const versionFile of await listVersionFiles(join(config.globalRoot, LIBRARY_ROOT, kind, id))) {
      const target = `${LIBRARY_ROOT}/${kind}/${id}/${versionFile.name}`;
      let body: unknown;
      try {
        body = parseYaml(await readFile(join(config.globalRoot, target), 'utf8'), YAML_OPTIONS);
      } catch {
        body = undefined;
      }
      const { mtimeMs } = await stat(join(config.globalRoot, target));
      records.push({
        definitionId: id,
        version: versionFile.version,
        body,
        recordedAt: mtimeMs,
        archived,
      });
    }
    return records;
  };

  /** The pipeline behind `load` and the repo.yaml candidate: read every library file, collect
   *  every file problem, then validate the merged definitions — never the other way round. The
   *  role histories ride along (R-128/R-130): the version check runs against them and the answer
   *  carries the repo flow's effective roles. */
  const runDefinitionsPipeline = async (
    repoMapping: UnknownRecord | undefined,
  ): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
    const problems: DefinitionIssue[] = [];
    const merged: Record<string, readonly UnknownRecord[]> = {};
    for (const kind of LIBRARY_KINDS) {
      const loaded = await loadLibraryKind(kind);
      problems.push(...loaded.problems);
      merged[kind] = loaded.entries;
    }
    if (problems.length > 0) return err(problems);
    if (repoMapping === undefined) {
      return err([{ path: 'repo', code: 'missing_field', message: `${REPO_FILE} is required` }]);
    }
    let roleIds: readonly string[];
    try {
      roleIds = (await readdir(join(config.globalRoot, LIBRARY_ROOT, 'roles'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (!isMissing(error)) throw error;
      roleIds = [];
    }
    const histories: VersionRecord<unknown>[] = [];
    for (const id of roleIds) {
      histories.push(...(await versionsOf('roles', id)));
    }
    return validateDefinitions(
      {
        roles: merged['roles'] ?? [],
        flows: merged['flows'] ?? [],
        capabilities: merged['capabilities'] ?? [],
        repo: repoMapping,
      },
      { roles: histories },
    );
  };

  /** A version candidate validates as that definition's next version: the body stands alone, the
   *  way the version-append use case validates, and its id names the definition it belongs to. */
  const validateVersionCandidate = (
    kind: DefinitionKind,
    id: string,
    content: string,
  ): Result<void, readonly DefinitionIssue[]> => {
    const parsed = parseMapping(`${LIBRARY_ROOT}/${kind}/${id}/v<n>.yaml`, content);
    if (!parsed.ok) return err([parsed.error]);
    const bodyId = parsed.value['id'];
    if (kind !== 'memory' && (typeof bodyId !== 'string' || bodyId !== id)) {
      return err([
        { path: `${LIBRARY_ROOT}/${kind}/${id}`, code: 'invalid_slug', message: 'id does not match folder name' },
      ]);
    }
    if (kind === 'memory') return ok(undefined);
    const validated = validateDefinitions({
      roles: kind === 'roles' ? [parsed.value] : [],
      flows: kind === 'flows' ? [parsed.value] : [],
      capabilities: kind === 'capabilities' ? [parsed.value] : [],
    });
    return validated.ok ? ok(undefined) : err(validated.error);
  };

  return {
    load: async (repo) => {
      const read = await readFixedFile(`${REPOS_ROOT}/${repo}/${REPO_FILE}`);
      if (!read.ok) return err([read.error]);
      return runDefinitionsPipeline(read.value);
    },

    loadRoadmap: async (project) => {
      const target = `${PROJECTS_ROOT}/${project}/${ROADMAP_FILE}`;
      let text: string;
      try {
        text = await readFile(join(config.globalRoot, target), 'utf8');
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      const parsed = parseMapping(target, text);
      if (!parsed.ok) return err([{ path: ROADMAP_FILE, code: 'wrong_type', message: parsed.error.message }]);
      // The roadmap's task targets are checked against the project that owns it; a project.yaml
      // that no longer parses there still yields a roadmap, just without membership checks.
      return validateRoadmap(parsed.value, await projectDefAt(project));
    },

    loadRepoRoadmap: async (repo) => {
      const target = `${REPOS_ROOT}/${repo}/${ROADMAP_FILE}`;
      let text: string;
      try {
        text = await readFile(join(config.globalRoot, target), 'utf8');
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      const parsed = parseMapping(target, text);
      if (!parsed.ok) return err([{ path: ROADMAP_FILE, code: 'wrong_type', message: parsed.error.message }]);
      return validateRepoRoadmap(parsed.value, repo);
    },

    saveRepoRoadmap: async (repo, roadmap, expectedHash) => {
      const target = `${REPOS_ROOT}/${repo}/${ROADMAP_FILE}`;
      const content = stringifyYaml(
        { milestones: roadmap.milestones, issues: roadmap.issues },
        YAML_OPTIONS,
      );
      const file = join(config.globalRoot, target);
      return enqueue(file, () => writeAtomic(file, content, expectedHash));
    },

    readFile: async (targetOrScope: string | unknown, maybeTarget?: string) => {
      const scope = typeof targetOrScope === 'string' ? undefined : (targetOrScope as { kind?: string; repo?: string; project?: string } | undefined);
      const target = typeof targetOrScope === 'string' ? targetOrScope : maybeTarget!;
      let normalized = target;
      if (scope !== undefined) {
        if (scope.kind === 'repo') {
          normalized = target === 'repo.yaml' ? `${REPOS_ROOT}/${scope.repo}/repo.yaml` : `${REPOS_ROOT}/${scope.repo}/${target}`;
        } else if (scope.kind === 'project') {
          normalized = target === 'roadmap.yaml' || target === 'roadmap.json'
            ? `${PROJECTS_ROOT}/${scope.project}/roadmap.yaml`
            : `${PROJECTS_ROOT}/${scope.project}/${target}`;
        }
      }
      if (
        parseTarget(normalized) === undefined
        && !isRepoAuxFile(target)
        && !['roles.json', 'flows.json', 'caps.json', 'capabilities.json'].includes(target)
      ) {
        return undefined;
      }
      try {
        const content = await readFile(join(config.globalRoot, normalized), 'utf8');
        return { content, hash: hashContent(content) };
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    writeFile: async (
      targetOrScope: string | unknown,
      contentOrTarget: string,
      expectedHashOrContent: string,
      maybeExpectedHash?: string,
    ) => {
      const scope = typeof targetOrScope === 'string' ? undefined : (targetOrScope as { kind?: string; repo?: string; project?: string } | undefined);
      const target = maybeExpectedHash !== undefined ? contentOrTarget : (targetOrScope as string);
      const content = maybeExpectedHash !== undefined ? expectedHashOrContent : contentOrTarget;
      const expectedHash = maybeExpectedHash !== undefined ? maybeExpectedHash : expectedHashOrContent;
      let normalized = target;
      if (scope !== undefined) {
        if (scope.kind === 'repo') {
          normalized = target === 'repo.yaml' ? `${REPOS_ROOT}/${scope.repo}/repo.yaml` : `${REPOS_ROOT}/${scope.repo}/${target}`;
        } else if (scope.kind === 'project') {
          normalized = target === 'roadmap.yaml' || target === 'roadmap.json'
            ? `${PROJECTS_ROOT}/${scope.project}/roadmap.yaml`
            : `${PROJECTS_ROOT}/${scope.project}/${target}`;
        }
      }
      const parsed = parseTarget(normalized);
      if (
        parsed === undefined
        && !isRepoAuxFile(target)
        && !['roles.json', 'flows.json', 'caps.json', 'capabilities.json'].includes(target)
      ) {
        throw new Error(`not a definition file: ${target}`);
      }
      const file = join(config.globalRoot, normalized);
      if (parsed !== undefined && 'version' in parsed) {
        // Create-only: a version is written once and never touched again — any other write,
        // whatever hash it claims, is stale by definition.
        return enqueue(file, async () => {
          if (expectedHash !== '') return err('stale');
          await mkdir(dirname(file), { recursive: true });
          const created = await createExclusive(file, content);
          return created ? ok({ hash: hashContent(content) }) : err('stale');
        });
      }
      return enqueue(file, () => writeAtomic(file, content, expectedHash));
    },

    validateCandidate: async (
      targetOrScope: string | unknown,
      contentOrTarget: string,
      maybeContent?: string,
    ) => {
      const scope = typeof targetOrScope === 'string' ? undefined : (targetOrScope as { kind?: string; repo?: string; project?: string } | undefined);
      const target = maybeContent !== undefined ? contentOrTarget : (targetOrScope as string);
      const content = maybeContent !== undefined ? maybeContent : contentOrTarget;
      let normalized = target;
      if (scope !== undefined) {
        if (scope.kind === 'repo') {
          normalized = target === 'repo.yaml' ? `${REPOS_ROOT}/${scope.repo}/repo.yaml` : `${REPOS_ROOT}/${scope.repo}/${target}`;
        } else if (scope.kind === 'project') {
          normalized = target === 'roadmap.yaml' || target === 'roadmap.json'
            ? `${PROJECTS_ROOT}/${scope.project}/roadmap.yaml`
            : `${PROJECTS_ROOT}/${scope.project}/${target}`;
        }
      }
      const parsed = parseTarget(normalized);
      if (
        parsed === undefined
        && !isRepoAuxFile(target)
        && !['roles.json', 'flows.json', 'caps.json', 'capabilities.json'].includes(target)
      ) {
        return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
      }
      if (isRepoAuxFile(target)) return ok(undefined);
      if (parsed !== undefined && parsed.kind === 'roadmap') {
        return validateRoadmapCandidate(content, await projectDefAt(target.split('/')[1] ?? ''));
      }
      if (parsed !== undefined && parsed.kind === 'repo_roadmap') {
        const repoSlug = normalized.split('/')[1] ?? '';
        const repoParsed = parseSlug<'repo'>(repoSlug);
        if (!repoParsed.ok) {
          return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
        }
        return validateRepoRoadmapCandidate(content, repoParsed.value);
      }
      if (parsed !== undefined && parsed.kind === 'project') {
        const read = parseMapping(target, content);
        if (!read.ok) return err([read.error]);
        const validated = validateProjectMapping(read.value);
        return validated.ok ? ok(undefined) : err(validated.error);
      }
      if (parsed !== undefined && parsed.kind === 'repo') {
        const read = parseMapping(target, content);
        if (!read.ok) return err([read.error]);
        const pipeline = await runDefinitionsPipeline(read.value);
        return pipeline.ok ? ok(undefined) : err(pipeline.error);
      }
      if (parsed !== undefined) {
        return validateVersionCandidate(parsed.kind, parsed.id, content);
      }
      const scopedTarget = target.replace(/^repos\/[^/]+\//, '');
      if (scopedTarget === 'roles.json' || scopedTarget === 'flows.json' || scopedTarget === 'caps.json' || scopedTarget === 'capabilities.json') {
        const read = parseMapping(target, content);
        if (!read.ok) return err([read.error]);
        const body = read.value;
        const roles = scopedTarget === 'roles.json' && Array.isArray(body.roles) ? body.roles : [];
        const flows = scopedTarget === 'flows.json' && Array.isArray(body.flows) ? body.flows : [];
        const capabilities = (scopedTarget === 'caps.json' || scopedTarget === 'capabilities.json') && Array.isArray(body.capabilities)
          ? body.capabilities
          : [];
        const validated = validateDefinitions({
          roles,
          flows,
          capabilities,
          ...(isRecord(body.repo) ? { repo: body.repo } : {}),
        });
        return validated.ok ? ok(undefined) : err(validated.error);
      }
      return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
    },

    installBuiltins: async (library) => {
      const written: string[] = [];
      const install = async (kind: 'roles' | 'flows', id: string, value: unknown): Promise<void> => {
        const target = `${LIBRARY_ROOT}/${kind}/${id}/v1${EXTENSION}`;
        const file = join(config.globalRoot, target);
        await mkdir(dirname(file), { recursive: true });
        // Exclusive create: a file that exists in any form, whatever its content, is the user's.
        if (await createExclusive(file, stringifyYaml(value))) written.push(target);
      };
      for (const role of library.roles) await install('roles', role.id, role);
      for (const flow of library.flows) await install('flows', flow.id, flow);
      return { written };
    },

    // I-44: one capability per version file, the shape `load` parses back; an existing target is
    // skipped untouched whatever its content. Through the per-path write queue, like every write.
    installCapabilities: async (capabilities) => {
      const written: string[] = [];
      const skipped: string[] = [];
      const install = async (id: string, value: unknown): Promise<void> => {
        const target = `${LIBRARY_ROOT}/capabilities/${id}/v1${EXTENSION}`;
        const file = join(config.globalRoot, target);
        await mkdir(dirname(file), { recursive: true });
        const created = await enqueue(file, () => createExclusive(file, stringifyYaml(value)));
        if (created) written.push(target);
        else skipped.push(target);
      };
      for (const capability of capabilities) await install(capability.id, capability);
      return { written, skipped };
    },

    // The library's histories read straight off the version files; recordedAt is the file's own
    // mtime (a version file is never rewritten, so it stays the write time), and nothing in the
    // layout marks a version archived yet.
    listIds: (kind) => listLibraryIds(kind),

    listVersions: async (kind, id) => {
      const records: VersionRecord<unknown>[] = [];
      for (const versionFile of await listVersionFiles(join(config.globalRoot, LIBRARY_ROOT, kind, id))) {
        const target = `${LIBRARY_ROOT}/${kind}/${id}/${versionFile.name}`;
        let body: unknown;
        try {
          body = parseYaml(await readFile(join(config.globalRoot, target), 'utf8'), YAML_OPTIONS);
        } catch {
          body = undefined;
        }
        const { mtimeMs } = await stat(join(config.globalRoot, target));
        records.push({
          definitionId: id,
          version: versionFile.version,
          body,
          recordedAt: mtimeMs,
          archived: false,
        });
      }
      return records;
    },

    appendVersion: async (kind, id, body, at) => {
      const versions = await listVersionFiles(join(config.globalRoot, LIBRARY_ROOT, kind, id));
      const next = versions.length === 0 ? 1 : versions[versions.length - 1].version + 1;
      const target = `${LIBRARY_ROOT}/${kind}/${id}/v${next}${EXTENSION}`;
      const file = join(config.globalRoot, target);
      return enqueue(file, async () => {
        await mkdir(dirname(file), { recursive: true });
        const created = await createExclusive(file, stringifyYaml(body));
        if (!created) return err('stale');
        return ok({ definitionId: id, version: next, body, recordedAt: at, archived: false });
      });
    },

    archiveLibrary: async (kind, id) => {
      const versions = await listVersionFiles(join(config.globalRoot, LIBRARY_ROOT, kind, id));
      if (versions.length === 0) return err('not_found');
      const marker = archivedMarker(kind, id);
      return enqueue(marker, async () => {
        await mkdir(dirname(marker), { recursive: true });
        const created = await createExclusive(marker, stringifyYaml({ archived: true }));
        if (!created) return ok(undefined);
        return ok(undefined);
      });
    },

    removeLibrary: async (kind, id) => {
      const dir = join(config.globalRoot, LIBRARY_ROOT, kind, id);
      try {
        const entries = await readdir(dir);
        if (entries.length === 0) return err('not_found');
      } catch (error) {
        if (isMissing(error)) return err('not_found');
        throw error;
      }
      return enqueue(dir, async () => {
        for (const versionFile of await listVersionFiles(dir)) {
          await unlink(join(dir, versionFile.name));
        }
        try {
          await unlink(archivedMarker(kind, id));
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        return ok(undefined);
      });
    },
  };
}
