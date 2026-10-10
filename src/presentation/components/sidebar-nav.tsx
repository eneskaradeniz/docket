// components/sidebar-nav.tsx — the sidebar's five nav rows (U-24, U-84): Anasayfa, Ara, Artifact'lar, Telefon
// and Ayarlar, each icon + label in a 32px row, above the project tree. Anasayfa goes to the cockpit
// and carries the shell's attention badge on its right edge (U-10 — the badge follows the row
// that owns the cockpit); Ara opens the centered search palette, its ⌘K hint right-aligned and
// part of the row's name the way the palette's door has always named itself; Telefon and Ayarlar
// open the settings panel on their own section. While current — Anasayfa on the cockpit, Ara
// while the palette is open, Telefon/Ayarlar while the panel is open on their section — a row
// speaks the one active-state language of active-state.ts. The rows are the only interactive
// things here; every user-visible string arrives through a label key (U-1).
import { useRef } from 'react';

import { t, type Locale } from '../labels/t';
import type { SettingsSection } from '../screens/settings';
import type { ShellBadge } from '../stores/shell';
import type { PaletteOrigin } from '../stores/search-palette';
import { ACTIVE_CLASS } from './active-state';

export interface SidebarNavProps {
  readonly locale: Locale;
  /** Whether the cockpit is the current route — Anasayfa's current standing. */
  readonly homeCurrent: boolean;
  /** Whether the search palette is open — Ara's current standing while it is. */
  readonly searchCurrent: boolean;
  /** The settings panel's open section — the Telefon/Ayarlar rows' current standing; null while
   *  the panel is closed. */
  readonly settingsSection: SettingsSection | null;
  /** Whether the Artifact'lar library is the current route — its row's current standing. */
  readonly libraryCurrent: boolean;
  /** How many artifacts the library holds; the row shows it only above zero (U-84). */
  readonly libraryCount: number;
  /** The shell's attention badge; null renders nothing, never a zero (U-10). */
  readonly badge: ShellBadge | null;
  readonly onHome: () => void;
  /** Opens the palette; the origin decides where focus lands on close. */
  readonly onSearch: (origin: PaletteOrigin) => void;
  readonly onLibrary: () => void;
  readonly onPhone: () => void;
  readonly onSettings: () => void;
}

const HomeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4 flex-none"
  >
    <path d="m3 11 9-8 9 8" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
    className="h-4 w-4 flex-none"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const LibraryIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4 flex-none"
  >
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

const PhoneIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4 flex-none"
  >
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M10.75 18.75h2.5" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/** One nav row's standing: the active-state language while current, a transparent border at rest
 *  (so nothing moves when the state flips), the raised ground on hover and keyboard focus. The
 *  rows sit in the sidebar's 13.5–14 px scale (U-51). */
const rowClass = (current: boolean): string =>
  current
    ? `flex h-8 items-center gap-2 rounded-control border px-2.5 text-left text-[13.5px] font-semibold text-ink ${ACTIVE_CLASS}`
    : 'flex h-8 items-center gap-2 rounded-control border border-transparent px-2.5 text-left text-[13.5px] text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink';

/** The pill Anasayfa carries on its right edge when attention exists — the badge grammar of the
 *  tree's count pill, never a rendered zero (U-10); its accessible name is the attention
 *  section's, so the count reads as what it counts. */
const BadgePill = ({ count, locale }: { readonly count: number; readonly locale: Locale }) => (
  <span
    aria-label={t(locale, 'cockpit.section.attention')}
    className="ml-auto inline-flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full border border-hairline bg-raised px-1 font-mono text-[11px] text-inkdim"
  >
    {count}
  </span>
);

export function SidebarNav({
  locale,
  homeCurrent,
  searchCurrent,
  settingsSection,
  libraryCurrent,
  libraryCount,
  badge,
  onHome,
  onSearch,
  onLibrary,
  onPhone,
  onSettings,
}: SidebarNavProps) {
  // A pointer press on Ara is indistinguishable from key activation by the click alone — the
  // press is what tells them apart, so it is stamped here and read once by the click.
  const pointerOpenRef = useRef(false);
  return (
    <div data-sidebar-nav className="grid gap-1">
      <button type="button" onClick={onHome} aria-current={homeCurrent ? 'page' : undefined} className={rowClass(homeCurrent)}>
        <HomeIcon />
        <span className="truncate">{t(locale, 'nav.home')}</span>
        {badge !== null ? <BadgePill count={badge.count} locale={locale} /> : null}
      </button>

      <button
        type="button"
        onPointerDown={() => {
          pointerOpenRef.current = true;
        }}
        onClick={() => {
          const origin: PaletteOrigin = pointerOpenRef.current ? 'pointer' : 'keyboard';
          pointerOpenRef.current = false;
          onSearch(origin);
        }}
        aria-current={searchCurrent ? 'true' : undefined}
        className={rowClass(searchCurrent)}
      >
        <SearchIcon />
        <span className="truncate">{t(locale, 'nav.search')}</span>
        <span className="ml-auto flex-none font-mono text-[12px] text-inkdim">{t(locale, 'nav.search.kbd')}</span>
      </button>

      <button
        type="button"
        data-nav-library=""
        onClick={onLibrary}
        aria-current={libraryCurrent ? 'page' : undefined}
        className={rowClass(libraryCurrent)}
      >
        <LibraryIcon />
        <span className="truncate">{t(locale, 'nav.library')}</span>
        {libraryCount > 0 ? (
          <span data-library-count="" className="ml-auto flex-none font-mono text-[12px] text-inkdim">
            {libraryCount}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={onPhone}
        aria-current={settingsSection === 'phone' ? 'true' : undefined}
        className={rowClass(settingsSection === 'phone')}
      >
        <PhoneIcon />
        <span className="truncate">{t(locale, 'nav.phone')}</span>
      </button>

      <button
        type="button"
        onClick={onSettings}
        aria-current={settingsSection !== null && settingsSection !== 'phone' ? 'true' : undefined}
        className={rowClass(settingsSection !== null && settingsSection !== 'phone')}
      >
        <GearIcon />
        <span className="truncate">{t(locale, 'nav.settings')}</span>
      </button>
    </div>
  );
}
