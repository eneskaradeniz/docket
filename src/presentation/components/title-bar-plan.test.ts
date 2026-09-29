import { describe, expect, it } from 'vitest';

import { titleBarFor } from './title-bar-plan';

describe('titleBarFor', () => {
  it("darwin's navigator platforms get the bar, the traffic lights' 92px lane and both bar buttons — home first, then search", () => {
    expect(titleBarFor('MacIntel')).toStrictEqual({ visible: true, leftInsetPx: 92, buttons: ['home', 'search'] });
    expect(titleBarFor('macOS')).toStrictEqual({ visible: true, leftInsetPx: 92, buttons: ['home', 'search'] });
  });

  it('every other platform keeps the native frame — no bar, no dangling inset, no bar buttons', () => {
    expect(titleBarFor('Win32')).toStrictEqual({ visible: false, leftInsetPx: 0, buttons: [] });
    expect(titleBarFor('Linux x86_64')).toStrictEqual({ visible: false, leftInsetPx: 0, buttons: [] });
    expect(titleBarFor('')).toStrictEqual({ visible: false, leftInsetPx: 0, buttons: [] });
  });
});
