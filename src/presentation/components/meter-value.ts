// components/meter-value.ts — one meter reading as screen text. The wire's unit word is a code,
// never copy: percent and fraction become a percent in the locale's own grammar, the counted
// units take their word from the label bundles, usd is a currency. A unit this build does not
// know renders the bare number — a percent sign on an unknown scale would be a wrong claim.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const UNIT_WORD: Readonly<Record<string, LabelKey>> = {
  credits: 'meter.unit.credits',
  tokens: 'meter.unit.tokens',
  requests: 'meter.unit.requests',
  prompts: 'meter.unit.prompts',
  minutes: 'meter.unit.minutes',
};

const number = (locale: Locale, value: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(LOCALE_TAG[locale], options).format(value);

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

export const formatMeterValue = (locale: Locale, unit: string, value: number): string => {
  if (unit === 'percent') return fill(t(locale, 'meter.value.percent'), { value: number(locale, Math.round(value)) });
  if (unit === 'fraction') return fill(t(locale, 'meter.value.percent'), { value: number(locale, Math.round(value * 100)) });
  if (unit === 'usd') return number(locale, value, { style: 'currency', currency: 'USD' });
  const word = UNIT_WORD[unit];
  const plain = number(locale, value);
  return word === undefined ? plain : fill(t(locale, 'meter.value.unit'), { value: plain, unit: t(locale, word) });
};

/** The unit alone, for a meter that carries no reading; null when there is nothing honest to say. */
export const meterUnitLabel = (locale: Locale, unit: string): string | null => {
  if (unit === 'percent' || unit === 'fraction') return '%';
  if (unit === 'usd') return 'USD';
  const word = UNIT_WORD[unit];
  return word === undefined ? null : t(locale, word);
};
