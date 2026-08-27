// src/core/__tests__/roadmap.test.ts — the derivation contract, test-first (WO-0048, ADR-0016).
// Status is NEVER stored: a task's status derives from its linked WOs, a faz's from its tasks and
// blockers. The antreo facts here are the approved mockup's frame-01 (the acceptance basis for the
// whole layer). Written BEFORE src/core/roadmap.ts (ADR-0006: core is test-first).
import { describe, expect, it } from 'vitest';
import { buildRoadmapMd, type FazSpec } from '../roadmap-md';
import {
  deriveRoadmapView,
  fazStatusOf,
  type RoadmapOrderFact,
  roadmapTaskOf,
  spawnActionOf,
  taskStatusOf,
} from '../roadmap';
import { ANTREO_REPOS, ANTREO_WORKSPACE, antreoFazlar, antreoOrderFacts, antreoRoadmapMd } from './antreo-roadmap';
import type { WorkOrderId } from '../types';

// Tests may build identities (the boundary carve-out) — the inline edge-case orders below brand here.
const wo = (id: string): WorkOrderId => id as WorkOrderId;

const antreoInput = (): { roadmapMd: string; workspaceSlug: string; knownRepos: string[]; orders: RoadmapOrderFact[] } => ({
  roadmapMd: antreoRoadmapMd,
  workspaceSlug: ANTREO_WORKSPACE,
  knownRepos: ANTREO_REPOS,
  orders: antreoOrderFacts,
});

// A minimal one-faz document with the given spec, for the edge cases.
const mdOf = (fazlar: FazSpec[]): string =>
  buildRoadmapMd({ workspaceSlug: ANTREO_WORKSPACE, title: 'T', fazlar });

describe('taskStatusOf — task status from its linked WOs, never stored', () => {
  it('no WO → planli; any open → kosuyor; all closed (≥1) → tamam', () => {
    expect(taskStatusOf([])).toBe('planli');
    expect(taskStatusOf([{ closed: false }])).toBe('kosuyor');
    expect(taskStatusOf([{ closed: true }, { closed: false }])).toBe('kosuyor');
    expect(taskStatusOf([{ closed: true }])).toBe('tamam');
    expect(taskStatusOf([{ closed: true }, { closed: true }])).toBe('tamam');
  });
});

describe('fazStatusOf — faz status from its tasks and blockers (precedence pinned)', () => {
  it('any task kosuyor outranks an unmet blocker (a running faz is not blocked)', () => {
    expect(fazStatusOf({ tasks: ['kosuyor'], blockers: ['planli'] })).toBe('kosuyor');
  });

  it('no kosuyor + any blocker not tamam → bekliyor', () => {
    expect(fazStatusOf({ tasks: ['planli'], blockers: ['planli'] })).toBe('bekliyor');
    expect(fazStatusOf({ tasks: [], blockers: ['kosuyor'] })).toBe('bekliyor');
  });

  it('tasks>0 and all tamam (blockers all tamam) → tamam; the vacuous truth is refused', () => {
    expect(fazStatusOf({ tasks: ['tamam', 'tamam'], blockers: ['tamam'] })).toBe('tamam');
    expect(fazStatusOf({ tasks: ['planli', 'tamam'], blockers: [] })).toBe('planli');
    expect(fazStatusOf({ tasks: [], blockers: [] })).toBe('planli'); // zero-task faz is planned, not done
  });
});

describe('spawnActionOf — İş emri aç availability (ADR-0001: absent with a reason, never disabled)', () => {
  const repo = { repo: 'api', knownRepos: ANTREO_REPOS } as const;

  it('planli task + unblocked faz + resolved repo → available (a KOSUYOR faz does not block)', () => {
    expect(spawnActionOf({ task: 'planli', faz: 'planli', ...repo })).toEqual({ available: true });
    expect(spawnActionOf({ task: 'planli', faz: 'kosuyor', ...repo })).toEqual({ available: true });
  });

  it('the three structural reasons', () => {
    expect(spawnActionOf({ task: 'kosuyor', faz: 'kosuyor', ...repo })).toEqual({ available: false, reason: 'kosuyor' });
    expect(spawnActionOf({ task: 'planli', faz: 'bekliyor', ...repo })).toEqual({ available: false, reason: 'bloke' });
    expect(spawnActionOf({ task: 'planli', faz: 'planli', repo: undefined, knownRepos: ANTREO_REPOS })).toEqual({ available: false, reason: 'repo_yok' });
    expect(spawnActionOf({ task: 'planli', faz: 'planli', repo: 'web', knownRepos: ANTREO_REPOS })).toEqual({ available: false, reason: 'repo_yok' });
  });

  it('a tamam task carries no reason — the "N WO kapandı" line is the tail', () => {
    expect(spawnActionOf({ task: 'tamam', faz: 'tamam', ...repo })).toEqual({ available: false });
  });
});

describe('deriveRoadmapView — the antreo facts (mockup frame-01, the acceptance basis)', () => {
  it('f0 TAMAM: 2/2 tasks, 5 closed WOs, $12.40 summed (3+2 split across its tasks)', () => {
    const v = deriveRoadmapView(antreoInput());
    expect(v.kind).toBe('ready');
    if (v.kind !== 'ready') return;
    const f0 = v.fazlar[0]!;
    expect(f0.id).toBe('f0');
    expect(f0.status).toBe('tamam');
    expect(f0.closedWoCount).toBe(5);
    expect(f0.closedCostUsd).toBeCloseTo(12.4, 10);
    expect(f0.tasks[0]).toMatchObject({ id: 'f0-t1', status: 'tamam', closedWoCount: 3 });
    expect(f0.tasks[1]).toMatchObject({ id: 'f0-t2', status: 'tamam', closedWoCount: 2 });
    expect(f0.tasks[0]!.closedCostUsd).toBeCloseTo(8.3, 10); // 3.10+4.20+1.00
    expect(f0.tasks[0]!.openWoIds).toEqual([]);
  });

  it('f1 KOŞUYOR: the open-WO chip sits on fotoğraf (f1-t3); doğrulama (f1-t2) is sıradaki', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    const f1 = v.fazlar[1]!;
    expect(f1.status).toBe('kosuyor');
    expect(f1.openWoCount).toBe(1);
    expect(f1.tasks[0]).toMatchObject({ id: 'f1-t1', status: 'tamam', closedWoCount: 1, closedCostUsd: 0 });
    expect(f1.tasks[2]).toMatchObject({ id: 'f1-t3', status: 'kosuyor', openWoIds: ['WO-0012'] });
    expect(f1.tasks[1]!.spawn).toEqual({ available: true });
    expect(f1.tasks[3]!.spawn).toEqual({ available: true });
    expect(v.siradaki).toEqual({ fazId: 'f1', taskId: 'f1-t2' });
  });

  it('f2 BEKLİYOR naming f4; f4 BEKLİYOR naming f1 (the chain f2→f4→f1-koşuyor)', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.fazlar[2]).toMatchObject({ id: 'f2', status: 'bekliyor', blockedBy: ['f4'] });
    expect(v.fazlar[3]).toMatchObject({ id: 'f4', status: 'bekliyor', blockedBy: ['f1'] });
    expect(v.fazlar[2]!.tasks[0]!.spawn).toEqual({ available: false, reason: 'bloke' });
    expect(v.fazlar[2]!.notes).toContain('gap analizi kararı');
  });

  it('head: 1/4 faz · 4 open work orders (WO-0012 + 3 unlinked) · $14.02 total observed', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.head).toMatchObject({
      title: 'Antreo Yol Haritası',
      doneFazCount: 1,
      totalFazCount: 4,
      openWoCount: 4,
      costUnknown: false,
    });
    expect(v.head.totalCostUsd).toBeCloseTo(14.02, 10); // 12.40 closed + 1.62 open — ALL observed spend
    expect(v.warnings).toEqual([]);
  });
});

describe('deriveRoadmapView — the union: absent / invalid / ready', () => {
  it("'' → absent (the invitation surface's data)", () => {
    expect(deriveRoadmapView({ ...antreoInput(), roadmapMd: '' })).toEqual({ kind: 'absent' });
  });

  it('a broken fence → invalid carrying the parse reason', () => {
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: '---\nworkspace: antreo-app\ntitle: T\n---\n\nProse only.' });
    expect(v.kind).toBe('invalid');
    if (v.kind !== 'invalid') throw new Error('expected invalid');
    expect(v.reasons).toEqual([expect.objectContaining({ code: 'no_fence', severity: 'error' })]);
  });

  it('a duplicate id (parses clean) → invalid carrying duplicate_id — never half-trusted', () => {
    const dup = [antreoFazlar[0]!, { ...antreoFazlar[1]!, id: 'f0' }];
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: mdOf(dup) });
    expect(v.kind).toBe('invalid');
    if (v.kind !== 'invalid') throw new Error('expected invalid');
    expect(v.reasons).toContainEqual(expect.objectContaining({ code: 'duplicate_id' }));
  });

  it('a foreign workspace → invalid carrying front_matter_mismatch (must not render)', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'other', title: 'T', fazlar: antreoFazlar });
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md });
    expect(v.kind).toBe('invalid');
  });
});

describe('deriveRoadmapView — the named edge cases (each a test, per the order)', () => {
  it('orphan: a task: ref pointing at no task is invisible in fazlar but counted in the head', () => {
    const orders: RoadmapOrderFact[] = [...antreoOrderFacts.map((o) => ({ ...o }))];
    orders[9] = { id: wo('WO-0009'), closed: false, costUsd: 0, taskRef: 'f9-t9' }; // 3 unlinked → 1 orphan + 2 unlinked
    const v = deriveRoadmapView({ ...antreoInput(), orders });
    if (v.kind !== 'ready') throw new Error('expected ready');
    const everyTask = v.fazlar.flatMap((f) => f.tasks);
    expect(everyTask.some((t) => t.openWoIds.includes(wo('WO-0009')))).toBe(false);
    expect(v.head.openWoCount).toBe(4); // still counted
  });

  it('zero-task faz → planli (and never tamam)', () => {
    const md = mdOf([{ id: 'f0', title: 'Boş', blockedBy: [], tasks: [] }, ...antreoFazlar.slice(1)]);
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md });
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.fazlar[0]).toMatchObject({ id: 'f0', status: 'planli', tasks: [] });
  });

  it('a blockedBy 2-cycle → BOTH bekliyor + one cyclic_blocked_by warning riding the ready view', () => {
    const md = mdOf([
      { id: 'fa', title: 'A', blockedBy: ['fb'], tasks: [{ id: 'fa-t1', title: 'x', repo: 'api' }] },
      { id: 'fb', title: 'B', blockedBy: ['fa'], tasks: [{ id: 'fb-t1', title: 'y', repo: 'api' }] },
    ]);
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md, orders: [] });
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.fazlar[0]!.status).toBe('bekliyor');
    expect(v.fazlar[1]!.status).toBe('bekliyor');
    expect(v.warnings).toEqual([expect.objectContaining({ code: 'cyclic_blocked_by', detail: expect.stringContaining('fa') })]);
  });

  it('self-block → invalid (a diagnostic error, not a bekliyor)', () => {
    const md = mdOf([{ id: 'f0', title: 'A', blockedBy: ['f0'], tasks: [{ id: 'f0-t1', title: 'x', repo: 'api' }] }]);
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md });
    expect(v.kind).toBe('invalid');
  });

  it("unknown repo → warning + that task's spawn is repo_yok; the surface stays ready", () => {
    const md = mdOf([{ id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x', repo: 'web' }] }]);
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md, orders: [] });
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.warnings).toEqual([expect.objectContaining({ code: 'unknown_repo' })]);
    expect(v.fazlar[0]!.tasks[0]!.spawn).toEqual({ available: false, reason: 'repo_yok' });
  });

  it('costUnknown flags NULL-cost sessions instead of silently summing them', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.head.costUnknown).toBe(false);
    const withUnknown = deriveRoadmapView({
      ...antreoInput(),
      orders: [...antreoOrderFacts, { id: wo('WO-0013'), closed: true, costUsd: 0, costUnknown: true, taskRef: 'f0-t1' }],
    });
    if (withUnknown.kind !== 'ready') throw new Error('expected ready');
    expect(withUnknown.head.costUnknown).toBe(true);
  });

  it('sıradaki: undefined when nothing is spawnable (a repo_yok first row cannot steal the marker)', () => {
    const md = mdOf([
      { id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x', repo: 'web' }] },
      { id: 'f1', title: 'B', blockedBy: [], tasks: [{ id: 'f1-t1', title: 'y', repo: 'api' }] },
    ]);
    const v = deriveRoadmapView({ ...antreoInput(), roadmapMd: md, orders: [] });
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.siradaki).toEqual({ fazId: 'f1', taskId: 'f1-t1' }); // skipped the repo_yok row
    const blockedWorld = mdOf([
      { id: 'fa', title: 'A', blockedBy: ['fb'], tasks: [{ id: 'fa-t1', title: 'x', repo: 'api' }] },
      { id: 'fb', title: 'B', blockedBy: ['fa'], tasks: [{ id: 'fb-t1', title: 'y', repo: 'api' }] },
    ]);
    const v2 = deriveRoadmapView({ ...antreoInput(), roadmapMd: blockedWorld, orders: [] });
    if (v2.kind !== 'ready') throw new Error('expected ready');
    expect(v2.siradaki).toBeUndefined();
  });
});

describe('roadmapTaskOf — the detail chip\'s wo→task reverse lookup (WO-0049)', () => {
  it('resolves a linked ref to its faz + title + 1-based ordinal (f1-t3 = fotoğraf, 3rd of f1)', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(roadmapTaskOf(v, 'f1-t3')).toEqual({
      fazId: 'f1',
      fazTitle: 'Antrenör Profili',
      taskId: 'f1-t3',
      taskTitle: 'Fotoğraf yükleme',
      taskOrdinal: 3,
    });
  });

  it('an orphan ref (the task left roadmap.md) → undefined — the chip degrades, never lies', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(roadmapTaskOf(v, 'f9-t9')).toBeUndefined();
  });

  it('the first task of a faz carries ordinal 1 (the spawn dialog\'s "GÖREV K" voice)', () => {
    const v = deriveRoadmapView(antreoInput());
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(roadmapTaskOf(v, 'f0-t1')).toMatchObject({ taskOrdinal: 1, taskTitle: 'Rol ayrımı ve kayıt akışı' });
  });
});
