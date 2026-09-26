import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from './result';

function nonNegativeOrExplaining(input: number): Result<number, string> {
  if (input < 0) return err('negative input');
  return ok(input);
}

describe('ok', () => {
  it('wraps the success value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('narrows to the success branch on .ok', () => {
    const result: Result<number, string> = ok(42);
    if (result.ok) {
      const value: number = result.value;
      expect(value).toBe(42);
    } else {
      throw new Error('ok() must narrow to the success branch');
    }
  });

  it('keeps the value identity — no copy, no mutation', () => {
    const payload: readonly string[] = ['a'];
    const result = ok(payload);
    if (!result.ok) throw new Error('ok() must produce the success branch');
    expect(result.value).toBe(payload);
  });
});

describe('err', () => {
  it('wraps the failure error', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows to the failure branch on .ok', () => {
    const result: Result<number, string> = err('boom');
    if (!result.ok) {
      const error: string = result.error;
      expect(error).toBe('boom');
    } else {
      throw new Error('err() must narrow to the failure branch');
    }
  });
});

describe('Result', () => {
  it('narrows a mixed Result so value and error are only reachable on their branch', () => {
    const success = nonNegativeOrExplaining(10);
    const failure = nonNegativeOrExplaining(-1);
    if (success.ok && !failure.ok) {
      expect(success.value).toBe(10);
      expect(failure.error).toBe('negative input');
    } else {
      throw new Error('narrowing on .ok failed');
    }
  });

  it('is pure — the same input always produces an equal result', () => {
    expect(nonNegativeOrExplaining(5)).toEqual(nonNegativeOrExplaining(5));
  });
});
