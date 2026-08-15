import { describe, expect, it } from 'vitest';
import { parseVerdict } from '../verdict';

describe('parseVerdict', () => {
  it('returns unknown for an empty string', () => {
    expect(parseVerdict('')).toEqual({ outcome: 'unknown' });
  });

  it('returns unknown when no VERDICT: line appears', () => {
    expect(parseVerdict('The report looks good.')).toEqual({ outcome: 'unknown' });
  });

  it('parses VERDICT: proceed', () => {
    expect(parseVerdict('Review…\n\nVERDICT: proceed')).toEqual({ outcome: 'proceed' });
  });

  it('parses VERDICT: proceed case-insensitively + tolerates trailing whitespace', () => {
    expect(parseVerdict('verdict: PROCEED   ')).toEqual({ outcome: 'proceed' });
  });

  it('parses VERDICT: revise with a REASON block', () => {
    const t = 'Review…\nVERDICT: revise\nREASON:\nThe tests are missing.\nPlease add them.';
    expect(parseVerdict(t)).toEqual({ outcome: 'revise', reason: 'The tests are missing.\nPlease add them.' });
  });

  it('parses VERDICT: revise with no REASON → empty reason', () => {
    expect(parseVerdict('VERDICT: revise')).toEqual({ outcome: 'revise', reason: '' });
  });

  it('selects the LAST VERDICT line when two appear (draft superseded)', () => {
    const t = 'VERDICT: revise\nREASON: draft\n\n…on second thought…\nVERDICT: proceed';
    expect(parseVerdict(t)).toEqual({ outcome: 'proceed' });
  });

  it('ignores a VERDICT word that is not a VERDICT: line', () => {
    expect(parseVerdict('The verdict is unclear here.')).toEqual({ outcome: 'unknown' });
  });
});

describe('parseVerdict — KARAR alias (WO-0029 / B20)', () => {
  it('KARAR: devam → proceed (the run-breaking case)', () => {
    expect(parseVerdict('Inceleme tamam.\n\nKARAR: devam')).toEqual({ outcome: 'proceed' });
  });
  it('KARAR: revize + GEREKÇE: → revise with reason', () => {
    expect(parseVerdict('KARAR: revize\nGEREKÇE:\nTestler eksik.')).toEqual({ outcome: 'revise', reason: 'Testler eksik.' });
  });
  it('KARAR: devam et → proceed (spaced variant)', () => {
    expect(parseVerdict('KARAR: devam et')).toEqual({ outcome: 'proceed' });
  });
  it('VERDICT: stays canonical and wins over a draft KARAR', () => {
    expect(parseVerdict('KARAR: revize\n\nVERDICT: proceed')).toEqual({ outcome: 'proceed' });
  });
});
