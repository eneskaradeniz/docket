// src/core/tray-menu.ts — the tray menu's STRUCTURE, PURE (WO-0100).
//
// The host (the Electron main process) keeps an owner snapshot beside its live-drive map — one
// entry per running drive, keyed by the same owner tag the renderer's appbar chip counts — and
// feeds it here. This module derives what the tray menu shows: the count, the ordered and capped
// rows, the overflow, the quiet flag and the secondary actions. It carries NO words: main maps
// the structure onto its fixed chrome vocabulary (plan §3/§4). No electron, no Node, no I/O.
//
// Also here, because they are decisions and not I/O: whether the host may create a tray at all
// (`trayAllowed`) and whether a Linux desktop warrants the "may be invisible" log hint
// (`linuxTrayHint`). The host reads the environment and passes plain facts in.

import type { WorkOrderId, WorkspaceId } from './types';

/** A row's title is cut to this many characters (code points), the last one being the ellipsis. */
export const TRAY_TITLE_MAX = 60;
/** At most this many rows are listed; the rest ride the overflow count. */
export const TRAY_ROWS_MAX = 12;

const ELLIPSIS = '…';

/** One live drive's owner as main's snapshot holds it. */
export type RunningOwner =
  /** A work-order drive; `title` is undefined while main's work-order lookup is in flight. */
  | { kind: 'wo'; woId: WorkOrderId; title: string | undefined }
  /** A workspace-scoped roadmap draft drive. */
  | { kind: 'draft'; workspaceId: WorkspaceId };

/** One listed tray row. */
export type TrayRow =
  /** `title` is trimmed to TRAY_TITLE_MAX; `''` when the lookup has not landed (the id renders alone). */
  | { kind: 'wo'; woId: WorkOrderId; title: string }
  | { kind: 'draft'; workspaceId: WorkspaceId };

/** The secondary actions under the separator, in order. */
export type TraySecondary = 'board' | 'quit';

export interface TrayMenuModel {
  /** === owners.length — every owner counts, drafts included (parity with the appbar chip). */
  count: number;
  /** wo rows by woId ascending, then drafts by workspaceId ascending; capped at TRAY_ROWS_MAX. */
  rows: TrayRow[];
  /** Owners beyond the cap (0 when none). */
  overflow: number;
  /** count === 0 → the host renders ONLY the quiet line, no header. */
  quiet: boolean;
  /** Always ['board', 'quit']. */
  secondary: TraySecondary[];
}

/** The one main → renderer push (`docket:chrome:navigate`): where the host asks the UI to go. */
export type ChromeNavigate =
  | { kind: 'wo'; id: WorkOrderId }
  | { kind: 'draft'; workspaceId: WorkspaceId }
  | { kind: 'board' }
  | { kind: 'settings' };

/** Environment facts the host reads for `trayAllowed`. */
export interface TrayEnv {
  /** The E2E run (DOCKET_E2E) — the tray is OFF there. */
  e2e: boolean;
  /** process.platform. */
  platform: string;
  /** Linux: DISPLAY is set. */
  display: boolean;
  /** Linux: WAYLAND_DISPLAY is set. */
  wayland: boolean;
}

/** Environment facts the host reads for `linuxTrayHint`. */
export interface TrayHintEnv {
  /** process.platform. */
  platform: string;
  /** XDG_CURRENT_DESKTOP, verbatim (e.g. `ubuntu:GNOME`). */
  desktop: string | undefined;
}

export type LinuxTrayHint = 'gnome-no-sni-host';

/** Cut to TRAY_TITLE_MAX code points (never splitting a surrogate pair), ellipsis last. */
function trimTitle(title: string | undefined): string {
  if (title === undefined) return '';
  const chars = Array.from(title);
  if (chars.length <= TRAY_TITLE_MAX) return title;
  return chars.slice(0, TRAY_TITLE_MAX - 1).join('') + ELLIPSIS;
}

/**
 * A native menu reads a lone `&` as a mnemonic marker (dropped on macOS; on Windows/Linux it also
 * underlines the next character). An operator-authored string shown in a native menu label passes
 * through here so every `&` renders literally (`&&`).
 */
export function menuLabelLiteral(text: string): string {
  return text.split('&').join('&&');
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Derive the tray menu's structure from main's live-drive owner snapshot. Never mutates `owners`. */
export function trayMenuModel(owners: readonly RunningOwner[]): TrayMenuModel {
  const wos: TrayRow[] = [];
  const drafts: TrayRow[] = [];
  for (const o of owners) {
    if (o.kind === 'wo') wos.push({ kind: 'wo', woId: o.woId, title: trimTitle(o.title) });
    else drafts.push({ kind: 'draft', workspaceId: o.workspaceId });
  }
  wos.sort((a, b) => cmp(a.kind === 'wo' ? a.woId : '', b.kind === 'wo' ? b.woId : ''));
  drafts.sort((a, b) =>
    cmp(a.kind === 'draft' ? a.workspaceId : '', b.kind === 'draft' ? b.workspaceId : ''),
  );
  const ordered = [...wos, ...drafts];
  const rows = ordered.slice(0, TRAY_ROWS_MAX);
  const count = owners.length;
  return {
    count,
    rows,
    overflow: count - rows.length,
    quiet: count === 0,
    secondary: ['board', 'quit'],
  };
}

/** Whether the host may create a tray: never under E2E; on Linux only with a display server. */
export function trayAllowed(env: TrayEnv): boolean {
  if (env.e2e) return false;
  if (env.platform === 'linux') return env.display || env.wayland;
  return true;
}

/** On a GNOME Linux desktop the tray may be invisible (no StatusNotifier host) — the host logs it once. */
export function linuxTrayHint(env: TrayHintEnv): LinuxTrayHint | undefined {
  if (env.platform !== 'linux' || env.desktop === undefined) return undefined;
  const parts = env.desktop.split(':').map((s) => s.trim().toUpperCase());
  return parts.some((p) => p === 'GNOME' || p.startsWith('GNOME-')) ? 'gnome-no-sni-host' : undefined;
}
