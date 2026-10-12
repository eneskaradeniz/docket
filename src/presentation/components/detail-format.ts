// components/detail-format.ts — the detail's own number and time formatters (U-229, U-230):
// token counts in the book's compact voice (“12,4k”), money in the locale's currency with the
// estimate tilde, durations in minutes and hours, and one clock time per run row. Pure, so the
// rows themselves stay renders over the store's view-model; every word a person reads arrives
// through a label key.
import { t, type Locale } from '../labels/t';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

/** “12,4k” / “12.4k”: thousands with one fraction digit, the decimal mark of the locale, no
 *  trailing zero (“3k”, never “3,0k”). Counts below a thousand read in full. */
export const formatTokensCompact = (locale: Locale, value: number): string => {
  const mark = new Intl.NumberFormat(LOCALE_TAG[locale]).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const grouped = (whole: number): string => new Intl.NumberFormat(LOCALE_TAG[locale]).format(whole);
  if (value < 1000) return grouped(value);
  const tenths = Math.round(value / 100) / 10; // one fraction digit, cut on the tenth
  let whole = Math.floor(tenths);
  let fraction = Math.round((tenths - whole) * 10);
  if (fraction === 10) {
    whole += 1;
    fraction = 0;
  }
  return `${grouped(whole)}${fraction > 0 ? `${mark}${fraction}` : ''}k`;
};

/** “$1,42” in the locale's own currency shape; an estimate reads “≈$1,42”. */
export const formatMoney = (locale: Locale, usd: number, estimate: boolean): string =>
  `${estimate ? '≈' : ''}${new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'currency', currency: 'USD' }).format(usd)}`;

/** Milliseconds as the quiet duration word: “43 dk”, “1 sa 5 dk” — the words from the bundle. */
export const formatDurationMs = (locale: Locale, ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return t(locale, 'detail.duration.minutes').replace('{n}', String(minutes));
  return t(locale, 'detail.duration.hours')
    .replace('{h}', String(Math.floor(minutes / 60)))
    .replace('{m}', String(minutes % 60));
};

/** One clock time (“09:12”); the full date rides the row's title. */
export const formatClock = (locale: Locale, epochMs: number): string =>
  new Intl.DateTimeFormat(LOCALE_TAG[locale], { hour: '2-digit', minute: '2-digit' }).format(epochMs);

/** The full date-time of a row's title. */
export const formatDateTime = (locale: Locale, epochMs: number): string =>
  new Intl.DateTimeFormat(LOCALE_TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs);
