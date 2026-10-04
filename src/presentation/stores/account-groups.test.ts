import { describe, expect, it } from 'vitest';

import {
  SECTION_OPEN_INITIAL,
  billingTag,
  billingTagKey,
  groupAccountRows,
  groupTotals,
  sectionSummary,
  splitSections,
  spendsMoney,
  toggleSection,
  type GroupProvider,
  type RowStanding,
} from './account-groups';

const PROVIDERS: readonly GroupProvider[] = [
  { id: 'claude', name: 'Claude Code', installed: true },
  { id: 'codex', name: 'Codex', installed: true },
  { id: 'agy', name: 'Antigravity', installed: true },
  { id: 'gone', name: 'Gone', installed: false },
];

describe('account groups (U-41)', () => {
  it('U-41: the billing tag reads the billing view, with "anahtarla" only on an included account that rides a key', () => {
    expect(billingTag('included', false)).toEqual({ key: 'accountGroups.billing.sub', tone: 'plain' });
    expect(billingTag('included', true)).toEqual({ key: 'accountGroups.billing.subKey', tone: 'plain' });
    expect(billingTag('metered', false)).toEqual({ key: 'accountGroups.billing.payg', tone: 'warn' });
    // A key does not make a metered or unknown account a subscription.
    expect(billingTag('metered', true).key).toBe('accountGroups.billing.payg');
    expect(billingTag('unknown', true)).toEqual({ key: 'accountGroups.billing.unknown', tone: 'warn' });
    expect(billingTagKey('unknown', false)).toBe('accountGroups.billing.unknown');
    expect(spendsMoney('included')).toBe(false);
    expect(spendsMoney('metered')).toBe(true);
    expect(spendsMoney('unknown')).toBe(true);
  });

  it('U-41: one group per assistant in the provider order, rows keeping their order inside', () => {
    const rows = [
      { id: 'a', providerId: 'codex' },
      { id: 'b', providerId: 'claude' },
      { id: 'c', providerId: 'claude' },
    ];
    const groups = groupAccountRows(rows, PROVIDERS);
    expect(groups.map((group) => [group.providerId, group.name, group.rows.map((row) => row.id)])).toEqual([
      ['claude', 'Claude Code', ['b', 'c']],
      ['codex', 'Codex', ['a']],
      ['agy', 'Antigravity', []],
    ]);
  });

  it('U-41: an installed assistant with no account still has a group; one that is not installed has none', () => {
    const groups = groupAccountRows([], PROVIDERS);
    expect(groups.map((group) => group.providerId)).toEqual(['claude', 'codex', 'agy']);
  });

  it('U-41: a row whose provider discovery does not know gets a group of its own, unnamed', () => {
    const groups = groupAccountRows([{ id: 'x', providerId: 'mystery' }, { id: 'y', providerId: null }], PROVIDERS);
    expect(groups.slice(-2).map((group) => [group.providerId, group.name])).toEqual([
      ['mystery', null],
      [null, null],
    ]);
  });

  it('U-41: the toolbar counts accounts and assistants', () => {
    const groups = groupAccountRows([{ id: 'a', providerId: 'codex' }, { id: 'b', providerId: 'claude' }], PROVIDERS);
    expect(groupTotals(groups)).toEqual({ accounts: 2, assistants: 3 });
  });
});

describe('account sections (U-45)', () => {
  const standingRow = (id: string, providerId: string, standing: RowStanding) => ({ id, providerId, standing });

  it('U-45: ready rows sit in Bulunanlar; needs-login, Doğrulanamadı and every other visible row in Hatalı ve bulunamayanlar', () => {
    const rows = [
      standingRow('ok-a', 'claude', 'ready'),
      standingRow('login-a', 'claude', 'needsLogin'),
      standingRow('unv-b', 'codex', 'unverified'),
      standingRow('key-b', 'codex', 'other'),
    ];
    const split = splitSections(groupAccountRows(rows, PROVIDERS));
    // A group may appear in both sections; an installed assistant's empty card stays in Bulunanlar.
    expect(split.found.map((group) => [group.providerId, group.rows.map((row) => row.id)])).toEqual([['claude', ['ok-a']], ['agy', []]]);
    expect(split.failed.map((group) => [group.providerId, group.rows.map((row) => row.id)])).toEqual([['claude', ['login-a']], ['codex', ['unv-b', 'key-b']]]);
  });

  it('U-45: Bulunanlar starts open, Hatalı ve bulunamayanlar starts closed; one toggle flips its own section only', () => {
    expect(SECTION_OPEN_INITIAL).toEqual({ found: true, failed: false });
    expect(toggleSection(SECTION_OPEN_INITIAL, 'failed')).toEqual({ found: true, failed: true });
    expect(toggleSection(SECTION_OPEN_INITIAL, 'found')).toEqual({ found: false, failed: false });
  });

  it('U-45: the closed summary counts needs-login and Doğrulanamadı rows, each part away at zero', () => {
    const rows = [
      standingRow('login-a', 'claude', 'needsLogin'),
      standingRow('login-b', 'claude', 'needsLogin'),
      standingRow('unv-b', 'codex', 'unverified'),
      standingRow('key-b', 'codex', 'other'),
      standingRow('ok-b', 'codex', 'ready'),
    ];
    expect(sectionSummary(rows)).toEqual({ needsLogin: 2, unverified: 1 });
    expect(sectionSummary([standingRow('key-b', 'codex', 'other')])).toEqual({ needsLogin: 0, unverified: 0 });
  });
});
