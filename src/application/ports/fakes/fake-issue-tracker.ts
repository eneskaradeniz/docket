// In-memory IssueTracker — fixtures seed straight into `items`, comments are recorded for
// assertions, and transitions replace the item slot so a seeded object is never mutated.
import type { ExternalItem, IssueTracker, TrackerError } from '../issue-tracker';

export const createFakeTracker = (): IssueTracker & {
  readonly items: ExternalItem[];
  readonly comments: readonly { key: string; text: string }[];
} => {
  // `items` is the seed store itself — the contract types it as a mutable array, so tests push
  // fixtures into it. Every read path hands out copies (A-2); only `comments` is copy-on-read.
  const items: ExternalItem[] = [];
  const recordedComments: { key: string; text: string }[] = [];

  const notFound = (): { readonly ok: false; readonly error: TrackerError } => ({
    ok: false,
    error: 'not_found',
  });

  const indexByKey = (key: string): number => items.findIndex((candidate) => candidate.key === key);

  return {
    kind: 'fake',

    items,

    // Matches title or key, case-insensitively; an empty query matches all. Seed order is the
    // reporting order — the port promises no ordering of its own.
    search: async (query, limit) => {
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
      const index = indexByKey(key);
      return index === -1 ? notFound() : { ok: true, value: { ...items[index] } };
    },

    comment: async (key, text) => {
      if (indexByKey(key) === -1) return notFound();
      recordedComments.push({ key, text });
      return { ok: true, value: undefined };
    },

    transition: async (key, status) => {
      const index = indexByKey(key);
      if (index === -1) return notFound();
      // Replace the slot instead of writing through: the stored object may be the caller's input.
      // updatedAt stays as seeded — the fake has no clock; time comes from the fixtures.
      items[index] = { ...items[index], status };
      return { ok: true, value: undefined };
    },

    get comments(): readonly { key: string; text: string }[] {
      return [...recordedComments];
    },
  };
};
