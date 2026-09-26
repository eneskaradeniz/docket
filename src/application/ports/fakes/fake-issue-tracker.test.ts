import { describe, expect, it } from 'vitest';

import type { ExternalItem, IssueTracker, TrackerError } from '../issue-tracker';

import { createFakeTracker } from './fake-issue-tracker';

const item = (overrides?: Partial<ExternalItem>): ExternalItem => ({
  source: 'jira',
  key: 'WID-1',
  title: 'Ship the widget',
  url: 'https://issues.example.com/browse/WID-1',
  status: 'open',
  updatedAt: 1_789_000_000_000,
  ...overrides,
});

const valueOf = async <T>(
  result: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TrackerError }>,
): Promise<T> => {
  const settled = await result;
  if (!settled.ok) throw new Error('tracker call must succeed');
  return settled.value;
};

describe('createFakeTracker', () => {
  it('A-1: satisfies the full IssueTracker surface with a data kind', () => {
    const tracker: IssueTracker = createFakeTracker();

    expect(tracker.kind).toBe('fake');
  });

  it('items starts empty; seeded items come back from search and get', async () => {
    const tracker = createFakeTracker();
    expect(await valueOf(tracker.search('widget', 10))).toEqual([]);

    tracker.items.push(item(), item({ key: 'WID-2', title: 'Polish the widget' }));

    expect(await valueOf(tracker.search('widget', 10))).toHaveLength(2);
    expect(await valueOf(tracker.get('WID-2'))).toEqual(item({ key: 'WID-2', title: 'Polish the widget' }));
  });

  it('search matches title and key case-insensitively, reporting matches in seed order', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item(), item({ key: 'WID-2', title: 'Polish the widget' }), item({ key: 'BUG-9', title: 'Unrelated' }));

    expect(await valueOf(tracker.search('POLISH', 10))).toEqual([item({ key: 'WID-2', title: 'Polish the widget' })]);
    expect((await valueOf(tracker.search('wid', 10))).map((found) => found.key)).toEqual(['WID-1', 'WID-2']);
  });

  it('search treats an empty query as match-all', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item(), item({ key: 'WID-2' }));

    expect(await valueOf(tracker.search('', 10))).toEqual([item(), item({ key: 'WID-2' })]);
    expect(await valueOf(tracker.search('   ', 10))).toHaveLength(2);
  });

  it('search never reports more than limit items', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item(), item({ key: 'WID-2' }), item({ key: 'WID-3' }));

    expect((await valueOf(tracker.search('wid', 2))).map((found) => found.key)).toEqual(['WID-1', 'WID-2']);
    expect(await valueOf(tracker.search('wid', 0))).toEqual([]);
    expect(await valueOf(tracker.search('wid', 50))).toHaveLength(3);
  });

  it('search returns ok with an empty list when nothing matches', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    expect(await valueOf(tracker.search('nonexistent', 10))).toEqual([]);
  });

  it('A-2: search hands out fresh arrays and item copies, never internal state', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    const first = await valueOf(tracker.search('wid', 10));
    (first as ExternalItem[]).push(item({ key: 'injected' }));
    (first[0] as { status: string }).status = 'mutated';

    const second = await valueOf(tracker.search('wid', 10));
    expect(second).toEqual([item()]);
    expect(await valueOf(tracker.get('WID-1'))).toEqual(item());
  });

  it('get returns a copy of the seeded item; mutating it changes nothing later', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    const seen = await valueOf(tracker.get('WID-1'));
    (seen as { status: string }).status = 'mutated';

    expect(await valueOf(tracker.get('WID-1'))).toEqual(item());
  });

  it('get returns the first match when two sources share a key', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item(), item({ source: 'azure-boards', key: 'WID-1', title: 'Same key elsewhere' }));

    expect(await valueOf(tracker.get('WID-1'))).toEqual(item());
  });

  it('get fails with not_found for an unknown key', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    const missing = await tracker.get('NOPE-1');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('not_found');
  });

  it('comment records the key and text in call order', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    expect(await tracker.comment('WID-1', 'Work order opened')).toEqual({ ok: true, value: undefined });
    expect(await tracker.comment('WID-1', 'Work order closed')).toEqual({ ok: true, value: undefined });

    expect(tracker.comments).toEqual([
      { key: 'WID-1', text: 'Work order opened' },
      { key: 'WID-1', text: 'Work order closed' },
    ]);
  });

  it('comment fails with not_found for an unknown key and records nothing', async () => {
    const tracker = createFakeTracker();

    const failed = await tracker.comment('NOPE-1', 'lost comment');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBe('not_found');
    expect(tracker.comments).toEqual([]);
  });

  it('A-2: comments returns a copy, not the internal array', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());
    await tracker.comment('WID-1', 'first');

    (tracker.comments as { key: string; text: string }[]).push({ key: 'WID-1', text: 'injected' });

    expect(tracker.comments).toEqual([{ key: 'WID-1', text: 'first' }]);
  });

  it('transition replaces the item status and keeps every other field', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item(), item({ key: 'WID-2' }));

    expect(await tracker.transition('WID-2', 'done')).toEqual({ ok: true, value: undefined });

    expect(await valueOf(tracker.get('WID-2'))).toEqual(item({ key: 'WID-2', status: 'done' }));
    expect(tracker.items[1]).toEqual(item({ key: 'WID-2', status: 'done' }));
  });

  it('transition never mutates the seeded object in place', async () => {
    const tracker = createFakeTracker();
    const seeded = item();
    tracker.items.push(seeded);

    await tracker.transition('WID-1', 'done');

    expect(seeded.status).toBe('open');
    expect(tracker.items[0]).not.toBe(seeded);
  });

  it('transition fails with not_found for an unknown key and changes nothing', async () => {
    const tracker = createFakeTracker();
    tracker.items.push(item());

    const failed = await tracker.transition('NOPE-1', 'done');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBe('not_found');
    expect(tracker.items).toEqual([item()]);
  });
});
