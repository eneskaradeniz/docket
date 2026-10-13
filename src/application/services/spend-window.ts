// services/spend-window.ts — time-window bounds for spend tracking (docs/v2/application.md).
import type { EpochMs } from '../../domain/index';

const MS_PER_DAY: EpochMs = 86_400_000;

/** Civil-from-days over a day count: the UTC calendar date without a Date object (banned here). */
const civilFromDays = (days: number): { readonly year: number; readonly month: number } => {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365); // [0, 399]
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? year + 1 : year, month };
};

/** Days from 1970-01-01 to the first of the given month. */
const daysFromCivilMonth = (year: number, month: number): number => {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yoe = shifted - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5);
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
};

const startOfUtcDay = (at: EpochMs): EpochMs => Math.floor(at / MS_PER_DAY) * MS_PER_DAY;

/** Monday 00:00 UTC of the ISO week; the epoch day 0 is a Thursday, hence the +3 shift. */
const startOfUtcIsoWeek = (at: EpochMs): EpochMs => {
  const days = Math.floor(at / MS_PER_DAY);
  return (Math.floor((days + 3) / 7) * 7 - 3) * MS_PER_DAY;
};

const startOfUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return daysFromCivilMonth(year, month) * MS_PER_DAY;
};

const startOfNextUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return (month === 12 ? daysFromCivilMonth(year + 1, 1) : daysFromCivilMonth(year, month + 1)) * MS_PER_DAY;
};

/** Both bounds inclusive: the spend port's window is `[from, to]`, so a boundary entry counts. */
export const spendWindow = (
  scope: 'account_day' | 'account_week' | 'account_month',
  now: EpochMs,
): { readonly from: EpochMs; readonly to: EpochMs } => {
  if (scope === 'account_day') return { from: startOfUtcDay(now), to: startOfUtcDay(now) + MS_PER_DAY - 1 };
  if (scope === 'account_week') {
    const from = startOfUtcIsoWeek(now);
    return { from, to: from + 7 * MS_PER_DAY - 1 };
  }
  return { from: startOfUtcMonth(now), to: startOfNextUtcMonth(now) - 1 };
};
