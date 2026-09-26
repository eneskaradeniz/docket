import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { parseSlug, parseUlid } from './ids';

const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('Actor', () => {
  it('represents a user with an id and an optional label', () => {
    const actor: Actor = { kind: 'user', id: 'u1', label: 'Enes' };
    expect(actor).toEqual({ kind: 'user', id: 'u1', label: 'Enes' });
  });

  it('represents an agent with a run id and a role slug', () => {
    const runId = parseUlid<'run'>(VALID_ULID);
    const role = parseSlug<'role'>('reviewer');
    if (!runId.ok || !role.ok) throw new Error('fixtures must parse');
    const actor: Actor = { kind: 'agent', runId: runId.value, role: role.value };
    expect(actor).toEqual({ kind: 'agent', runId: VALID_ULID, role: 'reviewer' });
  });

  it('represents the system with a component name', () => {
    const actor: Actor = { kind: 'system', component: 'dispatcher' };
    expect(actor).toEqual({ kind: 'system', component: 'dispatcher' });
  });
});
