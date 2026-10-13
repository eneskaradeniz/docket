// In-memory DefinitionStore — the same single-root grammar the YAML adapter implements, with JSON
// file bodies: the domain validators take parsed YAML/JSON, and a fake only needs the
// deterministic variant of that. Library histories live in a version map; the fixed project, repo
// and roadmap files live in a target-keyed map.
import type {
  CapabilityDef,
  DefinitionIssue,
  Definitions,
  EpochMs,
  FlowDef,
  ProjectDef,
  ProjectSlug,
  RepoDef,
  RepoSlug,
  Result,
  Roadmap,
  RoadmapIssue,
  RoleDef,
  VersionRecord,
} from '../../../domain/index';
import { err, nextVersion, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';

import type { DefinitionFile, DefinitionKind, DefinitionScope, DefinitionStore } from '../definition-store';

export const FAKE_ROADMAP_TARGET = 'roadmap.yaml';

export interface FakeDefinitionStore extends DefinitionStore {
  /** Seeds a fixed file directly, bypassing the hash protection — the initial-state setter for tests. */
  seed(target: string, content: string): void;
  seed(scope: DefinitionScope, target: string, content: string): void;
  /** Registers a project: the membership a roadmap's project context validates against. */
  setProject(def: ProjectDef): void;
  /** Registers the typed repo section `load` answers with — the typed-seed path for the Phase 7
   *  fields (`flow`, `defaultLimitPolicy`) the JSON narrowing does not carry yet. */
  setRepoDef(repo: RepoSlug, def: RepoDef): void;
  /** Overrides what repoPath reports; undefined marks the repo as without a checkout. */
  setRepoPath(repo: RepoSlug, path: string | undefined): void;
  /** Seeds a project.yaml directly for readProjectAt at a specific checkout path. */
  seedProjectAt(path: string, content: string): void;
  /** Seeds a repo.yaml directly at a specific checkout path for scaffolding assertions. */
  seedRepoAt(path: string, content: string): void;
  /** Reads back what was scaffolded/seeded at a repo path. */
  repoAt(path: string): string | undefined;
  /** Reads and validates project.yaml at an arbitrary path (legacy test helper). */
  readProjectAt(path: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>>;
  /** Makes the next scaffoldProject fail with 'io_failed' — the error branch probe. */
  failNextScaffold(): void;
  /** Makes the next `appendVersion` answer `stale` and write nothing — the deterministic
   *  stand-in for the YAML adapter's write race. */
  failNextAppendStale(): void;

  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  readFile(target: string): Promise<DefinitionFile | undefined>;

  writeFile(
    targetOrScope: DefinitionScope | string,
    contentOrTarget: string,
    expectedHashOrContent: string,
    maybeExpectedHash?: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>>;

  validateCandidate(
    scope: DefinitionScope,
    target: string,
    content: string,
  ): Promise<Result<void, readonly DefinitionIssue[]>>;
  validateCandidate(
    target: string,
    content: string,
  ): Promise<Result<void, readonly DefinitionIssue[]>>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

// The store's own grammar, mirrored without importing the adapter: a target names a library
// version file, or one of the three fixed files under projects/ and repos/.
const VERSION_TARGET = /^library\/(roles|flows|capabilities|memory)\/([^/]+)\/v([1-9][0-9]*)\.yaml$/;
const PROJECT_TARGET = /^projects\/([^/]+)\/(project|roadmap)\.yaml$/;
const REPO_TARGET = /^repos\/([^/]+)\/repo\.yaml$/;

interface FixedFile extends DefinitionFile {
  readonly target: string;
}

const toDefinitionIssues = (issues: readonly RoadmapIssue[]): readonly DefinitionIssue[] =>
  issues.map((issue) => ({
    path: `roadmap.${issue.path}`,
    code: issue.code === 'invalid_slug' || issue.code === 'duplicate_id' || issue.code === 'missing_field' || issue.code === 'wrong_type'
      ? issue.code
      : 'wrong_type',
    message: `roadmap ${issue.code}: ${issue.message}`,
  }));

/** The project rules see a project.yaml alone; roles and flows are explicitly empty. */
const validateProjectMapping = (mapping: UnknownRecord): Result<ProjectDef, readonly DefinitionIssue[]> => {
  const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: mapping });
  if (!validated.ok) return err(validated.error);
  return validated.value.project === undefined
    ? err([{ path: 'project.yaml', code: 'missing_field', message: 'project is required' }])
    : ok(validated.value.project);
};

/** The body a seeded version file carries: JSON when it parses, the raw text otherwise. */
const safeBody = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

export const createFakeDefinitionStore = (): FakeDefinitionStore => {
  const fixed = new Map<string, FixedFile>();
  const histories = new Map<string, VersionRecord<unknown>[]>();
  const projects: ProjectDef[] = [];
  const repoDefs = new Map<RepoSlug, RepoDef>();
  const projectAt = new Map<string, string>();
  const repoFileAt = new Map<string, string>();
  const legacyBroken = new Map<string, string>();
  const legacyRepoWithoutSection = new Set<string>();
  let failAppend = false;
  let legacyGlobalSeeded = false;

  const historyOf = (kind: DefinitionKind, id: string): VersionRecord<unknown>[] =>
    histories.get(`${kind}/${id}`) ?? [];

  /** The fixed file of a target, when the target names one. */
  const fixedOf = (target: string): FixedFile | undefined => {
    if (VERSION_TARGET.test(target) || PROJECT_TARGET.test(target) || REPO_TARGET.test(target)) {
      return fixed.get(target);
    }
    return fixed.get(target);
  };

  /** A library target's file reads back as its version's body, JSON-serialised. */
  const fileOf = (target: string): DefinitionFile | undefined => {
    const version = VERSION_TARGET.exec(target);
    if (version !== null) {
      const record = historyOf(version[1] as DefinitionKind, version[2]).find((entry) => entry.version === Number(version[3]));
      if (record === undefined) return undefined;
      const content = JSON.stringify(record.body);
      return { content, hash: contentHash(content) };
    }
    const file = fixedOf(target);
    return file === undefined ? undefined : { content: file.content, hash: file.hash };
  };

  const projectDefOf = (project: ProjectSlug): ProjectDef | undefined => {
    const mirror = projects.find((def) => def.id === project);
    if (mirror !== undefined) return mirror;
    const file = fixed.get(`projects/${project}/project.yaml`);
    if (file === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (!isRecord(parsed)) return undefined;
      const validated = validateProjectMapping(parsed);
      return validated.ok ? validated.value : undefined;
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

  /** One library kind's current bodies — the newest version of every definition. */
  const currentsOf = (kind: DefinitionKind): readonly unknown[] =>
    [...histories.entries()]
      .filter(([key]) => key.startsWith(`${kind}/`))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, history]) => history[history.length - 1]?.body)
      .filter((body): body is unknown => body !== undefined);

  const seedSingle = (target: string, content: string): void => {
    const version = VERSION_TARGET.exec(target);
    if (version !== null) {
      const kind = version[1] as DefinitionKind;
      const id = version[2];
      const key = `${kind}/${id}`;
      const history = histories.get(key) ?? [];
      histories.set(key, [...history, { definitionId: id, version: Number(version[3]), body: safeBody(content), recordedAt: 0, archived: false }]
        .sort((a, b) => a.version - b.version));
      return;
    }
    fixed.set(target, { target, content, hash: contentHash(content) });
  };

  return {
    seed: (targetOrScope: string | DefinitionScope, contentOrTarget: string, maybeContent?: string): void => {
      if (maybeContent === undefined && typeof targetOrScope === 'string') {
        seedSingle(targetOrScope, contentOrTarget);
        return;
      }
      const scope = targetOrScope as DefinitionScope;
      const target = contentOrTarget;
      const content = maybeContent ?? '';

      if (scope.kind === 'global') {
        legacyGlobalSeeded = true;
        const parsed = parseJson(target, content);
        if (parsed.ok && isRecord(parsed.value)) {
          const body = parsed.value;
          if (Array.isArray(body.roles)) {
            for (const r of body.roles) {
              if (isRecord(r) && typeof r.id === 'string') {
                histories.set(`roles/${r.id}`, [{ definitionId: r.id, version: 1, body: r, recordedAt: 0, archived: false }]);
              }
            }
          }
          if (Array.isArray(body.flows)) {
            for (const f of body.flows) {
              if (isRecord(f) && typeof f.id === 'string') {
                histories.set(`flows/${f.id}`, [{ definitionId: f.id, version: 1, body: f, recordedAt: 0, archived: false }]);
              }
            }
          }
          if (Array.isArray(body.capabilities)) {
            for (const c of body.capabilities) {
              if (isRecord(c) && typeof c.id === 'string') {
                histories.set(`capabilities/${c.id}`, [{ definitionId: c.id, version: 1, body: c, recordedAt: 0, archived: false }]);
              }
            }
          }
          if (typeof body.kind === 'string' && typeof body.id === 'string') {
            histories.set(`capabilities/${body.id}`, [{ definitionId: body.id, version: 1, body, recordedAt: 0, archived: false }]);
          } else if (target.startsWith('capabilities/')) {
            const id = target.replace(/^capabilities\//, '').replace(/\.(yaml|json)$/, '');
            histories.set(`capabilities/${id}`, [{ definitionId: id, version: 1, body, recordedAt: 0, archived: false }]);
          }
          if (body.repo !== undefined && isRecord(body.repo)) {
            if (typeof body.repo.id === 'string') {
              fixed.set(`repos/${body.repo.id}/repo.yaml`, {
                target: `repos/${body.repo.id}/repo.yaml`,
                content: JSON.stringify(body.repo),
                hash: contentHash(JSON.stringify(body.repo)),
              });
            }
          }
        } else if (!parsed.ok) {
          if (target.startsWith('capabilities/') && content.includes('kind:')) {
            const id = target.replace(/^capabilities\//, '').replace(/\.(yaml|json)$/, '');
            histories.set(`capabilities/${id}`, [{ definitionId: id, version: 1, body: safeBody(content), recordedAt: 0, archived: false }]);
          } else {
            legacyBroken.set(target, content);
          }
        }
        fixed.set(target, { target, content, hash: contentHash(content) });
        return;
      }

      if (scope.kind === 'repo') {
        const parsed = parseJson(target, content);
        if (parsed.ok && isRecord(parsed.value)) {
          const body = parsed.value;
          if (body.repo !== undefined && isRecord(body.repo)) {
            legacyRepoWithoutSection.delete(scope.repo);
            fixed.set(`repos/${scope.repo}/repo.yaml`, {
              target: `repos/${scope.repo}/repo.yaml`,
              content: JSON.stringify(body.repo),
              hash: contentHash(JSON.stringify(body.repo)),
            });
          } else if (body.id === scope.repo || body.name !== undefined) {
            legacyRepoWithoutSection.delete(scope.repo);
            fixed.set(`repos/${scope.repo}/repo.yaml`, {
              target: `repos/${scope.repo}/repo.yaml`,
              content,
              hash: contentHash(content),
            });
          } else {
            legacyRepoWithoutSection.add(scope.repo);
            fixed.delete(`repos/${scope.repo}/repo.yaml`);
          }
          if (Array.isArray(body.roles)) {
            for (const key of Array.from(histories.keys())) {
              if (key.startsWith('roles/')) histories.delete(key);
            }
            for (const r of body.roles) {
              if (isRecord(r) && typeof r.id === 'string') {
                histories.set(`roles/${r.id}`, [{ definitionId: r.id, version: 1, body: r, recordedAt: 0, archived: false }]);
              }
            }
          }
          if (Array.isArray(body.flows)) {
            for (const key of Array.from(histories.keys())) {
              if (key.startsWith('flows/')) histories.delete(key);
            }
            for (const f of body.flows) {
              if (isRecord(f) && typeof f.id === 'string') {
                histories.set(`flows/${f.id}`, [{ definitionId: f.id, version: 1, body: f, recordedAt: 0, archived: false }]);
              }
            }
          }
          if (Array.isArray(body.capabilities)) {
            for (const c of body.capabilities) {
              if (isRecord(c) && typeof c.id === 'string') {
                histories.set(`capabilities/${c.id}`, [{ definitionId: c.id, version: 1, body: c, recordedAt: 0, archived: false }]);
              }
            }
          }
        } else {
          fixed.set(`repos/${scope.repo}/repo.yaml`, {
            target: `repos/${scope.repo}/repo.yaml`,
            content,
            hash: contentHash(content),
          });
        }
        fixed.set(`repos/${scope.repo}/${target}`, { target: `repos/${scope.repo}/${target}`, content, hash: contentHash(content) });
        return;
      }

      if (scope.kind === 'project') {
        if (target === 'roadmap.json' || target === 'roadmap.yaml' || content.includes('phases')) {
          fixed.set(`projects/${scope.project}/roadmap.yaml`, {
            target: `projects/${scope.project}/roadmap.yaml`,
            content,
            hash: contentHash(content),
          });
        }
        const parsed = parseJson(target, content);
        if (parsed.ok && isRecord(parsed.value) && parsed.value.project !== undefined) {
          fixed.set(`projects/${scope.project}/project.yaml`, {
            target: `projects/${scope.project}/project.yaml`,
            content: JSON.stringify(parsed.value.project),
            hash: contentHash(JSON.stringify(parsed.value.project)),
          });
        }
        fixed.set(`projects/${scope.project}/${target}`, { target: `projects/${scope.project}/${target}`, content, hash: contentHash(content) });
      }
    },

    setProject: (def: ProjectDef): void => {
      const existing = projects.findIndex((candidate) => candidate.id === def.id);
      if (existing === -1) projects.push({ ...def, repos: [...def.repos] });
      else projects[existing] = { ...def, repos: [...def.repos] };
    },

    setRepoDef: (repo: RepoSlug, def: RepoDef): void => {
      repoDefs.set(repo, def);
    },

    setRepoPath: (_repo: RepoSlug, _path: string | undefined): void => {},

    seedProjectAt: (path: string, content: string): void => {
      projectAt.set(path, content);
    },

    seedRepoAt: (path: string, content: string): void => {
      repoFileAt.set(path, content);
    },

    repoAt: (path: string): string | undefined => repoFileAt.get(path),

    readProjectAt: async (path: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>> => {
      const content = projectAt.get(path);
      if (content === undefined) {
        return err([{ path: 'project.yaml', code: 'missing_field', message: 'project.yaml is required' }]);
      }
      const parsed = parseJson('project.yaml', content);
      if (!parsed.ok) return err([parsed.error]);
      if (!isRecord(parsed.value)) {
        return err([{ path: 'project.yaml', code: 'wrong_type', message: 'project.yaml must be a JSON object' }]);
      }
      const validated = validateDefinitions({ roles: [], flows: [], capabilities: [], project: parsed.value });
      return validated.ok && validated.value.project !== undefined
        ? ok(validated.value.project)
        : err(validated.ok ? [{ path: 'project.yaml', code: 'missing_field', message: 'project is required' }] : validated.error);
    },

    failNextScaffold: (): void => {},

    failNextAppendStale: (): void => {
      failAppend = true;
    },

    // Library copies land as version histories keyed by kind and id; an existing history is
    // never touched. The target strings match the adapter's grammar.
    installBuiltins: async (library): Promise<{ readonly written: readonly string[] }> => {
      const written: string[] = [];
      const install = (kind: 'roles' | 'flows', id: string, value: unknown): void => {
        const key = `${kind}/${id}`;
        if ((histories.get(key) ?? []).length > 0) return;
        histories.set(key, [{ definitionId: id, version: 1, body: value, recordedAt: 0, archived: false }]);
        written.push(`library/${kind}/${id}/v1.yaml`);
      };
      for (const role of library.roles) install('roles', role.id, role);
      for (const flow of library.flows) install('flows', flow.id, flow);
      return { written };
    },

    // One capability per version file, JSON-bodied here; an existing history is skipped
    // untouched whatever its content.
    installCapabilities: async (capabilities): Promise<{ readonly written: readonly string[]; readonly skipped: readonly string[] }> => {
      const written: string[] = [];
      const skipped: string[] = [];
      for (const capability of capabilities) {
        const key = `capabilities/${capability.id}`;
        if ((histories.get(key) ?? []).length > 0) {
          skipped.push(`library/capabilities/${capability.id}/v1.yaml`);
          continue;
        }
        histories.set(key, [{ definitionId: capability.id, version: 1, body: capability, recordedAt: 0, archived: false }]);
        written.push(`library/capabilities/${capability.id}/v1.yaml`);
      }
      return { written, skipped };
    },

    // The version histories live in memory keyed by kind and id. Records are replaced, never
    // edited, so a recorded body stays as it was.
    listVersions: async (kind: DefinitionKind, id: string): Promise<readonly VersionRecord<unknown>[]> =>
      [...historyOf(kind, id)],

    appendVersion: async (
      kind: DefinitionKind,
      id: string,
      body: unknown,
      at: EpochMs,
    ): Promise<Result<VersionRecord<unknown>, 'stale'>> => {
      if (failAppend) {
        failAppend = false;
        return err('stale');
      }
      const key = `${kind}/${id}`;
      const history = histories.get(key) ?? [];
      const record: VersionRecord<unknown> = {
        definitionId: id,
        version: nextVersion(history),
        body,
        recordedAt: at,
        archived: false,
      };
      histories.set(key, [...history, record]);
      return ok(record);
    },

    load: async (repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
      for (const [brokenTarget] of legacyBroken) {
        return err([{ path: brokenTarget, code: 'wrong_type', message: `${brokenTarget} is not valid JSON` }]);
      }
      const file = fixed.get(`repos/${repo}/repo.yaml`);
      if (file === undefined) {
        const registered = repoDefs.get(repo);
        if (registered !== undefined) {
          return ok({
            roles: currentsOf('roles') as readonly RoleDef[],
            flows: currentsOf('flows') as readonly FlowDef[],
            capabilities: currentsOf('capabilities') as readonly CapabilityDef[],
            repo: registered,
          });
        }
        if (legacyRepoWithoutSection.has(repo)) {
          return validateDefinitions({
            roles: currentsOf('roles'),
            flows: currentsOf('flows'),
            capabilities: currentsOf('capabilities'),
          });
        }
        if (legacyGlobalSeeded) {
          const registered = repoDefs.get(repo);
          const validated = validateDefinitions({
            roles: currentsOf('roles'),
            flows: currentsOf('flows'),
            capabilities: currentsOf('capabilities'),
            ...(registered === undefined ? {} : { repo: registered }),
          });
          return registered !== undefined && validated.ok
            ? ok({ ...validated.value, repo: registered })
            : validated;
        }
        return err([{ path: 'repo', code: 'missing_field', message: 'repo.yaml is required' }]);
      }
      const repoBody = parseBody(`repos/${repo}/repo.yaml`, file.content);
      if (!repoBody.ok) return err([repoBody.error]);
      const validated = validateDefinitions({
        roles: currentsOf('roles'),
        flows: currentsOf('flows'),
        capabilities: currentsOf('capabilities'),
        repo: repoBody.value,
      });
      // A typed seed replaces the narrowed repo section wholesale; the file world still has to
      // validate (roles and flows), so a broken merge keeps reporting its issues.
      const registered = repoDefs.get(repo);
      return registered !== undefined && validated.ok ? ok({ ...validated.value, repo: registered }) : validated;
    },

    loadRoadmap: async (project: ProjectSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined> => {
      const file = fixed.get(`projects/${project}/roadmap.yaml`);
      if (file === undefined) return undefined;
      const parsed = parseJson(`projects/${project}/roadmap.yaml`, file.content);
      if (!parsed.ok) {
        return err([{ path: 'roadmap.yaml', code: 'wrong_type', message: parsed.error.message }]);
      }
      if (!isRecord(parsed.value)) {
        return err([{ path: 'roadmap.yaml', code: 'wrong_type', message: 'roadmap.yaml must be a JSON object' }]);
      }
      return validateRoadmap(parsed.value, projectDefOf(project));
    },

    readFile: async (targetOrScope: string | DefinitionScope, maybeTarget?: string): Promise<DefinitionFile | undefined> => {
      if (maybeTarget === undefined && typeof targetOrScope === 'string') {
        return fileOf(targetOrScope);
      }
      const scope = targetOrScope as DefinitionScope;
      const target = maybeTarget as string;
      if (target.startsWith('projects/') || target.startsWith('repos/') || target.startsWith('library/')) {
        const exact = fileOf(target);
        if (exact !== undefined) return exact;
      }
      if (scope.kind === 'global') {
        if (target.startsWith('roles/')) {
          const id = target.replace(/^roles\//, '').replace(/\.(yaml|json)$/, '');
          return fixed.get(target) ?? fileOf(`library/roles/${id}/v1.yaml`);
        }
        if (target.startsWith('flows/')) {
          const id = target.replace(/^flows\//, '').replace(/\.(yaml|json)$/, '');
          return fixed.get(target) ?? fileOf(`library/flows/${id}/v1.yaml`);
        }
        if (target.startsWith('capabilities/')) {
          const id = target.replace(/^capabilities\//, '').replace(/\.(yaml|json)$/, '');
          return fixed.get(target) ?? fileOf(`library/capabilities/${id}/v1.yaml`);
        }
        return fixed.get(target);
      }
      if (scope.kind === 'repo') {
        return fixed.get(`repos/${scope.repo}/${target}`) ?? fixed.get(`repos/${scope.repo}/repo.yaml`) ?? fixed.get(target);
      }
      if (scope.kind === 'project') {
        if (target === 'roadmap.json' || target === 'roadmap.yaml') {
          return fixed.get(`projects/${scope.project}/roadmap.yaml`);
        }
        return fixed.get(`projects/${scope.project}/project.yaml`) ?? fixed.get(`projects/${scope.project}/${target}`) ?? fixed.get(target);
      }
      return undefined;
    },

    // '' means "must not exist", mirroring the contract; a library version is create-only — it
    // exists or it does not, and nothing ever replaces it — while the fixed files keep the
    // hash-guarded replace.
    writeFile: async (
      targetOrScope: string | DefinitionScope,
      contentOrTarget: string,
      expectedHashOrContent: string,
      maybeExpectedHash?: string,
    ): Promise<Result<{ readonly hash: string }, 'stale'>> => {
      let target = maybeExpectedHash !== undefined ? contentOrTarget : (targetOrScope as string);
      const content = maybeExpectedHash !== undefined ? expectedHashOrContent : contentOrTarget;
      const expectedHash = maybeExpectedHash !== undefined ? maybeExpectedHash : expectedHashOrContent;
      const scope: DefinitionScope | undefined = typeof targetOrScope !== 'string' ? targetOrScope : undefined;

      let canonical = target;
      if (scope !== undefined) {
        if (scope.kind === 'global') {
          if (target.startsWith('roles/')) {
            const id = target.replace(/^roles\//, '').replace(/\.(yaml|json)$/, '');
            canonical = `library/roles/${id}/v1.yaml`;
          } else if (target.startsWith('flows/')) {
            const id = target.replace(/^flows\//, '').replace(/\.(yaml|json)$/, '');
            canonical = `library/flows/${id}/v1.yaml`;
          } else if (target.startsWith('capabilities/')) {
            const id = target.replace(/^capabilities\//, '').replace(/\.(yaml|json)$/, '');
            canonical = `library/capabilities/${id}/v1.yaml`;
          }
        } else if (scope.kind === 'repo') {
          canonical = target === 'repo.yaml' ? `repos/${scope.repo}/repo.yaml` : `repos/${scope.repo}/${target}`;
        } else if (scope.kind === 'project') {
          canonical = (target === 'roadmap.json' || target === 'roadmap.yaml')
            ? `projects/${scope.project}/roadmap.yaml`
            : target === 'project.yaml'
              ? `projects/${scope.project}/project.yaml`
              : `projects/${scope.project}/${target}`;
        }
      }

      const version = VERSION_TARGET.exec(canonical);
      if (version !== null) {
        if (fileOf(canonical) !== undefined || expectedHash !== '') return err('stale');
        const kind = version[1] as DefinitionKind;
        const id = version[2];
        const key = `${kind}/${id}`;
        const history = histories.get(key) ?? [];
        histories.set(key, [...history, { definitionId: id, version: Number(version[3]), body: safeBody(content), recordedAt: 0, archived: false }]);
        return ok({ hash: contentHash(content) });
      }

      const current = (scope !== undefined ? fixed.get(canonical) : undefined) ?? fileOf(canonical) ?? fileOf(target) ?? fixed.get(canonical) ?? fixed.get(target);
      const currentHash = current === undefined ? '' : current.hash;
      if (currentHash !== expectedHash) return err('stale');

      fixed.set(canonical, { target: canonical, content, hash: contentHash(content) });
      if (scope === undefined && target !== canonical) {
        fixed.set(target, { target, content, hash: contentHash(content) });
      }
      return ok({ hash: contentHash(content) });
    },

    // Writes nothing: the candidate only ever enters the validation, never the store.
    validateCandidate: async (
      targetOrScope: string | DefinitionScope,
      contentOrTarget: string,
      maybeContent?: string,
    ): Promise<Result<void, readonly DefinitionIssue[]>> => {
      for (const [brokenTarget] of legacyBroken) {
        return err([{ path: brokenTarget, code: 'wrong_type', message: `${brokenTarget} is not valid JSON` }]);
      }
      let target = typeof targetOrScope === 'string' ? targetOrScope : contentOrTarget;
      const content = maybeContent !== undefined ? maybeContent : contentOrTarget;
      if (typeof targetOrScope !== 'string') {
        const scope = targetOrScope;
        if (scope.kind === 'global') {
          if (target.startsWith('capabilities/')) {
            const id = target.replace(/^capabilities\//, '').replace(/\.(yaml|json)$/, '');
            target = `library/capabilities/${id}/v1.yaml`;
          } else if (target.startsWith('roles/')) {
            const id = target.replace(/^roles\//, '').replace(/\.(yaml|json)$/, '');
            target = `library/roles/${id}/v1.yaml`;
          } else if (target.startsWith('flows/')) {
            const id = target.replace(/^flows\//, '').replace(/\.(yaml|json)$/, '');
            target = `library/flows/${id}/v1.yaml`;
          }
        } else if (scope.kind === 'repo') {
          target = target === 'repo.yaml' ? `repos/${scope.repo}/repo.yaml` : `repos/${scope.repo}/${target}`;
        } else if (scope.kind === 'project') {
          target = (target === 'roadmap.json' || target === 'roadmap.yaml')
            ? `projects/${scope.project}/roadmap.yaml`
            : target === 'project.yaml'
              ? `projects/${scope.project}/project.yaml`
              : target;
        }
      }

      const roadmap = PROJECT_TARGET.exec(target);
      if (roadmap !== null && roadmap[2] === 'roadmap') {
        const parsed = parseJson(target, content);
        if (!parsed.ok) {
          return err(toDefinitionIssues([{ path: 'roadmap.yaml', code: 'wrong_type', message: parsed.error.message }]));
        }
        if (!isRecord(parsed.value)) {
          return err(toDefinitionIssues([{ path: 'roadmap.yaml', code: 'wrong_type', message: 'roadmap.yaml must be a JSON object' }]));
        }
        const projectDef = projectDefOf(roadmap[1] as ProjectSlug);
        const validated = validateRoadmap(parsed.value, projectDef);
        return validated.ok ? ok(undefined) : err(toDefinitionIssues(validated.error));
      }
      if (target === 'roadmap.yaml' || target === 'roadmap.json') {
        const parsed = parseJson(target, content);
        if (!parsed.ok) {
          return err(toDefinitionIssues([{ path: 'roadmap.yaml', code: 'wrong_type', message: parsed.error.message }]));
        }
        if (!isRecord(parsed.value)) {
          return err(toDefinitionIssues([{ path: 'roadmap.yaml', code: 'wrong_type', message: 'roadmap.yaml must be a JSON object' }]));
        }
        const validated = validateRoadmap(parsed.value, projects[0]);
        return validated.ok ? ok(undefined) : err(toDefinitionIssues(validated.error));
      }
      if (roadmap !== null && roadmap[2] === 'project') {
        const parsed = parseBody(target, content);
        if (!parsed.ok) return err([parsed.error]);
        const validated = validateProjectMapping(parsed.value);
        return validated.ok ? ok(undefined) : err(validated.error);
      }
      const repo = REPO_TARGET.exec(target);
      if (repo !== null) {
        const parsed = parseBody(target, content);
        if (!parsed.ok) return err([parsed.error]);
        const validated = validateDefinitions({
          roles: currentsOf('roles'),
          flows: currentsOf('flows'),
          capabilities: currentsOf('capabilities'),
          repo: parsed.value,
        });
        return validated.ok ? ok(undefined) : err(validated.error);
      }
      const scopedTarget = target.replace(/^repos\/[^/]+\//, '');
      if (scopedTarget === 'roles.json' || scopedTarget === 'flows.json' || scopedTarget === 'caps.json' || scopedTarget === 'capabilities.json') {
        const parsed = parseBody(target, content);
        if (!parsed.ok) return err([parsed.error]);
        const body = parsed.value;
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
      const cleanTarget = target.replace(/^projects\/[^/]+\//, '').replace(/^repos\/[^/]+\//, '');
      const roleOrFlow = /^(?:library\/)?(roles|flows|capabilities)\/([^/]+)(?:\/v\d+\.yaml|\.yaml)?$/.exec(cleanTarget);
      if (roleOrFlow !== null) {
        const kind = roleOrFlow[1] as DefinitionKind;
        const id = roleOrFlow[2];
        const parsed = parseBody(target, content);
        if (!parsed.ok) return err([parsed.error]);
        const body = parsed.value;
        const item = (body[kind] && Array.isArray(body[kind]) ? body[kind][0] : body) ?? body;
        const bodyId = item['id'];
        if (kind !== 'memory' && typeof bodyId === 'string' && bodyId !== id && cleanTarget.startsWith('library/')) {
          return err([{ path: `library/${kind}/${id}`, code: 'invalid_slug', message: 'id does not match folder name' }]);
        }
        if (kind === 'memory') return ok(undefined);
        const validated = validateDefinitions({
          roles: kind === 'roles' ? (Array.isArray(body.roles) ? body.roles : [item]) : [],
          flows: kind === 'flows' ? (Array.isArray(body.flows) ? body.flows : [item]) : [],
          capabilities: kind === 'capabilities' ? (Array.isArray(body.capabilities) ? body.capabilities : [item]) : [],
        });
        return validated.ok ? ok(undefined) : err(validated.error);
      }
      return err([{ path: target, code: 'wrong_type', message: 'not a definition file' }]);
    },
  };
};
