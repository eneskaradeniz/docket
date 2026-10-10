// The AttachmentFiles port over the real filesystem: <root>/conversations/<conversationId>/<attachmentId>.
// An attachment is untrusted content from the operator's machine, so both ids must be ULIDs (which
// cannot hold a separator or a dot), nothing resolves outside the conversation directory, and no
// symlink is created, followed or written through. A file is staged in a temporary directory and
// linked into place in one step, so a reader sees all of it or none, and an existing attachment is
// never replaced.
import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AttachmentFiles } from '../../application/index';
import { isUlid } from '../../domain/index';

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0; // absent on Windows, where the realpath check carries it

const lstatIfPresent = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
  try {
    return await lstat(path);
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw failure;
  }
};

/** Makes sure `path` is a real directory (never a symlink to one), creating it when absent. */
const ensureRealDirectory = async (path: string): Promise<void> => {
  const found = await lstatIfPresent(path);
  if (found === undefined) {
    await mkdir(path);
    return;
  }
  if (found.isSymbolicLink() || !found.isDirectory()) throw new Error('attachment storage path is not a plain directory');
};

/** Whether `path` is a real directory; a missing one answers false, a symlink or file throws. */
const isRealDirectory = async (path: string): Promise<boolean> => {
  const found = await lstatIfPresent(path);
  if (found === undefined) return false;
  if (found.isSymbolicLink() || !found.isDirectory()) throw new Error('attachment storage path is not a plain directory');
  return true;
};

export const createFsAttachmentFiles = (root: string): AttachmentFiles => {
  const conversationsDir = join(root, 'conversations');
  const conversationDir = (conversation: string): string => join(conversationsDir, conversation);
  const requireIds = (...ids: readonly string[]): void => {
    if (!ids.every((id) => typeof id === 'string' && isUlid(id))) throw new Error('invalid conversation or attachment id');
  };

  return {
    write: async (conversation, id, bytes): Promise<void> => {
      requireIds(conversation, id);
      await mkdir(root, { recursive: true });
      await ensureRealDirectory(conversationsDir);
      await ensureRealDirectory(conversationDir(conversation));

      const staging = await mkdtemp(join(conversationDir(conversation), '.staging-'));
      try {
        const staged = join(staging, 'bytes');
        // "wx": create-only, and never through a symlink at the staged name.
        await writeFile(staged, bytes, { flag: 'wx' });
        // link fails with EEXIST when anything — a file or a symlink — already sits at the target,
        // which is what makes the attachment immutable.
        await link(staged, join(conversationDir(conversation), id));
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },

    read: async (conversation, id): Promise<Uint8Array | undefined> => {
      if (!isUlid(conversation) || !isUlid(id)) return undefined;
      const target = join(conversationDir(conversation), id);
      try {
        // The resolved file must be exactly where the ids say, measured from the resolved data
        // root: a symlink anywhere on the way makes the two differ.
        const expected = join(await realpath(root), 'conversations', conversation, id);
        if ((await realpath(target)) !== expected) return undefined;
        const handle = await open(target, constants.O_RDONLY | NO_FOLLOW);
        try {
          if (!(await handle.stat()).isFile()) return undefined;
          return new Uint8Array(await handle.readFile());
        } finally {
          await handle.close();
        }
      } catch {
        return undefined; // missing, unreadable or refused: the caller sees "no such attachment"
      }
    },

    remove: async (conversation, id): Promise<void> => {
      requireIds(conversation, id);
      if (!(await isRealDirectory(conversationsDir)) || !(await isRealDirectory(conversationDir(conversation)))) return;
      // rm on a symlink removes the link, never the file it points at.
      await rm(join(conversationDir(conversation), id), { force: true });
    },

    removeAll: async (conversation): Promise<void> => {
      requireIds(conversation);
      if (!(await isRealDirectory(conversationsDir))) return;
      // A symlink in place of the conversation directory is removed as a link only.
      await rm(conversationDir(conversation), { recursive: true, force: true });
    },
  };
};
