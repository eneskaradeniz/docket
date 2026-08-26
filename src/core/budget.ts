// src/core/budget.ts — the workspace month-spend threshold, PURE (WO-0047).
//
// The budget gate's arithmetic and nothing else: the calendar-month window and the
// ok/warn/hard_stop status derivation. No SQL, no display strings, no Node builtins — the store
// adapter feeds it numbers (the month sum over session rows), the pipeline consumes the verdict,
// the UI consumes the view. Paperclip validated the shape (budgets.ts:66-76): warn =
// ceil(cap·pct/100), stop = cap; the window is a pure UTC calendar month. ISO strings compare
// lexicographically, so the window is a plain string range on `started_at` — no date parsing in
// SQL. Solo scale (the order's ruling): ONE threshold set per workspace, calendar-month window,
// warn as a PERCENT of the cap (operator ruling 2026-08-26; default 80).

/** The warn ratio's default when the stored threshold carries none (Paperclip's default). */
export const DEFAULT_WARN_PERCENT = 80;

export interface BudgetThreshold {
  /** The hard cap in USD. `<= 0` reads as unconfigured — the gate fails open. */
  capUsd: number;
  /** The warn level as a percent of the cap (1-100); ceil(cap·pct/100) is the warn line. */
  warnPercent: number;
}

export type BudgetStatus = 'ok' | 'warn' | 'hard_stop';

/** The UTC calendar month containing `now` as an exclusive-end ISO string range on started_at. */
export function monthWindow(now: Date): { startIso: string; endIso: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    startIso: new Date(Date.UTC(y, m, 1)).toISOString(),
    endIso: new Date(Date.UTC(y, m + 1, 1)).toISOString(), // month 12 rolls the year itself
  };
}

/** The warn line: the smallest cent-exact USD amount that warns at this percent — Paperclip's
 *  integer-cents ceil, translated to USD floats with an epsilon so a float artifact
 *  (4.35·80 = 348.00000000000006) cannot buy a phantom cent. */
export function warnThresholdUsd(capUsd: number, warnPercent: number): number {
  return Math.ceil(capUsd * warnPercent - 1e-9) / 100;
}

export function budgetStatus(observedUsd: number, threshold: BudgetThreshold): BudgetStatus {
  if (!(threshold.capUsd > 0)) return 'ok'; // unconfigured (or nonsense) cap → no gate
  if (observedUsd >= threshold.capUsd) return 'hard_stop';
  if (observedUsd >= warnThresholdUsd(threshold.capUsd, threshold.warnPercent)) return 'warn';
  return 'ok';
}

/** The pure view every budget surface renders (composed once per read, never per card): the
 *  threshold + the month's observed sum + its honesty qualifier + the derived status. */
export interface WorkspaceBudgetView {
  threshold: BudgetThreshold;
  monthUsd: number;
  /** ≥1 in-window session row has NULL cost — the figure is "bilinen harcama" (the known-spend
   *  basis; unknown cost never counts toward the cap, the honest no-claim rule). */
  hasUnknown: boolean;
  status: BudgetStatus;
}

export function workspaceBudgetView(
  monthUsd: number,
  hasUnknown: boolean,
  threshold: BudgetThreshold,
): WorkspaceBudgetView {
  return { threshold, monthUsd, hasUnknown, status: budgetStatus(monthUsd, threshold) };
}

/** Parse an operator-typed amount accepting BOTH decimal separators (`,` and `.`) — the operator's
 *  keyboard, never the locale's opinion. NaN for anything that is not a plain non-negative decimal
 *  (signs, spaces, thousand separators, garbage); the CALLER owns the > 0 / > observed checks. */
export function parseAmount(text: string): number {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}
