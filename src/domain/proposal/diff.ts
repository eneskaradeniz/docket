export type DiffLineKind = 'same' | 'add' | 'remove';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface LineDiff {
  readonly lines: readonly DiffLine[];
  /** True when a side exceeded DIFF_LINE_LIMIT and the diff collapsed to one block per side. */
  readonly truncated: boolean;
}

/** Above this many lines on either side the quadratic table is not built. */
export const DIFF_LINE_LIMIT = 5_000;

// One final newline terminates the last line rather than starting an empty one, so "a\n" and "a"
// have the same lines; an empty text has none.
const splitLines = (text: string): readonly string[] => {
  if (text === '') return [];
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.slice(0, -1) : parts;
};

/**
 * Line-based diff by longest common subsequence. Deterministic: when removing and adding are
 * equally good the removal comes first. Past the size limit it gives up on alignment instead of
 * spending quadratic memory, and says so.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > DIFF_LINE_LIMIT || b.length > DIFF_LINE_LIMIT) {
    const lines: DiffLine[] = [];
    if (a.length > 0) lines.push({ kind: 'remove', text: before });
    if (b.length > 0) lines.push({ kind: 'add', text: after });
    return { lines, truncated: true };
  }

  // The common head and tail never need the table; it only covers the changed middle.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  const width = m + 1;
  // lcs[i * width + j] = length of the LCS of midA[i..] and midB[j..]; at most 5 000, so 16 bits.
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const x = midA[i] ?? '';
    const y = midB[j] ?? '';
    if (x === y) {
      lines.push({ kind: 'same', text: x });
      i += 1;
      j += 1;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      lines.push({ kind: 'remove', text: x });
      i += 1;
    } else {
      lines.push({ kind: 'add', text: y });
      j += 1;
    }
  }
  for (; i < n; i += 1) lines.push({ kind: 'remove', text: midA[i] ?? '' });
  for (; j < m; j += 1) lines.push({ kind: 'add', text: midB[j] ?? '' });
  for (const text of a.slice(a.length - tail)) lines.push({ kind: 'same', text });
  return { lines, truncated: false };
}
