// mcp/run-tokens.test.ts — rule I-59: the node token source is crypto-random, 32 bytes as hex.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type RoleSlug, type RunId, type WorkOrderId } from '../../domain/index';

import { createNodeRunTokens } from './run-tokens';

const ulid = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};
const RUN_A = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as RunId;
const RUN_B = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA2') as RunId;
const WORK_ORDER = ulid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV') as WorkOrderId;
const ROLE = (() => {
  const parsed = parseSlug<'role'>('designer');
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value as RoleSlug;
})();
const binding = (runId: RunId) => ({ runId, workOrderId: WORK_ORDER, role: ROLE });

describe('createNodeRunTokens', () => {
  it('I-59: a token is 32 random bytes written as 64 lowercase hex characters, never repeated', () => {
    const tokens = createNodeRunTokens();
    const minted = Array.from({ length: 50 }, (_, index) => tokens.mint(binding(index % 2 === 0 ? RUN_A : RUN_B)));
    for (const token of minted) expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(minted).size).toBe(50);
  });

  it('I-59: the bytes come from the random source — 32 of them per token — and a repeated draw is redrawn', () => {
    const asked: number[] = [];
    let draw = 0;
    const tokens = createNodeRunTokens((length) => {
      asked.push(length);
      draw += 1;
      return new Uint8Array(length).fill(draw <= 2 ? 0xab : 0xcd); // the first two draws collide
    });
    const first = tokens.mint(binding(RUN_A));
    const second = tokens.mint(binding(RUN_B));
    expect(first).toBe('ab'.repeat(32));
    expect(second).toBe('cd'.repeat(32));
    expect(asked.every((length) => length === 32)).toBe(true);
  });

  it('I-59: resolve answers the binding of a live token and nothing for an unknown one', () => {
    const tokens = createNodeRunTokens();
    const token = tokens.mint({ ...binding(RUN_A), project: (parseSlug<'project'>('proj') as { ok: true; value: never }).value });
    expect(tokens.resolve(token)).toMatchObject({ runId: RUN_A, workOrderId: WORK_ORDER, role: ROLE });
    expect(tokens.resolve('0'.repeat(64))).toBeUndefined();
    expect(tokens.resolve('')).toBeUndefined();
  });

  it('I-59: revoke voids every token of that run and only that run; revoking again is harmless', () => {
    const tokens = createNodeRunTokens();
    const a1 = tokens.mint(binding(RUN_A));
    const a2 = tokens.mint(binding(RUN_A));
    const b = tokens.mint(binding(RUN_B));
    tokens.revoke(RUN_A);
    expect(tokens.resolve(a1)).toBeUndefined();
    expect(tokens.resolve(a2)).toBeUndefined();
    expect(tokens.resolve(b)).toMatchObject({ runId: RUN_B });
    expect(() => tokens.revoke(RUN_A)).not.toThrow();
  });
});
