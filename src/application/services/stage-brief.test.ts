// stage-brief — A-423 of docs/v2/application.md: the planner's plan file is one per work order.
import { describe, expect, it } from 'vitest';

import type { FlowDef, ProjectSlug, RepoSlug, RoleDef, StageDef, WorkOrderId } from '../../domain/index';
import { BUILTIN_FLOWS, BUILTIN_ROLES, parseSlug, parseUlid, stageBrief, writeScopeVerdict } from '../../domain/index';

import type { WorkOrderRecord } from '../ports/index';
import { createFakeWorkOrderRepo } from '../ports/fakes';

import { planFilePath, stageBriefOf } from './stage-brief';

const ulidOf = (input: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const FIRST = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const SECOND = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA2');

const flow = BUILTIN_FLOWS[0] as FlowDef;
const stageOf = (id: string): StageDef => {
  const found = flow.stages.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`built-in flow has no stage ${id}`);
  return found;
};
const roleOf = (id: string): RoleDef => {
  const found = BUILTIN_ROLES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`built-in roles have no ${id}`);
  return found;
};

const harness = async () => {
  const workOrders = createFakeWorkOrderRepo();
  const base = {
    project: slugOf<'project'>('atolye') satisfies ProjectSlug,
    repo: slugOf<'repo'>('acme') satisfies RepoSlug,
    flow: slugOf<'flow'>('standard'),
    createdBy: { kind: 'user' as const, id: 'user-1', label: 'Operator' },
  };
  // The two records differ in createdAt, so A-29 ranks FIRST as 1 and SECOND as 2.
  const first: WorkOrderRecord = { ...base, id: FIRST, title: 'First order', createdAt: 1 };
  const second: WorkOrderRecord = { ...base, id: SECOND, title: 'Second order', createdAt: 2 };
  await workOrders.create(first);
  await workOrders.create(second);
  return { deps: { workOrders }, first, second };
};

describe('planFilePath', () => {
  it('A-423: the plan path is the docs root, plans, and the lowercase work order code', () => {
    expect(planFilePath(31, 'docs')).toBe('docs/plans/ie-0031.md');
    expect(planFilePath(1, undefined)).toBe('docs/plans/ie-0001.md');
    expect(planFilePath(12345, 'docs')).toBe('docs/plans/ie-12345.md');
  });

  it('A-423: a configured docs root is honoured, trailing slashes dropped, an empty one means docs', () => {
    expect(planFilePath(7, 'documentation/')).toBe('documentation/plans/ie-0007.md');
    expect(planFilePath(7, '')).toBe('docs/plans/ie-0007.md');
  });

  it('A-423: the path the planner is told is one the write-scope guard does not deny', () => {
    const verdict = writeScopeVerdict({
      scope: { kind: 'docs' },
      tool: 'Write',
      target: `/wt/acme/${planFilePath(31, 'docs')}`,
      context: { cwd: '/wt/acme', worktreeRoot: '/wt/acme', docsRoot: 'docs' },
    });
    expect(verdict).toEqual({ verdict: 'unchecked' });
  });
});

describe('stageBriefOf', () => {
  it('A-423: a planner stage names its own plan file and two work orders never share one', async () => {
    const h = await harness();
    const input = { flow, stage: stageOf('plan'), role: roleOf('planner'), docsRoot: 'docs' };
    const first = await stageBriefOf(h.deps, { ...input, record: h.first });
    const second = await stageBriefOf(h.deps, { ...input, record: h.second });

    expect(first).toContain('docs/plans/ie-0001.md');
    expect(second).toContain('docs/plans/ie-0002.md');
    expect(first).not.toContain('ie-0002');
    expect(second).not.toContain('ie-0001');
    expect(first).toContain('Plan file:');
    expect(first).not.toMatch(/docs\/plan\.md/);
  });

  it('A-423: a stage whose role is not the planner gets the plain brief, byte for byte', async () => {
    const h = await harness();
    const stage = stageOf('implement');
    const role = roleOf('developer');
    const brief = await stageBriefOf(h.deps, { flow, stage, role, record: h.first, docsRoot: 'docs' });
    expect(brief).toBe(stageBrief(flow, stage, role, { id: FIRST, title: 'First order' }));
    expect(brief).not.toContain('plans/');
  });

  it('A-423: a work order whose number cannot be read gets the plain brief — no invented path', async () => {
    const h = await harness();
    const strangerId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ');
    const stranger: WorkOrderRecord = { ...h.first, id: strangerId };
    const stage = stageOf('plan');
    const role = roleOf('planner');
    const brief = await stageBriefOf(h.deps, { flow, stage, role, record: stranger, docsRoot: 'docs' });
    expect(brief).toBe(stageBrief(flow, stage, role, { id: strangerId, title: 'First order' }));
  });
});
