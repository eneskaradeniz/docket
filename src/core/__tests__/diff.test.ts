import { describe, expect, it } from 'vitest';
import { unifiedDiffLines } from '../diff';

// WO-0031c — the diff peek behind a write-permission card: a pure line diff, capped, with structure
// (not display strings) so labels can render it. fs stays in the composition root; core sees text.
describe('unifiedDiffLines', () => {
  it('identical texts → no lines', () => {
    expect(unifiedDiffLines('a\nb', 'a\nb').lines).toEqual([]);
  });

  it('a pure insert', () => {
    const { lines } = unifiedDiffLines('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'add', text: 'b' },
      { op: 'ctx', text: 'c' },
    ]);
  });

  it('a pure delete', () => {
    const { lines } = unifiedDiffLines('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'ctx', text: 'c' },
    ]);
  });

  it('a replacement', () => {
    const { lines } = unifiedDiffLines('a\nold\nc', 'a\nnew\nc');
    expect(lines).toEqual([
      { op: 'ctx', text: 'a' },
      { op: 'del', text: 'old' },
      { op: 'add', text: 'new' },
      { op: 'ctx', text: 'c' },
    ]);
  });

  it('caps the output and reports how many lines were dropped', () => {
    const old = Array.from({ length: 100 }, (_, i) => `old${i}`).join('\n');
    const next = Array.from({ length: 100 }, (_, i) => `new${i}`).join('\n');
    const { lines, truncated } = unifiedDiffLines(old, next, 10);
    expect(lines).toHaveLength(10);
    expect(truncated).toBe(190); // 100 del + 100 add - 10 shown
  });

  it('caps the INPUT: oversized sides diff only their heads, the dropped tails count as truncated (operator fix)', () => {
    const old = Array.from({ length: 5000 }, (_, i) => `old${i}`).join('\n');
    const next = Array.from({ length: 5000 }, (_, i) => `new${i}`).join('\n');
    const { lines, truncated } = unifiedDiffLines(old, next, 10, 100);
    expect(lines).toHaveLength(10); // output still bounded
    // 100 old + 100 new diffed = 200 lines; 4900 + 4900 dropped by the input budget; 190 by the output cap
    expect(truncated).toBe(4900 + 4900 + 190);
  });

  it('slices pathologically long lines for display (a 1 MB minified line must not ride the DOM)', () => {
    const huge = 'x'.repeat(50_000);
    const { lines } = unifiedDiffLines('', huge);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text.length).toBe(400);
  });

  it('tolerates CRLF on the old side (editor artifacts)', () => {
    const { lines } = unifiedDiffLines('a\r\nb', 'a\nb');
    expect(lines).toEqual([]);
  });

  it('empty old text = a fresh file (all adds)', () => {
    const { lines } = unifiedDiffLines('', 'a\nb');
    expect(lines).toEqual([
      { op: 'add', text: 'a' },
      { op: 'add', text: 'b' },
    ]);
  });
});
