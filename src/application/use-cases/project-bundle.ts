import type {
  Actor,
  CapabilityDef,
  DefinitionIssue,
  FlowDef,
  PhaseDef,
  ProjectDef,
  ProjectSlug,
  RepoDef,
  RepoFlow,
  RepoSlug,
  Result,
  Roadmap,
  RoleDef,
  Slug,
  TaskDef,
  VersionRecord,
} from '../../domain/index';
import { err, ok, parseSlug, validateDefinitions } from '../../domain/index';
import type { DefinitionKind } from '../ports/definition-store';
import type { AppDeps } from '../ports/deps';
import type {
  BundleLibrary,
  BundleMemory,
  BundleProjects,
  BundleRepos,
  DocketBundle,
  MemoryNote,
} from '../ports/bundle-store';

export type ExportProjectDeps = Pick<
  AppDeps,
  'clock' | 'ids' | 'log' | 'projects' | 'definitions' | 'bundleStore' | 'memory'
>;

export interface ExportProjectResult {
  readonly path: string;
  readonly counts: {
    readonly projects: number;
    readonly repos: number;
    readonly definitions: number;
    readonly memoryNotes: number;
  };
}

export type ExportProjectError = 'not_found' | 'definitions_invalid' | 'io_failed';

export type ImportBundleDeps = Pick<
  AppDeps,
  'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'bundleStore' | 'memory'
>;

export interface ImportBundleReport {
  readonly warnings: readonly string[];
  readonly renames: readonly { readonly id: string; readonly to: string }[];
}

export type ImportBundleErrorCode =
  | 'not_found'
  | 'wrong_format'
  | 'bad_checksum'
  | 'definitions_invalid';

export type ImportBundleResult =
  | { readonly ok: true; readonly value: ImportBundleReport }
  | {
      readonly ok: false;
      readonly error: ImportBundleErrorCode;
      readonly issues?: readonly DefinitionIssue[];
    };

const slugOf = <B extends string>(val: string): Slug<B> => {
  const p = parseSlug<B>(val);
  if (!p.ok) throw new Error(`Invalid slug: ${val}`);
  return p.value;
};

/**
 * Sanitizes a RepoDef for bundle export:
 * - Stage bindings are exported with accounts [] (I-89).
 */
function sanitizeRepoForExport(repo: RepoDef): RepoDef {
  if (!repo.flow) return repo;
  const sanitizedFlow: RepoFlow = {
    ...repo.flow,
    bindings: repo.flow.bindings.map((binding) => ({
      ...binding,
      accounts: [],
    })),
  };
  return {
    ...repo,
    flow: sanitizedFlow,
  };
}

/**
 * A-342: project.export {project}
 * Builds the bundle of I-89/I-99 and writes it through BundleStore.export (I-100),
 * answering { path, counts: { projects, repos, definitions, memoryNotes } } (not_found for an unknown project; audit project.exported).
 */
export async function exportProject(
  deps: ExportProjectDeps,
  input: { readonly project: ProjectSlug; readonly actor: Actor },
): Promise<Result<ExportProjectResult, ExportProjectError>> {
  const projectDef = await deps.projects.get(input.project);
  if (projectDef === undefined) {
    return err('not_found');
  }

  // Load project roadmap if present
  const roadmapResult = await deps.definitions.loadRoadmap(projectDef.id);
  const roadmap: Roadmap | undefined = roadmapResult?.ok ? roadmapResult.value : undefined;

  const projects: BundleProjects = [
    {
      project: projectDef,
      ...(roadmap !== undefined ? { roadmap } : {}),
    },
  ];

  // Load repos for the project
  const repos: RepoDef[] = [];
  const referencedRoles = new Set<string>();
  const referencedFlows = new Set<string>();
  const referencedCaps = new Set<string>();

  for (const repoSlug of projectDef.repos) {
    const loaded = await deps.definitions.load(repoSlug);
    if (!loaded.ok || loaded.value.repo === undefined) {
      return err('definitions_invalid');
    }
    const repo = loaded.value.repo;
    repos.push(sanitizeRepoForExport(repo));

    for (const r of loaded.value.roles) referencedRoles.add(r.id);
    for (const f of loaded.value.flows) referencedFlows.add(f.id);
    for (const c of loaded.value.capabilities) referencedCaps.add(c.id);

    referencedFlows.add(repo.flow.flowId);
    for (const st of repo.flow.stages) {
      if (st.role) referencedRoles.add(st.role);
    }
    for (const bd of repo.flow.bindings) {
      if (bd.role?.roleId) referencedRoles.add(bd.role.roleId);
    }
  }

  // Build library version histories (I-99)
  const library: {
    roles: Record<string, readonly VersionRecord<unknown>[]>;
    flows: Record<string, readonly VersionRecord<unknown>[]>;
    capabilities: Record<string, readonly VersionRecord<unknown>[]>;
    memory: Record<string, readonly VersionRecord<unknown>[]>;
  } = {
    roles: {},
    flows: {},
    capabilities: {},
    memory: {},
  };

  let totalDefinitionsCount = 0;

  for (const roleId of referencedRoles) {
    const history = await deps.definitions.listVersions('roles', roleId);
    if (history.length > 0) {
      library.roles[roleId] = history;
      totalDefinitionsCount++;
      const latest = history[history.length - 1].body as RoleDef;
      if (latest && Array.isArray(latest.capabilities)) {
        for (const c of latest.capabilities) referencedCaps.add(c);
      }
    }
  }

  for (const flowId of referencedFlows) {
    const history = await deps.definitions.listVersions('flows', flowId);
    if (history.length > 0) {
      library.flows[flowId] = history;
      totalDefinitionsCount++;
    }
  }

  for (const capId of referencedCaps) {
    const history = await deps.definitions.listVersions('capabilities', capId);
    if (history.length > 0) {
      library.capabilities[capId] = history;
      totalDefinitionsCount++;
    }
  }

  // Accepted memory notes for this project only (I-99, R-142) — proposals never travel.
  const memoryNotes: MemoryNote[] = [];
  const repoIdSet = new Set(projectDef.repos.map((r) => r as string));
  const noteIds = await deps.memory.listNoteIds();
  for (const id of noteIds) {
    const versions = await deps.definitions.listVersions('memory', id);
    if (versions.length === 0) continue;
    const note = versions[versions.length - 1].body as MemoryNote;
    if (note === undefined) continue;
    const inScope =
      note.scope === 'global' ||
      (note.scope === 'project' && note.scopeId === projectDef.id) ||
      (note.scope === 'repo' && note.scopeId !== undefined && repoIdSet.has(note.scopeId));
    if (inScope) {
      memoryNotes.push(note);
    }
  }

  const bundle: DocketBundle = {
    format: 'docket-bundle',
    version: 1,
    createdAt: deps.clock.now(),
    projects,
    repos,
    library,
    memory: memoryNotes,
    checksum: '', // calculated by BundleStore adapter (I-100)
  };

  const exportResult = await deps.bundleStore.export(projectDef.id, bundle);
  if (!exportResult.ok) {
    return err('io_failed');
  }

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'project.exported',
    subject: { kind: 'project', id: projectDef.id },
    detail: { path: exportResult.value.path },
  });

  return ok({
    path: exportResult.value.path,
    counts: {
      projects: projects.length,
      repos: repos.length,
      definitions: totalDefinitionsCount,
      memoryNotes: memoryNotes.length,
    },
  });
}

/**
 * A-342: project.importBundle {path}
 * Reads through BundleStore.read (not_found · wrong_format · bad_checksum),
 * validates all-or-nothing (I-91: issues → definitions_invalid, nothing written)
 * and applies every rename, answering the report's { warnings, renames }; audit project.imported.
 */
export async function importBundle(
  deps: ImportBundleDeps,
  input: { readonly path: string; readonly actor: Actor },
): Promise<ImportBundleResult> {
  const readRes = await deps.bundleStore.read(input.path);
  if (!readRes.ok) {
    return { ok: false, error: readRes.error };
  }

  const bundle = readRes.value;
  if (bundle.format !== 'docket-bundle' || bundle.version !== 1) {
    return { ok: false, error: 'wrong_format' };
  }

  const bundleProjects = bundle.projects as BundleProjects;
  const bundleRepos = bundle.repos as BundleRepos;
  const bundleLibrary = bundle.library as BundleLibrary;
  const bundleMemory = bundle.memory as BundleMemory;

  if (!Array.isArray(bundleProjects) || !Array.isArray(bundleRepos) || !bundleLibrary) {
    return { ok: false, error: 'wrong_format' };
  }

  // All-or-nothing validation (I-91, R-8)
  const validationIssues: DefinitionIssue[] = [];

  const rolesToValidate: RoleDef[] = [];
  for (const [, history] of Object.entries(bundleLibrary.roles ?? {})) {
    if (history.length > 0) {
      rolesToValidate.push(history[history.length - 1].body as RoleDef);
    }
  }

  const flowsToValidate: FlowDef[] = [];
  for (const [, history] of Object.entries(bundleLibrary.flows ?? {})) {
    if (history.length > 0) {
      flowsToValidate.push(history[history.length - 1].body as FlowDef);
    }
  }

  const capsToValidate: CapabilityDef[] = [];
  for (const [id, history] of Object.entries(bundleLibrary.capabilities ?? {})) {
    if (history.length > 0) {
      const cap = history[history.length - 1].body as CapabilityDef;
      capsToValidate.push(cap);

      // R-8: secret literals check in capability env
      if (cap.kind === 'mcp' && cap.env) {
        for (const [key, val] of Object.entries(cap.env)) {
          if (typeof val === 'string') {
            validationIssues.push({
              path: `capabilities.${id}.env.${key}`,
              code: 'wrong_type',
              message: `Capability env value must be literal or secretRef: ${key}`,
            });
          } else if (
            typeof val === 'object' &&
            val !== null &&
            'literal' in val &&
            /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)
          ) {
            validationIssues.push({
              path: `capabilities.${id}.env.${key}`,
              code: 'secret_literal',
              message: `Capability env carrying secret literal forbidden: ${key}`,
            });
          }
        }
      }
    }
  }

  for (const repo of bundleRepos) {
    const checked = validateDefinitions({
      roles: rolesToValidate,
      flows: flowsToValidate,
      capabilities: capsToValidate,
      repo: repo as unknown as Record<string, unknown>,
    });
    if (!checked.ok) {
      validationIssues.push(...checked.error);
    }
  }

  for (const projItem of bundleProjects) {
    const checked = validateDefinitions({
      roles: rolesToValidate,
      flows: flowsToValidate,
      capabilities: capsToValidate,
      project: projItem.project as unknown as Record<string, unknown>,
    });
    if (!checked.ok) {
      validationIssues.push(...checked.error);
    }
  }

  if (validationIssues.length > 0) {
    return { ok: false, error: 'definitions_invalid', issues: validationIssues };
  }

  // Renaming and collisions (I-91)
  const renames: { id: string; to: string }[] = [];
  const warnings: string[] = [];
  const repoSlugMap = new Map<RepoSlug, RepoSlug>();

  // 1. Library renames / bumps
  const libraryWrites: {
    kind: DefinitionKind;
    id: string;
    body: unknown;
  }[] = [];

  const kinds: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities', 'memory'];
  for (const kind of kinds) {
    const recordsByDef = (bundleLibrary[kind] ?? {}) as Readonly<
      Record<string, readonly VersionRecord<unknown>[]>
    >;
    for (const [defId, history] of Object.entries(recordsByDef)) {
      const existing = await deps.definitions.listVersions(kind, defId);
      if (existing.length > 0) {
        const nextVer = existing[existing.length - 1].version + 1;
        renames.push({ id: defId, to: `v${nextVer}` });
      }
      for (const rec of history) {
        libraryWrites.push({ kind, id: defId, body: rec.body });
      }
    }
  }

  // 2. Repo renames
  const preparedRepos: RepoDef[] = [];
  const existingRepoEntries = await deps.repos.list();

  for (const rawRepo of bundleRepos) {
    let repo = rawRepo;
    // A-408: a bundle import loads repo autonomy: 'auto' as absent with a warning
    if (repo.autonomy === 'auto') {
      const { autonomy: _auto, ...rest } = repo;
      repo = rest as RepoDef;
      warnings.push(`autonomy_auto_dropped: repos/${rawRepo.id}/repo.yaml`);
    }
    let targetSlug = repo.id;
    const existingFile = await deps.definitions.readFile(`repos/${targetSlug}/repo.yaml`);
    const isRegistered = existingRepoEntries.some((e) => e.slug === targetSlug);

    if (existingFile !== undefined || isRegistered) {
      let idx = 2;
      while (
        existingRepoEntries.some((e) => e.slug === `${targetSlug}-${idx}`) ||
        (await deps.definitions.readFile(`repos/${targetSlug}-${idx}/repo.yaml`)) !== undefined
      ) {
        idx++;
      }
      const newSlug = slugOf<'repo'>(`${targetSlug}-${idx}`);
      renames.push({ id: repo.id, to: newSlug });
      repoSlugMap.set(repo.id, newSlug);
      preparedRepos.push({ ...repo, id: newSlug });
    } else {
      preparedRepos.push(repo);
    }
  }

  // 3. Project renames
  const preparedProjects: { readonly project: ProjectDef; readonly roadmap?: Roadmap }[] = [];
  for (const projItem of bundleProjects) {
    let project = projItem.project;
    // A-408: a bundle import loads project autonomy: 'auto' as absent with a warning
    if (project.autonomy === 'auto') {
      const { autonomy: _auto, ...rest } = project;
      project = rest as ProjectDef;
      warnings.push(`autonomy_auto_dropped: projects/${projItem.project.id}/project.yaml`);
    }
    let targetSlug = project.id;
    const existingProject = await deps.projects.get(targetSlug);

    if (existingProject !== undefined) {
      let idx = 2;
      while ((await deps.projects.get(slugOf<'project'>(`${targetSlug}-${idx}`))) !== undefined) {
        idx++;
      }
      const newSlug = slugOf<'project'>(`${targetSlug}-${idx}`);
      renames.push({ id: projItem.project.id, to: newSlug });
      targetSlug = newSlug;
    }

    // Remap repo slugs in project and roadmap
    const remappedRepos = project.repos.map((r: RepoSlug) => repoSlugMap.get(r) ?? r);

    const remappedProject: ProjectDef = {
      ...project,
      id: targetSlug,
      repos: remappedRepos,
    };

    let remappedRoadmap = projItem.roadmap;
    if (remappedRoadmap) {
      remappedRoadmap = {
        phases: remappedRoadmap.phases.map((ph: PhaseDef) => ({
          ...ph,
          tasks: ph.tasks.map((tsk: TaskDef) => ({
            ...tsk,
            targets: tsk.targets.map((tgt: RepoSlug) => repoSlugMap.get(tgt) ?? tgt),
          })),
        })),
      };
    }

    preparedProjects.push({
      project: remappedProject,
      ...(remappedRoadmap ? { roadmap: remappedRoadmap } : {}),
    });
  }

  // Apply writes now that all validations and renames have succeeded (all-or-nothing)
  const now = deps.clock.now();

  for (const libWrite of libraryWrites) {
    await deps.definitions.appendVersion(libWrite.kind, libWrite.id, libWrite.body, now);
  }

  for (const repo of preparedRepos) {
    // Unbound stage bindings (I-89)
    const sanitized = sanitizeRepoForExport(repo);
    await deps.definitions.writeFile(
      `repos/${repo.id}/repo.yaml`,
      JSON.stringify(sanitized),
      '',
    );
  }

  for (const projItem of preparedProjects) {
    await deps.projects.save(projItem.project);
    await deps.definitions.writeFile(
      `projects/${projItem.project.id}/project.yaml`,
      JSON.stringify(projItem.project),
      '',
    );
    if (projItem.roadmap) {
      await deps.definitions.writeFile(
        `projects/${projItem.project.id}/roadmap.yaml`,
        JSON.stringify(projItem.roadmap),
        '',
      );
    }
  }

  if (Array.isArray(bundleMemory)) {
    for (const note of bundleMemory) {
      await deps.definitions.appendVersion('memory', note.id, note, now);
      await deps.memory.recordNoteId(note.id);
    }
  }

  const primaryProjectId = preparedProjects[0]?.project.id ?? slugOf<ProjectSlug>('imported');

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: now,
    actor: input.actor,
    action: 'project.imported',
    subject: { kind: 'project', id: primaryProjectId },
    detail: { path: input.path },
  });

  return {
    ok: true,
    value: {
      warnings,
      renames,
    },
  };
}
