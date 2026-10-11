// new-project-panel.test.ts — the "Proje ekle" panel's pure standing (U-182, U-183): it opens over
// whichever route is current, stamps how it was opened, and every way out is the one close.
import { describe, expect, it } from 'vitest';

import { focusRestoredOnClose } from './search-palette';
import { CLOSED_NEW_PROJECT_PANEL, newProjectPanelReducer } from './new-project-panel';

describe('newProjectPanelReducer', () => {
  it('U-182: the panel boots closed and an open stamps the origin', () => {
    expect(CLOSED_NEW_PROJECT_PANEL.open).toBe(false);
    const opened = newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'open', origin: 'pointer' });
    expect(opened).toStrictEqual({ open: true, origin: 'pointer' });
  });

  it('U-182: a second open changes nothing — the first opener keeps its focus decision', () => {
    const opened = newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'open', origin: 'pointer' });
    expect(newProjectPanelReducer(opened, { type: 'open', origin: 'keyboard' })).toBe(opened);
  });

  it('U-183: close and Esc both close, and closing a closed panel is nothing', () => {
    const opened = newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'open', origin: 'keyboard' });
    expect(newProjectPanelReducer(opened, { type: 'close' }).open).toBe(false);
    expect(newProjectPanelReducer(opened, { type: 'escape' }).open).toBe(false);
    expect(newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'close' })).toBe(CLOSED_NEW_PROJECT_PANEL);
  });

  it('U-183: a closed panel keeps the origin, so the close can return focus by the palette rule', () => {
    const keyboard = newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'open', origin: 'keyboard' });
    const pointer = newProjectPanelReducer(CLOSED_NEW_PROJECT_PANEL, { type: 'open', origin: 'pointer' });
    expect(focusRestoredOnClose(newProjectPanelReducer(keyboard, { type: 'close' }).origin)).toBe(true);
    expect(focusRestoredOnClose(newProjectPanelReducer(pointer, { type: 'close' }).origin)).toBe(false);
  });
});
