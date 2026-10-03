import { describe, expect, it } from 'vitest';
import type { FlowDef, RepoDef, RoleDef, StageDef } from '../definitions/index';
import type { FlowSlug, GateSlug, RepoSlug, RoleSlug, StageSlug, WorkOrderId } from '../shared/index';
import {
  DEFAULT_INSTRUCTION_BUDGET_CHARS,
  acceptanceCriteria,
  planInstructions,
  renderInstructionBlock,
  stageBrief,
} from './instructions';
import type { RepoInstructionFile } from './instructions';

const flowOf = (id: string): FlowSlug => id as FlowSlug;
const stageOf = (id: string): StageSlug => id as StageSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const repoOf = (id: string): RepoSlug => id as RepoSlug;
const orderOf = (id: string): WorkOrderId => id as WorkOrderId;

const ROLE: RoleDef = {
  id: roleOf('developer'),
  name: 'Geliştirici',
  instructions: 'You implement the change end to end.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const WORK_ORDER = { id: orderOf('01J8Z0A7BCTHEXAMPLE0Q7Z8V9Q'), title: 'Fix the login bug' };

const REPO: RepoDef = {
  id: repoOf('docket'),
  name: 'docket',
  flows: [flowOf('standard')],
  defaultFlow: flowOf('standard'),
  commandSets: { check: ['npm test', 'npm run typecheck'] },
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: ['**/*.test.ts'],
};

const stageWith = (exit: StageDef['exit']): StageDef => ({
  id: stageOf('implement'),
  name: 'Implement',
  role: roleOf('developer'),
  exit,
});

const FLOW: FlowDef = { id: flowOf('standard'), name: 'Standard flow', stages: [stageWith([])] };

const file = (name: string, content: string): RepoInstructionFile => ({ name, content });

describe('stageBrief', () => {
  it('R-53: renders the same bytes for the same definitions — pure, no time or account data', () => {
    const once = stageBrief(FLOW, stageWith([]), ROLE, WORK_ORDER);
    // Distinct but equal inputs render identical bytes: no hidden state, clock or random source.
    const again = stageBrief(
      { ...FLOW, stages: [{ ...stageWith([]) }] },
      { ...stageWith([]) },
      { ...ROLE },
      { ...WORK_ORDER },
    );
    expect(once).toBe(again);
    expect(once).toContain(WORK_ORDER.title);
    expect(once).toContain(FLOW.name);
    expect(once).toContain('Implement');
    expect(once).toContain(ROLE.name);
    expect(once).toContain(ROLE.instructions);
  });

  it('R-53: a stage of a longer flow renders the same bytes — the brief is a function of its own stage', () => {
    const longer: FlowDef = {
      ...FLOW,
      stages: [stageWith([]), { id: stageOf('review'), name: 'Review', role: null, exit: [] }],
    };
    expect(stageBrief(longer, stageWith([]), ROLE, WORK_ORDER)).toBe(
      stageBrief(FLOW, stageWith([]), ROLE, WORK_ORDER),
    );
  });

  it('R-53: omits the role layer for a human-only stage', () => {
    const humanStage: StageDef = { ...stageWith([]), role: null };
    const brief = stageBrief(FLOW, humanStage, null, WORK_ORDER);
    expect(brief).not.toContain(ROLE.name);
    expect(brief).not.toContain(ROLE.instructions);
  });
});

describe('acceptanceCriteria', () => {
  it('R-53: renders the exit gates as checkable statements in stage order', () => {
    const stage = stageWith([
      { kind: 'command', id: gateOf('check'), commandSet: 'check' },
      { kind: 'secret_scan', id: gateOf('secrets') },
      { kind: 'agent_verdict', id: gateOf('verdict'), role: roleOf('reviewer') },
      { kind: 'human', id: gateOf('approval'), label: 'Kapanış onayı' },
    ]);
    const criteria = acceptanceCriteria(stage, REPO);
    expect(criteria).toHaveLength(4);
    expect(criteria[0]).toContain('check');
    expect(criteria[0]).toContain('npm test');
    expect(criteria[1].toLowerCase()).toContain('secret');
    expect(criteria[2]).toContain('reviewer');
    expect(criteria[3]).toContain('Kapanış onayı');
  });

  it('R-53: a command set missing from the repo renders by name alone — not an error', () => {
    const stage = stageWith([{ kind: 'command', id: gateOf('check'), commandSet: 'unknown-set' }]);
    expect(acceptanceCriteria(stage, REPO)).toEqual([expect.stringContaining('unknown-set')]);
  });

  it('R-53: renders the same criteria for the same definitions; a stage without gates has none', () => {
    const stage = stageWith([
      { kind: 'secret_scan', id: gateOf('secrets') },
    ]);
    expect(acceptanceCriteria(stage, REPO)).toEqual(acceptanceCriteria({ ...stage }, { ...REPO }));
    expect(acceptanceCriteria(stageWith([]), REPO)).toEqual([]);
  });
});

describe('planInstructions', () => {
  it('R-54: native files never inline — a file both native and present stays out', () => {
    const plan = planInstructions(['AGENTS.md'], [file('AGENTS.md', 'native rules')], { maxChars: 100 });
    expect(plan.inlined).toEqual([]);
    expect(plan.truncated).toEqual([]);
    expect(plan.native).toEqual(['AGENTS.md']);
  });

  it('R-54: a file both native and absent is not an error', () => {
    const plan = planInstructions(['CLAUDE.md'], [file('AGENTS.md', 'rules')], { maxChars: 100 });
    expect(plan.inlined.map((f) => f.name)).toEqual(['AGENTS.md']);
    expect(plan.truncated).toEqual([]);
  });

  it('R-54: inlines whole while the budget allows — a file exactly at the boundary fits', () => {
    const plan = planInstructions(
      [],
      [file('A.md', 'a'.repeat(6)), file('B.md', 'b'.repeat(4))],
      { maxChars: 10 },
    );
    expect(plan.inlined).toEqual([file('A.md', 'a'.repeat(6)), file('B.md', 'b'.repeat(4))]);
    expect(plan.truncated).toEqual([]);
  });

  it('R-54: the first file over the budget is truncated to the remainder with a marker naming file and kept chars', () => {
    const content = 'x'.repeat(25);
    const plan = planInstructions([], [file('BIG.md', content)], { maxChars: 10 });
    expect(plan.inlined).toHaveLength(1);
    const inlined = plan.inlined[0];
    expect(inlined.content.startsWith('x'.repeat(10))).toBe(true);
    expect(inlined.content).toContain('BIG.md');
    expect(inlined.content).toContain('10');
    expect(inlined.content).not.toContain('x'.repeat(11));
    expect(plan.truncated).toEqual(['BIG.md']);
  });

  it('R-54: later candidates are dropped and their names listed in truncated', () => {
    const plan = planInstructions(
      [],
      [file('A.md', 'a'.repeat(4)), file('B.md', 'b'.repeat(20)), file('C.md', 'c'.repeat(5))],
      { maxChars: 10 },
    );
    expect(plan.inlined.map((f) => f.name)).toEqual(['A.md', 'B.md']);
    expect(plan.inlined[1].content.startsWith('b'.repeat(6))).toBe(true);
    expect(plan.truncated).toEqual(['B.md', 'C.md']);
  });

  it('R-54: an exhausted budget drops every non-native candidate', () => {
    const plan = planInstructions(['AGENTS.md'], [file('A.md', 'a'), file('AGENTS.md', 'n')], { maxChars: 0 });
    expect(plan.inlined).toEqual([]);
    expect(plan.truncated).toEqual(['A.md']);
  });

  it('R-54: the plan is a pure function of (native, present, budget) — inputs never mutated', () => {
    const native = ['AGENTS.md'];
    const present = [file('A.md', 'a'.repeat(30)), file('B.md', 'b'.repeat(5))];
    const budget = { maxChars: 12 };
    const nativeBefore = [...native];
    const presentBefore = present.map((f) => ({ ...f }));
    const first = planInstructions(native, present, budget);
    expect(planInstructions(native, present, budget)).toEqual(first);
    expect(native).toEqual(nativeBefore);
    expect(present).toEqual(presentBefore);
    expect(budget).toEqual({ maxChars: 12 });
  });

  it('the default instruction budget is 24_000 chars', () => {
    expect(DEFAULT_INSTRUCTION_BUDGET_CHARS).toBe(24_000);
  });
});

describe('renderInstructionBlock', () => {
  it('places the inlined files under one project-context heading that marks them as quoted repo data', () => {
    const plan = planInstructions(
      ['AGENTS.md'],
      [file('A.md', 'alpha rules'), file('B.md', 'beta rules')],
      { maxChars: 100 },
    );
    const block = renderInstructionBlock(plan);
    expect(block.toLowerCase()).toContain('project context');
    expect(block.toLowerCase()).toContain('data');
    expect(block).toContain('A.md');
    expect(block).toContain('alpha rules');
    expect(block).toContain('B.md');
    expect(block.indexOf('A.md')).toBeLessThan(block.indexOf('B.md'));
    expect(block).not.toContain('AGENTS.md');
  });

  it('renders an empty plan as no block', () => {
    expect(renderInstructionBlock({ native: [], inlined: [], truncated: [] })).toBe('');
  });
});
