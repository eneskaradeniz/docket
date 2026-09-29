import { describe, expect, it } from 'vitest';

import { titleBarFor } from './title-bar-plan';

describe('titleBarFor', () => {
  it("darwin's navigator platforms get the bar, with the traffic lights' 92px lane reserved", () => {
    expect(titleBarFor('MacIntel')).toStrictEqual({ visible: true, leftInsetPx: 92 });
    expect(titleBarFor('macOS')).toStrictEqual({ visible: true, leftInsetPx: 92 });
  });

  it('every other platform keeps the native frame — no bar, no dangling inset', () => {
    expect(titleBarFor('Win32')).toStrictEqual({ visible: false, leftInsetPx: 0 });
    expect(titleBarFor('Linux x86_64')).toStrictEqual({ visible: false, leftInsetPx: 0 });
    expect(titleBarFor('')).toStrictEqual({ visible: false, leftInsetPx: 0 });
  });
});
