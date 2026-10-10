// Persistence port for pages (their versions live inside the record) and page comments.
import type { EpochMs, Page, PageComment, PageId, ProjectSlug, Ulid, WorkOrderId } from '../../domain/index';

export interface PageRepo {
  save(page: Page): Promise<void>; // upsert
  get(id: PageId): Promise<Page | undefined>;
  /** Id ascending (creation order); both filters narrow when present. */
  list(filter: { readonly workOrder?: WorkOrderId; readonly project?: ProjectSlug }): Promise<readonly Page[]>;
  saveComment(comment: PageComment): Promise<void>; // upsert
  /** The page's comments, id ascending (writing order). */
  comments(
    page: PageId,
    filter: { readonly undelivered?: boolean; readonly version?: number },
  ): Promise<readonly PageComment[]>;
  /** Stamps `at` on each named comment that has no delivery time yet; unknown ids and already
   *  delivered comments are left alone, so repeating the call changes nothing. */
  markDelivered(ids: readonly Ulid<'page-comment'>[], at: EpochMs): Promise<void>;
}
