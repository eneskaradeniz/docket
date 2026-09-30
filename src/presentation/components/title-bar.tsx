// components/title-bar.tsx — the drag strip the darwin window owes itself: the native title bar
// is hidden there, so this bar is the only thing to move the window by. The traffic lights keep
// their lane at its left, then the signal accent and the wordmark sign the app — nothing else;
// the navigation lives in the sidebar's rows (U-24). The bar's one control is the Update button
// at its right edge, the app's single call to action while an update waits: a bordered ghost
// with a small download glyph, visible only while the update state is available, downloading or
// ready — never for none or error. The button alone is interactive; everything else on the strip
// stays one drag region. Platforms that keep the native frame render no bar at all
// (title-bar-plan.ts decides).
import { t, type Locale } from '../labels/t';
import { updateButton, type UpdateStatus } from '../stores/update';
import { titleBarFor } from './title-bar-plan';

export interface TitleBarProps {
  /** The navigator's platform string — the plan's only input, passed in so the bar stays a pure
   *  function of its props. */
  readonly platform: string;
  readonly locale: Locale;
  /** The app-update standing; null renders no button (U-24). */
  readonly update: UpdateStatus | null;
  /** Starts the download and install — the apply intent, also on the ready standing (restart). */
  readonly onApply: () => void;
}

/** The palette's magnifier — the palette renders it with the defaults; the icon lives here with
 *  the bar so the two surfaces share one glyph (the palette imports it; this bar itself no
 *  longer carries a search door). */
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

/** The update button's download glyph. */
const DownloadIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-[15px] w-[15px] flex-none"
  >
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4.5 20.5h15" />
  </svg>
);

/** The one gap between the bar's right end and the window edge: it lives on the bar's padding so
 *  every right-end control inherits it, not just today's button. */
const BAR_RIGHT_INSET_PX = 16;

export function TitleBar({ platform, locale, update, onApply }: TitleBarProps) {
  const plan = titleBarFor(platform);
  if (!plan.visible) return null;
  // The button's plan — hidden standings render nothing at all, so the bar's right end stays
  // empty drag region exactly as it was before any update existed (U-24).
  const button = update === null ? null : updateButton(update);
  return (
    // The lane width is platform data, not a design constant, so it travels as a style rather
    // than a class; the right inset is the bar's own constant, kept here so the controls carry
    // no margin of their own; every colour stays on the theme tokens.
    <div
      data-title-bar
      className="flex h-10 w-full flex-none items-center gap-2 border-b border-hairline bg-bg text-ink [-webkit-app-region:drag]"
      style={{ paddingInlineStart: `${plan.leftInsetPx}px`, paddingInlineEnd: `${BAR_RIGHT_INSET_PX}px` }}
    >
      <span aria-hidden="true" className="h-4 w-[3px] flex-none bg-signal" />
      <span className="text-[13px] font-semibold">{t(locale, 'shell.wordmark')}</span>

      {button !== null && button.visible ? (
        <button
          type="button"
          data-update-button
          disabled={button.disabled}
          onClick={onApply}
          title={button.percent !== null ? t(locale, 'settings.update.status.downloading') : undefined}
          className="ml-auto inline-flex h-7 flex-none items-center gap-1.5 rounded-control border border-signal bg-transparent px-2.5 text-[12.5px] font-semibold text-ink transition-[filter,background-color] duration-100 hover:bg-raised focus-visible:bg-raised active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [-webkit-app-region:no-drag]"
        >
          <DownloadIcon />
          {button.percent !== null ? `%${button.percent}` : t(locale, button.labelKey)}
        </button>
      ) : null}
    </div>
  );
}
