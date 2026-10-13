// components/run-pinned-versions-view.tsx — pinned flow and role versions on a past run (R-132).
import { t, type Locale } from '../labels/t';

export interface RunPinnedVersionsViewProps {
  readonly locale: Locale;
  readonly flowVersion: number | null;
  readonly roleVersion: number | null;
}

export function RunPinnedVersionsView({ locale, flowVersion, roleVersion }: RunPinnedVersionsViewProps) {
  if (flowVersion === null && roleVersion === null) return null;
  const chips: string[] = [];
  if (flowVersion !== null) chips.push(t(locale, 'detail.run.flowVersion').replace('{version}', String(flowVersion)));
  if (roleVersion !== null) chips.push(t(locale, 'detail.run.roleVersion').replace('{version}', String(roleVersion)));
  const label = t(locale, 'detail.run.pinnedVersions');
  return (
    <div role="region" aria-label={label} className="flex flex-wrap items-center gap-1.5 text-[11px] text-inkdim">
      <span className="text-[10.5px] uppercase tracking-wide text-inkdim">{label}</span>
      {chips.map((chip) => (
        <span key={chip} className="inline-flex h-5 items-center rounded-control border border-hairline bg-raised px-1.5 font-mono">
          {chip}
        </span>
      ))}
    </div>
  );
}
