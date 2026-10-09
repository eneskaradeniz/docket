import { describe, expect, it } from 'vitest';
import type { AccountId, CapabilitySlug } from '../shared';
import { parseSlug } from '../shared';
import { candidateToDefinition, mergeCandidates, type CapabilityCandidate, type CapabilityCandidateKind } from './candidates';
import { validateDefinitions } from './validate';

// ULIDs, Crockford base32 — plain string order is the account order used by the merge rules
const ACCT_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const ACCT_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as AccountId;
const ACCT_C = '01ARZ3NDEKTSV4RRFFQ69G5FAX' as AccountId;

const capId = (raw: string): CapabilitySlug => {
  const parsed = parseSlug<'capability'>(raw);
  if (!parsed.ok) throw new Error(`bad test slug: ${raw}`);
  return parsed.value;
};

/** Builds an input candidate. `identity` defaults to a deliberately wrong string: the merge key is
 *  derived from kind/name/command (R-62), so the tests prove the output carries the canonical form. */
const cand = (
  over: Partial<CapabilityCandidate> & { readonly kind: CapabilityCandidateKind; readonly name: string },
): CapabilityCandidate => ({
  identity: `wrong-${over.name}`,
  sources: [ACCT_A],
  ...over,
});

const freezeDeep = <T>(value: T): T => {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  }
  return value;
};

describe('mergeCandidates', () => {
  it('R-62: identity is kind:name for skill/context (case-sensitive) and mcp:name|command for mcp', () => {
    const merged = mergeCandidates([
      cand({ kind: 'skill', name: 'fetch' }),
      cand({ kind: 'context', name: 'fetch' }),
      cand({ kind: 'skill', name: 'Fetch' }),
      cand({ kind: 'mcp', name: 'fetch', command: 'npx fetch' }),
    ]);
    expect(merged.map((c) => c.identity)).toEqual(['skill:fetch', 'context:fetch', 'skill:Fetch', 'mcp:fetch|npx fetch']);
  });

  it('R-62: two candidates with equal identity are one capability — mcp same name, different command stay two', () => {
    const merged = mergeCandidates([
      cand({ kind: 'mcp', name: 'db', command: 'npx db1' }),
      cand({ kind: 'mcp', name: 'db', command: 'npx db1', sources: [ACCT_B] }),
      cand({ kind: 'mcp', name: 'db', command: 'npx db2' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ identity: 'mcp:db|npx db1', sources: [ACCT_A, ACCT_B] });
    expect(merged[1]).toMatchObject({ identity: 'mcp:db|npx db2', sources: [ACCT_A] });
  });

  it('R-63: equal identity merges into the sorted unique union of sources; identities keep first-seen order', () => {
    const merged = mergeCandidates([
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_C, ACCT_A] }),
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_A, ACCT_B] }),
      cand({ kind: 'skill', name: 'other', sources: [ACCT_B] }),
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_A, ACCT_C, ACCT_A] }),
    ]);
    expect(merged.map((c) => [c.identity, c.sources])).toEqual([
      ['skill:fetch', [ACCT_A, ACCT_B, ACCT_C]],
      ['skill:other', [ACCT_B]],
    ]);
  });

  it('R-63: never mutates its input', () => {
    const input = freezeDeep([
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_B, ACCT_A], path: 'a' }),
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_A], path: 'b' }),
    ]);
    const before = JSON.parse(JSON.stringify(input)) as unknown;
    const merged = mergeCandidates(input);
    expect(JSON.parse(JSON.stringify(input)) as unknown).toEqual(before);
    expect(merged).toHaveLength(1);
  });

  it("R-63: a conflicting command/path/description keeps the lexicographically smallest account's value", () => {
    const merged = mergeCandidates([
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_B], path: 'from-b', description: 'B says' }),
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_A], path: 'from-a', description: 'A says' }),
    ]);
    expect(merged[0]?.path).toBe('from-a'); // ACCT_A < ACCT_B even though it arrived later
    expect(merged[0]?.description).toBe('A says');

    // the smallest backer of a many-source candidate beats a larger single account
    const merged2 = mergeCandidates([
      cand({ kind: 'skill', name: 'x', sources: [ACCT_C], path: 'from-c' }),
      cand({ kind: 'skill', name: 'x', sources: [ACCT_B, ACCT_A], path: 'from-ab' }),
    ]);
    expect(merged2[0]?.path).toBe('from-ab');
  });

  it('merging a merged output again changes nothing (idempotence)', () => {
    const once = mergeCandidates([
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_B], path: 'from-b' }),
      cand({ kind: 'skill', name: 'fetch', sources: [ACCT_A], path: 'from-a' }),
      cand({ kind: 'mcp', name: 'db', command: 'npx db', sources: [ACCT_A, ACCT_B] }),
    ]);
    expect(mergeCandidates(once)).toEqual(once);
  });

  it('an empty scan and candidates without sources pass through untouched', () => {
    expect(mergeCandidates([])).toEqual([]);
    const lonely = cand({ kind: 'context', name: 'AGENTS.md', path: 'AGENTS.md', sources: [] });
    expect(mergeCandidates([lonely])).toEqual([{ ...lonely, identity: 'context:AGENTS.md' }]);
  });
});

describe('candidateToDefinition', () => {
  it('R-64: a candidate never carries an env value — mcp import copies only the command string', () => {
    const result = candidateToDefinition(cand({ kind: 'mcp', name: 'db', command: 'npx db', identity: 'x' }), capId('db'));
    expect(result).toEqual({
      ok: true,
      value: { kind: 'mcp', id: capId('db'), name: 'db', command: 'npx db', args: [], env: {} },
    });
  });

  it('R-65: the output passes validateDefinitions for every kind', () => {
    const cases = [
      cand({ kind: 'mcp', name: 'db', command: 'npx db' }),
      cand({ kind: 'skill', name: 'fetch', path: 'skills/fetch.md' }),
      cand({ kind: 'context', name: 'AGENTS.md', path: 'AGENTS.md' }),
    ];
    for (const c of cases) {
      const result = candidateToDefinition(c, capId('imported'));
      if (!result.ok) throw new Error(`expected ok for ${c.kind}`);
      const validated = validateDefinitions({ roles: [], flows: [], capabilities: [result.value] });
      expect(validated.ok).toBe(true);
    }
  });

  it('R-65: mcp without command is missing_command; skill/context without path is missing_path', () => {
    expect(candidateToDefinition(cand({ kind: 'mcp', name: 'db' }), capId('db'))).toEqual({ ok: false, error: 'missing_command' });
    expect(candidateToDefinition(cand({ kind: 'skill', name: 's' }), capId('s'))).toEqual({ ok: false, error: 'missing_path' });
    expect(candidateToDefinition(cand({ kind: 'context', name: 'c' }), capId('c'))).toEqual({ ok: false, error: 'missing_path' });
  });

  it("R-65: a runtime 'hook' kind is unsupported (deferred)", () => {
    const hook = { kind: 'hook', name: 'fmt', command: 'fmt', sources: [ACCT_A] } as unknown as CapabilityCandidate;
    expect(candidateToDefinition(hook, capId('fmt'))).toEqual({ ok: false, error: 'unsupported_kind' });
  });
});
