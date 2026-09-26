import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES } from './roles';

const sentences = (text: string): readonly string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

describe('BUILTIN_ROLES', () => {
  it('has the seven contract roles in order', () => {
    expect(BUILTIN_ROLES.map((role) => role.id)).toEqual([
      'planner',
      'analyst',
      'developer',
      'test-writer',
      'reviewer',
      'security-auditor',
      'documenter',
    ]);
    expect(BUILTIN_ROLES.map((role) => role.name)).toEqual([
      'Planlayıcı',
      'Analist',
      'Geliştirici',
      'Test yazarı',
      'Gözden geçirici',
      'Güvenlik denetçisi',
      'Belgeci',
    ]);
  });

  it('gives each role its contract write scope', () => {
    expect(Object.fromEntries(BUILTIN_ROLES.map((role) => [role.id, role.writeScope]))).toEqual({
      planner: { kind: 'docs' },
      analyst: { kind: 'docs' },
      developer: { kind: 'repo' },
      'test-writer': { kind: 'tests' },
      reviewer: { kind: 'none' },
      'security-auditor': { kind: 'none' },
      documenter: { kind: 'docs' },
    });
  });

  it('marks every role active with no capabilities', () => {
    for (const role of BUILTIN_ROLES) {
      expect(role.active).toBe(true);
      expect(role.capabilities).toEqual([]);
    }
  });

  it('writes 3-6 sentence English instructions for every role', () => {
    for (const role of BUILTIN_ROLES) {
      const parts = sentences(role.instructions);
      expect(parts.length, `instructions of "${role.id}"`).toBeGreaterThanOrEqual(3);
      expect(parts.length, `instructions of "${role.id}"`).toBeLessThanOrEqual(6);
      expect(role.instructions, `instructions of "${role.id}"`).toMatch(/^[A-Z].*[.!?]$/s);
    }
  });
});
