// Definition store over YAML files: global root merged with per-repo overrides.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { DefinitionScope, DefinitionStore } from '../../../application/index';
import type { DefinitionIssue, Definitions, Result, RoadmapIssue } from '../../../domain/index';
import { err, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';
import type { RepoPaths } from '../../system/index';

import type { DefinitionKind } from './targets';
import { hashContent, parseTarget } from './targets';

export interface YamlStoreConfig {
  readonly globalRoot: string;
  readonly repos: RepoPaths;
}

const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, maxAliasCount: 100 } as const;
const KINDS: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities'];
const WORKSPACE_DIR = '.docket';
const EXTENSION = '.yaml';
const WORKSPACE_FILE = 'workspace.yaml';
const ROADMAP_FILE = 'roadmap.yaml';

type ScopeLabel = 'global' | 'repo';
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

/** Global entries first; a repo entry with the same id takes the global's position; the rest follow. */
const mergeKind = (globals: readonly KindEntry[], repoEntries: readonly KindEntry[]): readonly UnknownRecord[] => {
  const merged = [...globals];
  const indexById = new Map(merged.map((entry, index) => [entry.id, index] as const));
  for (const entry of repoEntries) {
    const index = indexById.get(entry.id);
    if (index === undefined) {
      indexById.set(entry.id, merged.length);
      merged.push(entry);
    } else {
      merged[index] = entry;
    }
  }
  return merged.map((entry) => entry.mapping);
};

interface PipelineInput {
  /** Repo scope under which the repo folder is listed; a global-scope run passes `{ kind: 'global' }`. */
  readonly scope: DefinitionScope;
  readonly repoRoot: string | undefined;
  /** True when a repo is required: `load` and repo-scope candidates; a global run has none. */
  readonly expectRepo: boolean;
  readonly candidate: CandidateFile | undefined;
}

/** A roadmap candidate folds into DefinitionIssues: the roadmap code travels in the message. */
const validateRoadmapCandidate = (content: string): Result<void, readonly DefinitionIssue[]> => {
  let document: unknown;
  try {
    document = parseYaml(content, YAML_OPTIONS);
  } catch {
    // Anything that is not a document is not a roadmap object; validateRoadmap says so itself.
    document = undefined;
  }
  const result = validateRoadmap(document);
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

  /** The pipeline behind `load` and `validateCandidate`: read every file, collect every file problem,
   * then validate the merged definitions — never the other way round. */
  const runDefinitionsPipeline = async (
    input: PipelineInput,
  ): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
    if (input.expectRepo && input.repoRoot === undefined) {
      return err([{ path: 'repo', code: 'missing_field', message: 'repo is not registered' }]);
    }

    const problems: DefinitionIssue[] = [];
    const merged: Record<DefinitionKind, UnknownRecord[]> = { roles: [], flows: [], capabilities: [] };

    for (const kind of KINDS) {
      const globalLoad = await loadKind(
        config.globalRoot,
        'global',
        { kind: 'global' },
        kind,
        input.candidate?.label === 'global' && input.candidate.target.startsWith(`${kind}/`) ? input.candidate : undefined,
      );
      problems.push(...globalLoad.problems);

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

      merged[kind] = [...mergeKind(globalLoad.entries, repoLoad?.entries ?? [])];
    }

    let repoMapping: UnknownRecord | undefined;
    if (input.repoRoot !== undefined) {
      if (input.candidate?.label === 'repo' && input.candidate.target === WORKSPACE_FILE) {
        const parsed = parseDocument('repo', WORKSPACE_FILE, input.candidate.text);
        if (parsed.ok) repoMapping = parsed.mapping;
        else problems.push(parsed.problem);
      } else {
        try {
          const text = await readFile(join(input.repoRoot, WORKSPACE_FILE), 'utf8');
          const parsed = parseDocument('repo', WORKSPACE_FILE, text);
          if (parsed.ok) repoMapping = parsed.mapping;
          else problems.push(parsed.problem);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
    }

    if (problems.length > 0) return err(problems);
    if (input.expectRepo && repoMapping === undefined) {
      return err([{ path: 'repo', code: 'missing_field', message: `${WORKSPACE_FILE} is required` }]);
    }

    const definitionsInput: Record<string, unknown> = {
      roles: merged.roles,
      flows: merged.flows,
      capabilities: merged.capabilities,
    };
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

  const resolveRepoRoot = async (scope: DefinitionScope): Promise<string | undefined> => {
    if (scope.kind === 'global') return config.globalRoot;
    const path = await config.repos.path(scope.repo);
    return path === undefined ? undefined : join(path, WORKSPACE_DIR);
  };

  return {
    load: async (repo) => {
      const path = await config.repos.path(repo);
      return runDefinitionsPipeline({
        scope: { kind: 'repo', repo },
        repoRoot: path === undefined ? undefined : join(path, WORKSPACE_DIR),
        expectRepo: true,
        candidate: undefined,
      });
    },

    loadRoadmap: async (repo) => {
      const path = await config.repos.path(repo);
      if (path === undefined) return undefined;

      let text: string;
      try {
        text = await readFile(join(path, WORKSPACE_DIR, ROADMAP_FILE), 'utf8');
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
      return validateRoadmap(document);
    },

    readFile: async (scope, target) => {
      if (parseTarget(scope, target) === undefined) return undefined;
      const root = await resolveRepoRoot(scope);
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
      const root = await resolveRepoRoot(scope);
      if (root === undefined) {
        throw new Error(scope.kind === 'global' ? 'no global root' : `unknown repo: ${scope.repo}`);
      }
      const file = join(root, target);
      return enqueue(file, () => writeAtomic(file, content, expectedHash));
    },

    repoPath: async (repo) => config.repos.path(repo),

    validateCandidate: async (scope, target, content) => {
      if (parseTarget(scope, target) === undefined) {
        return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
      }
      if (target === ROADMAP_FILE) return validateRoadmapCandidate(content);

      const path = scope.kind === 'global' ? undefined : await config.repos.path(scope.repo);
      const result = await runDefinitionsPipeline({
        scope,
        repoRoot: path === undefined ? undefined : join(path, WORKSPACE_DIR),
        expectRepo: scope.kind === 'repo',
        candidate: { label: scope.kind === 'global' ? 'global' : 'repo', target, text: content },
      });
      return result.ok ? ok(undefined) : err(result.error);
    },
  };
}
