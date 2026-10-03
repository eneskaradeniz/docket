// stores/reset-line.ts — U-20's reset wording as one pure helper: "14:30'da sıfırlanır · 3 sa 12 dk
// kaldı" (Turkish) and "Resets at 14:30 · 3h 12m left" (English). A reset more than a day away
// names its weekday, since a bare clock time would be ambiguous. The Turkish locative suffix
// follows the last number a reader would say aloud.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The suffix of the Turkish name of a digit (bir → de, üç → te, altı → da …) and of a round ten.
const UNIT_SUFFIX: Readonly<Record<number, 'da' | 'de' | 'ta' | 'te'>> = {
  1: 'de',
  2: 'de',
  3: 'te',
  4: 'te',
  5: 'te',
  6: 'da',
  7: 'de',
  8: 'de',
  9: 'da',
};
const TENS_SUFFIX: Readonly<Record<number, 'da' | 'de' | 'ta' | 'te'>> = { 10: 'da', 20: 'de', 30: 'da', 40: 'ta', 50: 'de' };

/** The locative suffix of a clock time: its minutes are said last unless they are zero. */
export const trLocativeSuffix = (hour: number, minute: number): 'da' | 'de' | 'ta' | 'te' => {
  const spoken = minute !== 0 ? minute : hour;
  if (spoken === 0) return 'da';
  const unit = spoken % 10;
  return unit !== 0 ? (UNIT_SUFFIX[unit] ?? 'da') : (TENS_SUFFIX[spoken] ?? 'da');
};

/** A span in the locale's compact units: minutes under an hour, hours and minutes under a day,
 *  days and hours beyond; a zero lower part is left out and a negative span reads zero. */
export const remainingText = (locale: Locale, ms: number): string => {
  const unit = (key: Extract<LabelKey, `reset.unit.${string}`>, n: number): string => t(locale, key).replace('{n}', String(n));
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / MINUTE_MS);
  if (minutes < 60) return unit('reset.unit.m', minutes);
  if (total < DAY_MS) {
    const hours = Math.floor(minutes / 60);
    return minutes % 60 === 0 ? unit('reset.unit.h', hours) : `${unit('reset.unit.h', hours)} ${unit('reset.unit.m', minutes % 60)}`;
  }
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  return hours === 0 ? unit('reset.unit.d', days) : `${unit('reset.unit.d', days)} ${unit('reset.unit.h', hours)}`;
};

/** "…'de sıfırlanır · … kaldı" for a window resetting at `resetsAt`, read at `now` in `timeZone`. */
export const resetLine = (locale: Locale, timeZone: string, resetsAt: number, now: number): string => {
  const tag = LOCALE_TAG[locale];
  const parts = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(resetsAt);
  const part = (type: 'hour' | 'minute'): string => parts.find((entry) => entry.type === type)?.value ?? '00';
  const clock = `${part('hour')}:${part('minute')}`;
  const left = resetsAt - now;
  const stamp =
    left >= DAY_MS ? `${new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone }).format(resetsAt)} ${clock}` : clock;
  return t(locale, 'reset.line')
    .replace('{time}', stamp)
    .replace('{suffix}', trLocativeSuffix(Number(part('hour')), Number(part('minute'))))
    .replace('{left}', remainingText(locale, left));
};
