// components/roles-section.tsx — the work-style part of Roller (U-33): the unset banner on top,
// then one row per role with a Hızlı · Dengeli · Özenli segment control. A pair outside the three
// presets stands as an inert "Özel" segment; a role with neither tier nor thinking stored shows no
// selection. Every value and intent is the RolesStore's; this file only draws.
import { t, type Locale } from '../labels/t';
import type { WorkStyle } from '../stores/recommended';
import { WORK_STYLES, styleStanding, type RoleRow, type RolesState, type RolesStore } from '../stores/roles';
import { SegmentedControl } from './segmented-control';
import { RolesUnsetBanner } from './settings-cards';

const STYLE_KEY = {
  fast: 'roles.style.fast',
  balanced: 'roles.style.balanced',
  careful: 'roles.style.careful',
} as const;

export interface RolesSectionProps {
  readonly locale: Locale;
  readonly store: RolesStore;
  readonly state: RolesState;
}

interface RoleStyleRowProps {
  readonly locale: Locale;
  readonly store: RolesStore;
  readonly row: RoleRow;
  readonly failed: string | null;
  readonly saved: boolean;
}

function RoleStyleRow({ locale, store, row, failed, saved }: RoleStyleRowProps) {
  const standing = styleStanding(row.style);
  return (
    <div data-role-row={row.id} className="grid gap-1 border-t border-hairline px-4 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-[13.5px] font-semibold text-ink">{row.name}</p>
        <div className="flex flex-none items-center gap-2">
          {saved ? (
            <span role="status" className="text-[12px] text-proceed">
              {t(locale, 'editor.saved')}
            </span>
          ) : null}
          <SegmentedControl<WorkStyle>
            label={t(locale, 'roles.style.title')}
            value={standing === 'custom' ? null : standing}
            standing={standing === 'custom' ? t(locale, 'roles.style.custom') : undefined}
            onPick={(style) => void store.setStyle(row.id, style)}
            options={WORK_STYLES.map((style) => ({
              id: style,
              text: t(locale, STYLE_KEY[style]),
              ...(style === row.recommended ? { hint: t(locale, 'editor.recommended') } : {}),
            }))}
          />
        </div>
      </div>
      {failed !== null ? <p className="m-0 text-[12.5px] text-error">{failed}</p> : null}
    </div>
  );
}

/** Roller's work-style rows; nothing while the roles have not loaded or none exist. */
export function RolesSection({ locale, store, state }: RolesSectionProps) {
  const rows = state.rows ?? [];
  if (rows.length === 0) return null;
  const failureOf = (row: string): string | null => (state.failure !== null && state.failure.row === row ? t(locale, state.failure.labelKey) : null);
  const bulkFailure = failureOf('roles');
  return (
    <div className="grid gap-3" data-roles-section="">
      {state.unsetCount > 0 ? <RolesUnsetBanner locale={locale} count={state.unsetCount} onApply={() => void store.applyRecommended()} /> : null}
      {bulkFailure !== null ? <p className="m-0 text-[12.5px] text-error">{bulkFailure}</p> : null}
      <div className="rounded-card border border-hairline bg-surface">
        {rows.map((row) => (
          <RoleStyleRow key={row.id} locale={locale} store={store} row={row} failed={failureOf(row.id)} saved={store.isSaved(row.id)} />
        ))}
      </div>
    </div>
  );
}
