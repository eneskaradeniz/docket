// labels/t.ts — the pure resolver behind typed keys (U-9): the active locale's bundle first,
// Turkish for a key the English bundle misses, the key itself only as a last-resort totality guard
// (a key both complete bundles carry, so app paths never reach it).
import type { LabelBundle, LabelKey } from './keys';
import { EN } from './en';
import { TR } from './tr';

export type Locale = 'tr' | 'en';

export const DEFAULT_LOCALE: Locale = 'tr';

/** A bundle that may miss keys: what the resolver tolerates so the fallback stays real. */
export type PartialLabelBundle = Readonly<Partial<LabelBundle>>;

export type LocaleBundles = Readonly<Record<Locale, PartialLabelBundle>>;

const BUNDLES: LocaleBundles = { tr: TR, en: EN };

export const resolveLabel = (bundles: LocaleBundles, locale: Locale, key: LabelKey): string =>
  bundles[locale][key] ?? bundles[DEFAULT_LOCALE][key] ?? key;

export const t = (locale: Locale, key: LabelKey): string => resolveLabel(BUNDLES, locale, key);
