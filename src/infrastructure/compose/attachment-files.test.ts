// I-74 (behaviour, atomic create-only write, removal) and I-75 (id validation, containment, symlink
// refusal) for the AttachmentFiles port: the same behaviour cases run on the fake and on the
// file-system adapter, and the adversarial cases once more against the real disk.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AttachmentFiles } from '../../application/index';
import { createFakeAttachmentFiles } from '../../application/ports/fakes/index';
import { parseUlid, type AttachmentId, type ConversationId } from '../../domain/index';

import { createFsAttachmentFiles } from './attachment-files';

const conv = (s: string): ConversationId => {
  const parsed = parseUlid<'conversation'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const att = (s: string): AttachmentId => {
  const parsed = parseUlid<'attachment'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const CONV = conv('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const OTHER = conv('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const A1 = att('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const A2 = att('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const A3 = att('01ARZ3NDEKTSV4RRFFQ69G5FA3');

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | undefined): string | undefined => (bytes === undefined ? undefined : new TextDecoder().decode(bytes));

let root: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'docket-attachment-files-'));
  root = join(base, 'data');
  outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside secret');
});

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

const BAD_IDS: readonly string[] = [
  '',
  '..',
  '.',
  '../x',
  '../../outside',
  '/etc/passwd',
  'a/b',
  'a\\b',
  'C:\\x',
  '01ARZ3NDEKTSV4RRFFQ69G5FA1/..',
  '01ARZ3NDEKTSV4RRFFQ69G5FA1/../x',
  '01ARZ3NDEKTSV4RRFFQ69G5FA1\u0000',
  '01ARZ3NDEKTSV4RRFFQ69G5FA',
  '01ARZ3NDEKTSV4RRFFQ69G5FA11',
  '01arz3ndektsv4rrffq69g5fa1',
  '01ARZ3NDEKTSV4RRFFQ69G5FAI',
  '%2e%2e',
  '\u202E01ARZ3NDEKTSV4RRFFQ69G5FA1',
  '\uFF0E\uFF0E',
  'not-a-ulid',
];

describe.each([
  ['fake', (): AttachmentFiles => createFakeAttachmentFiles()],
  ['fs', (): AttachmentFiles => createFsAttachmentFiles(root)],
])('AttachmentFiles behaviour: %s', (_kind, make) => {
  it('I-74: write then read round-trips the bytes exactly, binary and empty included', async () => {
    const files = make();
    const binary = new Uint8Array([0, 255, 1, 2, 128, 0]);
    await files.write(CONV, A1, binary);
    await files.write(CONV, A2, new Uint8Array(0));
    await files.write(CONV, A3, enc('héllo ünï'));
    expect(Array.from((await files.read(CONV, A1)) ?? [])).toEqual(Array.from(binary));
    expect((await files.read(CONV, A2))?.length).toBe(0);
    expect(dec(await files.read(CONV, A3))).toBe('héllo ünï');
  });

  it('I-74: a read of an absent attachment or conversation answers undefined and conversations do not mix', async () => {
    const files = make();
    await files.write(CONV, A1, enc('one'));
    expect(await files.read(CONV, A2)).toBeUndefined();
    expect(await files.read(OTHER, A1)).toBeUndefined();
    await files.write(OTHER, A1, enc('two'));
    expect(dec(await files.read(CONV, A1))).toBe('one');
    expect(dec(await files.read(OTHER, A1))).toBe('two');
  });

  it('I-74: an attachment is created once — writing it again rejects and leaves the first bytes', async () => {
    const files = make();
    await files.write(CONV, A1, enc('first'));
    await expect(files.write(CONV, A1, enc('second'))).rejects.toThrow();
    expect(dec(await files.read(CONV, A1))).toBe('first');
  });

  it('I-74: remove deletes only that attachment; a missing one is not an error', async () => {
    const files = make();
    await files.write(CONV, A1, enc('1'));
    await files.write(CONV, A2, enc('2'));
    await files.remove(CONV, A1);
    expect(await files.read(CONV, A1)).toBeUndefined();
    expect(dec(await files.read(CONV, A2))).toBe('2');
    await files.remove(CONV, A1);
    await files.remove(OTHER, A3);
    await files.write(CONV, A1, enc('again'));
    expect(dec(await files.read(CONV, A1))).toBe('again');
  });

  it('I-74: removeAll deletes every attachment of that conversation and no other; none present is not an error', async () => {
    const files = make();
    await files.write(CONV, A1, enc('1'));
    await files.write(CONV, A2, enc('2'));
    await files.write(OTHER, A1, enc('other'));
    await files.removeAll(CONV);
    expect(await files.read(CONV, A1)).toBeUndefined();
    expect(await files.read(CONV, A2)).toBeUndefined();
    expect(dec(await files.read(OTHER, A1))).toBe('other');
    await files.removeAll(CONV);
    await files.removeAll(conv('01ARZ3NDEKTSV4RRFFQ69G5FC9'));
    await files.write(CONV, A1, enc('fresh'));
    expect(dec(await files.read(CONV, A1))).toBe('fresh');
  });

  it('I-75: an id that is not a ULID — traversal, separators, NUL, case, length, format characters — is refused', async () => {
    const files = make();
    await files.write(CONV, A1, enc('ok'));
    for (const bad of BAD_IDS) {
      const label = JSON.stringify(bad).slice(0, 40);
      await expect(files.write(bad as ConversationId, A2, enc('x')), `write conversation ${label}`).rejects.toThrow();
      await expect(files.write(CONV, bad as AttachmentId, enc('x')), `write attachment ${label}`).rejects.toThrow();
      expect(await files.read(bad as ConversationId, A1), `read conversation ${label}`).toBeUndefined();
      expect(await files.read(CONV, bad as AttachmentId), `read attachment ${label}`).toBeUndefined();
      await expect(files.remove(bad as ConversationId, A1), `remove conversation ${label}`).rejects.toThrow();
      await expect(files.remove(CONV, bad as AttachmentId), `remove attachment ${label}`).rejects.toThrow();
      await expect(files.removeAll(bad as ConversationId), `removeAll ${label}`).rejects.toThrow();
    }
    expect(dec(await files.read(CONV, A1))).toBe('ok');
  });
});

describe('createFsAttachmentFiles on disk', () => {
  const convDir = (c: ConversationId = CONV): string => join(root, 'conversations', c);
  const names = (dir: string): readonly string[] => readdirSync(dir).sort();

  it('I-74: bytes land at <root>/conversations/<conversationId>/<attachmentId>', async () => {
    await createFsAttachmentFiles(root).write(CONV, A1, enc('x'));
    expect(readFileSync(join(convDir(), A1), 'utf8')).toBe('x');
  });

  it('I-74: a successful write leaves no temporary file or directory behind', async () => {
    const files = createFsAttachmentFiles(root);
    await files.write(CONV, A1, enc('x'));
    await files.write(CONV, A2, enc('y'));
    expect(names(convDir())).toEqual([A1, A2]);
  });

  it('I-74: a refused second write leaves the original untouched and no temporary file', async () => {
    const files = createFsAttachmentFiles(root);
    await files.write(CONV, A1, enc('first'));
    await expect(files.write(CONV, A1, enc('second'))).rejects.toThrow();
    expect(names(convDir())).toEqual([A1]);
    expect(readFileSync(join(convDir(), A1), 'utf8')).toBe('first');
  });

  it('I-74: removeAll removes the conversation directory itself', async () => {
    const files = createFsAttachmentFiles(root);
    await files.write(CONV, A1, enc('x'));
    await files.removeAll(CONV);
    expect(existsSync(convDir())).toBe(false);
  });

  it('I-75: a rejected id creates nothing on disk', async () => {
    const files = createFsAttachmentFiles(root);
    await expect(files.write('../escape' as ConversationId, A1, enc('x'))).rejects.toThrow();
    await expect(files.write(CONV, '../escape' as AttachmentId, enc('x'))).rejects.toThrow();
    expect(existsSync(join(root, 'escape'))).toBe(false);
    expect(existsSync(join(root, 'conversations', 'escape'))).toBe(false);
    expect(existsSync(convDir()) ? names(convDir()) : []).toEqual([]);
  });

  it('I-75: a symlink where an attachment belongs is never followed on read, and write refuses to go through it', async () => {
    const files = createFsAttachmentFiles(root);
    await files.write(CONV, A1, enc('real'));
    symlinkSync(join(outside, 'secret.txt'), join(convDir(), A2));
    symlinkSync(join(convDir(), A1), join(convDir(), A3));
    expect(await files.read(CONV, A2)).toBeUndefined();
    expect(await files.read(CONV, A3)).toBeUndefined();
    await expect(files.write(CONV, A2, enc('overwrite'))).rejects.toThrow();
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside secret');
    expect(dec(await files.read(CONV, A1))).toBe('real');
  });

  it('I-75: remove of a symlink drops the link, never the file it points at', async () => {
    const files = createFsAttachmentFiles(root);
    await files.write(CONV, A1, enc('real'));
    symlinkSync(join(outside, 'secret.txt'), join(convDir(), A2));
    await files.remove(CONV, A2);
    expect(existsSync(join(convDir(), A2))).toBe(false);
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside secret');
  });

  it('I-75: a conversation directory that is a symlink is not read through, written through or emptied', async () => {
    const files = createFsAttachmentFiles(root);
    mkdirSync(join(root, 'conversations'), { recursive: true });
    writeFileSync(join(outside, A1), 'planted');
    symlinkSync(outside, convDir());
    expect(await files.read(CONV, A1)).toBeUndefined();
    await expect(files.write(CONV, A2, enc('x'))).rejects.toThrow();
    await expect(files.remove(CONV, A1)).rejects.toThrow();
    await files.removeAll(CONV);
    expect(readFileSync(join(outside, A1), 'utf8')).toBe('planted');
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside secret');
    expect(names(outside)).toEqual([A1, 'secret.txt'].sort());
    expect(lstatSync(outside).isDirectory()).toBe(true);
  });

  it('I-75: a conversations directory that is a symlink refuses every operation and touches nothing behind it', async () => {
    const files = createFsAttachmentFiles(root);
    mkdirSync(join(outside, CONV));
    writeFileSync(join(outside, CONV, A1), 'planted');
    symlinkSync(outside, join(root, 'conversations'));
    await expect(files.write(CONV, A2, enc('x'))).rejects.toThrow();
    expect(await files.read(CONV, A1)).toBeUndefined();
    await expect(files.remove(CONV, A1)).rejects.toThrow();
    await expect(files.removeAll(CONV)).rejects.toThrow();
    expect(readFileSync(join(outside, CONV, A1), 'utf8')).toBe('planted');
    expect(names(join(outside, CONV))).toEqual([A1]);
  });

  it('I-75: the data root itself being reached through a symlink still reads its own files', async () => {
    const alias = join(root, '..', 'alias');
    symlinkSync(root, alias);
    await createFsAttachmentFiles(alias).write(CONV, A1, enc('x'));
    expect(dec(await createFsAttachmentFiles(alias).read(CONV, A1))).toBe('x');
  });

  it('I-75: a directory or a non-regular file where an attachment belongs reads as undefined', async () => {
    const files = createFsAttachmentFiles(root);
    mkdirSync(join(convDir(), A1), { recursive: true });
    expect(await files.read(CONV, A1)).toBeUndefined();
  });
});
