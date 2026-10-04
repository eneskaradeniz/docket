// components/account-groups.test.ts — U-45 as markup: the two collapsible sections AccountGroups
// draws over the same rows in the wizard's Hesaplar step and in Settings → Hesaplar — header
// buttons with aria-expanded and aria-controls, the closed section's summary with the lamp
// colours, rows hidden behind a closed header, and the flat list the Eklenmemiş group keeps.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { t } from '../labels/t';
import { SECTION_OPEN_INITIAL, groupAccountRows, toggleSection, type GroupProvider, type RowStanding } from '../stores/account-groups';
import { AccountGroups, type AccountRowView } from './account-groups';

const PROVIDERS: readonly GroupProvider[] = [
  { id: 'claude', name: 'Claude Code', installed: true },
  { id: 'codex', name: 'Codex', installed: true },
];

const row = (id: string, standing: RowStanding, providerId: string): AccountRowView => ({
  id,
  providerId,
  standing,
  label: id,
  billing: 'included',
  viaKey: false,
  path: `~/${id}`,
  host: null,
  status: { tone: 'dim', text: id },
});

const ALL_ROWS: readonly AccountRowView[] = [
  row('ok-1', 'ready', 'claude'),
  row('ok-2', 'ready', 'codex'),
  row('login-1', 'needsLogin', 'claude'),
  row('unverified-1', 'unverified', 'codex'),
];

interface RenderOptions {
  readonly rows?: readonly AccountRowView[];
  readonly locale?: 'tr' | 'en';
  /** Present = the sectioned list; absent = the flat list (Settings' Eklenmemiş). */
  readonly sections?: boolean;
  /** The wizard selects rows and Settings offers ✎ and Test et — the sectioned list keeps both. */
  readonly interactive?: boolean;
}

const html = ({ rows = ALL_ROWS, locale = 'tr', sections = true, interactive = false }: RenderOptions = {}): string =>
  renderToStaticMarkup(
    createElement(AccountGroups, {
      locale,
      groups: groupAccountRows(rows, PROVIDERS),
      markFor: () => null,
      nameOf: (group) => group.name ?? 'Asistan',
      ...(interactive ? { onToggle: () => undefined, onEdit: () => undefined, trailing: () => createElement('button', { type: 'button', 'data-test-button': '' }, 'Test et') } : {}),
      ...(sections ? { sections: { open: SECTION_OPEN_INITIAL, onToggle: () => undefined } } : {}),
    }),
  );

describe('AccountGroups sections (U-45)', () => {
  it('U-45: each header is a button with aria-expanded and aria-controls, a turning chevron, the name and "n hesap" — a real button, so Enter and Space toggle it', () => {
    const out = html();
    expect(out).toContain('<button type="button" id="accounts-section-found"');
    expect(out).toContain('aria-controls="accounts-section-found-body"');
    expect(out).toContain('<button type="button" id="accounts-section-failed"');
    expect(out).toContain('aria-controls="accounts-section-failed-body"');
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(out).toContain('Bulunanlar');
    expect(out).toContain('Hatalı ve bulunamayanlar');
    expect(out.match(/2 hesap/g)).toHaveLength(2);
    // The chevron turns: only the closed section's chevron sits rotated.
    expect(out.match(/-rotate-90/g)).toHaveLength(1);
  });

  it('U-45: Bulunanlar starts open, Hatalı ve bulunamayanlar starts closed and, while closed, shows its summary after the count with the status lamp colours', () => {
    const out = html();
    expect(out).toContain('<div id="accounts-section-found-body"');
    expect(out).not.toContain('id="accounts-section-found-body" hidden');
    expect(out).toContain('id="accounts-section-failed-body" hidden');
    expect(out).toContain('data-status-lamp="signal"');
    expect(out).toContain('1 giriş gerekli');
    expect(out).toContain('data-status-lamp="dim"');
    expect(out).toContain('1 doğrulanamadı');
  });

  it('U-45: each summary part is omitted at zero', () => {
    const onlyLogin = html({ rows: [row('ok-1', 'ready', 'claude'), row('login-1', 'needsLogin', 'claude')] });
    expect(onlyLogin).toContain('1 giriş gerekli');
    expect(onlyLogin).not.toContain('doğrulanamadı');
    const onlyUnverified = html({ rows: [row('ok-1', 'ready', 'claude'), row('unv-1', 'unverified', 'claude')] });
    expect(onlyUnverified).toContain('1 doğrulanamadı');
    expect(onlyUnverified).not.toContain('giriş gerekli');
  });

  it('U-45a: a Rezervde or Veri yok row renders in Bulunanlar; Hatalı ve bulunamayanlar holds only the failing rows', () => {
    const out = html({
      rows: [row('ok-1', 'ready', 'claude'), row('reserve-1', 'other', 'claude'), row('nodata-1', 'other', 'codex'), row('login-1', 'needsLogin', 'codex')],
    });
    const failedAt = out.indexOf('data-account-section="failed"');
    expect(failedAt).toBeGreaterThan(-1);
    expect(out.indexOf('data-account-row="reserve-1"')).toBeGreaterThan(-1);
    expect(out.indexOf('data-account-row="reserve-1"')).toBeLessThan(failedAt);
    expect(out.indexOf('data-account-row="nodata-1"')).toBeLessThan(failedAt);
    expect(out.indexOf('data-account-row="login-1"')).toBeGreaterThan(failedAt);
  });

  it('U-45: the open state is the screen\'s — a state the screen holds through "Yeniden tara" and re-renders draws exactly what the screen holds', () => {
    const flipped = toggleSection(toggleSection(SECTION_OPEN_INITIAL, 'found'), 'failed');
    const out = renderToStaticMarkup(
      createElement(AccountGroups, {
        locale: 'tr',
        groups: groupAccountRows(ALL_ROWS, PROVIDERS),
        markFor: () => null,
        nameOf: (group) => group.name ?? 'Asistan',
        sections: { open: flipped, onToggle: () => undefined },
      }),
    );
    expect(out).toContain('id="accounts-section-found-body" hidden');
    expect(out).toContain('<div id="accounts-section-failed-body"');
    // An open section carries no summary, and only the section the screen closed keeps a turned chevron.
    expect(out).not.toContain('giriş gerekli');
    expect(out).not.toContain('doğrulanamadı');
    expect(out.match(/-rotate-90/g)).toHaveLength(1);
  });

  it('U-45: an empty section is not drawn; an installed assistant with no account keeps its empty card inside Bulunanlar (U-42)', () => {
    const onlyFailed = html({ rows: [row('login-1', 'needsLogin', 'claude')] });
    expect(onlyFailed).toContain('data-account-section="failed"');
    expect(onlyFailed).toContain('data-account-section="found"');
    expect(onlyFailed).toContain('data-account-group="codex"');
    const onlyReady = html({ rows: [row('ok-1', 'ready', 'claude'), row('ok-2', 'ready', 'codex')] });
    expect(onlyReady).not.toContain('data-account-section="failed"');
  });

  it('U-45: the rows of a closed section are hidden and not focusable; inside the open one the groups, selection, ✎ and Test et are unchanged', () => {
    const out = html({ interactive: true });
    const panelAt = out.indexOf('id="accounts-section-failed-body" hidden');
    const rowAt = out.indexOf('data-account-row="login-1"');
    expect(panelAt).toBeGreaterThan(-1);
    expect(rowAt).toBeGreaterThan(panelAt);
    expect(out).toContain('data-account-group="claude"');
    expect(out).toContain('aria-label="Düzenle"');
    expect(out).toContain('data-test-button');
    expect(out).toContain('role="checkbox"');
  });

  it('U-45: the toolbar word and the section names read Taranan · Bulunanlar · Hatalı ve bulunamayanlar in tr, Scanned · Found · Failed or not found in en', () => {
    expect(t('tr', 'accountGroups.scanned')).toBe('Taranan');
    expect(t('en', 'accountGroups.scanned')).toBe('Scanned');
    expect(t('tr', 'accountGroups.found')).toBe('Bulunanlar');
    expect(t('en', 'accountGroups.found')).toBe('Found');
    expect(t('tr', 'accountGroups.failed')).toBe('Hatalı ve bulunamayanlar');
    expect(t('en', 'accountGroups.failed')).toBe('Failed or not found');
    expect(html({ locale: 'en' })).toContain('Failed or not found');
  });

  it("U-45: without sections the list stays one flat run — Settings' Eklenmemiş list is unchanged", () => {
    const flat = html({ sections: false });
    expect(flat).toContain('data-account-groups');
    expect(flat).not.toContain('data-account-section');
    expect(flat).not.toContain('aria-expanded');
  });
});
