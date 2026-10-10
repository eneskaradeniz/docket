// Persistence ports for assistant actions (durable, SQLite) and the permission grants that cover
// them (memory only: a grant must die with the app, so no implementation of GrantRepo may write to disk).
import type { ActionId, ActionRecord, ConversationId, Grant, GrantId } from '../../domain/index';

export interface ActionRepo {
  save(r: ActionRecord): Promise<void>; // upsert
  get(id: ActionId): Promise<ActionRecord | undefined>;
  /** Oldest proposal first, ties by id. */
  forConversation(c: ConversationId): Promise<readonly ActionRecord[]>;
  /** The conversation's records still waiting for the operator, in the same order. */
  pending(c: ConversationId): Promise<readonly ActionRecord[]>;
  /** How many records the conversation has, in any status. */
  countFor(c: ConversationId): Promise<number>;
}

export interface GrantRepo {
  save(g: Grant): Promise<void>; // upsert
  get(id: GrantId): Promise<Grant | undefined>;
  /** Oldest grant first, ties by id. */
  forConversation(c: ConversationId): Promise<readonly Grant[]>;
}
