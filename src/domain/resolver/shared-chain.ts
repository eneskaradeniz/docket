// The account order most roles share. The roles settings list shows it as the assistant order and
// the chat falls back to it when no assistant binding is stored, so both read one rule.

/** The chain most of the given chains agree on (same accounts, same order); the first chain to
 *  reach the top count wins a tie. An empty input has no shared chain. Pure. */
export function mostSharedChain<T>(chains: readonly (readonly T[])[], accountOf: (entry: T) => string): readonly T[] {
  const seen = new Map<string, { readonly chain: readonly T[]; readonly count: number }>();
  for (const chain of chains) {
    const key = chain.map(accountOf).join('|');
    const previous = seen.get(key);
    seen.set(key, { chain, count: (previous?.count ?? 0) + 1 });
  }
  let best: { readonly chain: readonly T[]; readonly count: number } | undefined;
  for (const entry of seen.values()) if (best === undefined || entry.count > best.count) best = entry;
  return best?.chain ?? [];
}
