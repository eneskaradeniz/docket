// components/cockpit-format.ts — the cockpit's one age formatter and the tone tables its rows share.
// Wording comes from Intl, so no copy lives here.
import type { AttentionItem } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import type { Locale } from '../labels/t';
import type { BadgeTone } from './state-badge';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

/** A span's age in the active locale, from milliseconds (U-2): minutes under an hour, hours under
 *  a day, days beyond. */
export const formatAge = (locale: Locale, ms: number): string => {
  const relative = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'always' });
  const minutes = Math.floor(ms / 60_000);
  // "auto" turns zero into the locale's "now"; "always" would read as a future span.
  if (minutes < 1) return new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' }).format(0, 'second');
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.floor(hours / 24), 'day');
};

/** An instant for display (a limit's reopening): day, month and time in the active locale. */
export const formatInstant = (locale: Locale, at: number): string =>
  new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at);

/** A wait older than a day reads as overdue on the row's age. */
export const OVERDUE_MS = 24 * 60 * 60 * 1000;

export const KIND_TONE: Readonly<Record<AttentionItem['kind'], BadgeTone>> = {
  permission_ask: 'signal',
  awaiting_human: 'signal',
  blocked: 'error',
  limit_waiting: 'info',
};

/** Amber = the operator is the next move, blue = a machine waits on a clock or a limit, red = stopped. */
export const KIND_LAMP: Readonly<Record<AttentionItem['kind'], string>> = {
  permission_ask: 'bg-signal',
  awaiting_human: 'bg-signal',
  blocked: 'bg-error',
  limit_waiting: 'bg-info',
};

export const KIND_KEY: Readonly<Record<AttentionItem['kind'], LabelKey>> = {
  permission_ask: 'attention.permission_ask',
  awaiting_human: 'attention.awaiting_human',
  blocked: 'attention.blocked',
  limit_waiting: 'attention.limit_waiting',
};
