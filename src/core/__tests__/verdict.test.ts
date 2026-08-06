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
