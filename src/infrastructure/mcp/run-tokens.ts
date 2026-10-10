// mcp/run-tokens.ts — the node RunTokens: 32 bytes from the OS's random source, written as hex,
// held in memory only. A token is a bearer secret for the run's tools; nothing here logs, stores
// or serialises one.
import { randomBytes } from 'node:crypto';

import type { RunTokenBinding, RunTokens } from '../../application/index';
import type { RunId } from '../../domain/index';

const TOKEN_BYTES = 32;

export type TokenRandom = (length: number) => Uint8Array;

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function createNodeRunTokens(random: TokenRandom = (length) => randomBytes(length)): RunTokens {
  const live = new Map<string, RunTokenBinding>();
  return {
    mint: (binding) => {
      // A repeat is astronomically unlikely from the real source; redrawing keeps the "never
      // answers the same string twice" promise unconditional.
      let token = hex(random(TOKEN_BYTES));
      while (live.has(token)) token = hex(random(TOKEN_BYTES));
      live.set(token, binding);
      return token;
    },
    resolve: (token) => live.get(token),
    revoke: (runId: RunId) => {
      for (const [token, binding] of [...live]) if (binding.runId === runId) live.delete(token);
    },
  };
}
