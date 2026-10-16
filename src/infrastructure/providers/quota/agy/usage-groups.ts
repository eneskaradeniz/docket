// The agy usage-report group table (P-39, docs/v2/provider-capabilities.md §13): which models
// draw from which reported group. The usage report names its groups after model families
// (docs/v2/quota.md → "Observed: Antigravity /usage"), and the description's model list carries
// display-family names that never match a run's model id, so applicability comes from this table
// instead: a known group name maps to the id prefixes of its family. A group the table does not
// know resolves to nothing here and the parser turns it into an informational pool — shown, never
// blocking a run.
import type { ModelMatcher } from '../../../../domain/index';

/** One reported group: the name the CLI prints, and the model-id prefixes that draw from the
 * group's meters. The argon group is its own bucket next to the other two (measured `/quota`,
 * agy 1.3.6: weekly only); its prefix names only argon ids, but the gemini family prefix keeps
 * matching them too, so an argon run answers to both pools and the strictest one wins — the
 * matcher language has no exclusion, and a pool that might apply is safer applied. */
const GROUP_MODEL_MATCHERS: readonly { readonly group: string; readonly prefixes: readonly ModelMatcher[] }[] = [
  { group: 'Gemini Models', prefixes: [{ prefix: 'gemini-' }] },
  { group: 'Claude and GPT models', prefixes: [{ prefix: 'claude-' }, { prefix: 'gpt-oss-' }] },
  { group: 'Gemini 4 Argon', prefixes: [{ prefix: 'gemini-4-argon' }] },
];

/** The matchers for a reported group name, or undefined when the table does not know the group.
 * Names match case-insensitively: the CLI prints its group names with inconsistent
 * capitalisation, and a spelling drift must not silently disable a group's headroom check. */
export function agyGroupMatchers(groupName: string): readonly ModelMatcher[] | undefined {
  const lower = groupName.toLowerCase();
  return GROUP_MODEL_MATCHERS.find((entry) => entry.group.toLowerCase() === lower)?.prefixes;
}
