// The one-time import of a repository's own `.docket/` folder (project.yaml, repo.yaml,
// roadmap.yaml and the role/flow/capability files beside them) onto the machine-local layout.
// This is the only module that opens a repo-side `.docket/`, and it only reads there: every
// write lands under the global root, through the store's create-only hash guard.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { DefinitionStore, LegacyImporter, LegacyImportReport } from '../../../application/index';
import type {
  DefinitionIssue,
  Definitions,
  FlowDef,
  RepoFlow,
  RepoDef,
  Result,
  RoleDef,
  RoleOverlay,
  RoleRef,
  StageBinding,
} from '../../../domain/index';
import { err, ok, validateDefinitions, validateRoadmap } from '../../../domain/index';

export interface LegacyImportConfig {
  readonly globalRoot: string;
  readonly store: DefinitionStore;
}

const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, maxAliasCount: 100 } as const;
const LEGACY_FOLDER = '.docket';
const KINDS = ['roles', 'flows', 'capabilities'] as const;
type Kind = (typeof KINDS)[number];
const VERSION_FILE = /^v([1-9][0-9]*)\.yaml$/;
const OVERLAY_FIELDS = ['name', 'instructions', 'writeScope', 'capabilities', 'docketTools'] as const;

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';

interface LegacyFile {
  readonly text: string;
  readonly mapping: UnknownRecord;
}

/** Reads and parses one legacy yaml file; missing → undefined, unreadable shape → an issue. */
async function readLegacyFile(
  file: string,
  label: string,
): Promise<Result<LegacyFile | undefined, DefinitionIssue>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return ok(undefined);
    throw error;
  }
  try {
    const document = parseYaml(text, YAML_OPTIONS);
    if (!isRecord(document)) return err({ path: label, code: 'wrong_type', message: 'yaml: document must be a mapping' });
    return ok({ text, mapping: document });
  } catch (error) {
    return err({ path: label, code: 'wrong_type', message: `yaml: ${firstLine(error)}` });
  }
}

/** The ids of the `<id>.yaml` files in a legacy override folder, sorted; a missing folder is empty. */
async function listOverrideIds(folder: string): Promise<readonly string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name.slice(0, -'.yaml'.length))
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

interface LibraryEntry {
  readonly mapping: UnknownRecord;
  readonly version: number;
}

/** The newest version of every library definition of one kind, keyed by id. */
async function readLibraryKind(globalRoot: string, kind: Kind): Promise<ReadonlyMap<string, LibraryEntry>> {
  const entries = new Map<string, LibraryEntry>();
  const root = join(globalRoot, 'library', kind);
  let ids: readonly string[];
  try {
    ids = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) return entries;
    throw error;
  }
  for (const id of ids) {
    const versions = (await readdir(join(root, id)))
      .map((name) => VERSION_FILE.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ name: match[0], version: Number(match[1]) }))
      .sort((a, b) => a.version - b.version);
    const newest = versions[versions.length - 1];
    if (newest === undefined) continue;
    const parsed = parseYaml(await readFile(join(root, id, newest.name), 'utf8'), YAML_OPTIONS);
    if (isRecord(parsed)) entries.set(id, { mapping: parsed, version: newest.version });
  }
  return entries;
}

const overlayOf = (override: UnknownRecord): RoleOverlay => {
  const overlay: Record<string, unknown> = {};
  for (const field of OVERLAY_FIELDS) {
    if (override[field] !== undefined) overlay[field] = override[field];
  }
  return overlay as RoleOverlay;
};

/** The first free `<id>`, `<id>-2`, `<id>-3`… for which `exists` is false. */
async function freeSlug(id: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await exists(id))) return id;
  for (let n = 2; ; n += 1) {
    const candidate = `${id}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}

export function createLegacyImporter(config: LegacyImportConfig): LegacyImporter {
  const { globalRoot, store } = config;

  const exists = (target: string) => async (slug: string): Promise<boolean> =>
    (await store.readFile(target.replace('<slug>', slug))) !== undefined;

  const importLegacyRepo = async (
    path: string,
  ): Promise<Result<LegacyImportReport, readonly DefinitionIssue[]>> => {
    const root = join(path, LEGACY_FOLDER);
    const issues: DefinitionIssue[] = [];
    const warnings: string[] = [];

    const files: Record<'project' | 'repo' | 'roadmap', LegacyFile | undefined> = {
      project: undefined,
      repo: undefined,
      roadmap: undefined,
    };
    for (const name of ['project', 'repo', 'roadmap'] as const) {
      const read = await readLegacyFile(join(root, `${name}.yaml`), `${LEGACY_FOLDER}/${name}.yaml`);
      if (!read.ok) issues.push(read.error);
      else files[name] = read.value;
    }
    if (issues.length === 0 && files.project === undefined && files.repo === undefined) {
      return err([{ path: LEGACY_FOLDER, code: 'missing_field', message: 'no legacy project.yaml or repo.yaml found' }]);
    }

    // The files beside the three documents are role/flow/capability definitions: project-level
    // defaults when a project.yaml sits here, repo-level overrides otherwise.
    const overrides: Record<Kind, Map<string, UnknownRecord>> = {
      roles: new Map(),
      flows: new Map(),
      capabilities: new Map(),
    };
    for (const kind of KINDS) {
      for (const id of await listOverrideIds(join(root, kind))) {
        const read = await readLegacyFile(join(root, kind, `${id}.yaml`), `${LEGACY_FOLDER}/${kind}/${id}.yaml`);
        if (!read.ok) issues.push(read.error);
        else if (read.value !== undefined) overrides[kind].set(id, read.value.mapping);
      }
    }
    if (issues.length > 0) return err(issues);

    const library: Record<Kind, ReadonlyMap<string, LibraryEntry>> = {
      roles: await readLibraryKind(globalRoot, 'roles'),
      flows: await readLibraryKind(globalRoot, 'flows'),
      capabilities: await readLibraryKind(globalRoot, 'capabilities'),
    };
    const merged = (kind: Kind): readonly UnknownRecord[] => {
      const byId = new Map<string, UnknownRecord>();
      for (const [id, entry] of library[kind]) byId.set(id, entry.mapping);
      for (const [id, mapping] of overrides[kind]) byId.set(id, mapping);
      return [...byId.values()];
    };

    // Validation first, all of it: an invalid folder writes nothing (every issue is answered).
    const projectValidated =
      files.project === undefined
        ? undefined
        : validateDefinitions({ roles: [], flows: [], capabilities: [], project: files.project.mapping });
    if (projectValidated !== undefined && !projectValidated.ok) issues.push(...projectValidated.error);
    const project = projectValidated?.ok === true ? projectValidated.value.project : undefined;

    const repoValidated =
      files.repo === undefined
        ? undefined
        : validateDefinitions({
            roles: merged('roles'),
            flows: merged('flows'),
            capabilities: merged('capabilities'),
            repo: files.repo.mapping,
          });
    if (repoValidated !== undefined && !repoValidated.ok) issues.push(...repoValidated.error);
    const defs: Definitions | undefined = repoValidated?.ok === true ? repoValidated.value : undefined;

    if (files.roadmap !== undefined) {
      if (files.project === undefined) {
        warnings.push('roadmap.yaml was not imported: a roadmap belongs to a project and no project.yaml sits beside it');
      } else {
        const roadmap = validateRoadmap(files.roadmap.mapping, project);
        if (!roadmap.ok) {
          issues.push(
            ...roadmap.error.map((issue): DefinitionIssue => ({
              path: `roadmap.${issue.path}`,
              code: 'wrong_type',
              message: `${issue.code}: ${issue.message}`,
            })),
          );
        }
      }
    }
    if (issues.length > 0) return err(issues);

    const usedOverrides = new Set<string>();
    let repoMapping: UnknownRecord | undefined;
    const legacyRepo: RepoDef | undefined = defs?.repo;
    if (defs !== undefined && legacyRepo !== undefined) {
      const flowDef: FlowDef | undefined = defs.flows.find((flow) => flow.id === legacyRepo.defaultFlow);
      if (flowDef === undefined) {
        return err([{ path: 'repo.defaultFlow', code: 'unknown_flow', message: `"${legacyRepo.defaultFlow}" is not a defined flow` }]);
      }
      const flowFromFile = overrides.flows.has(flowDef.id);
      if (flowFromFile) usedOverrides.add(`flows/${flowDef.id}`);
      for (const slot of legacyRepo.flows) {
        if (slot !== legacyRepo.defaultFlow) {
          warnings.push(`flow "${slot}" enabled in repo.flows was not imported: a repo has exactly one flow`);
        }
      }

      const roleOverrides = new Map(legacyRepo.roleOverrides.map((override) => [override.id as string, override]));
      const usedRoleOverrides = new Set<string>();
      const bindings: StageBinding[] = flowDef.stages.map((stage) => {
        if (stage.role === null) return { stage: stage.id, accounts: [] };
        const roleId = stage.role;
        const override = roleOverrides.get(roleId);
        if (override !== undefined) usedRoleOverrides.add(roleId);
        const overlay = override === undefined ? undefined : overlayOf(override as unknown as UnknownRecord);
        const base = defs.roles.find((role) => role.id === roleId) as RoleDef;
        const libraryEntry = library.roles.get(roleId);
        let role: RoleRef;
        if (overrides.roles.has(roleId)) {
          // A role that exists only as a repo file has no library version to point at: the repo
          // keeps its own detached copy, with the override already applied.
          usedOverrides.add(`roles/${roleId}`);
          role = {
            roleId: base.id,
            version: libraryEntry?.version ?? 1,
            detached: { ...base, ...(overlay ?? {}) } as RoleDef,
          };
          warnings.push(`roles file "${roleId}" was embedded as a detached copy in stage "${stage.id}"`);
        } else {
          role = {
            roleId: base.id,
            version: libraryEntry?.version ?? 1,
            ...(overlay === undefined || Object.keys(overlay).length === 0 ? {} : { overlay }),
          };
        }
        return { stage: stage.id, role, accounts: [] };
      });
      for (const override of legacyRepo.roleOverrides) {
        if (override.active !== undefined) {
          warnings.push(`roleOverride "${override.id}" sets active, which an overlay cannot carry; the field was dropped`);
        }
        if (!usedRoleOverrides.has(override.id)) {
          warnings.push(`roleOverride "${override.id}" is not used by the default flow and was dropped`);
        }
      }

      const flow: RepoFlow = {
        flowId: flowDef.id,
        version: flowFromFile ? 1 : (library.flows.get(flowDef.id)?.version ?? 1),
        stages: flowDef.stages,
        bindings,
      };
      repoMapping = {
        id: legacyRepo.id,
        name: legacyRepo.name,
        flow,
        defaultLimitPolicy: 'wait_resume',
        commandSets: legacyRepo.commandSets,
        docsRoot: legacyRepo.docsRoot,
        testGlobs: legacyRepo.testGlobs,
        ...(legacyRepo.environments === undefined ? {} : { environments: legacyRepo.environments }),
        ...(legacyRepo.budget === undefined ? {} : { budget: legacyRepo.budget }),
      };
    }

    for (const kind of KINDS) {
      for (const id of overrides[kind].keys()) {
        if (usedOverrides.has(`${kind}/${id}`)) continue;
        warnings.push(
          files.project === undefined
            ? `repo-level ${kind} override "${id}" was not imported`
            : `project-level ${kind} default "${id}" dropped: a project carries no ${kind}`,
        );
      }
    }

    // Slugs last, right before the writes: a taken slug is never overwritten, it gains -2, -3….
    const renames: { id: string; to: string }[] = [];
    let repoSlug: string | undefined;
    if (repoMapping !== undefined && legacyRepo !== undefined) {
      repoSlug = await freeSlug(legacyRepo.id, exists('repos/<slug>/repo.yaml'));
      if (repoSlug !== legacyRepo.id) renames.push({ id: legacyRepo.id, to: repoSlug });
    }
    let projectSlug: string | undefined;
    if (project !== undefined) {
      projectSlug = await freeSlug(project.id, exists('projects/<slug>/project.yaml'));
      if (projectSlug !== project.id) renames.push({ id: project.id, to: projectSlug });
    }

    const writes: { target: string; content: string }[] = [];
    if (repoMapping !== undefined && repoSlug !== undefined) {
      writes.push({
        target: `repos/${repoSlug}/repo.yaml`,
        content: `${stringifyYaml({ ...repoMapping, id: repoSlug })}\n`,
      });
    }
    if (project !== undefined && projectSlug !== undefined) {
      const renamedRepo = (slug: string): string => (legacyRepo !== undefined && slug === legacyRepo.id && repoSlug !== undefined ? repoSlug : slug);
      writes.push({
        target: `projects/${projectSlug}/project.yaml`,
        content: `${stringifyYaml({
          id: projectSlug,
          name: project.name,
          mainRepo: renamedRepo(project.mainRepo),
          repos: project.repos.map(renamedRepo),
          ...(project.budget === undefined ? {} : { budget: project.budget }),
        })}\n`,
      });
      if (files.roadmap !== undefined) {
        writes.push({ target: `projects/${projectSlug}/roadmap.yaml`, content: files.roadmap.text });
      }
    }
    for (const write of writes) {
      const written = await store.writeFile(write.target, write.content, '');
      if (!written.ok) {
        return err([{ path: write.target, code: 'duplicate_id', message: 'a file appeared at the target while importing' }]);
      }
    }

    return ok({ warnings, renames });
  };

  return { importLegacyRepo };
}
