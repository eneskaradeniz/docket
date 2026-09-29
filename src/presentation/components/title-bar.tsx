// components/title-bar.tsx — the drag strip the darwin window owes itself: the native title bar
// is hidden there, so this bar is the only thing to move the window by. The traffic lights keep
// their lane at its left, then the signal accent and the wordmark sign the app — nothing else,
// and nothing interactive, because the whole strip is one drag region. Platforms that keep the
// native frame render no bar at all (title-bar-plan.ts decides).
import { t, type Locale } from '../labels/t';
import { titleBarFor } from './title-bar-plan';

export interface TitleBarProps {
  /** The navigator's platform string — the plan's only input, passed in so the bar stays a pure
   *  function of its props. */
  readonly platform: string;
  readonly locale: Locale;
}

export function TitleBar({ platform, locale }: TitleBarProps) {
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
    </div>
  );
}
