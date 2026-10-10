// In-memory RunTokens — deterministic tokens ("fake-token-1", …) with the live set exposed.
import type { RunId } from '../../../domain/index';

import { runTokenOwner, type RunTokenBinding, type RunTokens } from '../run-tokens';

export interface FakeRunTokens extends RunTokens {
  /** Every token ever minted, in order, live or not. */
  minted(): readonly { readonly token: string; readonly binding: RunTokenBinding }[];
  /** The tokens that still resolve. */
  live(): readonly string[];
}

export const createFakeRunTokens = (): FakeRunTokens => {
  const all: { readonly token: string; readonly binding: RunTokenBinding }[] = [];
  const bindings = new Map<string, RunTokenBinding>();
  return {
    mint: (binding) => {
      const token = `fake-token-${all.length + 1}`;
      all.push({ token, binding });
      bindings.set(token, binding);
      return token;
    },
    resolve: (token) => bindings.get(token),
    revoke: (runId: RunId) => {
      for (const [token, binding] of [...bindings]) if (runTokenOwner(binding) === runId) bindings.delete(token);
    },
    minted: () => [...all],
    live: () => [...bindings.keys()],
  };
};
