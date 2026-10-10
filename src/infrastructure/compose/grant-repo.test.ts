// Parity (I-78) of the fake and the memory grant repository, and the restart semantics: a grant
// is held in memory only, so a new repository — what a new app start builds — knows none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { GrantRepo } from '../../application/index';
import { createFakeGrantRepo } from '../../application/ports/fakes/index';
import { parseUlid, type ConversationId, type Grant, type GrantId, type Ulid } from '../../domain/index';

import { createMemoryGrantRepo } from './grant-repo';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const C1: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const C2: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const G1: GrantId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FG1');
const G2: GrantId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FG2');
const G3: GrantId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FG3');

const grant = (id: GrantId, conversation: ConversationId, over: Partial<Grant> = {}): Grant => ({
  id,
  conversation,
  by: { kind: 'user', id: 'u1' },
  classes: ['open_work_order', 'roadmap_edit'],
  grantedAt: 1_000,
  expiresAt: 1_000 + 30 * 60_000,
  applied: 0,
  ...over,
});

describe('createMemoryGrantRepo', () => {
  describe.each([
    ['fake', (): GrantRepo => createFakeGrantRepo()],
    ['memory', (): GrantRepo => createMemoryGrantRepo()],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-78: save upserts by id; get round-trips every field and is undefined for an unknown id', async () => {
      const repo = makeRepo();
      await repo.save(grant(G1, C1));
      await repo.save(grant(G1, C1, { applied: 3, revokedAt: 5_000 }));
      expect(await repo.get(G1)).toStrictEqual(grant(G1, C1, { applied: 3, revokedAt: 5_000 }));
      expect(await repo.get(G2)).toBeUndefined();
    });

    it('I-78: a stored grant is a copy — mutating what was saved or read never reaches the store', async () => {
      const repo = makeRepo();
      const saved = grant(G1, C1);
      await repo.save(saved);
      (saved as { applied: number }).applied = 99;
      const read = await repo.get(G1);
      (read as { applied: number }).applied = 77;
      (read?.classes as ActionClassList).push('setting_change');
      expect(await repo.get(G1)).toStrictEqual(grant(G1, C1));
    });

    it('I-78: forConversation lists only that conversation\'s grants, oldest first, ties by id', async () => {
      const repo = makeRepo();
      await repo.save(grant(G3, C1, { grantedAt: 300 }));
      await repo.save(grant(G2, C1, { grantedAt: 100 }));
      await repo.save(grant(G1, C1, { grantedAt: 100 }));
      await repo.save(grant(ulid('01ARZ3NDEKTSV4RRFFQ69G5FG4'), C2, { grantedAt: 50 }));
      expect((await repo.forConversation(C1)).map((g) => g.id)).toEqual([G1, G2, G3]);
      expect((await repo.forConversation(C2)).map((g) => g.id)).toEqual([ulid('01ARZ3NDEKTSV4RRFFQ69G5FG4')]);
      expect(await repo.forConversation(ulid('01ARZ3NDEKTSV4RRFFQ69G5FZZ'))).toEqual([]);
    });
  });

  it('I-78: a grant dies with its repository — a new repository (a new app start) holds none', async () => {
    const first = createMemoryGrantRepo();
    await first.save(grant(G1, C1));
    expect(await first.forConversation(C1)).toHaveLength(1);
    const afterRestart = createMemoryGrantRepo();
    expect(await afterRestart.get(G1)).toBeUndefined();
    expect(await afterRestart.forConversation(C1)).toEqual([]);
  });

  it('I-78: the memory repository touches no file, database or network module', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'infrastructure', 'compose', 'grant-repo.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:|require\(|from '\.\.\/storage|sqlite|writeFile/);
  });
});

type ActionClassList = string[];
