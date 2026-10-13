// definitions/repo-flow.ts — the Phase 7 addendum of docs/v2/domain.md §2 (D-1, D-4, D-6):
// repo-owned flows with versioned library roles, the work-order pin, removal verdicts and the
// per-stage limit policy. Pure and clock-free: `recordedAt`/`at` values are passed in.
import type { AccountId, EpochMs, FlowSlug, RepoSlug, Result, RoleSlug, StageSlug } from '../shared/index';
import type { AccountRoute, LimitPolicy } from '../quota/index';
import type { DefinitionIssue, RepoDef, RoleDef, StageDef } from './types';

/** Which version of a library role a stage uses. `latest` is never stored: a binding always
 *  names a concrete version. */
export interface RoleRef {
  readonly roleId: RoleSlug;
  readonly version: number; // >= 1, a version that exists in the library
  readonly overlay?: RoleOverlay; // per-repo changes on top of that version
  readonly detached?: RoleDef; // set → the repo owns this copy; roleId/version are provenance only
}

export type RoleOverlay = Partial<Omit<RoleDef, 'id' | 'active'>>;

export interface StageBinding {
  readonly stage: StageSlug;
  readonly role?: RoleRef; // absent exactly when the flow's stage has role === null
  readonly accounts: readonly AccountRoute[]; // ordered chain, first preferred (what RoleBinding.accounts was)
  readonly limitPolicy?: LimitPolicy; // absent → the repo's defaultLimitPolicy
}

export interface RepoFlow {
  readonly flowId: FlowSlug;
  readonly version: number; // version of the library flow this was copied from (provenance)
  readonly stages: readonly StageDef[]; // the repo's own copy: edits here never touch the library
  readonly bindings: readonly StageBinding[]; // exactly one per stage, same order
}

/** One immutable version of a library definition. The body never changes once recorded. */
export interface VersionRecord<T> {
  readonly definitionId: string;
  readonly version: number; // contiguous from 1
  readonly body: T; // immutable once recorded
  readonly recordedAt: EpochMs; // passed in; the domain reads no clock
  readonly archived: boolean;
}

/** The fields an overlay may change, in the fixed order proposals report them. */
const OVERLAY_FIELDS = ['name', 'instructions', 'writeScope', 'capabilities', 'docketTools'] as const;

/** Structural equality over definition-field values (primitives, arrays, plain objects). */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = a as Readonly<Record<string, unknown>>;
    const right = b as Readonly<Record<string, unknown>>;
    const leftKeys = Object.keys(left);
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) => key in right && sameValue(left[key], right[key]))
    );
  }
  return false;
};

/** The overlay's field rule: set fields win, `id` and `active` never do (R-130). Always a fresh
 *  object when an overlay is present. */
const applyOverlay = (base: RoleDef, overlay: RoleOverlay | undefined): RoleDef =>
  overlay === undefined
    ? base
    : {
        id: base.id,
        name: overlay.name ?? base.name,
        instructions: overlay.instructions ?? base.instructions,
        writeScope: overlay.writeScope ?? base.writeScope,
        capabilities: overlay.capabilities ?? base.capabilities,
        active: base.active,
        ...(overlay.docketTools === undefined && base.docketTools === undefined
          ? {}
          : { docketTools: overlay.docketTools ?? base.docketTools }),
      };

/** R-129: versions are contiguous from 1, so the next one is the highest recorded + 1. */
export function nextVersion<T>(history: readonly VersionRecord<T>[]): number {
  return history.reduce((highest, record) => Math.max(highest, record.version), 0) + 1;
}

/** R-130: detached → the detached body; otherwise the library body of `roleId`@`version` with
 *  the overlay applied field-wise; an unknown version is `unknown_role_version`. */
export function effectiveRole(
  ref: RoleRef,
  library: readonly VersionRecord<RoleDef>[],
): Result<RoleDef, 'unknown_role_version'> {
  if (ref.detached !== undefined) return { ok: true, value: ref.detached };
  const record = library.find(
    (candidate) => candidate.definitionId === ref.roleId && candidate.version === ref.version,
  );
  if (record === undefined) return { ok: false, error: 'unknown_role_version' };
  return { ok: true, value: applyOverlay(record.body, ref.overlay) };
}

/** R-130's view of a flow's roles: each binding's effective role, first binding per role id.
 *  A binding whose version the library does not carry is skipped here — validation refuses it
 *  before this runs, and the caller never sees a half-resolved list. */
export function effectiveRoles(
  flow: RepoFlow,
  library: readonly VersionRecord<RoleDef>[],
): readonly RoleDef[] {
  const byId = new Map<RoleSlug, RoleDef>();
  for (const binding of flow.bindings) {
    const ref = binding.role;
    if (ref === undefined || byId.has(ref.roleId)) continue;
    const resolved = effectiveRole(ref, library);
    if (resolved.ok) byId.set(ref.roleId, resolved.value);
  }
  return [...byId.values()];
}

export interface RoleUpdateProposal {
  readonly stage: StageSlug;
  readonly from: number;
  readonly to: number;
  readonly overlayFieldsChangedUpstream: readonly (keyof RoleOverlay)[];
}

/** R-131: one proposal per non-detached binding below the library's latest version of its role,
 *  naming the overlay fields whose upstream value differs between the two versions. Applies
 *  nothing, never lists a detached stage, and is empty when everything is current. */
export function roleUpdateProposals(
  flow: RepoFlow,
  library: readonly VersionRecord<RoleDef>[],
): readonly RoleUpdateProposal[] {
  const proposals: RoleUpdateProposal[] = [];
  for (const bindingStage of flow.bindings) {
    const ref = bindingStage.role;
    if (ref === undefined || ref.detached !== undefined) continue;
    const history = library.filter((record) => record.definitionId === ref.roleId);
    if (history.length === 0) continue;
    const latest = nextVersion(history) - 1;
    if (ref.version >= latest) continue;
    const from = history.find((record) => record.version === ref.version)?.body;
    const to = history.find((record) => record.version === latest)?.body;
    if (from === undefined || to === undefined) continue;
    proposals.push({
      stage: bindingStage.stage,
      from: ref.version,
      to: latest,
      overlayFieldsChangedUpstream: OVERLAY_FIELDS.filter((field) => !sameValue(from[field], to[field])),
    });
  }
  return proposals;
}

/** What a work order records at creation: the flow and every stage's effective role, accounts
 *  and limit policy, copied so later library or repo edits never reach it. */
export interface FlowPin {
  readonly flowId: FlowSlug;
  readonly flowVersion: number;
  readonly stages: readonly {
    readonly stage: StageDef;
    readonly role: RoleDef | null;
    readonly roleVersion: number | null;
    readonly accounts: readonly AccountRoute[];
    readonly limitPolicy: LimitPolicy;
  }[];
}

/** R-135: the stage binding's `limitPolicy`, else the repo's `defaultLimitPolicy`. */
export function limitPolicyFor(flow: RepoFlow, stage: StageSlug, defaultLimitPolicy: LimitPolicy): LimitPolicy {
  const binding = flow.bindings.find((candidate) => candidate.stage === stage);
  return binding === undefined || binding.limitPolicy === undefined ? defaultLimitPolicy : binding.limitPolicy;
}

/** R-132: copies every stage with its effective role body and role version, accounts and
 *  effective limit policy. Refuses (never pins half a flow) when a binding breaks the flow
 *  contract or names a library version that is not there. */
export function pinFlow(
  flow: RepoFlow,
  library: readonly VersionRecord<RoleDef>[],
  defaultLimitPolicy: LimitPolicy,
): Result<FlowPin, DefinitionIssue> {
  const bindingByStage = new Map<StageSlug, StageBinding>();
  for (const bindingStage of flow.bindings) {
    if (bindingByStage.has(bindingStage.stage)) {
      return {
        ok: false,
        error: {
          path: `bindings.${bindingStage.stage}`,
          code: 'duplicate_binding',
          message: `stage "${bindingStage.stage}" has more than one binding`,
        },
      };
    }
    bindingByStage.set(bindingStage.stage, bindingStage);
  }

  // A binding for a stage the flow does not define is a count mismatch, whatever else it names.
  if (bindingByStage.size !== flow.stages.length) {
    return {
      ok: false,
      error: {
        path: 'bindings',
        code: 'binding_stage_mismatch',
        message: 'the flow carries a binding for a stage it does not define',
      },
    };
  }

  const stages: FlowPin['stages'][number][] = [];
  for (const stage of flow.stages) {
    const binding = bindingByStage.get(stage.id);
    if (binding === undefined) {
      return {
        ok: false,
        error: {
          path: `bindings.${stage.id}`,
          code: 'binding_stage_mismatch',
          message: `stage "${stage.id}" has no binding`,
        },
      };
    }
    let role: RoleDef | null = null;
    let roleVersion: number | null = null;
    if (stage.role === null) {
      if (binding.role !== undefined) {
        return {
          ok: false,
          error: {
            path: `bindings.${stage.id}.role`,
            code: 'role_forbidden',
            message: `stage "${stage.id}" has no role, so its binding cannot carry one`,
          },
        };
      }
    } else if (binding.role === undefined) {
      return {
        ok: false,
        error: {
          path: `bindings.${stage.id}.role`,
          code: 'role_required',
          message: `stage "${stage.id}" has a role, so its binding must carry one`,
        },
      };
    } else {
      const resolved = effectiveRole(binding.role, library);
      if (!resolved.ok) {
        return {
          ok: false,
          error: {
            path: `bindings[${stage.id}].role`,
            code: resolved.error,
            message: `stage "${stage.id}" binds ${binding.role.roleId}@${binding.role.version}, which the library does not carry`,
          },
        };
      }
      role = { ...resolved.value };
      roleVersion = binding.role.version;
    }
    stages.push({
      stage: { ...stage },
      role,
      roleVersion,
      accounts: [...binding.accounts],
      limitPolicy: limitPolicyFor(flow, stage.id, defaultLimitPolicy),
    });
  }
  return { ok: true, value: { flowId: flow.flowId, flowVersion: flow.version, stages } };
}

export type RemovalVerdict =
  | { readonly kind: 'delete' }
  | { readonly kind: 'archive' }
  | { readonly kind: 'blocked'; readonly reasons: readonly RemovalBlock[] };

export type RemovalBlock =
  | { readonly kind: 'running_work'; readonly workOrders: readonly string[] }
  | { readonly kind: 'dependant'; readonly of: 'stage' | 'binding'; readonly repo: RepoSlug; readonly stage?: StageSlug };

/** One work order's pin with its derived running flag — the input shape the verdicts take. */
export interface PinReference {
  readonly workOrder: string;
  readonly running: boolean;
  readonly pin: FlowPin;
}

/** R-134: `blocked` when any running pin references the role or any repo stage still binds it,
 *  `archive` when only finished work orders' pins reference it, `delete` when nothing does. */
export function roleRemoval(roleId: RoleSlug, repos: readonly RepoDef[], pins: readonly PinReference[]): RemovalVerdict {
  const references = (pin: FlowPin): boolean => pin.stages.some((stage) => stage.role?.id === roleId);
  return verdictOf(
    pins.filter((entry) => entry.running && references(entry.pin)).map((entry) => entry.workOrder),
    dependantsOfRole(roleId, repos).map((dependant) => ({
      kind: 'dependant' as const,
      of: 'stage' as const,
      repo: dependant.repo,
      stage: dependant.stage,
    })),
    pins.some((entry) => references(entry.pin)),
  );
}

/** R-134: the account twin of `roleRemoval` — a dependant is a stage binding whose account
 *  chain still routes to the account. */
export function accountRemoval(
  accountId: AccountId,
  repos: readonly RepoDef[],
  pins: readonly PinReference[],
): RemovalVerdict {
  const references = (pin: FlowPin): boolean =>
    pin.stages.some((stage) => stage.accounts.some((route) => route.accountId === accountId));
  return verdictOf(
    pins.filter((entry) => entry.running && references(entry.pin)).map((entry) => entry.workOrder),
    dependantsOfAccount(accountId, repos).map((dependant) => ({
      kind: 'dependant' as const,
      of: 'binding' as const,
      repo: dependant.repo,
      stage: dependant.stage,
    })),
    pins.some((entry) => references(entry.pin)),
  );
}

const verdictOf = (
  runningWorkOrders: readonly string[],
  dependants: readonly RemovalBlock[],
  referencedAtAll: boolean,
): RemovalVerdict => {
  const reasons: RemovalBlock[] = [];
  if (runningWorkOrders.length > 0) reasons.push({ kind: 'running_work', workOrders: [...runningWorkOrders] });
  reasons.push(...dependants);
  if (reasons.length > 0) return { kind: 'blocked', reasons };
  return referencedAtAll ? { kind: 'archive' } : { kind: 'delete' };
};

/** The repo stages whose versioned (non-detached) bindings name the role. */
export function dependantsOfRole(roleId: RoleSlug, repos: readonly RepoDef[]): readonly { repo: RepoSlug; stage: StageSlug }[] {
  const dependants: { repo: RepoSlug; stage: StageSlug }[] = [];
  for (const repo of repos) {
    for (const binding of repo.flow.bindings) {
      const ref = binding.role;
      if (ref === undefined || ref.detached !== undefined || ref.roleId !== roleId) continue;
      dependants.push({ repo: repo.id, stage: binding.stage });
    }
  }
  return dependants;
}

/** The repo stages whose bindings' account chains still route to the account. */
export function dependantsOfAccount(
  accountId: AccountId,
  repos: readonly RepoDef[],
): readonly { repo: RepoSlug; stage: StageSlug }[] {
  const dependants: { repo: RepoSlug; stage: StageSlug }[] = [];
  for (const repo of repos) {
    for (const binding of repo.flow.bindings) {
      if (!binding.accounts.some((route) => route.accountId === accountId)) continue;
      dependants.push({ repo: repo.id, stage: binding.stage });
    }
  }
  return dependants;
}
