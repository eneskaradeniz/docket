// agy usage group table tests (P-39, docs/v2/provider-capabilities.md §13): a reported group
// name the table knows resolves to the model matchers of that group's meters; a name it does not
// know resolves to nothing, which the parser turns into an informational pool.
import { describe, expect, it } from 'vitest';

import { agyGroupMatchers } from './usage-groups';

describe('agyGroupMatchers', () => {
  it('P-39: the two recorded groups map to the model-family prefixes that draw from their meters', () => {
    expect(agyGroupMatchers('Gemini Models')).toEqual([{ prefix: 'gemini-' }]);
    expect(agyGroupMatchers('Claude and GPT models')).toEqual([{ prefix: 'claude-' }, { prefix: 'gpt-oss-' }]);
  });

  it('P-39: a group name matches case-insensitively — the CLI capitalises its two names inconsistently', () => {
    // The recorded payloads print "Gemini Models" and "Claude and GPT models"; a spelling drift
    // must not silently turn a known group into an informational pool.
    expect(agyGroupMatchers('gemini models')).toEqual([{ prefix: 'gemini-' }]);
    expect(agyGroupMatchers('CLAUDE AND GPT MODELS')).toEqual([{ prefix: 'claude-' }, { prefix: 'gpt-oss-' }]);
  });

  it('P-39: a group the table does not know resolves to no matchers', () => {
    expect(agyGroupMatchers('Veo models')).toBeUndefined();
    expect(agyGroupMatchers('')).toBeUndefined();
  });
});
