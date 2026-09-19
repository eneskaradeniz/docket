// src/core/overview.ts — the workspace overview's read model (WO-0072), the usage.ts shape: the
// store adapter feeds FACTS (the work orders' stage facts, the roadmap view's task rows, the
// parsed debt lines); this module derives the whole projection. PURE: no SQL, no React, no Node,
// no clock. ADR-0008's derived-read discipline is the constitution — the screen is the facts the
// workspace already carries, projected; nothing here is ever stored or cached (a projection is
// derived per mount, TD-055's shape).
//
// ONE second job lives here: `parseTechDebt` — the tech-debt.md TABLE parser. Like the roadmap
// fence (ADR-0016's parser honesty), a row that does not parse lands in a NAMED diagnostic, never
// a silent drop. The parser emits the WO column's RAW token: core never constructs a branded
// identity (ADR-0003; the identity cast to a branded type is banned outside src/adapters/) — the
// store brands at assembly, the scanTaskRefs precedent.
import type { TaskStatus } from './roadmap';
import type { StageId, WorkOrderId } from './types';

/** Whose turn the stage model says it is — the four console voices. NOT a SessionRole union:
 *  `operator` has no session role (the operator drives, never sits in a ledger). */
export type Turn = 'architect' | 'operator' | 'implementer' | 'verifier';

/** One turn's open work orders. `stage` is the display-neutral union `WorkOrder` already carries
 *  (StageId, verbatim) — no stage WORD rides the view; the labels map it (TD-008's stance: the
 *  stage is derived, a stage column is a lie, and a stage label is the reader's business). */
export interface TurnGroup {
  turn: Turn;
  wos: Array<{ id: WorkOrderId; title: string; stage: StageId }>;
}

/** One open tech-debt line. `wo` is branded — the STORE resolves the parser's raw token against
 *  the workspace's open work orders and brands the hit; a line that matches nothing arrives
 *  unlinked. */
export interface DebtLine {
  id: string; // 'TD-NNN'
  title: string; // the bold lead sentence, truncated at 80 chars at a word boundary
  wo?: WorkOrderId;
}

export interface WorkspaceOverview {
  turns: TurnGroup[]; // architect → operator → implementer → verifier; empty groups ABSENT
  debts: DebtLine[]; // id-sorted; matched store-side (a closed WO's debts never arrive here)
  ready: {
    wos: Array<{ id: WorkOrderId; title: string; why: 'no_blockers' | 'gates_satisfiable' }>;
    tasks: Array<{ id: string; title: string }>; // navigate nowhere in v1 — the title speaks
  };
}

export interface DeriveOverviewInput {
  wos: Array<{
    id: WorkOrderId;
    title: string;
    stage: StageId;
    closeable?: boolean; // true = awaiting the close act — past ready, never "ready to start"
    gatePlanApproved?: boolean; // the plan gate's observed flip
    docsSha?: string; // present ⇒ closed (deriveStage's own rule)
  }>;
  debts: DebtLine[];
  roadmapTasks: Array<{ id: string; title: string; status: TaskStatus; fazBlocked: boolean }>;
}

// THE TURN MAP (WO-0072, pinned). Every open StageId member lands in exactly ONE turn; `closed`
// is deliberately unmapped — an archive is nobody's turn, and deriveOverview drops it before the
// grouping (pinned either way: the input filter is the store's, this drop is the defense).
//   architect   — plan_requested (the plan drive is the architect's work) and architect_audit
//                 (the architect's review leg).
//   operator    — written (the Plan iste click is the operator's), plan_ready (a pending plan
//                 awaits the operator's verdict — derivePhase's plan_ready arm),
//                 architect_approval (the proposal interval's resting answer: the operator's
//                 approve/resume advances it), closure (the Kapat act is the operator's).
//   implementer — implementation (the steps' flow).
//   verifier    — verification (awaiting the verifier's independent report).
const TURN_OF: Partial<Record<StageId, Turn>> = {
  written: 'operator',
  plan_requested: 'architect',
  plan_ready: 'operator',
  architect_approval: 'operator',
  implementation: 'implementer',
  verification: 'verifier',
  architect_audit: 'architect',
  closure: 'operator',
  // closed — unmapped on purpose (see above)
};

const TURN_ORDER: readonly Turn[] = ['architect', 'operator', 'implementer', 'verifier'];

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

/**
 * Compose the projection. The turn map above is the grouping's whole law: one pass, one group per
 * turn, WOs sorted by id inside the group, groups in TURN_ORDER, empty groups absent. The ready
 * rule is pinned SIMPLE — this is a projection, not a new gate engine:
 *   candidate = open WO + plan gate unsatisfied + no closure sha (startable work);
 *   excluded  = `closeable` (awaiting close is past ready — unreachable while the plan gate is
 *               unsatisfied, carried so the rule reads whole);
 *   why       = 'no_blockers' when nothing has ever touched the WO (stage `written`: no session
 *               has run, so the first move is available with nothing in flight);
 *               'gates_satisfiable' when a plan flow already did (any other open stage: the plan
 *               gate is the only unsatisfied one — satisfying it resumes the flow).
 * Tasks ride ADR-0016's derivation as fed: planli + an unblocked faz (a kosuyor faz does not
 * block its planli tasks — spawnActionOf's own rule). Debts pass through matched — the store does
 * the matching; core only sorts by id.
 */
export function deriveOverview(input: DeriveOverviewInput): WorkspaceOverview {
  const groups = new Map<Turn, TurnGroup>();
  const readyWos: WorkspaceOverview['ready']['wos'] = [];
  for (const wo of input.wos) {
    if (wo.stage === 'closed') continue; // pinned: an archive is nobody's turn
    const turn = TURN_OF[wo.stage];
    if (turn === undefined) continue; // a future stage must be MAPPED above, never leaked into a group
    let group = groups.get(turn);
    if (!group) {
      group = { turn, wos: [] };
      groups.set(turn, group);
    }
    group.wos.push({ id: wo.id, title: wo.title, stage: wo.stage });
    if (wo.docsSha == null && wo.gatePlanApproved !== true && wo.closeable !== true) {
      readyWos.push({ id: wo.id, title: wo.title, why: wo.stage === 'written' ? 'no_blockers' : 'gates_satisfiable' });
    }
  }
  return {
    turns: TURN_ORDER.filter((t) => groups.has(t)).map((t) => {
      const g = groups.get(t)!;
      return { turn: t, wos: [...g.wos].sort(byId) };
    }),
    debts: [...input.debts].sort(byId),
    ready: {
      wos: [...readyWos].sort(byId),
      tasks: input.roadmapTasks
        .filter((t) => t.status === 'planli' && !t.fazBlocked)
        .map(({ id, title }) => ({ id, title }))
        .sort(byId),
    },
  };
}

// ===== parseTechDebt — the tech-debt.md TABLE parser (WO-0072) =====
//
// The file is the closure gate's ledger: `| TD-NNN | WO-NNNN | **Title.** … | risk | status |`
// rows. The projection parses ONLY the table: prose lines and the `- **TD-NNN CLOSED…` tail
// blocks are not table rows and are ignored (a pipe row is the row grammar). Only OPEN rows are
// lines — a closed/accepted/narrowed status is a legitimate non-open row, dropped without a
// diagnostic. Ragged rows and id-less rows land in diagnostics, NAMED, never a silent drop
// (the roadmap fence's honesty, ADR-0016).

export interface ParsedDebtLine {
  id: string; // 'TD-NNN'
  title: string;
  /** The WO column's FIRST `WO-\d+` token, RAW — the compound form ('WO-0059 rev 4') takes the
   *  first. Unbranded by design: core never constructs an identity (ADR-0003); the store brands
   *  the match at assembly. Absent when the column names no work order ('design', 'ADR-0010'). */
  wo?: string;
}

const TITLE_CAP = 80;

/** Split one table row into trimmed cells, honoring the markdown escape (`\|` inside a cell —
 *  the real file's TD-029 carries `echo x \| tee`) so a description's pipe cannot shift the risk
 *  and status columns and silently un-open a row. */
function splitRow(row: string): string[] {
  const ESC = '\u0001'; // the sentinel never occurs in document text
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .replaceAll('\\|', ESC)
    .split('|')
    .map((c) => c.trim().replaceAll(ESC, '|'));
}

/** The bold lead sentence, truncated at TITLE_CAP at the last word boundary under it — no
 *  ellipsis games, the cut is a cut. The sentence boundary is a period followed by whitespace or
 *  the lead's end — NOT any period: the real file's TD-023/TD-058 carry dotted code spans
 *  (`work_order.cost_*`, `session_usage.model_usage`) inside the lead, and a bare first-dot cut
 *  would behead them. A non-bold cell degrades to its own first sentence (the same boundary). */
function debtTitle(cell: string): string {
  let t = cell.trim();
  if (t.startsWith('**')) {
    const end = t.indexOf('**', 2);
    t = end >= 0 ? t.slice(2, end) : t.slice(2);
  }
  const dot = /\.(?:\s|$)/.exec(t);
  if (dot) t = t.slice(0, dot.index);
  t = t.trim();
  if (t.length <= TITLE_CAP) return t;
  const cut = t.lastIndexOf(' ', TITLE_CAP);
  return cut > 0 ? t.slice(0, cut) : t.slice(0, TITLE_CAP);
}

export function parseTechDebt(md: string): { lines: ParsedDebtLine[]; diagnostics: string[] } {
  const lines: ParsedDebtLine[] = [];
  const diagnostics: string[] = [];
  if (md === '') return { lines, diagnostics }; // empty-honest: a missing file parses to nothing
  for (const raw of md.split('\n')) {
    const row = raw.trim();
    if (!row.startsWith('|')) continue; // prose + the CLOSED tail blocks are not table rows
    const cells = splitRow(row);
    if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) continue; // the separator frame
    const id = /TD-\d+/.exec(cells[0] ?? '')?.[0];
    if (id === undefined) {
      // The header row (`| id | opened by | …`) is the frame too; any OTHER id-less pipe row is named.
      if ((cells[0] ?? '').toLowerCase() !== 'id') {
        diagnostics.push(`tech-debt: row without a TD id (${cells.length} cells)`);
      }
      continue;
    }
    if (cells.length < 5) {
      diagnostics.push(`tech-debt: ${id} row has ${cells.length} cells, expected 5`);
      continue;
    }
    if (!cells[4]!.toLowerCase().startsWith('open')) continue; // closed / accepted / narrowed …
    const title = debtTitle(cells[2] ?? '');
    if (title === '') {
      diagnostics.push(`tech-debt: ${id} row without a title`);
      continue;
    }
    const wo = /WO-\d+/.exec(cells[1] ?? '')?.[0];
    lines.push({ id, title, ...(wo !== undefined ? { wo } : {}) });
  }
  return { lines, diagnostics };
}
