// src/core/__tests__/overview.test.ts — the workspace overview's projection + the tech-debt table
// parser, test-first (WO-0072). The turn map, the ready composition and the debt passthrough are
// pinned behaviorally; the parser pins run against REAL rows copied from docs/tech-debt.md (the
// file the projection reads in production — a synthetic table would pin a fiction).
import { describe, expect, it } from 'vitest';
import { deriveOverview, parseTechDebt, type DebtLine, type DeriveOverviewInput, type Turn } from '../overview';
import type { StageId, WorkOrderId } from '../types';

// Tests may build identities (the boundary carve-out) — the inline facts below brand here.
const wo = (id: string): WorkOrderId => id as WorkOrderId;

const ALL_STAGES: StageId[] = [
  'written',
  'plan_requested',
  'plan_ready',
  'architect_approval',
  'implementation',
  'verification',
  'architect_audit',
  'closure',
  'closed',
];

const oneWo = (id: string, stage: StageId, extra: Partial<DeriveOverviewInput['wos'][number]> = {}): DeriveOverviewInput['wos'][number] => ({
  id: wo(id),
  title: `title ${id}`,
  stage,
  ...extra,
});

const turnsOf = (view: ReturnType<typeof deriveOverview>): Record<Turn, string[]> => {
  const out = { architect: [], operator: [], implementer: [], verifier: [] } as Record<Turn, string[]>;
  for (const g of view.turns) for (const w of g.wos) out[g.turn].push(w.id);
  return out;
};

describe('deriveOverview — the stage→turn map (WO-0072, pinned)', () => {
  it('maps EVERY open stage into exactly one turn; groups order architect→operator→implementer→verifier', () => {
    const input = ALL_STAGES.map((s, i) => oneWo(`WO-00${i}`, s));
    const view = deriveOverview({ wos: input, debts: [], roadmapTasks: [] });
    expect(turnsOf(view)).toEqual({
      architect: ['WO-001', 'WO-006'], // plan_requested, architect_audit
      operator: ['WO-000', 'WO-002', 'WO-003', 'WO-007'], // written, plan_ready, architect_approval, closure
      implementer: ['WO-004'], // implementation
      verifier: ['WO-005'], // verification
    });
    expect(view.turns.map((g) => g.turn)).toEqual(['architect', 'operator', 'implementer', 'verifier']);
    // the closed archive never appears — the fn drops it even over a filter lapse
    expect(JSON.stringify(view)).not.toContain('WO-008');
  });

  it('covers the whole open union: a future stage must be mapped, never leaked', () => {
    // The map's contract, stated as data: every open StageId yields a group somewhere.
    for (const stage of ALL_STAGES.filter((s) => s !== 'closed')) {
      const view = deriveOverview({ wos: [oneWo('WO-0001', stage)], debts: [], roadmapTasks: [] });
      expect(view.turns).toHaveLength(1);
    }
  });

  it('empty groups are ABSENT; WOs sort by id within a group', () => {
    const view = deriveOverview({
      wos: [oneWo('WO-0009', 'implementation'), oneWo('WO-0002', 'written'), oneWo('WO-0007', 'implementation')],
      debts: [],
      roadmapTasks: [],
    });
    expect(view.turns.map((g) => g.turn)).toEqual(['operator', 'implementer']); // architect/verifier absent
    expect(view.turns[1]!.wos.map((w) => w.id)).toEqual(['WO-0007', 'WO-0009']);
  });

  it('a no-input workspace projects to the all-absent view', () => {
    expect(deriveOverview({ wos: [], debts: [], roadmapTasks: [] })).toEqual({
      turns: [],
      debts: [],
      ready: { wos: [], tasks: [] },
    });
  });
});

describe('deriveOverview — the ready composition (pinned simple: a projection, not a gate engine)', () => {
  it('a written WO is ready with why no_blockers (nothing has ever touched it)', () => {
    const view = deriveOverview({ wos: [oneWo('WO-0001', 'written', { gatePlanApproved: false })], debts: [], roadmapTasks: [] });
    expect(view.ready.wos).toEqual([{ id: wo('WO-0001'), title: 'title WO-0001', why: 'no_blockers' }]);
  });

  it('a mid-plan WO is ready with why gates_satisfiable (the plan gate is the only unsatisfied one)', () => {
    const view = deriveOverview({ wos: [oneWo('WO-0002', 'architect_approval', { gatePlanApproved: false })], debts: [], roadmapTasks: [] });
    expect(view.ready.wos).toEqual([{ id: wo('WO-0002'), title: 'title WO-0002', why: 'gates_satisfiable' }]);
  });

  it('an approved plan is NOT ready (the work is in flight or waiting on its own flow)', () => {
    const view = deriveOverview({
      wos: [oneWo('WO-0003', 'implementation', { gatePlanApproved: true }), oneWo('WO-0004', 'architect_approval', { gatePlanApproved: true })],
      debts: [],
      roadmapTasks: [],
    });
    expect(view.ready.wos).toEqual([]);
  });

  it('a closure sha is NOT ready (present means closed — the deriveStage rule)', () => {
    const view = deriveOverview({ wos: [oneWo('WO-0005', 'written', { docsSha: 'sha-closed' })], debts: [], roadmapTasks: [] });
    expect(view.ready.wos).toEqual([]);
  });

  it('a closeable WO is NOT ready (awaiting close is past ready)', () => {
    const view = deriveOverview({ wos: [oneWo('WO-0006', 'implementation', { gatePlanApproved: true, closeable: true })], debts: [], roadmapTasks: [] });
    expect(view.ready.wos).toEqual([]);
    // and the closeable fact alone cannot make an unapproved WO ready
    const armed = deriveOverview({ wos: [oneWo('WO-0007', 'closure', { closeable: true })], debts: [], roadmapTasks: [] });
    expect(armed.ready.wos).toEqual([]);
  });

  it('ready WOs sort by id and carry no stage word', () => {
    const view = deriveOverview({
      wos: [oneWo('WO-0004', 'written'), oneWo('WO-0001', 'architect_approval'), oneWo('WO-0002', 'verification', { gatePlanApproved: true })],
      debts: [],
      roadmapTasks: [],
    });
    expect(view.ready.wos.map((w) => w.id)).toEqual([wo('WO-0001'), wo('WO-0004')]);
    expect(Object.keys(view.ready.wos[0]!).sort()).toEqual(['id', 'title', 'why']);
  });

  it('ready tasks: planli in an unblocked faz only — kosuyor and blocked-faz tasks stay out; sorted by id', () => {
    const view = deriveOverview({
      wos: [],
      debts: [],
      roadmapTasks: [
        { id: 'f2-t1', title: 'blocked faz task', status: 'planli', fazBlocked: true },
        { id: 'f1-t2', title: 'kosuyor task', status: 'kosuyor', fazBlocked: false },
        { id: 'f1-t1', title: 'ready task', status: 'planli', fazBlocked: false },
        { id: 'f3-t1', title: 'done task', status: 'tamam', fazBlocked: false },
      ],
    });
    expect(view.ready.tasks).toEqual([{ id: 'f1-t1', title: 'ready task' }]);
  });
});

describe('deriveOverview — the debt passthrough (the store matches; core carries + sorts)', () => {
  it('debts pass through id-sorted, payload untouched', () => {
    const debts: DebtLine[] = [
      { id: 'TD-029', title: 'b' },
      { id: 'TD-003', title: 'a', wo: wo('WO-0002') },
      { id: 'TD-016', title: 'c', wo: wo('WO-0001') },
    ];
    const view = deriveOverview({ wos: [], debts, roadmapTasks: [] });
    expect(view.debts.map((d) => d.id)).toEqual(['TD-003', 'TD-016', 'TD-029']);
    expect(view.debts[0]).toBe(debts[1]); // passthrough — the same objects, not copies
  });
});

// ===== parseTechDebt — REAL rows from docs/tech-debt.md (the production table) =====

const REAL_HEADER = '| id | opened by | description | risk | status |';
const REAL_SEPARATOR = '| --- | --- | --- | --- | --- |';
const REAL_TAIL = [
  '',
  '- **TD-058 CLOSED by WO-0054 (2026-08-29); the queued follow-up LANDED as WO-0061 (2026-09-19):**',
  '  the usage screen\'s byModel split is a core-TS rollup over the JSON (the row-partition:',
  '  `modelUsage` lines win, scalars never double-land) — the JSON never enters SQL and no',
  '  normalized child table was needed.',
].join('\n');

const REAL_OPEN_UNLINKED =
  '| TD-003 | design | **Briefing bundle selection is undesigned.** We know a fresh architect session receives work order + linked ADRs + roadmap section + open debt. *How* linked ADRs are found (tags? front matter? directory?) is not decided. | medium | open |';
const REAL_OPEN_COMPOUND =
  '| TD-060 | WO-0059 rev 4 | **The key-injection surface is callerless by design.** The stored provider key retired (port methods, IPC, the row swept at open), but `RunnerOptions.env` and `checkProvider(env?)` remain — deliberate. | low | open |';
const REAL_OPEN_ESCAPED_PIPE =
  '| TD-029 | WO-0023 audit | **The fence is a coarse tripwire, not a security boundary.** `classifyCommandLine` inspects only the leading verb + one redirect; chains (`cat f; rm -rf /`, `echo x \\| tee …`, `find . -delete`) and arbitrary binaries bypass it for every role, including verifier. | medium | open |';
const REAL_OPEN_DOTTED_SPAN =
  '| TD-023 | WO-0011 | **The `work_order.cost_*` columns are inert.** A work order\'s cost is derived from its session rows at hydrate. | low | open · WO-0043 (2026-08-25): the fixture seed\'s `cost_*` write now lives in `store.test.ts`. |';
const REAL_OPEN_ADR_OPENER =
  '| TD-008 | ADR-0010 | **`stage` is stored, not derived.** The view model carries `stage: StageId` as raw state. | medium | **closed** by WO-0009 (merge `2763be2`): both derived in core. |';
const REAL_OPEN_STATUS_TAIL =
  '| TD-058 | WO-0052 | **Per-turn model splits live in `session_usage.model_usage` JSON.** The floor persists the per-model usage map verbatim as a JSON column. | low | open |';
const REAL_CLOSED =
  '| TD-001 | design | **Architect write isolation in single-repo workspaces.** In a multi-repo workspace the architect sits in a different repo, so isolation is physical. | high | **closed** by WO-0001 (merged `0d77313`): the fence holds. |';
const REAL_ACCEPTED =
  '| TD-002 | design | **`Forge` has one implementation.** The interface exists but only GitHub-over-`gh` is written. Untested abstraction. | low | accepted |';
const REAL_NARROWED =
  '| TD-037 | WO-0031c pre-merge review | "**Faz C P2 fast-follow batch.** Paid by WO-0031d: scroll-margin under the pinned rail, the v4 §7 closure SEAL (now the results card), the comment-rot sweep." | low | narrowed · **closed** by WO-0043 (2026-08-25): the dead label keys deleted. |';

const realFile = (...extra: string[]): string =>
  [
    '# Tech debt',
    '',
    'Updating this file is a closure gate.',
    '',
    REAL_HEADER,
    REAL_SEPARATOR,
    ...extra,
  ].join('\n');

describe('parseTechDebt — the tech-debt.md table parser (WO-0072)', () => {
  it('parses the REAL open rows: the bold lead sentence, the unlinked design opener, empty diagnostics', () => {
    const { lines, diagnostics } = parseTechDebt(realFile(REAL_OPEN_UNLINKED, REAL_OPEN_COMPOUND));
    expect(diagnostics).toEqual([]);
    expect(lines).toEqual([
      { id: 'TD-003', title: 'Briefing bundle selection is undesigned' }, // 'design' names no WO
      { id: 'TD-060', wo: 'WO-0059', title: 'The key-injection surface is callerless by design' }, // compound → FIRST token
    ]);
  });

  it('the escaped pipe in a description cannot shift the risk/status columns (the real TD-029 row)', () => {
    const { lines, diagnostics } = parseTechDebt(realFile(REAL_OPEN_ESCAPED_PIPE));
    expect(diagnostics).toEqual([]);
    expect(lines).toEqual([{ id: 'TD-029', wo: 'WO-0023', title: 'The fence is a coarse tripwire, not a security boundary' }]);
  });

  it('a dotted code span inside the lead is not a sentence end (the real TD-023 row); an open·note status stays open', () => {
    const { lines } = parseTechDebt(realFile(REAL_OPEN_DOTTED_SPAN, REAL_OPEN_STATUS_TAIL));
    expect(lines.map((l) => l.title)).toEqual([
      'The `work_order.cost_*` columns are inert',
      'Per-turn model splits live in `session_usage.model_usage` JSON',
    ]);
    expect(lines.map((l) => l.wo)).toEqual(['WO-0011', 'WO-0052']);
  });

  it('closed / accepted / narrowed rows are legitimately not open — dropped WITHOUT a diagnostic', () => {
    const { lines, diagnostics } = parseTechDebt(realFile(REAL_CLOSED, REAL_ACCEPTED, REAL_NARROWED, REAL_OPEN_ADR_OPENER));
    expect(diagnostics).toEqual([]);
    expect(lines).toEqual([]); // the ADR-opener row above is **closed** too — the fourth control
  });

  it('the header, the separator and the prose tail are the frame — never rows, never diagnostics', () => {
    const { lines, diagnostics } = parseTechDebt(realFile(REAL_OPEN_UNLINKED) + REAL_TAIL);
    expect(diagnostics).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it('a ragged row is a NAMED diagnostic carrying the TD id, never a silent drop', () => {
    const { lines, diagnostics } = parseTechDebt(realFile('| TD-010 | WO-0002 verification | **A ragged row.** | medium |'));
    expect(lines).toEqual([]);
    expect(diagnostics).toEqual(['tech-debt: TD-010 row has 4 cells, expected 5']);
  });

  it('an id-less pipe row is named; the literal header row is not', () => {
    const { diagnostics } = parseTechDebt(realFile('| WO-9000 | somebody | **Not a debt row.** | low | open |'));
    expect(diagnostics).toEqual(['tech-debt: row without a TD id (5 cells)']);
    expect(parseTechDebt(realFile(REAL_OPEN_UNLINKED)).diagnostics).toEqual([]); // the header passes silent
  });

  it('a row with a TD id but no readable title is named, not rendered', () => {
    const { lines, diagnostics } = parseTechDebt(realFile('| TD-090 | WO-0072 | **.** | low | open |'));
    expect(lines).toEqual([]);
    expect(diagnostics).toEqual(['tech-debt: TD-090 row without a title']);
  });

  it('an empty file parses to the empty-honest face', () => {
    expect(parseTechDebt('')).toEqual({ lines: [], diagnostics: [] });
  });

  it('a title over the cap is cut at the last word boundary under 80 — no ellipsis games', () => {
    const lead =
      'A deliberately very long bold lead sentence that runs well past the eighty character mark and must be cut at the last word boundary under it';
    const { lines } = parseTechDebt(realFile(`| TD-900 | WO-0072 | **${lead}.** Rest. | low | open |`));
    const title = lines[0]!.title;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(lead.startsWith(title)).toBe(true);
    expect(lead.charAt(title.length)).toBe(' '); // the cut IS a word boundary
    expect(title.endsWith('…')).toBe(false);
    // and a short lead rides whole
    expect(parseTechDebt(realFile(REAL_OPEN_COMPOUND)).lines[0]!.title).toBe('The key-injection surface is callerless by design');
  });
});
