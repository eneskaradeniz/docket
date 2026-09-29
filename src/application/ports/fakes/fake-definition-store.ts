// In-memory DefinitionStore — seeded JSON files merged the way the real store merges them.
//
// Files are JSON strings: the domain validators take parsed YAML/JSON, and a fake only needs the
// deterministic variant of that. Every file holds a partial Definitions object; `load` merges the
// global files with the repo's, repo ids overriding global ids of the same kind.
import type {
  DefinitionIssue,
  Definitions,
  Roadmap,
  RoadmapIssue,
  Result,
  RepoSlug,
} from '../../../domain/index';
import { err, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';

import type { DefinitionFile, DefinitionScope, DefinitionStore } from '../definition-store';

/** The target the fake keeps a roadmap at, in either scope. */
export const FAKE_ROADMAP_TARGET = 'roadmap.json';

export interface FakeDefinitionStore extends DefinitionStore {
  /** Seeds a file directly, bypassing the hash protection — the initial-state setter for tests. */
  seed(scope: DefinitionScope, target: string, content: string): void;
  /** Overrides what repoPath reports; undefined marks the repo as without a checkout. */
  setRepoPath(repo: RepoSlug, path: string | undefined): void;
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
  scope.kind === 'global' ? 'global' : `repo:${scope.repo}`;

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
  for (const body of bodies) {
    if (Array.isArray(body.roles)) roles.push(...body.roles);
    if (Array.isArray(body.flows)) flows.push(...body.flows);
    if (Array.isArray(body.capabilities)) capabilities.push(...body.capabilities);
    if (body.repo !== undefined) repo = body.repo;
  }
  const merged: Record<string, unknown> = {
    roles: overrideById(roles),
    flows: overrideById(flows),
    capabilities: overrideById(capabilities),
  };
  if (repo !== undefined) merged.repo = repo;
  return merged;
};

export const createFakeDefinitionStore = (): FakeDefinitionStore => {
  const files = new Map<string, StoredFile>();
  const pathsByRepo = new Map<RepoSlug, string | undefined>();

  const keyOf = (scope: DefinitionScope, target: string): string => `${scopeKey(scope)}\n${target}`;

  const filesOf = (scope: DefinitionScope): readonly StoredFile[] =>
    [...files.values()]
      .filter((file) => scopeKey(file.scope) === scopeKey(scope))
      .sort((a, b) => (a.target < b.target ? -1 : 1));

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
    if (!parsed.ok) return err({ path: target, code: 'wrong_type', message: `${target} is not valid JSON` });
    if (!isRecord(parsed.value)) return err({ path: target, code: 'wrong_type', message: `${target} must be a JSON object` });
    return ok(parsed.value);
  };

  /**
   * The file bodies of a scope, with `replace` swapped in for its target: global files first, then
   * the repo's, then the replacement — so a repo candidate still overrides the globals.
   * A global scope has no repo overlay of its own; the port names none for it.
   */
  const bodiesFor = (
    scope: DefinitionScope,
    replace: Body | undefined,
  ): Result<readonly UnknownRecord[], DefinitionIssue> => {
    const globalFiles = filesOf({ kind: 'global' }).filter(
      (file) => replace === undefined || !(scope.kind === 'global' && file.target === replace.target),
    );
    const repoFiles = scope.kind === 'repo'
      ? filesOf(scope).filter((file) => replace === undefined || file.target !== replace.target)
      : [];

    const ordered: readonly Body[] = [
      ...globalFiles,
      ...(replace !== undefined && scope.kind === 'global' ? [replace] : []),
      ...repoFiles,
      ...(replace !== undefined && scope.kind === 'repo' ? [replace] : []),
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

    load: async (repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
      const collected = bodiesFor({ kind: 'repo', repo }, undefined);
      if (!collected.ok) return err([collected.error]);
      return validateDefinitions(mergeBodies(collected.value));
    },

    loadRoadmap: async (repo: RepoSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined> => {
      const file =
        files.get(keyOf({ kind: 'repo', repo }, FAKE_ROADMAP_TARGET)) ??
        files.get(keyOf({ kind: 'global' }, FAKE_ROADMAP_TARGET));
      if (file === undefined) return undefined;
      const parsed = parseRoadmapBody(FAKE_ROADMAP_TARGET, file.content);
      if (!parsed.ok) return err([parsed.error]);
      return validateRoadmap(parsed.value);
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
        const validated = validateRoadmap(parsed.value);
        return validated.ok ? ok(undefined) : err(toDefinitionIssues(validated.error));
      }
      const collected = bodiesFor(scope, { target, content });
      if (!collected.ok) return err([collected.error]);
      const validated = validateDefinitions(mergeBodies(collected.value));
      return validated.ok ? ok(undefined) : err(validated.error);
    },
  };
};
