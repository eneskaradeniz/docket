import { describe, expect, it } from 'vitest';
import { mostSharedChain } from './shared-chain';

const id = (entry: string): string => entry;

describe('mostSharedChain', () => {
  it('U-243: the chain most roles share wins, the first one to reach the top count wins a tie, nothing shared is empty', () => {
    expect(mostSharedChain([['a', 'b'], ['b', 'a'], ['b', 'a']], id)).toEqual(['b', 'a']);
    expect(mostSharedChain([['a'], ['b']], id)).toEqual(['a']);
    expect(mostSharedChain([], id)).toEqual([]);
  });
});
