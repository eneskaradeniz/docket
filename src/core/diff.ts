// src/core/diff.ts — pure line diff for the write-permission card's peek (WO-0031c). The composition
// root reads the OLD file (fs stays main-side); core diffs the texts and returns STRUCTURE — add/del/ctx
// lines plus how many were dropped by the caps — never display strings (labels render it).
//
// BUDGETS (operator fix, pre-merge): the LCS table is O(n·m) — an unbounded input pair would spend
// unbounded time/memory BEFORE the output cap ever applies. Both sides are therefore cut to
// `inputBudget` lines (the dropped lines count into `truncated` — honest, not silent), and each line
// is sliced to `lineCharCap` for display (a 1 MB minified line must not ride the IPC and the DOM).
export interface DiffLine {
  op: 'add' | 'del' | 'ctx';
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  truncated: number;
}

export const DIFF_INPUT_LINE_BUDGET = 2000;
export const DIFF_LINE_CHAR_CAP = 400;

const splitLines = (text: string): string[] => (text === '' ? [] : text.split(/\r?\n/));

/**
 * A longest-common-subsequence line diff, double-capped: INPUT (each side ≤ inputBudget lines — the
 * remainder counts as truncated) and OUTPUT (≤ maxLines diff lines). Context lines around changes are
 * kept so the peek reads like a diff, not two file dumps.
 */
export function unifiedDiffLines(
  oldText: string,
  newText: string,
  maxLines = 40,
  inputBudget = DIFF_INPUT_LINE_BUDGET,
): LineDiff {
  const aFull = splitLines(oldText);
  const bFull = splitLines(newText);
  // Input budget: diff only the heads; the dropped tails are reported, never guessed at.
  const dropped = Math.max(0, aFull.length - inputBudget) + Math.max(0, bFull.length - inputBudget);
  const a = aFull.slice(0, inputBudget).map((l) => (l.length > DIFF_LINE_CHAR_CAP ? l.slice(0, DIFF_LINE_CHAR_CAP) : l));
  const b = bFull.slice(0, inputBudget).map((l) => (l.length > DIFF_LINE_CHAR_CAP ? l.slice(0, DIFF_LINE_CHAR_CAP) : l));

  // LCS table (fine for capped, human-scale peeks; the budget is what makes this bounded).
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      all.push({ op: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      all.push({ op: 'del', text: a[i]! });
      i++;
    } else {
      all.push({ op: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < a.length) all.push({ op: 'del', text: a[i++]! });
  while (j < b.length) all.push({ op: 'add', text: b[j++]! });

  // No changes at all → nothing to peek at (identical texts, or a CRLF-only difference).
  if (!all.some((l) => l.op !== 'ctx')) return { lines: [], truncated: 0 };

  const shown = all.length <= maxLines ? all.length : maxLines;
  return { lines: all.slice(0, shown), truncated: dropped + (all.length - shown) };
}
