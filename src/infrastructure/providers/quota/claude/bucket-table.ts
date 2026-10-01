// Data table for P-39 (docs/v2/provider-capabilities.md §13): the display names the usage
// report gives its model-scoped buckets, each mapped to the models that draw from it. Matched
// by the display name the provider reports — case-insensitively, like the domain's own model
// matching, so a cosmetic case change cannot silently demote a known bucket to unknown. A name
// the table does not know answers 'unknown' and the mapper shows it for information only.
// Additive data: a new bucket needs a row here, not a change to mapping code.
import type { ModelMatcher } from '../../../../domain/index';

const BUCKET_MATCHERS: ReadonlyMap<string, readonly ModelMatcher[]> = new Map([
  ['fable', [{ prefix: 'claude-fable' }]],
]);

export function matchersForBucket(displayName: string): readonly ModelMatcher[] | 'unknown' {
  return BUCKET_MATCHERS.get(displayName.toLowerCase()) ?? 'unknown';
}
