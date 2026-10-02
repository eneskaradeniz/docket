// components/provider-mark.tsx — the account badge (U-21): a provider's own mark as one inline
// SVG in the row's text colour (`fill="currentColor"` follows the theme and the row it sits in),
// and — for an id the marks do not know, an empty id, a provider without a mark — the neutral
// glyph: a square outline in the control radius, of the same size, never a letter and never a
// name (C4). The badge takes the monogram's box: 16px by default, 14px in dense rows.
// `data-provider-mark` is the layout audit's hook.
import type { ProviderMark as ProviderMarkValue } from '../stores/provider-marks';

export const MARK_SIZE = { default: 16, dense: 14 } as const;

export interface ProviderMarkProps {
  readonly mark: ProviderMarkValue | null;
  /** The badge's square side; 16 by default, 14 in dense rows (the sidebar's cards). */
  readonly size?: number;
  /** Placement classes the caller's row adds (e.g. `self-center` in a baseline row). */
  readonly className?: string;
}

export function ProviderMark({ mark, size = MARK_SIZE.default, className = '' }: ProviderMarkProps) {
  const side = `${size}px`;
  if (mark === null) {
    return (
      <span
        data-provider-mark=""
        aria-hidden="true"
        className={`block flex-none rounded-control border-[1.5px] border-current ${className}`}
        style={{ width: side, height: side }}
      />
    );
  }
  return (
    <svg
      data-provider-mark=""
      viewBox={mark.viewBox}
      aria-hidden="true"
      className={`block flex-none ${className}`}
      style={{ width: side, height: side }}
    >
      <path d={mark.path} fill="currentColor" fillRule={mark.fillRule} clipRule={mark.fillRule} />
    </svg>
  );
}
