// Persistence port for conversations (their messages live inside the record) and the work-order
// drafts a conversation produced.
import type { Conversation, ConversationId, ConversationScope, DraftId, EpochMs, WorkOrderDraft } from '../../domain/index';

export interface ConversationSummary {
  readonly id: ConversationId;
  readonly scope: ConversationScope;
  readonly title: string;
  readonly updatedAt: EpochMs;
  readonly pinned: boolean;
  readonly messageCount: number;
}

export interface ConversationFilter {
  readonly scope?: ConversationScope;
  readonly pinned?: boolean;
  /** Case-insensitive substring over the title and the text of every message. */
  readonly query?: string;
  readonly limit?: number;
}

export interface ConversationRepo {
  save(c: Conversation): Promise<void>; // upsert
  get(id: ConversationId): Promise<Conversation | undefined>;
  /** Pinned first, then newest-updated first (ties by id, descending). Every filter narrows. */
  list(filter: ConversationFilter): Promise<readonly ConversationSummary[]>;
  /** Removes the conversation and all its drafts; an unknown id is not an error. */
  delete(id: ConversationId): Promise<void>;
  saveDraft(d: WorkOrderDraft): Promise<void>; // upsert
  getDraft(id: DraftId): Promise<WorkOrderDraft | undefined>;
  /** The conversation's drafts in id order. */
  draftsOf(conversation: ConversationId): Promise<readonly WorkOrderDraft[]>;
}
