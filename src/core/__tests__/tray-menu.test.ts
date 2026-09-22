import { describe, expect, it } from 'vitest';
import type { WorkOrderId, WorkspaceId } from '../types';
import {
  TRAY_ROWS_MAX,
  TRAY_TITLE_MAX,
  linuxTrayHint,
  menuLabelLiteral,
  trayAllowed,
  trayMenuModel,
  type RunningOwner,
} from '../tray-menu';

/** Tests may build identities (the boundary check's own carve-out). */
const wo = (id: string): WorkOrderId => id as WorkOrderId;
const ws = (id: string): WorkspaceId => id as WorkspaceId;

const woOwner = (id: string, ...rest: [title?: string | undefined]): RunningOwner => ({
  kind: 'wo',
  woId: wo(id),
  // an explicit `undefined` stays undefined (the lookup-in-flight case); no argument → a stock title
  title: rest.length > 0 ? rest[0] : `title ${id}`,
});
const draftOwner = (id: string): RunningOwner => ({ kind: 'draft', workspaceId: ws(id) });

describe('trayMenuModel (WO-0100)', () => {
  it('pins the limits the plan names', () => {
    expect(TRAY_TITLE_MAX).toBe(60);
    expect(TRAY_ROWS_MAX).toBe(12);
  });

  it('no owners → quiet, empty, secondary board + quit', () => {
    expect(trayMenuModel([])).toEqual({
      count: 0,
      rows: [],
      overflow: 0,
      quiet: true,
      secondary: ['board', 'quit'],
    });
  });

  it('one wo owner → one row carrying its woId and title', () => {
    const m = trayMenuModel([woOwner('WO-0093', 'Worktree otomasyonu')]);
    expect(m.count).toBe(1);
    expect(m.quiet).toBe(false);
    expect(m.overflow).toBe(0);
    expect(m.rows).toEqual([{ kind: 'wo', woId: wo('WO-0093'), title: 'Worktree otomasyonu' }]);
    expect(m.secondary).toEqual(['board', 'quit']);
  });

  it('a draft owner is counted and gets a draft row', () => {
    const m = trayMenuModel([draftOwner('antreo-app')]);
    expect(m.count).toBe(1);
    expect(m.quiet).toBe(false);
    expect(m.rows).toEqual([{ kind: 'draft', workspaceId: ws('antreo-app') }]);
  });

  it('count parity: count === owners.length for mixed input', () => {
    const owners = [woOwner('WO-0002'), draftOwner('a'), woOwner('WO-0001'), draftOwner('b')];
    const m = trayMenuModel(owners);
    expect(m.count).toBe(owners.length);
    expect(m.rows).toHaveLength(owners.length);
    expect(m.overflow).toBe(0);
  });

  it('orders wo rows by woId ascending regardless of input order, drafts after them', () => {
    const m = trayMenuModel([
      draftOwner('zeta'),
      woOwner('WO-0100'),
      draftOwner('alpha'),
      woOwner('WO-0007'),
      woOwner('WO-0093'),
    ]);
    expect(m.rows.map((r) => (r.kind === 'wo' ? r.woId : `draft:${r.workspaceId}`))).toEqual([
      'WO-0007',
      'WO-0093',
      'WO-0100',
      'draft:alpha',
      'draft:zeta',
    ]);
  });

  it('trims a title longer than 60 to 59 chars plus …', () => {
    const long = 'x'.repeat(61);
    const m = trayMenuModel([woOwner('WO-0001', long)]);
    const row = m.rows[0];
    expect(row.kind).toBe('wo');
    if (row.kind !== 'wo') return;
    expect(row.title).toBe(`${'x'.repeat(59)}…`);
    expect(Array.from(row.title)).toHaveLength(TRAY_TITLE_MAX);
  });

  it('leaves a title of exactly 60 untouched', () => {
    const exact = 'y'.repeat(60);
    const row = trayMenuModel([woOwner('WO-0001', exact)]).rows[0];
    expect(row).toEqual({ kind: 'wo', woId: wo('WO-0001'), title: exact });
  });

  it('never splits a surrogate pair when trimming', () => {
    const long = '🟠'.repeat(70);
    const row = trayMenuModel([woOwner('WO-0001', long)]).rows[0];
    if (row.kind !== 'wo') throw new Error('expected a wo row');
    expect(row.title).toBe(`${'🟠'.repeat(59)}…`);
  });

  it('an undefined title (lookup in flight) gives "" and the row still renders', () => {
    const m = trayMenuModel([woOwner('WO-0042', undefined)]);
    expect(m.rows).toEqual([{ kind: 'wo', woId: wo('WO-0042'), title: '' }]);
    expect(m.count).toBe(1);
  });

  it('13 owners → 12 rows and overflow 1, count stays 13', () => {
    const owners = Array.from({ length: 13 }, (_, i) => woOwner(`WO-${String(i + 1).padStart(4, '0')}`));
    const m = trayMenuModel(owners);
    expect(m.count).toBe(13);
    expect(m.rows).toHaveLength(TRAY_ROWS_MAX);
    expect(m.overflow).toBe(1);
    // the cap keeps the first twelve in sorted order
    expect(m.rows[11]).toMatchObject({ kind: 'wo', woId: 'WO-0012' });
  });

  it('the cap applies after ordering: drafts are the first to overflow', () => {
    const owners = [
      draftOwner('d'),
      ...Array.from({ length: 12 }, (_, i) => woOwner(`WO-${String(i + 1).padStart(4, '0')}`)),
    ];
    const m = trayMenuModel(owners);
    expect(m.rows.every((r) => r.kind === 'wo')).toBe(true);
    expect(m.overflow).toBe(1);
  });

  it('does not mutate the input array or its owners', () => {
    const owners: RunningOwner[] = [woOwner('WO-0003', 'z'.repeat(80)), draftOwner('a'), woOwner('WO-0001')];
    const snapshot = JSON.parse(JSON.stringify(owners));
    trayMenuModel(owners);
    expect(owners).toEqual(snapshot);
    expect(Object.isFrozen(owners)).toBe(false);
  });

  it('accepts a frozen input (readonly snapshot)', () => {
    const owners = Object.freeze([Object.freeze(woOwner('WO-0002')), Object.freeze(woOwner('WO-0001'))]);
    expect(() => trayMenuModel(owners)).not.toThrow();
  });

  it('returns a fresh secondary array each call', () => {
    const a = trayMenuModel([]);
    const b = trayMenuModel([]);
    expect(a.secondary).not.toBe(b.secondary);
  });
});

describe('trayAllowed (WO-0100)', () => {
  const base = { e2e: false, platform: 'linux', display: false, wayland: false };

  it('e2e → false on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(trayAllowed({ ...base, platform, e2e: true, display: true, wayland: true })).toBe(false);
    }
  });

  it('linux with no DISPLAY and no WAYLAND → false', () => {
    expect(trayAllowed(base)).toBe(false);
  });

  it('linux with either DISPLAY or WAYLAND → true', () => {
    expect(trayAllowed({ ...base, display: true })).toBe(true);
    expect(trayAllowed({ ...base, wayland: true })).toBe(true);
  });

  it('darwin / win32 when not e2e → true (display flags irrelevant)', () => {
    expect(trayAllowed({ ...base, platform: 'darwin' })).toBe(true);
    expect(trayAllowed({ ...base, platform: 'win32' })).toBe(true);
  });
});

describe('linuxTrayHint (WO-0100)', () => {
  it('linux + ubuntu:GNOME → the GNOME hint', () => {
    expect(linuxTrayHint({ platform: 'linux', desktop: 'ubuntu:GNOME' })).toBe('gnome-no-sni-host');
  });

  it('linux + plain GNOME → the GNOME hint', () => {
    expect(linuxTrayHint({ platform: 'linux', desktop: 'GNOME' })).toBe('gnome-no-sni-host');
  });

  it('linux + KDE → undefined', () => {
    expect(linuxTrayHint({ platform: 'linux', desktop: 'KDE' })).toBeUndefined();
  });

  it('darwin → undefined even with a GNOME desktop string', () => {
    expect(linuxTrayHint({ platform: 'darwin', desktop: 'GNOME' })).toBeUndefined();
  });

  it('undefined desktop → undefined', () => {
    expect(linuxTrayHint({ platform: 'linux', desktop: undefined })).toBeUndefined();
  });
});

describe('menuLabelLiteral (WO-0100)', () => {
  it('doubles every & so a native menu renders it literally', () => {
    expect(menuLabelLiteral('Build & deploy')).toBe('Build && deploy');
    expect(menuLabelLiteral('R&D')).toBe('R&&D');
    expect(menuLabelLiteral('a && b')).toBe('a &&&& b');
  });

  it('leaves a string without & untouched', () => {
    expect(menuLabelLiteral('')).toBe('');
    expect(menuLabelLiteral('düz başlık')).toBe('düz başlık');
  });
});
