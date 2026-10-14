// definition-removal.ts — R-134 removal verdicts and library archive/delete (A-355). Pins and repo
// stage bindings are derived the same way account removal reads them (A-326).
import type {
  Actor,
  FlowPin,
  RemovalBlock,
  RemovalVerdict,
  RepoDef,
  RepoSlug,
  RoleSlug,
} from '../../domain/index';
import { deriveWorkOrderState, err, ok, roleRemoval, type Result } from '../../domain/index';

import type { AppDeps, DefinitionKind } from '../ports';

/** The repos a removal verdict consults: every registered project's repos with a loaded repo section. */
export const reposForVerdict = async (deps: Pick<AppDeps, 'definitions' | 'projects'>): Promise<readonly RepoDef[]> => {
  const repos: RepoDef[] = [];
  const seen = new Set<RepoSlug>();
  for (const project of await deps.projects.list()) {
    for (const slug of project.repos) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const loaded = await deps.definitions.load(slug);
      if (loaded.ok && loaded.value.repo !== undefined) repos.push(loaded.value.repo);
    }
  }
  return repos;
};

/** Every work order's pin with its derived `running` flag. */
export const pinsForVerdict = async (
  deps: Pick<AppDeps, 'definitions' | 'workOrders'>,
): Promise<readonly { workOrder: string; running: boolean; pin: FlowPin }[]> => {
  const pins: { workOrder: string; running: boolean; pin: FlowPin }[] = [];
  for (const record of await deps.workOrders.list({})) {
    if (record.pin === undefined) continue;
    const loaded = await deps.definitions.load(record.repo);
    const flow = loaded.ok ? loaded.value.flows.find((candidate) => candidate.id === record.flow) : undefined;
    const running =
      flow !== undefined && deriveWorkOrderState(flow, await deps.workOrders.events(record.id)).status === 'running';
    pins.push({ workOrder: record.id, running, pin: record.pin });
  }
  return pins;
};

export const roleRemovalVerdict = async (
  deps: Pick<AppDeps, 'definitions' | 'projects' | 'workOrders'>,
  roleId: RoleSlug,
): Promise<RemovalVerdict> => roleRemoval(roleId, await reposForVerdict(deps), await pinsForVerdict(deps));

export type DefinitionLifecycleError =
  | 'not_found'
  | 'blocked'
  | 'wrong_action'
  | { readonly code: 'blocked'; readonly reasons: readonly RemovalBlock[] };

const blocked = (reasons: readonly RemovalBlock[]): DefinitionLifecycleError => ({ code: 'blocked', reasons });

export async function archiveDefinition(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'definitions' | 'projects' | 'workOrders'>,
  input: { readonly kind: DefinitionKind; readonly id: string; readonly actor: Actor },
): Promise<Result<void, DefinitionLifecycleError>> {
  if (input.kind !== 'roles') return err('not_found');
  const roleId = input.id as RoleSlug;
  const verdict = await roleRemovalVerdict(deps, roleId);
  if (verdict.kind === 'blocked') return err(blocked(verdict.reasons));
  if (verdict.kind === 'delete') return err('wrong_action');
  const archived = await deps.definitions.archiveLibrary(input.kind, input.id);
  if (!archived.ok) return err('not_found');
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'library.definition_archived',
    subject: { kind: 'definition', id: input.id },
    detail: { kind: input.kind, id: input.id },
  });
  return ok(undefined);
}

export const roleVersionFields = async (
  deps: Pick<AppDeps, 'definitions'>,
  roleId: string,
): Promise<{
  readonly version: number;
  readonly pastVersions: readonly { readonly version: number; readonly recordedAt: number; readonly archived: boolean }[];
}> => {
  const history = await deps.definitions.listVersions('roles', roleId);
  if (history.length === 0) return { version: 1, pastVersions: [] };
  const latest = history[history.length - 1];
  const version = latest?.version ?? 1;
  const pastVersions = history
    .filter((record) => record.version < version)
    .map((record) => ({ version: record.version, recordedAt: record.recordedAt, archived: record.archived }))
    .sort((a, b) => b.version - a.version);
  return { version, pastVersions };
};

export async function deleteDefinition(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'definitions' | 'projects' | 'workOrders'>,
  input: { readonly kind: DefinitionKind; readonly id: string; readonly actor: Actor },
): Promise<Result<void, DefinitionLifecycleError>> {
  if (input.kind !== 'roles') return err('not_found');
  const roleId = input.id as RoleSlug;
  const verdict = await roleRemovalVerdict(deps, roleId);
  if (verdict.kind === 'blocked') return err(blocked(verdict.reasons));
  if (verdict.kind === 'archive') return err('wrong_action');
  const removed = await deps.definitions.removeLibrary(input.kind, input.id);
  if (!removed.ok) return err('not_found');
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'library.definition_deleted',
    subject: { kind: 'definition', id: input.id },
    detail: { kind: input.kind, id: input.id },
  });
  return ok(undefined);
}
