// src/core/usage.ts — the usage screen's read model (WO-0054), the deriveRoadmapView shape:
// the store adapter feeds FACTS (month-windowed session_usage rows WITHOUT num_turns/duration_*
// — the never-summed legs are not even selected — plus unwindowed session facts and order
// facts); this module derives the whole view. PURE: no SQL, no React, no Node, no clock (the
// window arrives precomputed — the store calls monthWindow(new Date()) once, the monthSpendRow
// idiom). Model ids and role names cross as DATA (ADR-0006's WO-0052 addendum). Money sums are
// cent-exact; absent figures stay absent — never zeros (TD-030 lineage).
import type { ModelUsageLine, SessionRole, WorkOrderId } from './types';

/** One month-windowed `session_usage` row. `num_turns`/`duration_ms`/`duration_api_ms` are
 *  deliberately ABSENT from this read: they are leg-cumulative and never summed by Docket —
 *  the guarantee is structural (the fact cannot carry them), not conventional. */
export interface UsageFactRow {
  workOrderId: WorkOrderId | null; // NULL = a ✦ draft session's row (the owner pair)
  providerSessionId: string; // the core-side join key to the session fact
  at: string; // the result's ISO receive stamp — the window key
  tokensIn: number; // fresh input (the summable half)
  tokensOut: number;
  usdDelta: number; // the per-turn delta — the ONLY money this read sums
  cacheRead?: number; // NULL-hydrated absent, never 0
  cacheCreation?: number;
  model?: string; // the single-model shortcut (NULL for 0-or-multi)
  modelUsage?: ModelUsageLine[]; // the verbatim per-model split — wins over `model`
}

/** One session row, UNWINDOWED — the join side + the honesty probes. No transcript, no
 *  pendingNotes: this read lifts nothing it does not render. */
export interface UsageSessionFact {
  providerSessionId: string;
  workOrderId: WorkOrderId | null; // null = the ✦ draft session row
  role?: SessionRole; // absent = the row's own column is NULL (legacy vintage)
  costUsd?: number; // the session's own observed total — the unledgeredCount probe
  startedAt?: string; // the in-month probe's key (ISO lexicographic, the monthSpendRow precedent)
  ctx?: { usedTokens: number; maxTokens: number }; // the LATEST checkpoint — one reading, never
  // a curve (WO-0052 D7's floor ruling stands)
}

/** One work order's view-relevant fact (the title is the only render field; the spend derives
 *  from the rows, never from a stored cost — the work_order cost_* columns are inert, TD-023). */
export interface UsageOrderFact {
  id: WorkOrderId;
  title: string;
}

export interface DeriveUsageInput {
  window: { startIso: string; endIso: string }; // the UTC calendar month
  rows: UsageFactRow[];
  sessions: UsageSessionFact[];
  orders: UsageOrderFact[];
}

export interface UsageRoleBucket {
  role: SessionRole;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  sessionCount: number;
  pct: number; // of the totals' usd — the mockup's «%75»
}

export interface UsageModelBucket {
  model?: string; // ABSENT = the modelUnknown bucket (0-model results; rendered last)
  usd: number;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageCacheSplit {
  freshIn: number; // Σ tokens_in over ALL rows (cache reads are the real mass, not fresh input)
  cacheRead: number;
  cacheCreation: number;
  hasCacheFigures: boolean; // gates the cache card — a cache-less month renders none
}

export interface UsageOrderRow {
  id: WorkOrderId;
  title: string;
  usd: number;
  sessionCount: number;
}

export interface UsageDraftRow {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  sessionCount: number;
}

export interface UsageSessionRow {
  providerSessionId: string;
  workOrderId: WorkOrderId | null; // null renders the ✦ draft marker, never a raw null
  role?: SessionRole; // absent → the role-unknown voice
  usd: number;
  tokensIn: number;
  tokensOut: number;
  turnCount: number; // the OBSERVED-RESULT COUNT (rows) — never num_turns
  lastAt: string; // the latest row `at` — the list's sort key
  ctxPct?: number; // round(used/max·100), present only when a checkpoint exists
  ctx?: { usedTokens: number; maxTokens: number }; // the readout's denominator half
}

export interface WorkspaceUsageView {
  empty: boolean; // ZERO windowed rows (draft rows are rows)
  totals: { usd: number; tokensIn: number; tokensOut: number };
  byRole: UsageRoleBucket[]; // usd desc; a role with zero rows is ABSENT
  byModel: UsageModelBucket[]; // usd desc; the unknown bucket last; model ids verbatim
  hasModelSplit: boolean; // ≥1 row carried modelUsage lines — the models note's precondition
  cache: UsageCacheSplit; // hasCacheFigures gates the card
  workOrders: UsageOrderRow[]; // usd desc; zero-spend WOs absent
  draft?: UsageDraftRow; // present ONLY when draft rows exist (the 1832 un-pin's read half)
  sessions: UsageSessionRow[]; // lastAt desc
  unledgeredCount: number; // in-month costed sessions with an empty per-turn ledger; 0 = false
  roleUnknownCount: number; // rows whose session/role join fails (the owner is gone); 0 = false
}

// Cent-round the money sums (the roadmap pattern, src/core/roadmap.ts:196-198 — module-private
// there; duplicated here with its origin named rather than extracted, per the plan's D2.9).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The cent-half tolerance (the round2 epsilon idiom — `warnThresholdUsd`'s `1e-9` guard serves
 *  the same discipline in budget.ts): a difference at or below half a cent is rounding dust,
 *  not a divergence. */
const CENT_HALF = 0.005;

/** The head-vs-breakdown basis divergence (plan D2.1): true when the budget view's month figure
 *  (`session.cost_usd` over `started_at`, WO-0047's own basis) and the ledger's windowed total
 *  (`usd_delta` over `at`) disagree by more than half a cent. The head's qualifier line renders
 *  ONLY on true — a narration, never a reconciliation, never a third figure. */
export function basisDiverges(budgetMonthUsd: number, ledgerTotalsUsd: number): boolean {
  return Math.abs(budgetMonthUsd - ledgerTotalsUsd) > CENT_HALF;
}

/** The models-block split note's predicate (plan D2.2): true when a provider per-model split
 *  exists AND its Σ does not total to the row-scalar total within half a cent — the provider's
 *  own accounting on two channels, narrated as exactly that, never corrected by Docket. */
export function modelSplitDiverges(view: WorkspaceUsageView): boolean {
  if (!view.hasModelSplit) return false;
  const byModelUsd = view.byModel.reduce((s, b) => s + b.usd, 0);
  return Math.abs(byModelUsd - view.totals.usd) > CENT_HALF;
}

/**
 * Compose the view. The window filters the rows (`startIso <= at < endIso`, ISO strings compare
 * lexicographically — the monthSpendRow shape); every aggregation is core TS (TD-058 stays
 * closed — the model_usage JSON never enters SQL). byModel is a PARTITION of rows through the
 * finest available split (modelUsage lines → `model` → the unknown bucket), so a multi-model
 * row's own scalars land once, in the totals; byRole joins each row's session fact by
 * `providerSessionId` (a row whose join fails paints no bucket and raises roleUnknownCount);
 * workOrders/draft group by the row's own `work_order_id` — the ✦ draft rows are NON-ADDITIVE
 * with the role buckets (two views of one row set, no combined figure anywhere).
 */
export function deriveUsageView(input: DeriveUsageInput): WorkspaceUsageView {
  const { window: win, rows, sessions, orders } = input;
  const inWindow = rows.filter((r) => r.at >= win.startIso && r.at < win.endIso);
  const factByPsid = new Map(sessions.map((s) => [s.providerSessionId, s] as const));
  const orderById = new Map(orders.map((o) => [o.id, o] as const));

  let usd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead: number | undefined;
  let cacheCreation: number | undefined;
  let hasModelSplit = false;
  const roleAcc = new Map<SessionRole, { usd: number; tokensIn: number; tokensOut: number; psids: Set<string> }>();
  const modelAcc = new Map<string, { usd: number; tokensIn: number; tokensOut: number }>();
  let unknownModel: { usd: number; tokensIn: number; tokensOut: number } | undefined;
  const orderAcc = new Map<WorkOrderId, { usd: number; psids: Set<string> }>();
  let draftAcc: { usd: number; tokensIn: number; tokensOut: number; psids: Set<string> } | undefined;
  const sessionAcc = new Map<
    string,
    { first: UsageFactRow; usd: number; tokensIn: number; tokensOut: number; count: number; lastAt: string }
  >();

  const modelBucket = (model: string | undefined): { usd: number; tokensIn: number; tokensOut: number } => {
    if (model === undefined) {
      unknownModel ??= { usd: 0, tokensIn: 0, tokensOut: 0 };
      return unknownModel;
    }
    let b = modelAcc.get(model);
    if (!b) {
      b = { usd: 0, tokensIn: 0, tokensOut: 0 };
      modelAcc.set(model, b);
    }
    return b;
  };

  for (const r of inWindow) {
    usd += r.usdDelta;
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    if (r.cacheRead !== undefined) cacheRead = (cacheRead ?? 0) + r.cacheRead;
    if (r.cacheCreation !== undefined) cacheCreation = (cacheCreation ?? 0) + r.cacheCreation;

    // byModel — the row partition (D2.2): the finest available split exactly once
    if (r.modelUsage?.length) {
      hasModelSplit = true;
      for (const line of r.modelUsage) {
        const b = modelBucket(line.model);
        b.usd += line.usd;
        b.tokensIn += line.tokensIn;
        b.tokensOut += line.tokensOut;
      }
    } else {
      const b = modelBucket(r.model);
      b.usd += r.usdDelta;
      b.tokensIn += r.tokensIn;
      b.tokensOut += r.tokensOut;
    }

    // byRole — the session join (D2.3); a row whose join/role fails paints no bucket
    const fact = factByPsid.get(r.providerSessionId);
    const role = fact?.role;
    if (role !== undefined) {
      let b = roleAcc.get(role);
      if (!b) {
        b = { usd: 0, tokensIn: 0, tokensOut: 0, psids: new Set<string>() };
        roleAcc.set(role, b);
      }
      b.usd += r.usdDelta;
      b.tokensIn += r.tokensIn;
      b.tokensOut += r.tokensOut;
      b.psids.add(r.providerSessionId);
    }

    // workOrders / draft — the row's own owner key (D2.5); the draft is NON-ADDITIVE (Ruling 3)
    if (r.workOrderId === null) {
      draftAcc ??= { usd: 0, tokensIn: 0, tokensOut: 0, psids: new Set<string>() };
      draftAcc.usd += r.usdDelta;
      draftAcc.tokensIn += r.tokensIn;
      draftAcc.tokensOut += r.tokensOut;
      draftAcc.psids.add(r.providerSessionId);
    } else {
      let b = orderAcc.get(r.workOrderId);
      if (!b) {
        b = { usd: 0, psids: new Set<string>() };
        orderAcc.set(r.workOrderId, b);
      }
      b.usd += r.usdDelta;
      b.psids.add(r.providerSessionId);
    }

    // sessions (D2.7) — grouped from the WINDOWED rows only; turnCount is the row COUNT
    let s = sessionAcc.get(r.providerSessionId);
    if (!s) {
      s = { first: r, usd: 0, tokensIn: 0, tokensOut: 0, count: 0, lastAt: r.at };
      sessionAcc.set(r.providerSessionId, s);
    }
    s.usd += r.usdDelta;
    s.tokensIn += r.tokensIn;
    s.tokensOut += r.tokensOut;
    s.count += 1;
    if (r.at > s.lastAt) s.lastAt = r.at;
  }

  const totals = { usd: round2(usd), tokensIn, tokensOut };

  const byRole: UsageRoleBucket[] = [...roleAcc.entries()]
    .map(([bucketRole, b]) => ({
      role: bucketRole,
      usd: round2(b.usd),
      tokensIn: b.tokensIn,
      tokensOut: b.tokensOut,
      sessionCount: b.psids.size,
      pct: totals.usd > 0 ? Math.round((b.usd / usd) * 100) : 0,
    }))
    .sort((a, b) => b.usd - a.usd);

  const byModel: UsageModelBucket[] = [...modelAcc.entries()]
    .map(([model, b]) => ({ model, usd: round2(b.usd), tokensIn: b.tokensIn, tokensOut: b.tokensOut }))
    .sort((a, b) => b.usd - a.usd);
  if (unknownModel) {
    byModel.push({
      model: undefined, // the modelUnknown bucket renders LAST regardless of its usd
      usd: round2(unknownModel.usd),
      tokensIn: unknownModel.tokensIn,
      tokensOut: unknownModel.tokensOut,
    });
  }

  const cache: UsageCacheSplit = {
    freshIn: tokensIn,
    cacheRead: cacheRead ?? 0,
    cacheCreation: cacheCreation ?? 0,
    hasCacheFigures: cacheRead !== undefined || cacheCreation !== undefined,
  };

  const workOrders: UsageOrderRow[] = [...orderAcc.entries()]
    .filter(([id, b]) => orderById.has(id) && round2(b.usd) !== 0) // unknown order → totals only; zero-spend → absent
    .map(([id, b]) => ({ id, title: orderById.get(id)!.title, usd: round2(b.usd), sessionCount: b.psids.size }))
    .sort((a, b) => b.usd - a.usd);

  const draft: UsageDraftRow | undefined = draftAcc
    ? {
        usd: round2(draftAcc.usd),
        tokensIn: draftAcc.tokensIn,
        tokensOut: draftAcc.tokensOut,
        sessionCount: draftAcc.psids.size,
      }
    : undefined;

  const sessionRows: UsageSessionRow[] = [...sessionAcc.values()]
    .map((s) => {
      const f = factByPsid.get(s.first.providerSessionId);
      const ctx = f?.ctx;
      const ctxPct = ctx && ctx.maxTokens > 0 ? Math.round((ctx.usedTokens / ctx.maxTokens) * 100) : undefined;
      return {
        providerSessionId: s.first.providerSessionId,
        workOrderId: s.first.workOrderId,
        ...(f?.role !== undefined ? { role: f.role } : {}),
        usd: round2(s.usd),
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        turnCount: s.count,
        lastAt: s.lastAt,
        ...(ctxPct !== undefined ? { ctxPct } : {}),
        ...(ctx ? { ctx } : {}),
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

  // the pre-WO-0052 vintage: spend observed at the session level, per-turn ledger empty
  const windowedPsids = new Set(inWindow.map((r) => r.providerSessionId));
  let unledgeredCount = 0;
  for (const f of sessions) {
    if (f.costUsd === undefined) continue;
    if (f.startedAt === undefined || f.startedAt < win.startIso || f.startedAt >= win.endIso) continue;
    if (windowedPsids.has(f.providerSessionId)) continue;
    unledgeredCount += 1;
  }

  let roleUnknownCount = 0;
  for (const r of inWindow) {
    if (factByPsid.get(r.providerSessionId)?.role === undefined) roleUnknownCount += 1;
  }

  return {
    empty: inWindow.length === 0,
    totals,
    byRole,
    byModel,
    hasModelSplit,
    cache,
    workOrders,
    ...(draft ? { draft } : {}),
    sessions: sessionRows,
    unledgeredCount,
    roleUnknownCount,
  };
}
