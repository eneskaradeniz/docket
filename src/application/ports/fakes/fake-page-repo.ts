// In-memory PageRepo — pages and comments keyed by id, listed in id order like the SQLite store.
import type { EpochMs, Page, PageComment, PageId, ProjectSlug, Ulid, WorkOrderId } from '../../../domain/index';

import type { PageRepo } from '../page-repo';

export interface FakePageRepo extends PageRepo {}

const byId = <T extends { readonly id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const createFakePageRepo = (): FakePageRepo => {
  // Structured copies in and out, so neither side can mutate what is stored.
  const pages = new Map<PageId, Page>();
  const comments = new Map<Ulid<'page-comment'>, PageComment>();
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    save: async (page: Page): Promise<void> => {
      pages.set(page.id, copy(page));
    },

    get: async (id: PageId): Promise<Page | undefined> => {
      const found = pages.get(id);
      return found === undefined ? undefined : copy(found);
    },

    list: async (filter: { readonly workOrder?: WorkOrderId; readonly project?: ProjectSlug }): Promise<readonly Page[]> =>
      [...pages.values()]
        .filter(
          (page) =>
            (filter.workOrder === undefined || page.workOrder === filter.workOrder) &&
            (filter.project === undefined || page.project === filter.project),
        )
        .sort(byId)
        .map(copy),

    saveComment: async (comment: PageComment): Promise<void> => {
      comments.set(comment.id, copy(comment));
    },

    comments: async (
      page: PageId,
      filter: { readonly undelivered?: boolean; readonly version?: number },
    ): Promise<readonly PageComment[]> =>
      [...comments.values()]
        .filter(
          (comment) =>
            comment.page === page &&
            (filter.undelivered !== true || comment.deliveredAt === undefined) &&
            (filter.version === undefined || comment.version === filter.version),
        )
        .sort(byId)
        .map(copy),

    markDelivered: async (ids: readonly Ulid<'page-comment'>[], at: EpochMs): Promise<void> => {
      for (const id of ids) {
        const found = comments.get(id);
        if (found !== undefined && found.deliveredAt === undefined) comments.set(id, { ...found, deliveredAt: at });
      }
    },
  };
};
