// In-memory ActionRepo and GrantRepo — carry the stores' ordering (oldest first, ties by id). Records
// go in and out as JSON copies, like the SQLite store, so neither side can mutate what is stored and
// an `undefined` field reads back absent.
import type { ActionId, ActionRecord, ConversationId, Grant, GrantId } from '../../../domain/index';

import type { ActionRepo, GrantRepo } from '../action-repo';

export interface FakeActionRepo extends ActionRepo {}
export interface FakeGrantRepo extends GrantRepo {}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const byId = (a: { readonly id: string }, b: { readonly id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const createFakeActionRepo = (): FakeActionRepo => {
  const records = new Map<ActionId, ActionRecord>();
  const of = (c: ConversationId): ActionRecord[] =>
    [...records.values()].filter((r) => r.conversation === c).sort((a, b) => a.proposedAt - b.proposedAt || byId(a, b));

  return {
    save: async (r): Promise<void> => {
      records.set(r.id, copy(r));
    },
    get: async (id): Promise<ActionRecord | undefined> => {
      const found = records.get(id);
      return found === undefined ? undefined : copy(found);
    },
    forConversation: async (c): Promise<readonly ActionRecord[]> => of(c).map(copy),
    pending: async (c): Promise<readonly ActionRecord[]> => of(c).filter((r) => r.status === 'pending').map(copy),
    countFor: async (c): Promise<number> => of(c).length,
  };
};

export const createFakeGrantRepo = (): FakeGrantRepo => {
  const grants = new Map<GrantId, Grant>();
  return {
    save: async (g): Promise<void> => {
      grants.set(g.id, copy(g));
    },
    get: async (id): Promise<Grant | undefined> => {
      const found = grants.get(id);
      return found === undefined ? undefined : copy(found);
    },
    forConversation: async (c): Promise<readonly Grant[]> =>
      [...grants.values()]
        .filter((g) => g.conversation === c)
        .sort((a, b) => a.grantedAt - b.grantedAt || byId(a, b))
        .map(copy),
  };
};
