// components/rescan-button.tsx — the one "Yeniden tara" control (U-160, U-161), used wherever a scan
// or refresh is offered. It sits right-aligned in its section's header row (title left, actions
// right) with the age of the last scan beside it. While the scan runs the button stays put and
// only its icon turns about its own centre — linear, 0.9 s, behind motion-safe, so under reduced
// motion the label alone says it. The box itself never rotates.
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import { formatAge } from './cockpit-format';
import { SIDEBAR_HEADER_BUTTON } from './sidebar-header-button';

export interface RescanButtonProps {
  readonly locale: Locale;
  /** A scan is running: the label reads "Taranıyor…" and the button is disabled. */
  readonly busy: boolean;
  readonly onRescan: () => void;
  /** When the last scan finished; absent before one has. */
  readonly scannedAt?: number | null;
  /** The clock the age reads against. */
  readonly now?: number;
  /** `icon` is the sidebar's small square button: no label, the name rides tooltip and aria-label. */
  readonly variant?: 'labeled' | 'icon';
}

/** Only the icon turns: its own centre, linear, 0.9 s; nothing turns under reduced motion. */
const TURN = 'origin-center motion-safe:animate-spin motion-safe:[animation-duration:0.9s]';

function RefreshIcon({ turning, className }: { readonly turning: boolean; readonly className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`block flex-none ${className} ${turning ? TURN : ''}`}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function RescanButton({ locale, busy, onRescan, scannedAt = null, now = 0, variant = 'labeled' }: RescanButtonProps) {
  if (variant === 'icon') {
    const name = t(locale, 'scan.rescan');
    return (
      <button
        type="button"
        data-rescan-icon=""
        onClick={() => {
          if (!busy) onRescan();
        }}
        aria-label={name}
        title={name}
        aria-busy={busy ? true : undefined}
        className={SIDEBAR_HEADER_BUTTON}
      >
        <RefreshIcon turning={busy} className="h-3 w-3" />
      </button>
    );
  }
  return (
    <div data-rescan="" className="ml-auto flex flex-none items-center gap-3">
      {scannedAt === null ? null : (
        <span className="text-[0.75rem] leading-4 text-inkdim">{t(locale, 'scan.last').replace('{age}', formatAge(locale, Math.max(0, now - scannedAt)))}</span>
      )}
      <ActionButton variant="ghost" size="sm" disabled={busy} ariaBusy={busy} onClick={onRescan}>
        <RefreshIcon turning={busy} className="h-[0.9375rem] w-[0.9375rem]" />
        <span>{t(locale, busy ? 'scan.scanning' : 'scan.rescan')}</span>
      </ActionButton>
    </div>
  );
}
