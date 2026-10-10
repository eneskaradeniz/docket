// Permission grants live in memory only. A grant is the operator's short, deliberate "go ahead"
// for one conversation; it must not outlive the app, so nothing here is written anywhere and a
// new repository — what each app start builds — starts empty.
import type { GrantRepo } from '../../application/index';
import type { Grant, GrantId } from '../../domain/index';

const copy = (grant: Grant): Grant => JSON.parse(JSON.stringify(grant)) as Grant;

export function createMemoryGrantRepo(): GrantRepo {
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
        .sort((a, b) => a.grantedAt - b.grantedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(copy),
  };
}
