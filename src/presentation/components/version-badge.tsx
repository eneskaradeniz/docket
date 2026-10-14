// components/version-badge.tsx — the library definition's current version chip (U-292).
import { t, type Locale } from '../labels/t';

export interface VersionBadgeProps {
  readonly locale: Locale;
  readonly version: number;
}

export function VersionBadge({ locale, version }: VersionBadgeProps) {
  const text = t(locale, 'definition.version.badge').replace('{version}', String(version));
  return (
    <span role="status" aria-label={text} className="inline-flex h-5 items-center rounded-full border border-bord bg-raised px-2 font-mono text-[11px] text-inkdim">
      {text}
    </span>
  );
}
