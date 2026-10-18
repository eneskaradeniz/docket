import { describe, expect, it } from 'vitest';

import { DOCKET_VERDICT_TOOL, verdictAskDetailOf } from './verdict-ask-detail';

describe('verdictAskDetailOf', () => {
  it('names the verdict tool as the MCP server prefix spells it', () => {
    expect(DOCKET_VERDICT_TOOL).toBe('mcp__docket-pages__submit_verdict');
  });

  it('reads the verdict, the trimmed summary and the pointer count — never the pointers', () => {
    const detail = verdictAskDetailOf({ verdict: 'approve', summary: '  Looks right.  ', pointers: ['a.ts:1', 'b.ts:2-4'] });

    expect(detail).toEqual({ verdict: 'approve', summary: 'Looks right.', pointerCount: 2 });
    expect(JSON.stringify(detail)).not.toContain('a.ts');
  });

  it('accepts a reject with no pointers', () => {
    expect(verdictAskDetailOf({ verdict: 'reject', summary: 'Tests missing.', pointers: [] })).toEqual({
      verdict: 'reject',
      summary: 'Tests missing.',
      pointerCount: 0,
    });
  });

  it('bounds how much of a long summary is carried on, leaving redaction and the card cut to the executor', () => {
    const detail = verdictAskDetailOf({ verdict: 'approve', summary: 'x'.repeat(5000), pointers: ['a.ts:1'] });

    expect(detail?.summary.length).toBe(2000);
  });

  it('answers nothing for input that is missing or malformed', () => {
    expect(verdictAskDetailOf(undefined)).toBeUndefined();
    expect(verdictAskDetailOf('approve')).toBeUndefined();
    expect(verdictAskDetailOf([])).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'maybe', summary: 's', pointers: [] })).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'approve', summary: 7, pointers: [] })).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'approve', summary: '   ', pointers: [] })).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'approve', summary: 's' })).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'approve', summary: 's', pointers: 'a.ts:1' })).toBeUndefined();
    expect(verdictAskDetailOf({ verdict: 'approve', summary: 's', pointers: ['a.ts:1', 3] })).toBeUndefined();
  });
});
