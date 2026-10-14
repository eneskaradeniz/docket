// The shared IssueTracker adapter contract (A-333): the laws every adapter — this layer's
// in-memory fake and the infrastructure gh CLI adapter alike — must hold. A test file runs the
// suite by calling trackerAdapterContract with a closure that builds a fresh adapter over the
// canonical fixture described below; the file also carries the suite's own run against the fake,
// so collecting it directly stays a green test file and a law no compliant adapter can pass
// fails here instead of passing vacuously everywhere. Transport-fault classification (rate
// limiting, auth, network) stays with each adapter's own tests — only an adapter's closure can
// script those faults, and the fake never produces them.
//
// Canonical fixture the closure must serve:
// - probePermissions answers read granted and every write capability refused;
// - listMilestones answers at least one milestone as one page with no follow-up page token;
// - listIssues answers a non-empty first page that carries a follow-up page token, and following
//   that token answers a final page without one; keys do not repeat across the walk;
// - every key the first page lists is get-able and get agrees with the listed item;
// - the absent-key constant below is not part of the fixture.
import { describe, expect, it } from 'vitest';

import type { Result } from '../../domain/index';
import type { ExternalItem, ExternalMilestone, IssueTracker, TrackerError } from './issue-tracker';
import { createFakeTracker } from './fakes/fake-issue-tracker';

/** The scope every suite call uses; a closure serving GitHub-shaped scopes reads it as owner/repo. */
export const TRACKER_CONTRACT_SCOPE = 'octo/contract';

/** An issue key the canonical fixture does not contain. */
export const TRACKER_CONTRACT_ABSENT_KEY = '999999999';

const okValue = async <T>(outcome: Promise<Result<T, TrackerError>>): Promise<T> => {
  const settled = await outcome;
  if (!settled.ok) throw new Error(`tracker call must succeed, got '${settled.error}'`);
  return settled.value;
};

const expectExternalItem = (item: ExternalItem): void => {
  expect(item.source).not.toBe('');
  expect(item.key).not.toBe('');
  expect(item.title).not.toBe('');
  expect(item.url).not.toBe('');
  expect(item.status).not.toBe('');
};

const expectMilestone = (milestone: ExternalMilestone): void => {
  expect(milestone.id).not.toBe('');
  expect(milestone.title).not.toBe('');
  expect(['open', 'closed']).toContain(milestone.state);
};

/** Runs the contract laws against adapters the closure builds over the canonical fixture. */
export function trackerAdapterContract(createAdapter: () => IssueTracker): void {
  describe('trackerAdapterContract (A-333)', () => {
    it('A-333: listIssues pages through the returned page token and stops when none comes back', async () => {
      const adapter = createAdapter();
      const first = await okValue(adapter.listIssues(TRACKER_CONTRACT_SCOPE, {}));
      expect(first.items.length).toBeGreaterThan(0);
      expect(typeof first.next).toBe('string');
      expect(first.next).not.toBe('');
      const second = await okValue(adapter.listIssues(TRACKER_CONTRACT_SCOPE, { cursor: first.next }));
      expect(second.next).toBeUndefined();
      const keys = [...first.items, ...second.items].map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const item of [...first.items, ...second.items]) expectExternalItem(item);
    });

    it('A-333: probePermissions never reports a capability the API refused', async () => {
      const adapter = createAdapter();
      // The canonical fixture grants read and refuses every write, so reporting any write
      // capability here is exactly the over-reporting the rule bans.
      expect(await okValue(adapter.probePermissions(TRACKER_CONTRACT_SCOPE))).toEqual({
        read: true,
        comment: false,
        transition: false,
        edit: false,
      });
    });

    it('A-333: an issue key absent from the tracker maps to not_found', async () => {
      const adapter = createAdapter();
      expect(await adapter.get(TRACKER_CONTRACT_ABSENT_KEY)).toEqual({ ok: false, error: 'not_found' });
    });

    it('A-333: listMilestones answers one page of well-shaped milestones', async () => {
      const adapter = createAdapter();
      const page = await okValue(adapter.listMilestones(TRACKER_CONTRACT_SCOPE));
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.next).toBeUndefined();
      for (const milestone of page.items) expectMilestone(milestone);
    });

    it('A-333: get agrees with the listed item for the same key', async () => {
      const adapter = createAdapter();
      const page = await okValue(adapter.listIssues(TRACKER_CONTRACT_SCOPE, {}));
      const listed = page.items[0];
      expect(listed).toBeDefined();
      if (listed === undefined) return;
      expect(await adapter.get(listed.key)).toEqual({ ok: true, value: listed });
    });

    it('A-333: re-listing issues and milestones without remote changes is idempotent', async () => {
      const world = async (): Promise<{
        readonly milestones: unknown;
        readonly issues: unknown;
        readonly followUp: unknown;
        readonly permissions: unknown;
        readonly item: unknown;
      }> => {
        const adapter = createAdapter();
        const milestones = await adapter.listMilestones(TRACKER_CONTRACT_SCOPE);
        const issues = await adapter.listIssues(TRACKER_CONTRACT_SCOPE, {});
        const followUp = await adapter.listIssues(TRACKER_CONTRACT_SCOPE, { cursor: issues.ok ? issues.value.next : undefined });
        const permissions = await adapter.probePermissions(TRACKER_CONTRACT_SCOPE);
        const present = issues.ok ? (issues.value.items[0]?.key ?? '') : '';
        const item = await adapter.get(present);
        return { milestones, issues, followUp, permissions, item };
      };
      expect(await world()).toEqual(await world());

      const stable = createAdapter();
      const issues = await okValue(stable.listIssues(TRACKER_CONTRACT_SCOPE, {}));
      const key = issues.items[0]?.key ?? '';
      expect(await stable.probePermissions(TRACKER_CONTRACT_SCOPE)).toEqual(await stable.probePermissions(TRACKER_CONTRACT_SCOPE));
      expect(await stable.get(key)).toEqual(await stable.get(key));
    });
  });
}

const contractItem = (key: string, title: string): ExternalItem => ({
  source: 'fake',
  key,
  title,
  url: `https://example.test/issues/${key}`,
  status: 'open',
  updatedAt: 1_789_000_000_000,
});

/** A compliant closure over the canonical fixture, built from this layer's fake. */
export function createContractFakeTracker(): IssueTracker {
  const tracker = createFakeTracker({
    permissions: { read: true, comment: false, transition: false, edit: false },
    milestones: [{ id: '1', title: 'Contract milestone', state: 'open' }],
    issuePages: [
      {
        items: [contractItem('1', 'First contract issue'), contractItem('2', 'Second contract issue')],
        next: 'contract-page-2',
      },
      { items: [contractItem('3', 'Third contract issue')] },
    ],
  });
  tracker.items.push(contractItem('1', 'First contract issue'), contractItem('2', 'Second contract issue'), contractItem('3', 'Third contract issue'));
  return tracker;
}

trackerAdapterContract(createContractFakeTracker);
