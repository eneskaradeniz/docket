// Tests for the gh CLI tracker adapter (rule A-333). The command runner is injected, so every
// test scripts gh outputs and asserts the exact commands; nothing touches the network. The
// shared trackerAdapterContract runs against a scripted canonical fixture, and the
// adapter-specific laws — transport-fault classification, permission-object mapping, read purity —
// are asserted here because only this layer can script those conditions.
import { describe, expect, it } from 'vitest';

import type { CommandResult, ExternalItem } from '../../application/index';
import { createFakeCommandRunner, type FakeCommandRunner } from '../../application/ports/fakes/index';
import {
  TRACKER_CONTRACT_ABSENT_KEY,
  TRACKER_CONTRACT_SCOPE,
  trackerAdapterContract,
} from '../../application/ports/tracker-adapter-contract.test';
import type { IssueTracker } from '../../application/index';
import { createGhTracker } from './github-tracker';

const REPO_PATH = '/repo/hello';

const result = (exitCode: number, outputTail = ''): CommandResult => ({ exitCode, durationMs: 1, outputTail });

const ISSUES_NODES = 'number title url state updatedAt body milestone{number} labels(first:50){nodes{name}}';
const ISSUES_PAGE_INFO = 'endCursor hasNextPage';
const ISSUES_FIELDS = `{nodes{${ISSUES_NODES}}pageInfo{${ISSUES_PAGE_INFO}}}`;

const ISSUES_PAGE_1 = `gh api graphql -f query='query{repository(owner:"octo",name:"contract"){issues(first:50,orderBy:{field:UPDATED_AT,direction:DESC})${ISSUES_FIELDS}}}'`;
const ISSUES_PAGE_2 = `gh api graphql -f query='query{repository(owner:"octo",name:"contract"){issues(first:50,after:"page-2",orderBy:{field:UPDATED_AT,direction:DESC})${ISSUES_FIELDS}}}'`;
const ISSUES_SINCE = `gh api graphql -f query='query{repository(owner:"octo",name:"contract"){issues(first:50,filterBy:{since:"2026-10-01T00:00:00.000Z"},orderBy:{field:UPDATED_AT,direction:DESC})${ISSUES_FIELDS}}}'`;
const MILESTONES_PAGE_1 = `gh api graphql -f query='query{repository(owner:"octo",name:"contract"){milestones(first:50,states:[OPEN,CLOSED]){nodes{number title dueOn state url}pageInfo{${ISSUES_PAGE_INFO}}}}}'`;
const MILESTONES_PAGE_2 = `gh api graphql -f query='query{repository(owner:"octo",name:"contract"){milestones(first:50,after:"milestone-page-2",states:[OPEN,CLOSED]){nodes{number title dueOn state url}pageInfo{${ISSUES_PAGE_INFO}}}}}'`;
const PROBE = `gh api 'repos/octo/contract'`;
const VIEW_12 = `gh issue view '12' --json number,title,url,state,updatedAt,body,milestone,labels`;
const VIEW_ABSENT = `gh issue view '${TRACKER_CONTRACT_ABSENT_KEY}' --json number,title,url,state,updatedAt,body,milestone,labels`;
const SEARCH = `gh issue list --search 'contract' --limit '10' --json number,title,url,state,updatedAt,body,milestone,labels`;

const ISSUE_12 = {
  number: 12,
  title: 'Ship the contract',
  url: 'https://github.com/octo/contract/issues/12',
  state: 'OPEN',
  updatedAt: '2026-10-10T08:00:00Z',
  body: 'Contract body',
  milestone: { number: 3 },
  labels: { nodes: [{ name: 'bug' }] },
};
const ISSUE_41 = {
  number: 41,
  title: 'Wire the contract',
  url: 'https://github.com/octo/contract/issues/41',
  state: 'OPEN',
  updatedAt: '2026-10-09T08:00:00Z',
};
const ISSUE_7 = {
  number: 7,
  title: 'Close the contract',
  url: 'https://github.com/octo/contract/issues/7',
  state: 'CLOSED',
  updatedAt: '2026-10-08T08:00:00Z',
};

const MAPPED_12: ExternalItem = {
  source: 'github-issues',
  key: '12',
  title: 'Ship the contract',
  url: 'https://github.com/octo/contract/issues/12',
  status: 'open',
  updatedAt: Date.parse('2026-10-10T08:00:00Z'),
  body: 'Contract body',
  milestone: '3',
  labels: ['bug'],
};
const MAPPED_41: ExternalItem = {
  source: 'github-issues',
  key: '41',
  title: 'Wire the contract',
  url: 'https://github.com/octo/contract/issues/41',
  status: 'open',
  updatedAt: Date.parse('2026-10-09T08:00:00Z'),
};
const MAPPED_7: ExternalItem = {
  source: 'github-issues',
  key: '7',
  title: 'Close the contract',
  url: 'https://github.com/octo/contract/issues/7',
  status: 'closed',
  updatedAt: Date.parse('2026-10-08T08:00:00Z'),
};

const issuesPageJson = (nodes: readonly unknown[], pageInfo: unknown): string =>
  JSON.stringify({ data: { repository: { issues: { nodes, pageInfo } } } });

const MILESTONES_JSON = JSON.stringify({
  data: {
    repository: {
      milestones: {
        nodes: [
          {
            number: 3,
            title: 'Contract milestone',
            dueOn: '2026-12-31T00:00:00Z',
            state: 'OPEN',
            url: 'https://github.com/octo/contract/milestone/3',
          },
          { number: 1, title: 'Closed contract milestone', state: 'CLOSED', url: 'https://github.com/octo/contract/milestone/1' },
        ],
        pageInfo: { hasNextPage: false },
      },
    },
  },
});

const MAPPED_MILESTONES = [
  {
    id: '3',
    title: 'Contract milestone',
    state: 'open',
    dueAt: Date.parse('2026-12-31T00:00:00Z'),
    url: 'https://github.com/octo/contract/milestone/3',
  },
  { id: '1', title: 'Closed contract milestone', state: 'closed', url: 'https://github.com/octo/contract/milestone/1' },
];

// The scripted runner hands out each page the same way on every walk of the canonical fixture, so
// the suite's repeated reads stay idempotent; three rounds cover its worst case with margin.
const scriptCanonicalFixture = (runner: FakeCommandRunner): void => {
  for (let round = 0; round < 3; round += 1) {
    runner.script(PROBE, result(0, JSON.stringify({ permissions: { admin: false, push: false, pull: true } })));
    runner.script(MILESTONES_PAGE_1, result(0, MILESTONES_JSON));
    runner.script(ISSUES_PAGE_1, result(0, issuesPageJson([ISSUE_12, ISSUE_41], { endCursor: 'page-2', hasNextPage: true })));
    runner.script(ISSUES_PAGE_2, result(0, issuesPageJson([ISSUE_7], { endCursor: 'page-3', hasNextPage: false })));
    // The gh JSON shapes differ from the GraphQL ones only in labels, which arrives as a plain
    // array here; both map onto the same ExternalItem.
    runner.script(VIEW_12, result(0, JSON.stringify({ ...ISSUE_12, labels: [{ name: 'bug' }] })));
    runner.script(VIEW_ABSENT, result(1, 'GraphQL: Could not resolve to an Issue with the number 999999999.'));
  }
};

const makeScriptedTracker = (): IssueTracker => {
  const runner = createFakeCommandRunner();
  scriptCanonicalFixture(runner);
  return createGhTracker(REPO_PATH, runner);
};

describe('gh CLI tracker adapter (A-333)', () => {
  trackerAdapterContract(makeScriptedTracker);

  it('A-333: HTTP 429 and rate limit error outputs map to TrackerError rate_limited', async () => {
    const listRunner = createFakeCommandRunner();
    listRunner.script(ISSUES_PAGE_1, result(1, 'gh: HTTP 429: Too Many Requests'));
    const listTracker = createGhTracker(REPO_PATH, listRunner);
    expect(await listTracker.listIssues(TRACKER_CONTRACT_SCOPE, {})).toEqual({ ok: false, error: 'rate_limited' });

    const viewRunner = createFakeCommandRunner();
    viewRunner.script(VIEW_12, result(1, 'gh: API rate limit exceeded for installation ID 1234'));
    const viewTracker = createGhTracker(REPO_PATH, viewRunner);
    expect(await viewTracker.get('12')).toEqual({ ok: false, error: 'rate_limited' });

    const milestoneRunner = createFakeCommandRunner();
    milestoneRunner.script(MILESTONES_PAGE_1, result(1, 'gh: HTTP 429'));
    const milestoneTracker = createGhTracker(REPO_PATH, milestoneRunner);
    expect(await milestoneTracker.listMilestones(TRACKER_CONTRACT_SCOPE)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('A-333: probePermissions maps the repos permissions object and never reports a refused capability', async () => {
    const pushRunner = createFakeCommandRunner();
    pushRunner.script(PROBE, result(0, '{"permissions":{"admin":false,"push":true,"pull":true}}'));
    const pushTracker = createGhTracker(REPO_PATH, pushRunner);
    expect(await pushTracker.probePermissions(TRACKER_CONTRACT_SCOPE)).toEqual({
      ok: true,
      value: { read: true, comment: true, transition: true, edit: true },
    });

    const adminRunner = createFakeCommandRunner();
    adminRunner.script(PROBE, result(0, '{"permissions":{"admin":true,"push":false,"pull":false}}'));
    const adminTracker = createGhTracker(REPO_PATH, adminRunner);
    expect(await adminTracker.probePermissions(TRACKER_CONTRACT_SCOPE)).toEqual({
      ok: true,
      value: { read: true, comment: true, transition: true, edit: true },
    });

    const noneRunner = createFakeCommandRunner();
    noneRunner.script(PROBE, result(0, '{"permissions":{"admin":false,"push":false,"pull":false}}'));
    const noneTracker = createGhTracker(REPO_PATH, noneRunner);
    expect(await noneTracker.probePermissions(TRACKER_CONTRACT_SCOPE)).toEqual({
      ok: true,
      value: { read: false, comment: false, transition: false, edit: false },
    });

    const absentRunner = createFakeCommandRunner();
    absentRunner.script(PROBE, result(0, '{"id":1296269,"name":"contract"}'));
    const absentTracker = createGhTracker(REPO_PATH, absentRunner);
    expect(await absentTracker.probePermissions(TRACKER_CONTRACT_SCOPE)).toEqual({ ok: false, error: 'unknown' });
  });

  it('A-333: read operations never issue a write command', async () => {
    const runner = createFakeCommandRunner();
    scriptCanonicalFixture(runner);
    runner.script(SEARCH, result(0, '[]'));
    const tracker = createGhTracker(REPO_PATH, runner);

    await tracker.probePermissions(TRACKER_CONTRACT_SCOPE);
    await tracker.listMilestones(TRACKER_CONTRACT_SCOPE);
    await tracker.listIssues(TRACKER_CONTRACT_SCOPE, {});
    await tracker.get('12');
    await tracker.search('contract', 10);

    const writes = runner.calls().filter((call) => /gh issue (comment|close|reopen|create|edit)/.test(call.command));
    expect(writes).toEqual([]);
  });

  it('listIssues builds the GraphQL page query and maps nodes onto ExternalItem', async () => {
    const runner = createFakeCommandRunner();
    runner.script(ISSUES_PAGE_1, result(0, issuesPageJson([ISSUE_12, ISSUE_41], { endCursor: 'page-2', hasNextPage: true })));
    runner.script(ISSUES_PAGE_2, result(0, issuesPageJson([ISSUE_7], { endCursor: 'page-3', hasNextPage: false })));
    const tracker = createGhTracker(REPO_PATH, runner);

    const first = await tracker.listIssues(TRACKER_CONTRACT_SCOPE, {});
    expect(first).toEqual({ ok: true, value: { items: [MAPPED_12, MAPPED_41], next: 'page-2' } });

    const second = await tracker.listIssues(TRACKER_CONTRACT_SCOPE, { cursor: 'page-2' });
    expect(second).toEqual({ ok: true, value: { items: [MAPPED_7] } });

    const commands = runner.calls().map((call) => call.command);
    expect(commands).toEqual([ISSUES_PAGE_1, ISSUES_PAGE_2]);
    expect(runner.calls()[0]?.cwd).toBe(REPO_PATH);
  });

  it('listIssues passes the since bound into the query', async () => {
    const runner = createFakeCommandRunner();
    runner.script(ISSUES_SINCE, result(0, issuesPageJson([], { hasNextPage: false })));
    const tracker = createGhTracker(REPO_PATH, runner);

    const outcome = await tracker.listIssues(TRACKER_CONTRACT_SCOPE, { since: Date.parse('2026-10-01T00:00:00Z') });
    expect(outcome).toEqual({ ok: true, value: { items: [] } });
    expect(runner.calls().map((call) => call.command)).toEqual([ISSUES_SINCE]);
  });

  it('listMilestones maps dueOn, state and url onto ExternalMilestone', async () => {
    const runner = createFakeCommandRunner();
    runner.script(MILESTONES_PAGE_1, result(0, MILESTONES_JSON));
    const tracker = createGhTracker(REPO_PATH, runner);

    const outcome = await tracker.listMilestones(TRACKER_CONTRACT_SCOPE);
    expect(outcome).toEqual({ ok: true, value: { items: MAPPED_MILESTONES } });
    expect(runner.calls().map((call) => call.command)).toEqual([MILESTONES_PAGE_1]);
  });

  it('listMilestones sends the page token as after', async () => {
    const runner = createFakeCommandRunner();
    runner.script(MILESTONES_PAGE_2, result(0, MILESTONES_JSON));
    const tracker = createGhTracker(REPO_PATH, runner);

    await tracker.listMilestones(TRACKER_CONTRACT_SCOPE, 'milestone-page-2');
    expect(runner.calls().map((call) => call.command)).toEqual([MILESTONES_PAGE_2]);
  });

  it('a page token outside the GitHub charset refuses as unknown without running gh', async () => {
    const runner = createFakeCommandRunner();
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.listIssues(TRACKER_CONTRACT_SCOPE, { cursor: 'bad"token' })).toEqual({ ok: false, error: 'unknown' });
    expect(await tracker.listMilestones(TRACKER_CONTRACT_SCOPE, 'bad token')).toEqual({ ok: false, error: 'unknown' });
    expect(runner.calls()).toEqual([]);
  });

  it('search maps gh issue list output and clamps the limit to what gh accepts', async () => {
    const runner = createFakeCommandRunner();
    runner.script(SEARCH, result(0, JSON.stringify([{ ...ISSUE_12, labels: [{ name: 'bug' }] }])));
    const tracker = createGhTracker(REPO_PATH, runner);

    const outcome = await tracker.search('contract', 10);
    expect(outcome).toEqual({ ok: true, value: [MAPPED_12] });
    expect(runner.calls().map((call) => call.command)).toEqual([SEARCH]);

    const clamped = createFakeCommandRunner();
    clamped.script(
      `gh issue list --search 'contract' --limit '1000' --json number,title,url,state,updatedAt,body,milestone,labels`,
      result(0, '[]'),
    );
    const clampedTracker = createGhTracker(REPO_PATH, clamped);
    expect(await clampedTracker.search('contract', 5000)).toEqual({ ok: true, value: [] });

    const empty = createFakeCommandRunner();
    const emptyTracker = createGhTracker(REPO_PATH, empty);
    expect(await emptyTracker.search('contract', 0)).toEqual({ ok: true, value: [] });
    expect(empty.calls()).toEqual([]);
  });

  it('get maps gh issue view output onto ExternalItem', async () => {
    const runner = createFakeCommandRunner();
    runner.script(VIEW_12, result(0, JSON.stringify({ ...ISSUE_12, labels: [{ name: 'bug' }] })));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.get('12')).toEqual({ ok: true, value: MAPPED_12 });
    expect(runner.calls().map((call) => call.command)).toEqual([VIEW_12]);
  });

  it('comment posts through gh issue comment with shell-safe quoting', async () => {
    const runner = createFakeCommandRunner();
    runner.script(`gh issue comment '12' --body 'it'\\''s open'`, result(0, 'https://github.com/octo/contract/issues/12#issuecomment-1'));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.comment('12', "it's open")).toEqual({ ok: true, value: undefined });
    expect(runner.calls().map((call) => call.command)).toEqual([`gh issue comment '12' --body 'it'\\''s open'`]);
  });

  it('transition closes and reopens; any other status is refused without a command', async () => {
    const runner = createFakeCommandRunner();
    runner.script(`gh issue close '12'`, result(0, '✓ Closed issue #12'));
    runner.script(`gh issue reopen '41'`, result(0, '✓ Reopened issue #41'));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.transition('12', 'closed')).toEqual({ ok: true, value: undefined });
    expect(await tracker.transition('41', 'open')).toEqual({ ok: true, value: undefined });
    expect(await tracker.transition('12', 'in progress')).toEqual({ ok: false, error: 'unknown' });
    expect(runner.calls().map((call) => call.command)).toEqual([`gh issue close '12'`, `gh issue reopen '41'`]);
  });

  it('createIssue creates through gh and parses the created issue url', async () => {
    const runner = createFakeCommandRunner();
    runner.script(
      `gh issue create --repo 'octo/contract' --title 'New contract issue' --body 'The body.'`,
      result(0, 'https://github.com/octo/contract/issues/57\n'),
    );
    const tracker = createGhTracker(REPO_PATH, runner);

    const outcome = await tracker.createIssue?.(TRACKER_CONTRACT_SCOPE, { title: 'New contract issue', body: 'The body.' });
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok) {
      expect(outcome.value.key).toBe('57');
      expect(outcome.value.url).toBe('https://github.com/octo/contract/issues/57');
      expect(outcome.value.title).toBe('New contract issue');
      expect(outcome.value.status).toBe('open');
    }
  });

  it('createIssue refuses an input without a title', async () => {
    const runner = createFakeCommandRunner();
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.createIssue?.(TRACKER_CONTRACT_SCOPE, { body: 'no title' })).toEqual({ ok: false, error: 'unknown' });
    expect(runner.calls()).toEqual([]);
  });

  it('updateIssue edits fields and moves state, refusing unknown states', async () => {
    const runner = createFakeCommandRunner();
    runner.script(`gh issue edit '12' --repo 'octo/contract' --title 'Renamed'`, result(0));
    runner.script(`gh issue close '12' --repo 'octo/contract'`, result(0, '✓ Closed issue #12'));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.updateIssue?.(TRACKER_CONTRACT_SCOPE, '12', { title: 'Renamed', state: 'closed' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(runner.calls().map((call) => call.command)).toEqual([
      `gh issue edit '12' --repo 'octo/contract' --title 'Renamed'`,
      `gh issue close '12' --repo 'octo/contract'`,
    ]);

    const refusing = createFakeCommandRunner();
    const refusingTracker = createGhTracker(REPO_PATH, refusing);
    expect(await refusingTracker.updateIssue?.(TRACKER_CONTRACT_SCOPE, '12', { state: 'frozen' })).toEqual({ ok: false, error: 'unknown' });
    expect(await refusingTracker.updateIssue?.(TRACKER_CONTRACT_SCOPE, '12', {})).toEqual({ ok: true, value: undefined });
    expect(refusing.calls()).toEqual([]);
  });

  it('a scope that is not owner/repo refuses as unknown without running gh', async () => {
    const runner = createFakeCommandRunner();
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.listIssues('gitlab.example/octo/contract', {})).toEqual({ ok: false, error: 'unknown' });
    expect(await tracker.listMilestones('contract')).toEqual({ ok: false, error: 'unknown' });
    expect(await tracker.probePermissions('octo/contract/extra')).toEqual({ ok: false, error: 'unknown' });
    expect(runner.calls()).toEqual([]);
  });

  it('an authentication failure maps to auth', async () => {
    const runner = createFakeCommandRunner();
    runner.script(VIEW_12, result(4, 'gh: To get started with GitHub, run `gh auth login`'));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.get('12')).toEqual({ ok: false, error: 'auth' });
  });

  it('a connection failure maps to network', async () => {
    const runner = createFakeCommandRunner();
    runner.script(ISSUES_PAGE_1, result(1, 'gh: dial tcp 140.82.121.4:443: i/o timeout'));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.listIssues(TRACKER_CONTRACT_SCOPE, {})).toEqual({ ok: false, error: 'network' });
  });

  it('malformed GraphQL output maps to unknown', async () => {
    const runner = createFakeCommandRunner();
    runner.script(ISSUES_PAGE_1, result(0, 'not json at all'));
    const tracker = createGhTracker(REPO_PATH, runner);
    expect(await tracker.listIssues(TRACKER_CONTRACT_SCOPE, {})).toEqual({ ok: false, error: 'unknown' });

    const shapeRunner = createFakeCommandRunner();
    shapeRunner.script(MILESTONES_PAGE_1, result(0, '{"data":{"repository":null}}'));
    const shapeTracker = createGhTracker(REPO_PATH, shapeRunner);
    expect(await shapeTracker.listMilestones(TRACKER_CONTRACT_SCOPE)).toEqual({ ok: false, error: 'unknown' });
  });

  it('a node with a missing required field fails the whole page rather than dropping silently', async () => {
    const runner = createFakeCommandRunner();
    runner.script(ISSUES_PAGE_1, result(0, issuesPageJson([{ number: 12, title: 'No url' }], { hasNextPage: false })));
    const tracker = createGhTracker(REPO_PATH, runner);

    expect(await tracker.listIssues(TRACKER_CONTRACT_SCOPE, {})).toEqual({ ok: false, error: 'unknown' });
  });
});
