// components/source-badge.tsx — how a meter's observation source (U-6) reaches the screen: the
// closed ObservationSource set gets its own label key and tone, and a code outside the set renders
// as its own dim slug instead of pretending a known provenance.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { StateBadge, type BadgeTone } from './state-badge';

const SOURCE_TONE: Readonly<Record<string, BadgeTone>> = {
  pushed: 'proceed',
  polled: 'info',
  header: 'info',
  captured_from_error: 'signal',
  estimated: 'dim',
  documented_rule: 'dim',
  unknown: 'dim',
};

const SOURCE_KEY: Readonly<Record<string, LabelKey>> = {
  pushed: 'source.pushed',
  polled: 'source.polled',
  header: 'source.header',
  captured_from_error: 'source.captured_from_error',
  estimated: 'source.estimated',
  documented_rule: 'source.documented_rule',
  unknown: 'source.unknown',
};

export function SourceBadge({ code, locale }: { readonly code: string; readonly locale: Locale }) {
  const key = SOURCE_KEY[code];
  return <StateBadge tone={SOURCE_TONE[code] ?? 'dim'}>{key === undefined ? code : t(locale, key)}</StateBadge>;
}
