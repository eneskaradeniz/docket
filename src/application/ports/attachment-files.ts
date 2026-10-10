// Storage port for the bytes of conversation attachments. An attachment is written once and never
// changed; both ids must be ULIDs and an implementation refuses anything else before touching storage.
import type { AttachmentId, ConversationId } from '../../domain/index';

export interface AttachmentFiles {
  /** Rejects on an invalid id, and when the attachment already exists: an attachment is immutable. */
  write(conversation: ConversationId, id: AttachmentId, bytes: Uint8Array): Promise<void>;
  /** The bytes, or undefined when absent or when an id is not a ULID. */
  read(conversation: ConversationId, id: AttachmentId): Promise<Uint8Array | undefined>;
  /** Deletes one attachment; one that is not there is not an error. Used to undo a write whose
   *  record could not be saved, so it must never touch the conversation's other attachments. */
  remove(conversation: ConversationId, id: AttachmentId): Promise<void>;
  /** Deletes every attachment of the conversation; a conversation without any is not an error. */
  removeAll(conversation: ConversationId): Promise<void>;
}
