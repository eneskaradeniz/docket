// stores/settings-panel.test.ts — the settings overlay's pure state: open/close and the origin
// the close's focus rule reads. The reducer carries no route — settings is an overlay over
// whatever route the operator is on, so "open leaves the route unchanged" holds by construction
// here and the journeys (J-6) prove it against the real shell.
import { describe, expect, it } from 'vitest';

import { CLOSED_SETTINGS_PANEL, settingsPanelReducer } from './settings-panel';

describe('settingsPanelReducer', () => {
  it('open flips the panel open and carries how it was opened — the close reads the origin', () => {
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' })).toStrictEqual({
      open: true,
      origin: 'pointer',
    });
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard' }).origin).toBe(
      'keyboard',
    );
  });

  it('open twice is idempotent — an open panel keeps its standing and is not re-stamped', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' });
    expect(settingsPanelReducer(opened, { type: 'open', origin: 'keyboard' })).toStrictEqual(opened);
  });

  it('close flips open off and keeps the origin; a close on a closed panel changes nothing', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' });
    const closed = settingsPanelReducer(opened, { type: 'close' });
    expect(closed).toStrictEqual({ open: false, origin: 'pointer' });
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'close' })).toStrictEqual(CLOSED_SETTINGS_PANEL);
  });

  it('the state holds only the open standing and the origin — there is no route to change', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard' });
    expect(Object.keys(opened).sort()).toStrictEqual(['open', 'origin']);
  });
});
