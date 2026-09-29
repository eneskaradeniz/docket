// components/title-bar.tsx — the drag strip the darwin window owes itself: the native title bar
// is hidden there, so this bar is the only thing to move the window by. The traffic lights keep
// their lane at its left, then the signal accent and the wordmark sign the app, then the bar's
// two icon buttons: Anasayfa, the cockpit's route (raised with the inset signal bar while the
// cockpit is where the operator is, the attention badge on its corner), and Ara, which opens the
// centered search palette. The buttons speak through their aria-label and tooltip, not visible
// words. The buttons alone are interactive — everything else on the strip stays one drag region.
// Platforms that keep the native frame render no bar at all (title-bar-plan.ts decides).
import { t, type Locale } from '../labels/t';
import type { ShellBadge } from '../stores/shell';
import { titleBarFor } from './title-bar-plan';

export interface TitleBarProps {
  /** The navigator's platform string — the plan's only input, passed in so the bar stays a pure
   *  function of its props. */
  readonly platform: string;
  readonly locale: Locale;
  /** Whether the cockpit is the current route — Anasayfa's current-route standing. */
  readonly homeCurrent: boolean;
  /** The shell's attention badge; null renders nothing, never a zero (U-10). */
  readonly badge: ShellBadge | null;
  readonly onHome: () => void;
  readonly onSearch: () => void;
}

/** The palette's magnifier. The defaults are the palette's own rendering; the title bar's button
 *  passes its larger, lighter stroke so one icon serves both surfaces. */
export const SearchIcon = ({
  className = 'h-3.5 w-3.5 flex-none',
  strokeWidth = 2,
}: {
  readonly className?: string;
  readonly strokeWidth?: number;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    aria-hidden="true"
    className={className}
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

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

/** The bar buttons' standing: 28px wordless ghosts, no border at rest, raised on hover and
 *  keyboard focus; the current route keeps the raised ground with the inset signal bar — the
 *  same grammar as the sidebar's rows. */
const buttonClass = (current: boolean): string =>
  current
    ? 'relative grid h-7 w-7 flex-none place-items-center rounded-md bg-raised text-ink shadow-[inset_2px_0_0_0] shadow-signal [-webkit-app-region:no-drag]'
    : 'relative grid h-7 w-7 flex-none place-items-center rounded-md text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink [-webkit-app-region:no-drag]';

export function TitleBar({ platform, locale, homeCurrent, badge, onHome, onSearch }: TitleBarProps) {
  const plan = titleBarFor(platform);
  if (!plan.visible) return null;
  return (
    // The lane width is platform data, not a design constant, so it travels as a style rather
    // than a class; every colour stays on the theme tokens.
    <div
      className="flex h-10 w-full flex-none items-center gap-2 border-b border-hairline bg-bg text-ink [-webkit-app-region:drag]"
      style={{ paddingInlineStart: `${plan.leftInsetPx}px` }}
    >
      <span aria-hidden="true" className="h-4 w-[3px] flex-none bg-signal" />
      <span className="text-[13px] font-semibold">{t(locale, 'shell.wordmark')}</span>

      {plan.buttons.includes('home') ? (
        <button
          type="button"
          onClick={onHome}
          aria-current={homeCurrent ? 'page' : undefined}
          aria-label={t(locale, 'nav.home')}
          title={t(locale, 'nav.home')}
          className={buttonClass(homeCurrent)}
        >
          <HomeIcon />
          {/* The badge hangs on the button's corner: a count pill inside a 28px square would
              stretch it past its icon-only footprint. */}
          {badge !== null ? (
            <span
              aria-label={t(locale, 'cockpit.section.attention')}
              className="absolute -right-1.5 -top-1 inline-flex h-[14px] min-w-[18px] items-center justify-center rounded-full border border-hairline bg-raised px-1 font-mono text-[9.5px] text-inkdim"
            >
              {badge.count}
            </span>
          ) : null}
        </button>
      ) : null}

      {plan.buttons.includes('search') ? (
        <button
          type="button"
          onClick={onSearch}
          aria-label={t(locale, 'shell.search')}
          title={t(locale, 'shell.search')}
          className={buttonClass(false)}
        >
          <SearchIcon className="h-4 w-4 flex-none" strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  );
}
