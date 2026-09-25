// DriverSelect — WO-0108 (Faz E): the ONE driver picker (vendor · profile), shared by the
// Modeller role rows and the workspace dialog. A native select styled to the kit's input look
// (the option count grows with vendors × profiles — a segmented bar would not fit); every
// option label is adapter DATA (the vendor's display name) or the labels' own words — never a
// raw id. The first option is always the CHAIN arm («Varsayılan» = no preference here: the
// levels below decide), the picker's value therefore carries {vendor?, profile?} or nothing.
import type { VendorInfo } from '../../core/app-settings';
import type { BackendProfile } from '../../core/backend-profile';
import { useLabels } from '../data/locale';

export interface DriverRouteValue {
  vendor?: string;
  profile?: string;
}

export interface DriverOption {
  key: string;
  label: string;
  route?: DriverRouteValue;
}

/** The option list: the chain arm, then each WIRED vendor's «Varsayılan» + its profiles.
 *  Per-vendor profiles are a named follow-up — only the builtin vendor's profiles list today
 *  (VendorInfo.builtin names it); another vendor offers its Varsayılan alone. Probe-pending
 *  vendors never appear (an action whose evidence is unmet is absent — ADR-0001). */
export function driverOptions(vendors: readonly VendorInfo[], profiles: readonly BackendProfile[], UI: ReturnType<typeof useLabels>['UI']): DriverOption[] {
  const wired = vendors.filter((v) => v.wired);
  return [
    { key: '', label: UI.profileDefaultName },
    ...wired.flatMap((v) => [
      { key: `${v.id}|`, label: `${v.name} · ${UI.profileDefaultName}`, route: { vendor: v.id } },
      // Per-vendor profiles are a named follow-up: only the builtin vendor's profile list rides
      // today (VendorInfo.builtin names it); another wired vendor offers its Varsayılan alone.
      ...(v.builtin ? profiles.map((p) => ({ key: `${v.id}|${p.name}`, label: `${v.name} · ${p.name}`, route: { vendor: v.id, profile: p.name } })) : []),
    ]),
  ];
}

export function DriverSelect({
  value,
  options,
  ariaLabel,
  onValueChange,
}: {
  value: DriverRouteValue | undefined;
  options: readonly DriverOption[];
  ariaLabel: string;
  onValueChange: (route: DriverRouteValue | undefined) => void;
}) {
  const keyOf = (v: DriverRouteValue | undefined): string => {
    if (v === undefined || (v.vendor === undefined && v.profile === undefined)) return '';
    return `${v.vendor ?? ''}|${v.profile ?? ''}`;
  };
  // A stored value naming something the options no longer carry (a deleted profile, an unwired
  // vendor) keeps its own option — the row SHOWS what is stored (findable), the fix is a pick.
  const current = keyOf(value);
  const known = options.some((o) => o.key === current);
  const all: readonly DriverOption[] =
    known || current === '' ? options : [...options, { key: current, label: current.split('|').filter(Boolean).join(' · ') || current, route: value }];
  return (
    <select
      data-driver-select=""
      aria-label={ariaLabel}
      className="h-[30px] rounded-[7px] border border-hairline bg-bg px-2 text-[12.5px] text-ink transition-colors duration-150 hover:bg-raised/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
      value={current}
      onChange={(e) => {
        const opt = all.find((o) => o.key === e.target.value);
        onValueChange(opt?.route);
      }}
    >
      {all.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
