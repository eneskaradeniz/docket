import { describe, expect, it } from 'vitest';
import type { ProjectDef } from '../definitions';
import type { ProjectSlug, RepoSlug, Result } from '../shared';
import type { Roadmap } from './types';
import type { RoadmapIssue } from './types';
import { validateRoadmap } from './validate';

type Obj = Record<string, unknown>;

const task = (id: string, dependsOn: readonly string[] = [], over: Obj = {}): Obj => ({
  id,
  title: `Task ${id}`,
  dependsOn,
  acceptance: [`acceptance of ${id}`],
  ...over,
});

const phase = (id: string, tasks: readonly Obj[] = [], blockedBy: readonly string[] = [], over: Obj = {}): Obj => ({
  id,
  name: `Phase ${id}`,
  blockedBy,
  tasks,
  ...over,
});

const doc = (phases: readonly Obj[]): Obj => ({ phases });

const repoSlug = (id: string): RepoSlug => id as RepoSlug;
const projectSlug = (id: string): ProjectSlug => id as ProjectSlug;

const project = (over: Partial<ProjectDef> = {}): ProjectDef => ({
  id: projectSlug('atolye'),
  name: 'Atölye',
  mainRepo: repoSlug('docket'),
  repos: [repoSlug('docket'), repoSlug('docs')],
  ...over,
});

const expectOk = (result: Result<Roadmap, readonly RoadmapIssue[]>): Roadmap => {
  if (!result.ok) throw new Error(`expected ok, got issues: ${JSON.stringify(result.error)}`);
  return result.value;
};

const expectErr = (result: Result<Roadmap, readonly RoadmapIssue[]>): readonly RoadmapIssue[] => {
  if (result.ok) throw new Error(`expected err, got ok: ${JSON.stringify(result.value)}`);
  return result.error;
};

const codesOf = (issues: readonly RoadmapIssue[]): readonly string[] => issues.map((issue) => issue.code);

const issueWithCode = (issues: readonly RoadmapIssue[], code: string): RoadmapIssue | undefined =>
  issues.find((issue) => issue.code === code);

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.values(value as Obj).forEach((inner) => deepFreeze(inner));
    Object.freeze(value);
  }
  return value;
};

// Two phases, three tasks, dependencies across the phase border — the shape every rule below hangs on.
const validInput: Obj = doc([
  phase('p-1', [task('t-1'), task('t-2', ['t-1'])]),
  phase('p-2', [task('t-3', ['t-2'], { targets: ['docket'] })], ['p-1']),
]);

describe('validateRoadmap', () => {
  it('R-39: accepts a valid roadmap and returns the parsed phases and tasks', () => {
    const value = expectOk(validateRoadmap(validInput));
    expect(value.phases).toHaveLength(2);
    expect(value.phases[0]?.id).toBe('p-1');
    expect(value.phases[0]?.tasks[1]?.dependsOn).toEqual(['t-1']);
    expect(value.phases[1]?.blockedBy).toEqual(['p-1']);
    expect(value.phases[1]?.tasks[0]?.targets).toEqual(['docket']);
    expect(value.phases[0]?.tasks[0]?.acceptance).toEqual(['acceptance of t-1']);
  });

  it('R-39: accepts a task depending on a task declared in a later phase', () => {
    const value = expectOk(
      validateRoadmap(doc([phase('p-1', [task('t-1', ['t-later'])]), phase('p-2', [task('t-later')])])),
    );
    expect(value.phases[0]?.tasks[0]?.dependsOn).toEqual(['t-later']);
  });

  it('R-39: accepts an empty roadmap', () => {
    const value = expectOk(validateRoadmap(doc([])));
    expect(value.phases).toEqual([]);
  });

  it('R-39: accepts a phase with no tasks', () => {
    const value = expectOk(validateRoadmap(doc([phase('p-1', [])])));
    expect(value.phases[0]?.tasks).toEqual([]);
  });

  it('R-39: reports duplicate task ids across the whole roadmap', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-dup')]), phase('p-2', [task('t-dup')])])));
    const duplicate = issueWithCode(issues, 'duplicate_id');
    expect(duplicate).toBeDefined();
    expect(duplicate?.path).toBe('phases[1].tasks[0].id');
    expect(duplicate?.message).toContain('t-dup');
  });

  it('R-39: reports duplicate task ids inside one phase', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-a'), task('t-a')])])));
    expect(issueWithCode(issues, 'duplicate_id')?.path).toBe('phases[0].tasks[1].id');
  });

  it('R-39: reports duplicate phase ids', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1'), phase('p-1')])));
    const duplicate = issueWithCode(issues, 'duplicate_id');
    expect(duplicate?.path).toBe('phases[1].id');
    expect(duplicate?.message).toContain('p-1');
  });

  it('R-39: reports dependsOn references to a task that does not exist', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-1'), task('t-2', ['t-ghost'])])])));
    const unknown = issueWithCode(issues, 'unknown_task');
    expect(unknown).toBeDefined();
    expect(unknown?.path).toBe('phases[0].tasks[1].dependsOn[0]');
    expect(unknown?.message).toContain('t-ghost');
  });

  it('R-39: reports blockedBy references to a phase that does not exist', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1'), phase('p-2', [], ['p-ghost'])])));
    const unknown = issueWithCode(issues, 'unknown_phase');
    expect(unknown).toBeDefined();
    expect(unknown?.path).toBe('phases[1].blockedBy[0]');
    expect(unknown?.message).toContain('p-ghost');
  });

  it('R-39: reports a task dependency cycle with the ids involved in the message', () => {
    // t-a dependsOn t-b, t-b dependsOn t-c, t-c dependsOn t-a.
    const issues = expectErr(
      validateRoadmap(doc([phase('p-1', [task('t-a', ['t-b']), task('t-b', ['t-c']), task('t-c', ['t-a'])])])),
    );
    const cycle = issueWithCode(issues, 'task_cycle');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('t-a');
    expect(cycle?.message).toContain('t-b');
    expect(cycle?.message).toContain('t-c');
    expect(cycle?.path).toContain('dependsOn');
  });

  it('R-39: reports a task that depends on itself', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-a', ['t-a'])])])));
    const cycle = issueWithCode(issues, 'task_cycle');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('t-a');
  });

  it('R-39: reports a phase blockedBy cycle with the ids involved in the message', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [], ['p-2']), phase('p-2', [], ['p-1'])])));
    const cycle = issueWithCode(issues, 'phase_cycle');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('p-1');
    expect(cycle?.message).toContain('p-2');
    expect(cycle?.path).toContain('blockedBy');
  });

  it('R-39: reports a task cycle and a phase cycle in one validation result', () => {
    const issues = expectErr(
      validateRoadmap(
        doc([
          phase('p-1', [task('t-a', ['t-b']), task('t-b', ['t-a'])], ['p-2']),
          phase('p-2', [], ['p-1']),
        ]),
      ),
    );
    expect(codesOf(issues)).toContain('task_cycle');
    expect(codesOf(issues)).toContain('phase_cycle');
    expect(issues.filter((issue) => issue.code === 'task_cycle')).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === 'phase_cycle')).toHaveLength(1);
  });

  it('R-39a: reports a cross-graph deadlock as one cross_cycle naming the tasks involved', () => {
    // t-a depends on t-b, while p-2 (home of t-b) is blocked by p-1 (home of t-a): neither can start.
    const issues = expectErr(
      validateRoadmap(doc([phase('p-1', [task('t-a', ['t-b'])]), phase('p-2', [task('t-b')], ['p-1'])])),
    );
    const cross = issues.filter((issue) => issue.code === 'cross_cycle');
    expect(cross).toHaveLength(1);
    expect(cross[0]?.message).toContain('t-a');
    expect(cross[0]?.message).toContain('t-b');
    expect(issueWithCode(issues, 'task_cycle')).toBeUndefined();
  });

  it('R-39a: with a phase cycle present, only phase_cycle is reported — no cross_cycle noise', () => {
    const issues = expectErr(
      validateRoadmap(doc([phase('p-1', [task('t-a'), task('t-b')], ['p-2']), phase('p-2', [task('t-c')], ['p-1'])])),
    );
    expect(issueWithCode(issues, 'phase_cycle')).toBeDefined();
    expect(issues.filter((issue) => issue.code === 'cross_cycle')).toHaveLength(0);
  });

  it('R-39a: reports a pure task cycle only as task_cycle, never as cross_cycle', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-a', ['t-b']), task('t-b', ['t-a'])])])));
    expect(issueWithCode(issues, 'task_cycle')).toBeDefined();
    expect(issues.filter((issue) => issue.code === 'cross_cycle')).toHaveLength(0);
  });

  it('R-39a: a task depending on itself is not reported as cross_cycle', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-a', ['t-a'])])])));
    expect(issueWithCode(issues, 'task_cycle')).toBeDefined();
    expect(issues.filter((issue) => issue.code === 'cross_cycle')).toHaveLength(0);
  });

  it('R-39a: detects the deadlock through transitive phase blocking', () => {
    // p-3 is blocked by p-2, which is blocked by p-1; the block edge t-c -> t-a spans two hops.
    const issues = expectErr(
      validateRoadmap(
        doc([
          phase('p-1', [task('t-a', ['t-c'])]),
          phase('p-2', [], ['p-1']),
          phase('p-3', [task('t-c')], ['p-2']),
        ]),
      ),
    );
    const cross = issues.filter((issue) => issue.code === 'cross_cycle');
    expect(cross).toHaveLength(1);
    expect(cross[0]?.message).toContain('t-a');
    expect(cross[0]?.message).toContain('t-c');
  });

  it('R-39a: accepts a dependency into the blocking phase without a phantom cross_cycle', () => {
    // t-3 sits in p-2, blocked by p-1, and depends on p-1's t-2: every edge points forward.
    expect(validateRoadmap(validInput).ok).toBe(true);
  });

  it('R-47: every targets entry must be a valid slug', () => {
    const badSlug = expectErr(validateRoadmap(doc([phase('p-1', [task('t-1', [], { targets: ['docket', 'NOPE'] })])])));
    expect(issueWithCode(badSlug, 'invalid_slug')?.path).toBe('phases[0].tasks[0].targets[1]');

    const notString = expectErr(validateRoadmap(doc([phase('p-1', [task('t-1', [], { targets: [7] })])])));
    expect(issueWithCode(notString, 'wrong_type')?.path).toBe('phases[0].tasks[0].targets[0]');

    const notArray = expectErr(validateRoadmap(doc([phase('p-1', [task('t-1', [], { targets: 'docket' })])])));
    expect(issueWithCode(notArray, 'wrong_type')?.path).toBe('phases[0].tasks[0].targets');
  });

  it('R-47: a target outside project.repos is unknown_repo; without a project there is nothing to check against', () => {
    const issues = expectErr(
      validateRoadmap(doc([phase('p-1', [task('t-1', [], { targets: ['docket', 'ghost'] })])]), project()),
    );
    const unknown = issueWithCode(issues, 'unknown_repo');
    expect(unknown).toBeDefined();
    expect(unknown?.path).toBe('phases[0].tasks[0].targets[1]');
    expect(unknown?.message).toContain('ghost');
    expect(unknown?.message).toContain('atolye');

    expect(validateRoadmap(doc([phase('p-1', [task('t-1', [], { targets: ['docket', 'ghost'] })])])).ok).toBe(true);
  });

  it('R-47: absent or empty targets default to [project.mainRepo]; written targets survive', () => {
    const value = expectOk(
      validateRoadmap(
        doc([phase('p-1', [task('t-1'), task('t-2', [], { targets: [] }), task('t-3', [], { targets: ['docs'] })])]),
        project(),
      ),
    );
    expect(value.phases[0]?.tasks[0]?.targets).toEqual(['docket']);
    expect(value.phases[0]?.tasks[1]?.targets).toEqual(['docket']);
    expect(value.phases[0]?.tasks[2]?.targets).toEqual(['docs']);
  });

  it('R-47: changing the project mainRepo moves the default target with it', () => {
    const input = doc([phase('p-1', [task('t-1')])]);
    const withDocket = expectOk(validateRoadmap(input, project()));
    expect(withDocket.phases[0]?.tasks[0]?.targets).toEqual(['docket']);

    const withDocs = expectOk(validateRoadmap(input, project({ mainRepo: repoSlug('docs') })));
    expect(withDocs.phases[0]?.tasks[0]?.targets).toEqual(['docs']);
  });

  it('R-47 edge: without a project, absent targets stay empty', () => {
    const value = expectOk(validateRoadmap(doc([phase('p-1', [task('t-1')])])));
    expect(value.phases[0]?.tasks[0]?.targets).toEqual([]);
  });

  it('R-39: reports invalid task and phase slugs', () => {
    const issues = expectErr(
      validateRoadmap(doc([phase('P_1', [task('Bad Slug')])])),
    );
    expect(issueWithCode(issues, 'invalid_slug')?.path).toBe('phases[0].id');
    expect(issues.filter((issue) => issue.code === 'invalid_slug').map((issue) => issue.path)).toContain(
      'phases[0].tasks[0].id',
    );
  });

  it('R-39: reports invalid slugs inside dependsOn and blockedBy', () => {
    const issues = expectErr(validateRoadmap(doc([phase('p-1', [task('t-1', ['NOPE'])], ['NOPE'])])));
    expect(issues.filter((issue) => issue.code === 'invalid_slug').map((issue) => issue.path)).toEqual([
      'phases[0].blockedBy[0]',
      'phases[0].tasks[0].dependsOn[0]',
    ]);
  });

  it('R-39: reports missing required fields with their paths', () => {
    const issues = expectErr(
      validateRoadmap(
        doc([
          {
            id: 'p-1',
            blockedBy: [],
            tasks: [{ id: 't-1', dependsOn: [], acceptance: [] }],
          },
        ]),
      ),
    );
    const missing = issues.filter((issue) => issue.code === 'missing_field');
    expect(missing.map((issue) => issue.path).sort()).toEqual(['phases[0].name', 'phases[0].tasks[0].title']);
  });

  it('R-39: reports a roadmap without phases', () => {
    const issues = expectErr(validateRoadmap({}));
    expect(issueWithCode(issues, 'missing_field')?.path).toBe('phases');
  });

  it('R-39: reports wrong types at every level', () => {
    const rawPhase = (over: Obj): Obj => ({ id: 'p-1', name: 'Phase p-1', blockedBy: [], tasks: [], ...over });
    const rawTask = (over: Obj): Obj => ({ id: 't-1', title: 'Task t-1', dependsOn: [], acceptance: [], ...over });

    const notObject = expectErr(validateRoadmap(null));
    expect(issueWithCode(notObject, 'wrong_type')).toBeDefined();

    const notArray = expectErr(validateRoadmap({ phases: 'nope' }));
    expect(issueWithCode(notArray, 'wrong_type')?.path).toBe('phases');

    const phaseNotObject = expectErr(validateRoadmap({ phases: ['nope'] }));
    expect(issueWithCode(phaseNotObject, 'wrong_type')?.path).toBe('phases[0]');

    const tasksNotArray = expectErr(validateRoadmap(doc([rawPhase({ tasks: 'nope' })])));
    expect(issueWithCode(tasksNotArray, 'wrong_type')?.path).toBe('phases[0].tasks');

    const blockedByNotArray = expectErr(validateRoadmap(doc([rawPhase({ blockedBy: 'nope' })])));
    expect(issueWithCode(blockedByNotArray, 'wrong_type')?.path).toBe('phases[0].blockedBy');

    const dependsOnNotArray = expectErr(validateRoadmap(doc([rawPhase({ tasks: [rawTask({ dependsOn: 'nope' })] })])));
    expect(issueWithCode(dependsOnNotArray, 'wrong_type')?.path).toBe('phases[0].tasks[0].dependsOn');

    const acceptanceNotString = expectErr(validateRoadmap(doc([rawPhase({ tasks: [rawTask({ acceptance: [7] })] })])));
    expect(issueWithCode(acceptanceNotString, 'wrong_type')?.path).toBe('phases[0].tasks[0].acceptance[0]');

    const repoNotString = expectErr(validateRoadmap(doc([rawPhase({ tasks: [rawTask({ targets: 7 })] })])));
    expect(issueWithCode(repoNotString, 'wrong_type')?.path).toBe('phases[0].tasks[0].targets');
  });

  it('R-39: collects every issue in one result instead of stopping at the first', () => {
    const issues = expectErr(
      validateRoadmap(
        doc([
          phase('p-1', [task('t-1'), task('t-1', ['t-ghost'])]),
          phase('p-1', [], ['p-ghost']),
        ]),
      ),
    );
    expect(codesOf(issues)).toEqual(
      expect.arrayContaining(['duplicate_id', 'duplicate_id', 'unknown_task', 'unknown_phase']),
    );
  });

  it('R-39: does not mutate its input', () => {
    const input = deepFreeze(structuredClone(validInput));
    expect(() => validateRoadmap(input)).not.toThrow();
    expect(validateRoadmap(input).ok).toBe(true);
  });
});
