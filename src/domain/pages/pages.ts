// Pages: visual artifacts an agent publishes, the user comments on and approves. A page is
// untrusted content, so every rule here exists to keep what an agent hands over inside a version
// directory and tied to one specific, immutable version.
import { err, ok, type Actor, type ConversationId, type EpochMs, type PageId, type ProjectSlug, type Result, type Ulid, type WorkOrderId } from '../shared';

export type PageKind = 'html' | 'diagram' | 'markdown' | 'table' | 'image' | 'report';
export type PageApproval = 'none' | 'pending' | 'approved' | 'rejected';

/** `path` is relative, '/'-separated and passes `validatePagePath`. */
export interface PageFileRef {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PageVersion {
  readonly n: number;
  readonly createdAt: EpochMs;
  readonly by: Actor;
  readonly entry: string;
  readonly files: readonly PageFileRef[];
}

export interface PageComment {
  readonly id: Ulid<'page-comment'>;
  readonly page: PageId;
  readonly version: number;
  readonly by: Actor;
  readonly at: EpochMs;
  readonly text: string;
  readonly anchor?: string;
  readonly deliveredAt?: EpochMs;
}

export interface Page {
  readonly id: PageId;
  readonly title: string;
  readonly kind: PageKind;
  readonly workOrder?: WorkOrderId;
  readonly project?: ProjectSlug;
  /** The conversation whose chat turn made this page; absent on run-made and operator pages. Set
   *  once at creation and never rewritten — the only ownership proof for chat page updates. */
  readonly conversation?: ConversationId;
  readonly createdBy: Actor;
  readonly createdAt: EpochMs;
  readonly versions: readonly PageVersion[];
  readonly approval: PageApproval;
  readonly approvedVersion?: number;
}

/** How a kind reads in Turkish; the library search matches a typed word against it. */
export const PAGE_KIND_NAMES_TR: Readonly<Record<PageKind, string>> = {
  html: 'taslak',
  diagram: 'diyagram',
  markdown: 'metin markdown',
  table: 'tablo',
  image: 'resim',
  report: 'rapor',
};

export const pageKindNameTr = (kind: PageKind): string => PAGE_KIND_NAMES_TR[kind];

export type PageError = {
  readonly code:
    | 'empty_title'
    | 'title_too_long'
    | 'bad_kind'
    | 'no_files'
    | 'too_many_files'
    | 'file_too_large'
    | 'page_too_large'
    | 'bad_path'
    | 'entry_missing'
    | 'empty_comment'
    | 'comment_too_long'
    | 'not_found'
    | 'unknown_version'
    | 'not_pending'
    | 'self_approval'
    | 'stale_version';
};

export const PAGE_LIMITS = {
  titleMax: 120,
  filesMax: 64,
  fileMaxBytes: 5_000_000,
  pageMaxBytes: 20_000_000,
  commentMax: 4_000,
} as const;

const PATH_MAX = 200;

/** A Map, not an object literal: a kind such as "constructor" must not find an inherited entry. */
const ENTRY_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['html', ['.html']],
  ['diagram', ['.mmd', '.mermaid']],
  ['markdown', ['.md']],
  ['table', ['.csv', '.json']],
  // No .svg: an svg can carry script, so it is never an image page.
  ['image', ['.png', '.jpg', '.jpeg', '.gif', '.webp']],
  ['report', ['.html', '.md']],
]);

const hasControlCharacter = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const isPlainPath = (path: string): boolean => {
  if (path.length === 0 || path.length > PATH_MAX) return false;
  if (hasControlCharacter(path)) return false; // NUL, newlines and the like
  if (path.includes('\\')) return false; // a Windows separator
  if (path.includes(':')) return false; // a drive prefix, or an alternate data stream
  // A URL decoder would turn "%2e%2e" into "..", so no percent sign survives in a name.
  if (path.includes('%')) return false;
  // Format characters (right-to-left override, zero-width space, BOM, isolates) spoof names in lists.
  if (/\p{Cf}/u.test(path)) return false;
  if (path.startsWith('/')) return false;
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
    // Windows drops a trailing dot or space, so "..␠" would open the parent directory there.
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;
  }
  return true;
};

/**
 * Whether `path` may name a file inside a page version. The NFKC form is judged too: filesystems
 * and tools that normalise fold look-alikes (fullwidth dots, the two-dot leader, fullwidth
 * slashes) into the real characters, so a path is safe only when both forms are.
 */
export function validatePagePath(path: string): boolean {
  return isPlainPath(path) && isPlainPath(path.normalize('NFKC'));
}

const foldPath = (path: string): string => path.normalize('NFKC').toLowerCase();

/**
 * Whether two of the (already valid) paths cannot live side by side on disk: the same path, two
 * names that fold together on a case-insensitive or normalising filesystem, or one path that is a
 * file while another needs it as a directory.
 */
export function pathsCollide(paths: readonly string[]): boolean {
  const folded = paths.map(foldPath);
  const files = new Set<string>();
  const directories = new Set<string>();
  for (const path of folded) {
    if (files.has(path)) return true;
    files.add(path);
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
  }
  return folded.some((path) => directories.has(path));
}

const hasAllowedExtension = (kind: string, entry: string): boolean => {
  const allowed = ENTRY_EXTENSIONS.get(kind);
  if (allowed === undefined) return false;
  const name = entry.slice(entry.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 && allowed.includes(name.slice(dot));
};

const failure = (code: PageError['code']): Result<never, PageError> => err({ code });

export function validatePageContent(
  kind: PageKind,
  files: readonly { path: string; bytes: number }[],
  entry: string,
): Result<void, PageError> {
  if (files.length === 0) return failure('no_files');
  if (files.length > PAGE_LIMITS.filesMax) return failure('too_many_files');

  for (const file of files) {
    if (!validatePagePath(file.path)) return failure('bad_path');
  }
  if (pathsCollide(files.map((file) => file.path))) return failure('bad_path');

  let total = 0;
  for (const file of files) {
    if (!Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > PAGE_LIMITS.fileMaxBytes) {
      return failure('file_too_large');
    }
    total += file.bytes;
  }
  if (total > PAGE_LIMITS.pageMaxBytes) return failure('page_too_large');

  if (!files.some((file) => file.path === entry)) return failure('entry_missing');
  if (!hasAllowedExtension(kind, entry)) return failure('bad_kind');
  return ok(undefined);
}

export interface VersionInput {
  readonly by: Actor;
  readonly entry: string;
  readonly files: readonly PageFileRef[];
}

export interface PublishInput extends VersionInput {
  readonly title: string;
  readonly kind: PageKind;
  readonly workOrder?: WorkOrderId;
  readonly project?: ProjectSlug;
  readonly conversation?: ConversationId;
}

const makeVersion = (n: number, input: VersionInput, now: EpochMs): PageVersion => ({
  n,
  createdAt: now,
  by: input.by,
  entry: input.entry,
  files: input.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
});

export function publishPage(input: PublishInput, now: EpochMs, id: PageId): Result<Page, PageError> {
  const title = input.title.trim();
  if (title.length === 0) return failure('empty_title');
  if (title.length > PAGE_LIMITS.titleMax) return failure('title_too_long');
  const content = validatePageContent(input.kind, input.files, input.entry);
  if (!content.ok) return err(content.error);
  return ok({
    id,
    title,
    kind: input.kind,
    ...(input.workOrder === undefined ? {} : { workOrder: input.workOrder }),
    ...(input.project === undefined ? {} : { project: input.project }),
    ...(input.conversation === undefined ? {} : { conversation: input.conversation }),
    createdBy: input.by,
    createdAt: now,
    versions: [makeVersion(1, input, now)],
    approval: 'none',
  });
}

/** An approval is of one specific version, so a new version starts without one. */
const withoutApproval = (page: Page): Omit<Page, 'approvedVersion'> => {
  const { approvedVersion: _dropped, ...rest } = page;
  return { ...rest, approval: 'none' };
};

export function addVersion(page: Page, input: VersionInput, now: EpochMs): Result<Page, PageError> {
  const content = validatePageContent(page.kind, input.files, input.entry);
  if (!content.ok) return err(content.error);
  const latest = page.versions[page.versions.length - 1];
  const n = (latest === undefined ? 0 : latest.n) + 1;
  return ok({ ...withoutApproval(page), versions: [...page.versions, makeVersion(n, input, now)] });
}

const latestVersion = (page: Page): number => {
  const latest = page.versions[page.versions.length - 1];
  return latest === undefined ? 0 : latest.n;
};

export interface CommentInput {
  readonly version: number;
  readonly by: Actor;
  readonly text: string;
  readonly anchor?: string;
}

export function addComment(
  page: Page,
  input: CommentInput,
  now: EpochMs,
  id: Ulid<'page-comment'>,
): Result<PageComment, PageError> {
  // Agents answer a comment by publishing a version; they never write comments themselves.
  if (input.by.kind !== 'user') return failure('self_approval');
  const text = input.text.trim();
  if (text.length === 0) return failure('empty_comment');
  if (text.length > PAGE_LIMITS.commentMax) return failure('comment_too_long');
  if (!page.versions.some((version) => version.n === input.version)) return failure('unknown_version');
  return ok({
    id,
    page: page.id,
    version: input.version,
    by: input.by,
    at: now,
    text,
    ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
  });
}

export function requestApproval(page: Page): Result<Page, PageError> {
  // Only a page with no verdict on its latest version, or a rejected one, can go to review.
  if (page.approval !== 'none' && page.approval !== 'rejected') return failure('not_pending');
  return ok({ ...withoutApproval(page), approval: 'pending' });
}

export function decideApproval(
  page: Page,
  decision: 'approved' | 'rejected',
  by: Actor,
  version: number,
): Result<Page, PageError> {
  if (page.approval !== 'pending') return failure('not_pending');
  if (by.kind !== 'user') return failure('self_approval');
  if (version !== latestVersion(page)) return failure('stale_version');
  const cleared = withoutApproval(page);
  return ok(
    decision === 'approved' ? { ...cleared, approval: 'approved', approvedVersion: version } : { ...cleared, approval: 'rejected' },
  );
}

/** Stamps `now` on the named comments that have no delivery time yet; the first stamp stays. */
export function markDelivered(
  comments: readonly PageComment[],
  ids: readonly Ulid<'page-comment'>[],
  now: EpochMs,
): readonly PageComment[] {
  const named = new Set<string>(ids);
  return comments.map((comment) =>
    named.has(comment.id) && comment.deliveredAt === undefined ? { ...comment, deliveredAt: now } : comment,
  );
}
