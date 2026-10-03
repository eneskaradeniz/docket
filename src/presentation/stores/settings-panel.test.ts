// stores/settings-panel.test.ts — the settings overlay's pure state: open/close and the origin
// the close's focus rule reads, the section menu and sub-page mechanics (U-28). The reducer carries
// no route — settings is an overlay over whatever route the operator is on, so "open leaves the
// route unchanged" holds by construction here and the journeys (J-6) prove it against the real shell.
import { listedCandidateCount } from './candidates';
import { describe, expect, it } from 'vitest';

import {
  CLOSED_SETTINGS_PANEL,
  SETTINGS_MENU,
  SETTINGS_SECTIONS,
  createCandidateDotStore,
  hasUnaddedCandidate,
  settingsPanelReducer,
  type CandidateDotSource,
} from './settings-panel';

describe('settingsPanelReducer', () => {
  it('open flips the panel open and carries how it was opened — the close reads the origin', () => {
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' })).toMatchObject({
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
    expect(closed).toMatchObject({ open: false, origin: 'pointer' });
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'close' })).toStrictEqual(CLOSED_SETTINGS_PANEL);
  });

  it('the state holds the open standing, the origin, the section and the sub-page — there is no route to change', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard' });
    expect(Object.keys(opened).sort()).toStrictEqual(['fineTune', 'open', 'origin', 'section', 'subPage', 'tab']);
  });
});

const candidate = (alreadyAdded: boolean, warnings: readonly ('env_overrides_login' | 'unreadable')[] = []) => ({
  alreadyAdded,
  warnings,
});

describe('settings sections (U-28)', () => {
  it('U-28: the menu has two groups in order — Çalışma then Uygulama — each with its sections in order', () => {
    expect(SETTINGS_MENU).toStrictEqual([
      { id: 'work', sections: ['accounts', 'roles', 'capabilities', 'providers'] },
      { id: 'app', sections: ['appearance', 'phone', 'update'] },
    ]);
    expect(SETTINGS_SECTIONS).toStrictEqual([
      'accounts',
      'roles',
      'capabilities',
      'providers',
      'appearance',
      'phone',
      'update',
    ]);
    expect(SETTINGS_SECTIONS).not.toContain('language');
  });

  it("U-28: opening without a named section lands on Hesaplar — the nav's Ayarlar row; Telefon names its own", () => {
    expect(settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' }).section).toBe('accounts');
    expect(
      settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer', section: 'phone' }).section,
    ).toBe('phone');
  });

  it('U-28: selecting a section moves the menu and drops any sub-page', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' });
    const sub = settingsPanelReducer(opened, { type: 'enterSubPage', id: 'acc-1' });
    expect(sub.subPage).toBe('acc-1');
    const moved = settingsPanelReducer(sub, { type: 'select', section: 'roles' });
    expect(moved).toMatchObject({ section: 'roles', subPage: null });
  });

  it('U-28: Esc leaves the sub-page first and closes the panel only on the next press', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard' });
    const sub = settingsPanelReducer(opened, { type: 'enterSubPage', id: 'role-1' });
    const afterFirst = settingsPanelReducer(sub, { type: 'escape' });
    expect(afterFirst).toMatchObject({ open: true, subPage: null, section: 'accounts' });
    expect(settingsPanelReducer(afterFirst, { type: 'escape' }).open).toBe(false);
  });

  it('U-28: a sub-page is not a history entry — closing clears it, and the back row leaves it', () => {
    const opened = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard' });
    const sub = settingsPanelReducer(opened, { type: 'enterSubPage', id: 'acc-1' });
    expect(settingsPanelReducer(sub, { type: 'leaveSubPage' }).subPage).toBeNull();
    const closed = settingsPanelReducer(sub, { type: 'close' });
    expect(closed.subPage).toBeNull();
    expect(settingsPanelReducer(closed, { type: 'open', origin: 'keyboard' }).subPage).toBeNull();
  });

  it('U-28: the Hesaplar dot and the Eklenmemiş list read one count — a dot shows exactly when the list has a row', () => {
    const facts = [
      [],
      [candidate(true)],
      [candidate(false, ['unreadable'])],
      [candidate(true), candidate(false)],
      [candidate(false, ['env_overrides_login'])],
    ];
    for (const entry of facts) {
      expect(hasUnaddedCandidate(entry)).toBe(listedCandidateCount(entry) > 0);
    }
    expect(hasUnaddedCandidate([])).toBe(false);
    expect(hasUnaddedCandidate([candidate(true)])).toBe(false);
    expect(hasUnaddedCandidate([candidate(false, ['unreadable'])])).toBe(true);
  });

  it('U-28: the dot store reads accounts.candidates and a failed query shows no dot', async () => {
    const reply: { value: unknown } = { value: [candidate(false)] };
    const source: CandidateDotSource = {
      query: (query) => {
        expect(query).toStrictEqual({ type: 'accounts.candidates' });
        return Promise.resolve(reply.value);
      },
    };
    const store = createCandidateDotStore(source);
    expect(store.dot()).toBe(false);
    await store.load();
    expect(store.dot()).toBe(true);
    reply.value = { ok: false, code: 'not_found' };
    await store.load();
    expect(store.dot()).toBe(false);
  });
});

describe('settings open targets (U-37)', () => {
  it('U-37: an open can name the sub-page, the editor tab and the role whose fine-tune opens', () => {
    expect(
      settingsPanelReducer(CLOSED_SETTINGS_PANEL, {
        type: 'open',
        origin: 'pointer',
        section: 'accounts',
        subPage: 'a-1',
        tab: 'limits',
      }),
    ).toMatchObject({ open: true, section: 'accounts', subPage: 'a-1', tab: 'limits', fineTune: null });
    expect(
      settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'keyboard', section: 'roles', fineTune: 'planner' }),
    ).toMatchObject({ section: 'roles', subPage: null, tab: null, fineTune: 'planner' });
  });

  it('U-37: an open panel follows a named target; leaving, selecting or closing clears the tab and the fine-tune', () => {
    const open = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer' });
    const moved = settingsPanelReducer(open, { type: 'open', origin: 'keyboard', section: 'accounts', subPage: 'a-2', tab: 'limits' });
    expect(moved).toMatchObject({ origin: 'pointer', subPage: 'a-2', tab: 'limits' });
    expect(settingsPanelReducer(moved, { type: 'leaveSubPage' })).toMatchObject({ subPage: null, tab: null });
    expect(settingsPanelReducer(moved, { type: 'select', section: 'roles' })).toMatchObject({ tab: null, fineTune: null });
    expect(settingsPanelReducer(moved, { type: 'close' })).toMatchObject({ open: false, tab: null, fineTune: null });
  });
});
