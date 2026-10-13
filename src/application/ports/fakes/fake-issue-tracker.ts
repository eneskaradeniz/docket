// In-memory IssueTracker — fixtures seed straight into `items`, comments are recorded for
// assertions, and transitions replace the item slot so a seeded object is never mutated.
import type { ExternalMilestone, TrackerPermissions } from '../../../domain/index';
import type { ExternalItem, IssueTracker, TrackerError } from '../issue-tracker';

export type RecordedTrackerCall =
  | { readonly method: 'search'; readonly args: readonly [string, number] }
  | { readonly method: 'get'; readonly args: readonly [string] }
  | { readonly method: 'comment'; readonly args: readonly [string, string] }
  | { readonly method: 'transition'; readonly args: readonly [string, string] }
  | { readonly method: 'probePermissions'; readonly args: readonly [string] }
  | { readonly method: 'listMilestones'; readonly args: readonly [string, string | undefined] }
  | { readonly method: 'listIssues'; readonly args: readonly [string, { readonly since?: number; readonly cursor?: string }] }
  | { readonly method: 'createIssue'; readonly args: readonly [string, unknown] }
  | { readonly method: 'updateIssue'; readonly args: readonly [string, string, unknown] };

export interface FakeTrackerOptions {
  readonly permissions?: TrackerPermissions;
  readonly milestones?: readonly ExternalMilestone[];
  readonly issuePages?: readonly { readonly items: readonly ExternalItem[]; readonly next?: string }[];
}

export const createFakeTracker = (
  options: FakeTrackerOptions = {},
): IssueTracker & {
  readonly items: ExternalItem[];
  readonly comments: readonly { key: string; text: string }[];
  readonly calls: readonly RecordedTrackerCall[];
  setPermissions(permissions: TrackerPermissions): void;
} => {
  const items: ExternalItem[] = [];
  const recordedComments: { key: string; text: string }[] = [];
  const calls: RecordedTrackerCall[] = [];
  let permissions: TrackerPermissions = options.permissions ?? {
    read: true,
    comment: true,
    transition: true,
    edit: true,
  };
  const milestones = [...(options.milestones ?? [])];
  const issuePages = [...(options.issuePages ?? [])];

  const record = (entry: RecordedTrackerCall): void => {
    calls.push(entry);
  };

  const notFound = (): { readonly ok: false; readonly error: TrackerError } => ({
    ok: false,
    error: 'not_found',
  });

  const indexByKey = (key: string): number => items.findIndex((candidate) => candidate.key === key);

  return {
    kind: 'fake',

    items,

    search: async (query, limit) => {
      record({ method: 'search', args: [query, limit] });
      const needle = query.trim().toLowerCase();
      const matches = items.filter(
        (candidate) =>
          needle === '' ||
          candidate.title.toLowerCase().includes(needle) ||
          candidate.key.toLowerCase().includes(needle),
      );
      return {
        ok: true,
        value: matches.slice(0, Math.max(0, limit)).map((candidate) => ({ ...candidate })),
      };
    },

    get: async (key) => {
      record({ method: 'get', args: [key] });
      const index = indexByKey(key);
      return index === -1 ? notFound() : { ok: true, value: { ...items[index] } };
    },

    comment: async (key, text) => {
      record({ method: 'comment', args: [key, text] });
      if (indexByKey(key) === -1) return notFound();
      recordedComments.push({ key, text });
      return { ok: true, value: undefined };
    },

    transition: async (key, status) => {
      record({ method: 'transition', args: [key, status] });
      const index = indexByKey(key);
      if (index === -1) return notFound();
      items[index] = { ...items[index], status };
      return { ok: true, value: undefined };
    },

    probePermissions: async (scope) => {
      record({ method: 'probePermissions', args: [scope] });
      return { ok: true, value: { ...permissions } };
    },

    listMilestones: async (scope, cursor) => {
      record({ method: 'listMilestones', args: [scope, cursor] });
      return { ok: true, value: { items: milestones.map((milestone) => ({ ...milestone })) } };
    },

    listIssues: async (scope, opts) => {
      record({ method: 'listIssues', args: [scope, opts] });
      if (issuePages.length > 0) {
        const page = issuePages.shift();
        if (page === undefined) return { ok: true, value: { items: [] } };
        return {
          ok: true,
          value: {
            items: page.items.map((item) => ({ ...item })),
            ...(page.next === undefined ? {} : { next: page.next }),
          },
        };
      }
      return {
        ok: true,
        value: { items: items.map((item) => ({ ...item })) },
      };
    },

    createIssue: async (scope, item) => {
      record({ method: 'createIssue', args: [scope, item] });
      const created: ExternalItem = {
        source: 'fake',
        key: `new-${items.length + 1}`,
        title: 'created',
        url: 'https://example.test/new',
        status: 'open',
        updatedAt: 0,
      };
      items.push(created);
      return { ok: true, value: { ...created } };
    },

    updateIssue: async (scope, key, patch) => {
      record({ method: 'updateIssue', args: [scope, key, patch] });
      const index = indexByKey(key);
      if (index === -1) return notFound();
      return { ok: true, value: undefined };
    },

    get comments(): readonly { key: string; text: string }[] {
      return [...recordedComments];
    },

    get calls(): readonly RecordedTrackerCall[] {
      return [...calls];
    },

    setPermissions(next: TrackerPermissions): void {
      permissions = { ...next };
    },
  };
};
