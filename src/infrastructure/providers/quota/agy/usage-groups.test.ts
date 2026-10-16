// agy usage group table tests (P-39, docs/v2/provider-capabilities.md §13): a reported group
// name the table knows resolves to the model matchers of that group's meters; a name it does not
// know resolves to nothing, which the parser turns into an informational pool.
import { describe, expect, it } from 'vitest';

import { agyGroupMatchers } from './usage-groups';

/** The recorded `/quota` line of the argon measurement (agy 1.3.6): group TAB bucket TAB
 * remaining TAB reset — its own bucket next to the other two groups, weekly only. The bucket
 * name and the single weekly window come from this line; the table must know the group it
 * prints. */
const ARGON_QUOTA_LINE = 'Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t82%\t2026-10-23T15:33:59Z';

describe('agyGroupMatchers', () => {
  it('P-39: the three recorded groups map to the model-family prefixes that draw from their meters', () => {
    expect(agyGroupMatchers('Gemini Models')).toEqual([{ prefix: 'gemini-' }]);
    expect(agyGroupMatchers('Claude and GPT models')).toEqual([{ prefix: 'claude-' }, { prefix: 'gpt-oss-' }]);
    expect(agyGroupMatchers('Gemini 4 Argon')).toEqual([{ prefix: 'gemini-4-argon' }]);
  });

  it('P-39: the recorded argon /quota line names a group the table knows, with its own weekly bucket', () => {
    // The line is the run's evidence that argon draws from a bucket of its own: the group field
    // must resolve to matchers (an unknown name would turn the pool informational and drop it
    // from every headroom check), and those matchers must be the argon prefix alone.
    const group = ARGON_QUOTA_LINE.split('\t')[0];
    expect(agyGroupMatchers(group ?? '')).toEqual([{ prefix: 'gemini-4-argon' }]);
  });

  it('P-39: a group name matches case-insensitively — the CLI capitalises its names inconsistently', () => {
    // The recorded payloads print "Gemini Models" and "Claude and GPT models"; a spelling drift
    // must not silently turn a known group into an informational pool.
    expect(agyGroupMatchers('gemini models')).toEqual([{ prefix: 'gemini-' }]);
    expect(agyGroupMatchers('CLAUDE AND GPT MODELS')).toEqual([{ prefix: 'claude-' }, { prefix: 'gpt-oss-' }]);
    expect(agyGroupMatchers('gemini 4 argon')).toEqual([{ prefix: 'gemini-4-argon' }]);
  });

  it('P-39: a group the table does not know resolves to no matchers', () => {
    expect(agyGroupMatchers('Veo models')).toBeUndefined();
    expect(agyGroupMatchers('')).toBeUndefined();
  });
});
