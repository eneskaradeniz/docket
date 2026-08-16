// src/core/diff.ts — pure line diff for the write-permission card's peek (WO-0031c). The composition
// root reads the OLD file (fs stays main-side); core diffs the texts and returns STRUCTURE — add/del/ctx
// lines plus how many were dropped by the cap — never display strings (labels render it).
export interface DiffLine {
  op: 'add' | 'del' | 'ctx';
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  truncated: number;
}

const splitLines = (text: string): string[] => (text === '' ? [] : text.split(/\r?\n/));

/**
 * A longest-common-subsequence line diff, capped. Context lines around changes are kept so the peek
 * reads like a diff, not two file dumps; when the cap cuts, `truncated` says how many lines were
 * dropped so the UI can say "… N satır" without guessing.
 */
export function unifiedDiffLines(oldText: string, newText: string, maxLines = 40): LineDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // LCS table (fine for capped, human-scale peeks; not for binary-scale inputs).
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

  if (all.length <= maxLines) return { lines: all, truncated: 0 };
  return { lines: all.slice(0, maxLines), truncated: all.length - maxLines };
}
