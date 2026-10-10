// use-cases/page-library.ts — the artifact library: every page across projects, filtered and
// searched, plus the operator's pins. Pins are a preference kept in the settings store, not part
// of a page record, so pinning never touches a page's history.
import type { Page, PageId, PageKind, ProjectSlug, Result, WorkOrderId } from '../../domain/index';
import { err, matchesSearch, ok, pageKindNameTr } from '../../domain/index';

import type { AppDeps } from '../ports/index';

/** The settings-store key the pinned page ids live under. */
export const PAGES_PINNED_KEY = 'pages.pinned';
export const PAGES_PINNED_MAX = 200;
export const PAGE_LIBRARY_LIMIT = 500;

/** Work orders are searched by the code the Turkish UI shows (U-22); the English prefix is a
 *  display concern of the presentation layer. */
const WORK_ORDER_CODE_PREFIX = 'İE-';

export const workOrderCodeOf = (number: number): string => `${WORK_ORDER_CODE_PREFIX}${String(number).padStart(4, '0')}`;

export interface PageLibraryItem {
  readonly page: Page;
  readonly projectName?: string;
  readonly workOrderNumber?: number;
  readonly pinned: boolean;
}

export interface PageLibraryFilter {
  readonly q?: string;
  readonly kind?: PageKind;
  readonly project?: ProjectSlug;
  readonly workOrder?: WorkOrderId;
  readonly pinned?: boolean;
}

export type PinError = { readonly code: 'not_found' | 'too_many_pinned' };

const updatedAtOf = (page: Page): number => page.versions[page.versions.length - 1]?.createdAt ?? page.createdAt;

/** A damaged stored value must never break the library: anything that is not a list of strings
 *  counts as no pins. */
const storedPins = async (deps: Pick<AppDeps, 'settings'>): Promise<readonly string[]> => {
  const stored = await deps.settings.get(PAGES_PINNED_KEY);
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
};

export async function pageLibrary(
  deps: Pick<AppDeps, 'pages' | 'projects' | 'workOrders' | 'settings'>,
  filter: PageLibraryFilter,
): Promise<readonly PageLibraryItem[]> {
  const pins = new Set(await storedPins(deps));
  const candidates = (
    await deps.pages.list({
      ...(filter.workOrder === undefined ? {} : { workOrder: filter.workOrder }),
      ...(filter.project === undefined ? {} : { project: filter.project }),
    })
  ).filter(
    (page) =>
      (filter.kind === undefined || page.kind === filter.kind) &&
      (filter.pinned === undefined || pins.has(page.id) === filter.pinned),
  );

  const projectNames = new Map<ProjectSlug, string | undefined>();
  const items: PageLibraryItem[] = [];
  for (const page of candidates) {
    let projectName: string | undefined;
    if (page.project !== undefined) {
      if (!projectNames.has(page.project)) projectNames.set(page.project, (await deps.projects.get(page.project))?.name);
      projectName = projectNames.get(page.project);
    }
    const workOrderNumber = page.workOrder === undefined ? undefined : await deps.workOrders.number(page.workOrder);
    const query = filter.q ?? '';
    const haystack = [
      page.title,
      pageKindNameTr(page.kind),
      projectName ?? '',
      workOrderNumber === undefined ? '' : workOrderCodeOf(workOrderNumber),
    ].join(' ');
    if (!matchesSearch(haystack, query)) continue;
    items.push({
      page,
      ...(projectName === undefined ? {} : { projectName }),
      ...(workOrderNumber === undefined ? {} : { workOrderNumber }),
      pinned: pins.has(page.id),
    });
  }
  return items
    .sort((x, y) => updatedAtOf(y.page) - updatedAtOf(x.page) || (x.page.id < y.page.id ? 1 : x.page.id > y.page.id ? -1 : 0))
    .slice(0, PAGE_LIBRARY_LIMIT);
}

/** Pins or unpins one page. Idempotent. Ids of pages that no longer exist are dropped whenever
 *  the list is written, so the stored list cannot grow with dead entries. */
export async function pinPage(
  deps: Pick<AppDeps, 'settings' | 'pages'>,
  input: { readonly page: PageId; readonly pinned: boolean },
): Promise<Result<undefined, PinError>> {
  if ((await deps.pages.get(input.page)) === undefined) return err({ code: 'not_found' });

  const alive: string[] = [];
  for (const id of await storedPins(deps)) {
    if (!alive.includes(id) && (await deps.pages.get(id as PageId)) !== undefined) alive.push(id);
  }
  const next = input.pinned
    ? alive.includes(input.page) ? alive : [...alive, input.page]
    : alive.filter((id) => id !== input.page);
  if (next.length > PAGES_PINNED_MAX) return err({ code: 'too_many_pinned' });
  await deps.settings.set(PAGES_PINNED_KEY, next);
  return ok(undefined);
}
