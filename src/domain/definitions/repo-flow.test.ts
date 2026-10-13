// repo-flow.test.ts — rules R-129, R-131, R-132, R-134 from docs/v2/domain.md §2 addendum
// (versioned definitions, work-order pinning, archive and dependency queries), plus #1012's
// R-11/R-130 overlay and effective-role arms. R-126..R-128 live in validate.test.ts; R-135 is #1013.
import { describe, expect, it } from 'vitest';

import type { AccountId, FlowSlug, RepoSlug, RoleSlug, Slug, StageSlug, Ulid } from '../shared';
import { parseSlug, parseUlid } from '../shared';
import type { LimitPolicy } from '../quota';
import type { RepoDef, RoleDef, StageDef } from './types';
import {
  accountRemoval,
  dependantsOfAccount,
  dependantsOfRole,
  effectiveRole,
  effectiveRoles,
  limitPolicyFor,
  nextVersion,
  pinFlow,
  roleRemoval,
  roleUpdateProposals,
  type FlowPin,
  type RepoFlow,
  type RoleRef,
  type StageBinding,
  type VersionRecord,
} from './repo-flow';

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const ROLE: RoleSlug = slugOf<'role'>('dev');
const REVIEWER: RoleSlug = slugOf<'role'>('reviewer');
const FLOW: FlowSlug = slugOf<'flow'>('main');
const OTHER_FLOW: FlowSlug = slugOf<'flow'>('other');
const REPO: RepoSlug = slugOf<'repo'>('acme');
const OTHER_REPO: RepoSlug = slugOf<'repo'>('beta');
const WORK: StageSlug = slugOf<'stage'>('work');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const MANUAL: StageSlug = slugOf<'stage'>('manual');
const ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const OTHER_ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');

const route = (accountId: AccountId = ACCOUNT): { readonly accountId: AccountId } => ({ accountId });

const roleDef = (id: RoleSlug, over: Partial<RoleDef> = {}): RoleDef => ({
  id,
  name: id === ROLE ? 'Developer' : 'Reviewer',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
  ...over,
});

const stageDef = (id: StageSlug, role: RoleSlug | null): StageDef => ({
  id,
  name: id,
  role,
  exit: [],
});

const roleRef = (roleId: RoleSlug, version: number, over: Partial<RoleRef> = {}): RoleRef => ({
  roleId,
  version,
  ...over,
});

const binding = (
  stage: StageSlug,
  role: RoleRef | undefined,
  accounts: readonly { readonly accountId: AccountId }[] = [route()],
  limitPolicy?: LimitPolicy,
): StageBinding => ({
  stage,
  ...(role === undefined ? {} : { role }),
  accounts,
  ...(limitPolicy === undefined ? {} : { limitPolicy }),
});

const repoFlow = (
  stages: readonly StageDef[],
  bindings: readonly StageBinding[],
  version = 1,
  flowId: FlowSlug = FLOW,
): RepoFlow => ({ flowId, version, stages, bindings });

const versionOf = <T>(
  definitionId: string,
  version: number,
  body: T,
  over: Partial<VersionRecord<T>> = {},
): VersionRecord<T> => ({ definitionId, version, body, recordedAt: 1_000, archived: false, ...over });

/** The dev role's history: v1 the base body, v2 same shape with new instructions, v3 also renamed. */
const devLibrary = (): readonly VersionRecord<RoleDef>[] => [
  versionOf(ROLE, 1, roleDef(ROLE)),
  versionOf(ROLE, 2, roleDef(ROLE, { instructions: 'Do the work, carefully.' })),
  versionOf(ROLE, 3, roleDef(ROLE, { name: 'Engineer', instructions: 'Do the work, carefully.' })),
];

const reviewerLibrary = (): readonly VersionRecord<RoleDef>[] => [
  versionOf(REVIEWER, 1, roleDef(REVIEWER)),
  versionOf(REVIEWER, 2, roleDef(REVIEWER)),
];

const repoDef = (id: RepoSlug, flow: RepoFlow): RepoDef => ({
  id,
  name: id,
  flow,
  defaultLimitPolicy: 'wait_resume',
  commandSets: {},
  docsRoot: 'docs',
  testGlobs: [],
});

const pinEntry = (
  stage: StageSlug,
  role: RoleDef | null,
  roleVersion: number | null,
  accounts: readonly { readonly accountId: AccountId }[] = [route()],
): FlowPin['stages'][number] => ({
  stage: stageDef(stage, role === null ? null : role.id),
  role,
  roleVersion,
  accounts,
  limitPolicy: 'wait_resume',
});

const pinOf = (stages: readonly FlowPin['stages'][number][], flowVersion = 1): FlowPin => ({
  flowId: FLOW,
  flowVersion,
  stages,
});

describe('nextVersion', () => {
  it('R-129: nextVersion([]) is 1 and last+1 otherwise', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([versionOf(ROLE, 1, roleDef(ROLE))])).toBe(2);
    expect(nextVersion(devLibrary())).toBe(4);
    // The rule speaks of contiguity, so an out-of-order history still yields max+1: every gap
    // would otherwise mint a version that already exists.
    expect(nextVersion([versionOf(ROLE, 3, roleDef(ROLE)), versionOf(ROLE, 1, roleDef(ROLE))])).toBe(4);
  });

  it('R-129: an edit never changes a recorded body', () => {
    const library = devLibrary();
    const snapshot = library.map((record) => ({ ...record }));
    const flow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, REVIEWER)],
      [binding(WORK, roleRef(ROLE, 1)), binding(REVIEW, roleRef(REVIEWER, 1, { overlay: { instructions: 'Review it.' } }))],
    );

    // Everything this module can do with the history — proposals, pins, resolution — and the
    // edit's own next record: none of them touches a recorded body.
    roleUpdateProposals(flow, [...library, ...reviewerLibrary()]);
    const pinned = pinFlow(flow, [...library, ...reviewerLibrary()], 'wait_resume');
    expect(pinned.ok).toBe(true);
    effectiveRole(roleRef(ROLE, 2), library);
    const next = versionOf(ROLE, nextVersion(library), roleDef(ROLE, { name: 'Next' }));

    expect(library).toEqual(snapshot);
    expect(next.version).toBe(4);
    expect(library[0].body).toEqual(roleDef(ROLE));
    expect(library[1].body.instructions).toBe('Do the work, carefully.');
  });
});

describe('roleUpdateProposals', () => {
  const flow = repoFlow(
    [stageDef(WORK, ROLE), stageDef(REVIEW, ROLE), stageDef(MANUAL, null)],
    [
      binding(WORK, roleRef(ROLE, 1)),
      binding(REVIEW, roleRef(ROLE, 2)),
      binding(MANUAL, undefined),
    ],
  );

  it('R-131: lists one proposal per outdated binding, naming the overlay fields whose upstream value differs', () => {
    const proposals = roleUpdateProposals(flow, devLibrary());

    expect(proposals).toEqual([
      {
        stage: WORK,
        from: 1,
        to: 3,
        // v1 → v3 changed name and instructions; writeScope, capabilities and docketTools did not.
        overlayFieldsChangedUpstream: ['name', 'instructions'],
      },
      {
        stage: REVIEW,
        from: 2,
        to: 3,
        // v2 → v3 changed only the name.
        overlayFieldsChangedUpstream: ['name'],
      },
    ]);
    // It never applies anything: the flow and its bindings are untouched.
    expect(flow.bindings[0].role).toEqual(roleRef(ROLE, 1));
    expect(flow.bindings[1].role).toEqual(roleRef(ROLE, 2));
  });

  it('R-131: a change that only touches non-overlay fields or array contents is reported per field', () => {
    const library: readonly VersionRecord<RoleDef>[] = [
      versionOf(REVIEWER, 1, roleDef(REVIEWER)),
      versionOf(REVIEWER, 2, roleDef(REVIEWER, { capabilities: [] })),
      versionOf(REVIEWER, 3, roleDef(REVIEWER, { writeScope: { kind: 'docs' }, docketTools: false })),
    ];
    const proposals = roleUpdateProposals(
      repoFlow([stageDef(REVIEW, REVIEWER)], [binding(REVIEW, roleRef(REVIEWER, 1))]),
      library,
    );
    expect(proposals).toEqual([
      {
        stage: REVIEW,
        from: 1,
        to: 3,
        // v1 → v3: writeScope moved and docketTools flipped (absent → false reads changed);
        // capabilities stayed an empty list, so it is not named.
        overlayFieldsChangedUpstream: ['writeScope', 'docketTools'],
      },
    ]);
  });

  it('R-131: never lists a detached stage and is empty when everything is current', () => {
    const detachedFlow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, REVIEWER)],
      [
        binding(WORK, roleRef(ROLE, 1, { detached: roleDef(ROLE) })),
        binding(REVIEW, roleRef(REVIEWER, 2)),
      ],
    );
    expect(roleUpdateProposals(detachedFlow, [...devLibrary(), ...reviewerLibrary()])).toEqual([
      // The detached work stage is skipped; the reviewer binding sits on its latest version.
    ]);

    const currentFlow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, REVIEWER)],
      [binding(WORK, roleRef(ROLE, 3)), binding(REVIEW, roleRef(REVIEWER, 2))],
    );
    expect(roleUpdateProposals(currentFlow, [...devLibrary(), ...reviewerLibrary()])).toEqual([]);
  });
});

describe('pinFlow', () => {
  it('R-132: copies every stage with its effective role body and version, accounts and limitPolicyFor', () => {
    const flow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, ROLE), stageDef(MANUAL, null)],
      [
        binding(WORK, roleRef(ROLE, 2), [route(), route(OTHER_ACCOUNT)]),
        binding(REVIEW, roleRef(ROLE, 3, { overlay: { instructions: 'Review it.' } }), [route(OTHER_ACCOUNT)], 'ask'),
        binding(MANUAL, undefined),
      ],
    );

    const pinned = pinFlow(flow, devLibrary(), 'wait_resume');
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;

    expect(pinned.value.flowId).toBe(FLOW);
    expect(pinned.value.flowVersion).toBe(1);
    expect(pinned.value.stages).toHaveLength(3);

    const [work, review, manual] = pinned.value.stages;
    // The effective body: v2's instructions, no overlay.
    expect(work.role).toEqual(roleDef(ROLE, { instructions: 'Do the work, carefully.' }));
    expect(work.roleVersion).toBe(2);
    expect(work.accounts).toEqual([route(), route(OTHER_ACCOUNT)]);
    // limitPolicyFor: no binding policy → the default.
    expect(work.limitPolicy).toBe('wait_resume');

    // The effective body of an overlaid ref: v3's name, the overlay's instructions.
    expect(review.role).toEqual(
      roleDef(ROLE, { name: 'Engineer', instructions: 'Review it.' }),
    );
    expect(review.roleVersion).toBe(3);
    // limitPolicyFor: the binding's own policy wins over the default.
    expect(review.limitPolicy).toBe('ask');
    expect(review.accounts).toEqual([route(OTHER_ACCOUNT)]);

    // A human-only stage pins no role and no version, but keeps accounts and a policy.
    expect(manual.role).toBeNull();
    expect(manual.roleVersion).toBeNull();
    expect(manual.accounts).toEqual([route()]);
    expect(manual.limitPolicy).toBe('wait_resume');

    // The stage definitions ride along, and the pin's role bodies are copies, not aliases of
    // the library's records.
    expect(work.stage).toEqual(stageDef(WORK, ROLE));
    expect(work.role).not.toBe(devLibrary()[1].body);
  });

  it('R-132: the pin is self-contained — later library edits, archives or repo changes never change it', () => {
    const flow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(MANUAL, null)],
      [binding(WORK, roleRef(ROLE, 2)), binding(MANUAL, undefined)],
    );
    const pinned = pinFlow(flow, devLibrary(), 'wait_resume');
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    const snapshot = JSON.parse(JSON.stringify(pinned.value)) as FlowPin;

    // Later library edits: a v4 lands and every earlier version is archived.
    const laterLibrary: readonly VersionRecord<RoleDef>[] = [
      ...devLibrary().map((record) => ({ ...record, archived: true })),
      versionOf(ROLE, 4, roleDef(ROLE, { name: 'Post-pin' }), { archived: true }),
    ];
    // Later repo changes: the flow is replaced by another one entirely.
    const laterFlow = repoFlow(
      [stageDef(REVIEW, ROLE)],
      [binding(REVIEW, roleRef(ROLE, 4))],
      9,
      OTHER_FLOW,
    );

    expect(pinned.value).toEqual(snapshot);
    expect(flow.flowId).toBe(FLOW);
    expect(laterFlow.version).toBe(9);
    // The pin resolves against the archived library without changing (R-134's resolvability).
    const repinned = pinFlow(flow, laterLibrary, 'wait_resume');
    expect(repinned.ok).toBe(true);
    expect(repinned.ok && repinned.value).toEqual(snapshot);
  });

  it('R-132: a binding whose role version the library does not carry fails with unknown_role_version', () => {
    const flow = repoFlow([stageDef(WORK, ROLE)], [binding(WORK, roleRef(ROLE, 99))]);
    const pinned = pinFlow(flow, devLibrary(), 'wait_resume');
    expect(pinned).toEqual({
      ok: false,
      error: { path: 'bindings[work].role', code: 'unknown_role_version', message: expect.any(String) },
    });
  });

  it('R-132: refuses bindings the flow contract would reject (mismatch, duplicate, role presence)', () => {
    // One binding short of the stage list.
    const short = repoFlow(
      [stageDef(WORK, ROLE), stageDef(MANUAL, null)],
      [binding(WORK, roleRef(ROLE, 1))],
    );
    expect(pinFlow(short, devLibrary(), 'wait_resume')).toMatchObject({
      ok: false,
      error: { code: 'binding_stage_mismatch' },
    });

    // Two bindings for one stage.
    const duplicated = repoFlow(
      [stageDef(WORK, ROLE)],
      [binding(WORK, roleRef(ROLE, 1)), binding(WORK, roleRef(ROLE, 2))],
    );
    expect(pinFlow(duplicated, devLibrary(), 'wait_resume')).toMatchObject({
      ok: false,
      error: { code: 'duplicate_binding' },
    });

    // A role stage without a role on its binding, and a human stage with one.
    const roleless = repoFlow([stageDef(WORK, ROLE)], [binding(WORK, undefined)]);
    expect(pinFlow(roleless, devLibrary(), 'wait_resume')).toMatchObject({
      ok: false,
      error: { code: 'role_required' },
    });
    const roled = repoFlow([stageDef(MANUAL, null)], [binding(MANUAL, roleRef(ROLE, 1))]);
    expect(pinFlow(roled, devLibrary(), 'wait_resume')).toMatchObject({
      ok: false,
      error: { code: 'role_forbidden' },
    });
  });
});

describe('effectiveRole', () => {
  it('resolves a detached ref to its own body without touching the library', () => {
    const detached = roleDef(ROLE, { name: 'Repo-owned' });
    const resolved = effectiveRole(roleRef(ROLE, 1, { detached }), devLibrary());
    expect(resolved).toEqual({ ok: true, value: detached });
  });

  it('reports unknown_role_version for a version the library does not carry', () => {
    expect(effectiveRole(roleRef(ROLE, 99), devLibrary())).toEqual({ ok: false, error: 'unknown_role_version' });
    expect(effectiveRole(roleRef(REVIEWER, 1), devLibrary())).toEqual({
      ok: false,
      error: 'unknown_role_version',
    });
  });

  it('R-11: the overlay never changes id or active — set fields win, identity never does', () => {
    const library: readonly VersionRecord<RoleDef>[] = [
      versionOf(ROLE, 1, roleDef(ROLE, { active: false, name: 'Base', instructions: 'Base' })),
    ];
    const resolved = effectiveRole(
      roleRef(ROLE, 1, {
        overlay: { name: 'Yerel', instructions: 'Local', writeScope: { kind: 'docs' }, capabilities: [] },
      }),
      library,
    );
    expect(resolved).toEqual({
      ok: true,
      value: {
        id: ROLE,
        name: 'Yerel',
        instructions: 'Local',
        writeScope: { kind: 'docs' },
        capabilities: [],
        active: false, // never overlaid
      },
    });
  });

  it('R-130: effectiveRoles answers each binding’s role, first binding per role id', () => {
    const flow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, REVIEWER), stageDef(MANUAL, null)],
      [
        binding(WORK, roleRef(ROLE, 1, { overlay: { name: 'Yerel' } }), undefined),
        binding(REVIEW, roleRef(REVIEWER, 2), undefined),
        binding(MANUAL, undefined, undefined),
      ],
    );
    const roles = effectiveRoles(flow, [...devLibrary(), ...reviewerLibrary()]);
    expect(roles).toEqual([
      roleDef(ROLE, { name: 'Yerel' }), // the first binding of ROLE wins
      roleDef(REVIEWER),
    ]);
  });

  it('answers limitPolicyFor from the binding, falling back to the default', () => {
    const flow = repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, ROLE)],
      [binding(WORK, roleRef(ROLE, 1), undefined), binding(REVIEW, roleRef(ROLE, 1), undefined, 'fallback_account')],
    );
    expect(limitPolicyFor(flow, WORK, 'wait_resume')).toBe('wait_resume');
    expect(limitPolicyFor(flow, REVIEW, 'wait_resume')).toBe('fallback_account');
    // A stage without a binding reads the default — the same answer an unknown stage gets.
    expect(limitPolicyFor(flow, MANUAL, 'ask')).toBe('ask');
  });
});

describe('roleRemoval', () => {
  const runningPin = pinOf([pinEntry(WORK, roleDef(ROLE), 2)]);
  const finishedPin = pinOf([pinEntry(REVIEW, roleDef(ROLE), 3)]);
  const boundRepo = repoDef(
    REPO,
    repoFlow([stageDef(WORK, ROLE)], [binding(WORK, roleRef(ROLE, 1))]),
  );
  const detachedRepo = repoDef(
    OTHER_REPO,
    repoFlow([stageDef(REVIEW, ROLE)], [binding(REVIEW, roleRef(ROLE, 1, { detached: roleDef(ROLE) }))]),
  );

  it('R-134: blocked when a running pin references the role or a repo stage still binds it', () => {
    const verdict = roleRemoval(ROLE, [], [
      { workOrder: 'wo-running', running: true, pin: runningPin },
      { workOrder: 'wo-finished', running: false, pin: finishedPin },
    ]);
    expect(verdict).toEqual({
      kind: 'blocked',
      reasons: [{ kind: 'running_work', workOrders: ['wo-running'] }],
    });

    const dependant = roleRemoval(ROLE, [boundRepo, detachedRepo], []);
    expect(dependant).toEqual({
      kind: 'blocked',
      // The detached copy owns its role body; only the versioned binding is a dependant.
      reasons: [{ kind: 'dependant', of: 'stage', repo: REPO, stage: WORK }],
    });
  });

  it('R-134: archives when only finished work orders reference the role, deletes when nothing does', () => {
    expect(roleRemoval(ROLE, [], [{ workOrder: 'wo-finished', running: false, pin: finishedPin }])).toEqual({
      kind: 'archive',
    });
    expect(roleRemoval(ROLE, [detachedRepo], [])).toEqual({ kind: 'delete' });
    expect(roleRemoval(ROLE, [], [])).toEqual({ kind: 'delete' });
  });
});

describe('accountRemoval', () => {
  const runningPin = pinOf([pinEntry(WORK, roleDef(ROLE), 2)]);
  const finishedPin = pinOf([pinEntry(WORK, roleDef(ROLE), 2)]);
  const boundRepo = repoDef(
    REPO,
    repoFlow([stageDef(WORK, ROLE)], [binding(WORK, roleRef(ROLE, 1), [route(), route(OTHER_ACCOUNT)])]),
  );

  it('R-134: blocked when a running pin or a stage binding references the account', () => {
    const verdict = accountRemoval(ACCOUNT, [], [
      { workOrder: 'wo-running', running: true, pin: runningPin },
    ]);
    expect(verdict).toEqual({
      kind: 'blocked',
      reasons: [{ kind: 'running_work', workOrders: ['wo-running'] }],
    });

    const dependant = accountRemoval(ACCOUNT, [boundRepo], []);
    expect(dependant).toEqual({
      kind: 'blocked',
      reasons: [{ kind: 'dependant', of: 'binding', repo: REPO, stage: WORK }],
    });
  });

  it('R-134: archives when only finished pins reference the account, deletes when nothing does', () => {
    // The finished pin routes to ACCOUNT, so only finished work references it.
    expect(accountRemoval(ACCOUNT, [], [{ workOrder: 'wo-finished', running: false, pin: finishedPin }])).toEqual({
      kind: 'archive',
    });
    // OTHER_ACCOUNT is referenced by nothing here (the repo's chain is not passed in).
    expect(accountRemoval(OTHER_ACCOUNT, [], [{ workOrder: 'wo-finished', running: false, pin: finishedPin }])).toEqual({
      kind: 'delete',
    });
    expect(accountRemoval(ACCOUNT, [], [])).toEqual({ kind: 'delete' });
  });
});

describe('dependants', () => {
  const repo = repoDef(
    REPO,
    repoFlow(
      [stageDef(WORK, ROLE), stageDef(REVIEW, ROLE), stageDef(MANUAL, null)],
      [
        binding(WORK, roleRef(ROLE, 1), []),
        binding(REVIEW, roleRef(ROLE, 2, { detached: roleDef(REVIEWER) }), [route()]),
        binding(MANUAL, undefined, [route(OTHER_ACCOUNT)]),
      ],
    ),
  );

  it('R-134: dependantsOfRole lists versioned bindings only; dependantsOfAccount lists account chains', () => {
    expect(dependantsOfRole(ROLE, [repo])).toEqual([{ repo: REPO, stage: WORK }]);
    expect(dependantsOfRole(REVIEWER, [repo])).toEqual([]);
    expect(dependantsOfAccount(ACCOUNT, [repo])).toEqual([{ repo: REPO, stage: REVIEW }]);
    expect(dependantsOfAccount(OTHER_ACCOUNT, [repo])).toEqual([{ repo: REPO, stage: MANUAL }]);
    // A repo whose flow binds no role and no account contributes nothing.
    const idle = repoDef(OTHER_REPO, repoFlow([stageDef(MANUAL, null)], [binding(MANUAL, undefined, [])]));
    expect(dependantsOfRole(ROLE, [idle])).toEqual([]);
    expect(dependantsOfAccount(ACCOUNT, [idle])).toEqual([]);
  });
});

describe('archived definitions', () => {
  it('R-134: archived definitions stay resolvable for pins and history', () => {
    const archivedLibrary: readonly VersionRecord<RoleDef>[] = [
      versionOf(ROLE, 1, roleDef(ROLE)),
      versionOf(ROLE, 2, roleDef(ROLE, { name: 'Engineer' }), { archived: true }),
    ];
    expect(effectiveRole(roleRef(ROLE, 2), archivedLibrary)).toEqual({
      ok: true,
      value: roleDef(ROLE, { name: 'Engineer' }),
    });
    const flow = repoFlow([stageDef(WORK, ROLE)], [binding(WORK, roleRef(ROLE, 2))]);
    const pinned = pinFlow(flow, archivedLibrary, 'wait_resume');
    expect(pinned.ok).toBe(true);
    expect(pinned.ok && pinned.value.stages[0].roleVersion).toBe(2);
  });
});
