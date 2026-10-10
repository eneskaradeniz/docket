// api/page-views.ts — the read side of pages for the viewer: list rows, and one page with its
// versions, every comment and the line diff against the previous version. Pure reads. Page text
// leaves only inside `diff.lines`; no view carries file bytes, and nothing here is logged.
import type { Actor, DiffLine, Page, PageComment, PageId, PageKind, PageVersion, WorkOrderId } from '../domain/index';
import { PAGE_LIMITS, diffLines } from '../domain/index';

import type { AppDeps } from '../application';
import { pendingPageApprovalGate } from '../application';

/** `pages.list` returns at most this many, newest update first. */
export const PAGE_LIST_LIMIT = 200;

export interface PageListItem {
  readonly id: string;
  readonly title: string;
  readonly kind: PageKind;
  readonly latestVersion: number;
  readonly approval: 'none' | 'pending' | 'approved' | 'rejected';
  readonly approvedVersion?: number;
  readonly updatedAt: number;
  readonly createdBy: { readonly kind: Actor['kind']; readonly label: string };
  /** User comments the agent has not pulled yet. */
  readonly undeliveredComments: number;
}

export interface PageVersionView {
  readonly n: number;
  readonly createdAt: number;
  readonly by: { readonly kind: Actor['kind']; readonly label: string };
  readonly entry: string;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
}

export interface PageCommentView {
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly anchor?: string;
  readonly at: number;
  readonly delivered: boolean;
}

export interface PageDetailView {
  readonly page: PageListItem & { readonly versions: readonly PageVersionView[] };
  readonly version: number;
  /** Every version's comments, oldest first. */
  readonly comments: readonly PageCommentView[];
  readonly diff?: { readonly against: number; readonly lines: readonly DiffLine[]; readonly truncated?: true };
  /** Present only for a page linked to a work order. */
  readonly gate?: { readonly pending: boolean; readonly gate?: string };
}

const labelOf = (actor: Actor): string => {
  switch (actor.kind) {
    case 'user':
      return actor.label ?? actor.id;
    case 'agent':
      return actor.role;
    case 'system':
      return actor.component;
  }
};

const whoOf = (actor: Actor): { readonly kind: Actor['kind']; readonly label: string } => ({
  kind: actor.kind,
  label: labelOf(actor),
});

// The record keeps no update time of its own; a page changes when a version lands.
const updatedAtOf = (page: Page): number => page.versions[page.versions.length - 1]?.createdAt ?? page.createdAt;

const itemOf = (page: Page, undeliveredComments: number): PageListItem => ({
  id: page.id,
  title: page.title,
  kind: page.kind,
  latestVersion: page.versions.length,
  approval: page.approval,
  ...(page.approvedVersion === undefined ? {} : { approvedVersion: page.approvedVersion }),
  updatedAt: updatedAtOf(page),
  createdBy: whoOf(page.createdBy),
  undeliveredComments,
});

const countUndelivered = async (deps: Pick<AppDeps, 'pages'>, page: PageId): Promise<number> =>
  (await deps.pages.comments(page, { undelivered: true })).filter((comment) => comment.by.kind === 'user').length;

export async function pageListView(
  deps: Pick<AppDeps, 'pages'>,
  workOrder: WorkOrderId,
): Promise<readonly PageListItem[]> {
  const pages = await deps.pages.list({ workOrder });
  const newest = [...pages]
    .sort((x, y) => updatedAtOf(y) - updatedAtOf(x) || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0))
    .slice(0, PAGE_LIST_LIMIT);
  return Promise.all(newest.map(async (page) => itemOf(page, await countUndelivered(deps, page.id))));
}

const versionOf = (version: PageVersion): PageVersionView => ({
  n: version.n,
  createdAt: version.createdAt,
  by: whoOf(version.by),
  entry: version.entry,
  files: version.files.map((file) => ({ path: file.path, bytes: file.bytes })),
});

const commentOf = (comment: PageComment): PageCommentView => ({
  id: comment.id,
  version: comment.version,
  text: comment.text,
  ...(comment.anchor === undefined ? {} : { anchor: comment.anchor }),
  at: comment.at,
  delivered: comment.deliveredAt !== undefined,
});

/** The entry file of a version as text; undefined when it is missing, too large or not UTF-8. */
const readEntryText = async (deps: Pick<AppDeps, 'pageFiles'>, page: Page, version: PageVersion): Promise<string | undefined> => {
  const ref = version.files.find((file) => file.path === version.entry);
  if (ref === undefined || ref.bytes > PAGE_LIMITS.fileMaxBytes) return undefined;
  const bytes = await deps.pageFiles.read(page.id, version.n, version.entry);
  if (bytes === undefined || bytes.length > PAGE_LIMITS.fileMaxBytes) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
};

const diffOf = async (
  deps: Pick<AppDeps, 'pageFiles'>,
  page: Page,
  version: number,
): Promise<PageDetailView['diff']> => {
  if (page.kind === 'image' || version <= 1) return undefined;
  const previous = page.versions[version - 2];
  const current = page.versions[version - 1];
  if (previous === undefined || current === undefined) return undefined;
  const before = await readEntryText(deps, page, previous);
  const after = await readEntryText(deps, page, current);
  if (before === undefined || after === undefined) return undefined;
  const diff = diffLines(before, after);
  return { against: previous.n, lines: diff.lines, ...(diff.truncated ? { truncated: true as const } : {}) };
};

/** undefined = no such page; 'unknown_version' = the page has no such version. */
export async function pageDetailView(
  deps: Pick<AppDeps, 'pages' | 'pageFiles' | 'workOrders' | 'definitions'>,
  input: { readonly page: PageId; readonly version?: number },
): Promise<PageDetailView | 'unknown_version' | undefined> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return undefined;
  const version = input.version ?? page.versions.length;
  if (!Number.isInteger(version) || version < 1 || version > page.versions.length) return 'unknown_version';

  const comments = await deps.pages.comments(page.id, {});
  const gate =
    page.workOrder === undefined
      ? undefined
      : await pendingPageApprovalGate(deps, page.workOrder);
  const diff = await diffOf(deps, page, version);
  return {
    page: {
      ...itemOf(page, comments.filter((comment) => comment.deliveredAt === undefined && comment.by.kind === 'user').length),
      versions: page.versions.map(versionOf),
    },
    version,
    comments: [...comments].sort((x, y) => x.at - y.at).map(commentOf),
    ...(diff === undefined ? {} : { diff }),
    ...(page.workOrder === undefined ? {} : { gate: gate === undefined ? { pending: false } : { pending: true, gate } }),
  };
}
