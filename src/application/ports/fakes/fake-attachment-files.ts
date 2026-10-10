// In-memory AttachmentFiles — carries the real adapter's contract: ids must be ULIDs, an attachment
// is written once, reads of anything invalid or absent answer undefined, removing is forgiving.
import { isUlid, type AttachmentId, type ConversationId } from '../../../domain/index';

import type { AttachmentFiles } from '../attachment-files';

export interface FakeAttachmentFiles extends AttachmentFiles {
  /** Test helper: the "<conversation>/<attachment>" entries currently stored, sorted. */
  stored(): readonly string[];
}

export const createFakeAttachmentFiles = (): FakeAttachmentFiles => {
  const files = new Map<string, Uint8Array>();
  const key = (conversation: ConversationId, id: AttachmentId): string => `${conversation}/${id}`;
  const valid = (conversation: string, id: string): boolean => isUlid(conversation) && isUlid(id);

  return {
    write: async (conversation, id, bytes): Promise<void> => {
      if (!valid(conversation, id)) throw new Error('invalid conversation or attachment id');
      if (files.has(key(conversation, id))) throw new Error('attachment already exists');
      files.set(key(conversation, id), new Uint8Array(bytes));
    },

    read: async (conversation, id): Promise<Uint8Array | undefined> => {
      if (!valid(conversation, id)) return undefined;
      const found = files.get(key(conversation, id));
      return found === undefined ? undefined : new Uint8Array(found);
    },

    remove: async (conversation, id): Promise<void> => {
      if (!valid(conversation, id)) throw new Error('invalid conversation or attachment id');
      files.delete(key(conversation, id));
    },

    removeAll: async (conversation): Promise<void> => {
      if (!isUlid(conversation)) throw new Error('invalid conversation id');
      for (const entry of [...files.keys()]) if (entry.startsWith(`${conversation}/`)) files.delete(entry);
    },

    stored: (): readonly string[] => [...files.keys()].sort(),
  };
};
