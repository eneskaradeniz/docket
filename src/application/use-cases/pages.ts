// use-cases/pages.ts — publishing, versioning, commenting and approving pages. The domain decides
// every rule; this layer writes a version's files FIRST and the record second (a failed record
// write removes the files again), and appends an audit entry whose detail is ids, version numbers
// and counts only — never a title, comment text, path or file content.
import type {
  Actor,
  ConversationId,
  Page,
  PageComment,
  PageError,
  PageFileRef,
  PageId,
  PageKind,
  ProjectSlug,
  Result,
  Ulid,
  WorkOrderId,
} from '../../domain/index';
import {
  addComment,
  addVersion,
  decideApproval,
  err,
  markDelivered,
  ok,
  publishPage,
  requestApproval,
  sha256Hex,
} from '../../domain/index';

import type { AppDeps, AuditAction } from '../ports';

import { decideHumanGate, pendingPageApprovalGate } from './gates';

type PageDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'pages' | 'pageFiles'>;

export interface PageFileInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const refsOf = (files: readonly PageFileInput[]): readonly PageFileRef[] =>
  files.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha256Hex(file.bytes) }));

const failure = (code: PageError['code']): Result<never, PageError> => err({ code });

const audit = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log'>,
  entry: {
    readonly action: AuditAction;
    readonly actor: Actor;
    readonly page: PageId;
    readonly detail: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: entry.actor,
    action: entry.action,
    subject: { kind: 'page', id: entry.page },
    detail: entry.detail,
  });
};

const totalBytes = (refs: readonly PageFileRef[]): number => refs.reduce((sum, ref) => sum + ref.bytes, 0);

/** Files first, then the record. When the record write fails the just-written version goes away
 *  again — a version without a record would be unreachable — and the failure still surfaces. */
const storeVersion = async (
  deps: Pick<AppDeps, 'pages' | 'pageFiles'>,
  page: Page,
  version: number,
  files: readonly PageFileInput[],
): Promise<void> => {
  await deps.pageFiles.write(page.id, version, files);
  try {
    await deps.pages.save(page);
  } catch (failed) {
    await deps.pageFiles.remove(page.id, version).catch(() => undefined);
    throw failed;
  }
};

export async function publishPageUseCase(
  deps: PageDeps,
  input: {
    readonly title: string;
    readonly kind: PageKind;
    readonly by: Actor;
    readonly entry: string;
    readonly files: readonly PageFileInput[];
    readonly workOrder?: WorkOrderId;
    readonly project?: ProjectSlug;
    readonly conversation?: ConversationId;
  },
): Promise<Result<Page, PageError>> {
  const refs = refsOf(input.files);
  const published = publishPage(
    {
      title: input.title,
      kind: input.kind,
      by: input.by,
      entry: input.entry,
      files: refs,
      ...(input.workOrder === undefined ? {} : { workOrder: input.workOrder }),
      ...(input.project === undefined ? {} : { project: input.project }),
      ...(input.conversation === undefined ? {} : { conversation: input.conversation }),
    },
    deps.clock.now(),
    deps.ids.next<'page'>(),
  );
  if (!published.ok) return err(published.error);

  await storeVersion(deps, published.value, 1, input.files);
  await audit(deps, {
    action: 'page.published',
    actor: input.by,
    page: published.value.id,
    detail: { version: 1, files: refs.length, bytes: totalBytes(refs) },
  });
  return ok(published.value);
}

export async function publishVersion(
  deps: PageDeps,
  input: {
    readonly page: PageId;
    readonly by: Actor;
    readonly entry: string;
    readonly files: readonly PageFileInput[];
  },
): Promise<Result<Page, PageError>> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return failure('not_found');
  const refs = refsOf(input.files);
  const added = addVersion(page, { by: input.by, entry: input.entry, files: refs }, deps.clock.now());
  if (!added.ok) return err(added.error);

  const version = added.value.versions.length;
  await storeVersion(deps, added.value, version, input.files);
  await audit(deps, {
    action: 'page.versioned',
    actor: input.by,
    page: page.id,
    detail: { version, files: refs.length, bytes: totalBytes(refs) },
  });
  return ok(added.value);
}

export async function commentOnPage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'pages'>,
  input: {
    readonly page: PageId;
    readonly version: number;
    readonly by: Actor;
    readonly text: string;
    readonly anchor?: string;
  },
): Promise<Result<PageComment, PageError>> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return failure('not_found');
  const comment = addComment(
    page,
    {
      version: input.version,
      by: input.by,
      text: input.text,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    },
    deps.clock.now(),
    deps.ids.next<'page-comment'>(),
  );
  if (!comment.ok) return err(comment.error);

  await deps.pages.saveComment(comment.value);
  await audit(deps, {
    action: 'page.commented',
    actor: input.by,
    page: page.id,
    detail: { version: comment.value.version, comment: comment.value.id },
  });
  return ok(comment.value);
}

export async function requestPageApproval(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'pages'>,
  input: { readonly page: PageId; readonly by: Actor },
): Promise<Result<Page, PageError>> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return failure('not_found');
  const requested = requestApproval(page);
  if (!requested.ok) return err(requested.error);

  await deps.pages.save(requested.value);
  await audit(deps, {
    action: 'page.approval_requested',
    actor: input.by,
    page: page.id,
    detail: { version: requested.value.versions.length },
  });
  return ok(requested.value);
}

export async function decidePageApproval(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'pages' | 'workOrders' | 'definitions'>,
  input: {
    readonly page: PageId;
    readonly decision: 'approved' | 'rejected';
    readonly by: Actor;
    readonly version: number;
  },
): Promise<Result<Page, PageError>> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return failure('not_found');
  const decided = decideApproval(page, input.decision, input.by, input.version);
  if (!decided.ok) return err(decided.error);

  await deps.pages.save(decided.value);
  await audit(deps, {
    action: 'page.approval_decided',
    actor: input.by,
    page: page.id,
    detail: { version: input.version, decision: input.decision },
  });

  // The work order advances through the one gating path every human decision takes; a page whose
  // work order waits on no page_approval gate (none linked, already decided, moved on) only
  // changes itself.
  if (page.workOrder !== undefined) {
    const gate = await pendingPageApprovalGate(deps, page.workOrder);
    if (gate !== undefined) {
      await decideHumanGate(deps, { id: page.workOrder, gate, decision: input.decision, actor: input.by });
    }
  }
  return ok(decided.value);
}

export async function listPages(
  deps: Pick<AppDeps, 'pages'>,
  filter: { readonly workOrder?: WorkOrderId; readonly project?: ProjectSlug },
): Promise<readonly Page[]> {
  return deps.pages.list(filter);
}

export async function pageDetail(
  deps: Pick<AppDeps, 'pages'>,
  input: { readonly page: PageId },
): Promise<Result<{ readonly page: Page; readonly comments: readonly PageComment[] }, PageError>> {
  const page = await deps.pages.get(input.page);
  if (page === undefined) return failure('not_found');
  return ok({ page, comments: await deps.pages.comments(input.page, {}) });
}

export async function undeliveredComments(
  deps: Pick<AppDeps, 'pages'>,
  input: { readonly page: PageId; readonly version?: number },
): Promise<Result<readonly PageComment[], PageError>> {
  if ((await deps.pages.get(input.page)) === undefined) return failure('not_found');
  return ok(
    await deps.pages.comments(input.page, {
      undelivered: true,
      ...(input.version === undefined ? {} : { version: input.version }),
    }),
  );
}

/** Marks the named comments of the page delivered and returns the ones that changed. Ids of
 *  other pages are ignored, and a comment already delivered keeps its first time. */
export async function ackComments(
  deps: Pick<AppDeps, 'clock' | 'pages'>,
  input: { readonly page: PageId; readonly ids: readonly Ulid<'page-comment'>[] },
): Promise<Result<readonly PageComment[], PageError>> {
  if ((await deps.pages.get(input.page)) === undefined) return failure('not_found');
  const now = deps.clock.now();
  const pending = await deps.pages.comments(input.page, { undelivered: true });
  const named = new Set<string>(input.ids);
  const targets = pending.filter((comment) => named.has(comment.id));
  const stamped = markDelivered(pending, targets.map((comment) => comment.id), now).filter((comment) => named.has(comment.id));
  await deps.pages.markDelivered(targets.map((comment) => comment.id), now);
  return ok(stamped);
}
