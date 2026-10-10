// In-memory ConversationRepo — carries the SQLite store's listing rules: pinned first, then newest
// update first, filters narrowing, a case-insensitive substring query over title and message text.
import type { Conversation, ConversationId, ConversationScope, DraftId, WorkOrderDraft } from '../../../domain/index';

import type { ConversationFilter, ConversationRepo, ConversationSummary } from '../conversation-repo';

export interface FakeConversationRepo extends ConversationRepo {}

const scopeKey = (scope: ConversationScope): string =>
  scope.kind === 'global' ? 'global' : scope.kind === 'project' ? `project:${scope.project}` : `workOrder:${scope.workOrder}`;

const searchText = (c: Conversation): string => [c.title, ...c.messages.map((m) => m.text)].join('\n').toLowerCase();

const byId = <T extends { readonly id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const createFakeConversationRepo = (): FakeConversationRepo => {
  // Structured copies in and out, so neither side can mutate what is stored.
  const conversations = new Map<ConversationId, Conversation>();
  const drafts = new Map<DraftId, WorkOrderDraft>();
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    save: async (c): Promise<void> => {
      conversations.set(c.id, copy(c));
    },

    get: async (id): Promise<Conversation | undefined> => {
      const found = conversations.get(id);
      return found === undefined ? undefined : copy(found);
    },

    list: async (filter: ConversationFilter): Promise<readonly ConversationSummary[]> => {
      const query = filter.query === undefined ? '' : filter.query.toLowerCase();
      const wanted = filter.scope === undefined ? undefined : scopeKey(filter.scope);
      const rows = [...conversations.values()]
        .filter(
          (c) =>
            (wanted === undefined || scopeKey(c.scope) === wanted) &&
            (filter.pinned === undefined || c.pinned === filter.pinned) &&
            (query === '' || searchText(c).includes(query)),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || -byId(a, b))
        .map(
          (c): ConversationSummary => ({
            id: c.id,
            scope: copy(c.scope),
            title: c.title,
            updatedAt: c.updatedAt,
            pinned: c.pinned,
            messageCount: c.messages.length,
          }),
        );
      return filter.limit === undefined ? rows : rows.slice(0, Math.max(0, Math.floor(filter.limit)));
    },

    delete: async (id): Promise<void> => {
      conversations.delete(id);
      for (const draft of [...drafts.values()]) if (draft.conversation === id) drafts.delete(draft.id);
    },

    saveDraft: async (d): Promise<void> => {
      drafts.set(d.id, copy(d));
    },

    getDraft: async (id): Promise<WorkOrderDraft | undefined> => {
      const found = drafts.get(id);
      return found === undefined ? undefined : copy(found);
    },

    draftsOf: async (conversation): Promise<readonly WorkOrderDraft[]> =>
      [...drafts.values()]
        .filter((d) => d.conversation === conversation)
        .sort(byId)
        .map(copy),
  };
};
