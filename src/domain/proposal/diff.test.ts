import { describe, expect, it } from 'vitest';
import { DIFF_LINE_LIMIT, diffLines } from './diff';

describe('diffLines', () => {
  it('R-73: classifies lines as same, add and remove in document order', () => {
    const out = diffLines('a\nb\nc\n', 'a\nx\nc\nd\n');
    expect(out.truncated).toBe(false);
    expect(out.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });

  it('R-73: identical inputs are all same', () => {
    const out = diffLines('a\nb\n', 'a\nb\n');
    expect(out.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ]);
  });

  it('R-73: empty inputs have no lines; an empty side is all add or all remove', () => {
    expect(diffLines('', '')).toEqual({ lines: [], truncated: false });
    expect(diffLines('', 'a\nb').lines).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
    expect(diffLines('a', '').lines).toEqual([{ kind: 'remove', text: 'a' }]);
  });

  it('R-73: one trailing newline does not make an extra line, a blank line does', () => {
    expect(diffLines('a\n', 'a').lines).toEqual([{ kind: 'same', text: 'a' }]);
    expect(diffLines('a\n', 'a\n\n').lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: '' },
    ]);
  });

  it('R-73: ties put removals before additions and the result is deterministic', () => {
    const first = diffLines('a\nb\n', 'c\nd\n');
    expect(first.lines.map((l) => l.kind)).toEqual(['remove', 'remove', 'add', 'add']);
    expect(diffLines('a\nb\n', 'c\nd\n')).toEqual(first);
  });

  it('R-73: above the line limit on either side each side collapses to one block and truncated is set', () => {
    const big = Array.from({ length: DIFF_LINE_LIMIT + 1 }, (_, i) => `l${i}`).join('\n');
    const out = diffLines(big, 'x\ny');
    expect(out.truncated).toBe(true);
    expect(out.lines).toEqual([
      { kind: 'remove', text: big },
      { kind: 'add', text: 'x\ny' },
    ]);
    const atLimit = Array.from({ length: DIFF_LINE_LIMIT }, (_, i) => `l${i}`).join('\n');
    expect(diffLines(atLimit, atLimit).truncated).toBe(false);
  });
});
