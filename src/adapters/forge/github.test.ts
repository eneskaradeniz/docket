import { describe, expect, it } from 'vitest';
import { ForgeError, type Forge } from '../../core/forge';
import { GitHubForge, ghProcessRunner, parseRepoRemote, type GhResult, type GhRunner } from './github';

// WO-0063 — the adapter against the PROBE'S OBSERVED OUTPUTS (docs/work-orders/
// WO-0062-forge-probe/report.md; § cited per fixture). No live call: the GhRunner seam is fed
// the wire's real shapes — case INCLUDED — so the edge normalization and every degraded path
// are pinned offline.

const ok = (stdout: string): GhResult => ({ exit: 0, stdout, stderr: '' });
const fail = (stderr: string, exit = 1, stdout = ''): GhResult => ({ exit, stdout, stderr });

const forgeWith = (respond: (args: string[]) => GhResult): GitHubForge =>
  new GitHubForge(((args) => Promise.resolve(respond(args))) as GhRunner);

const ref = { owner: 'eneskaradeniz', name: 'docket' };

// report §1 — `gh auth status --json hosts` (verbatim excerpt; the scopes ride the fixture to
// prove they never escape the adapter, not because health needs them)
const AUTH_OK = `{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"eneskaradeniz","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}]}}`;

// report §3 — `gh pr list --json number,state,…` for the WO-0061 merge (abbreviated in the
// report; the field set it names is the fixture's shape)
const PR_LIST = JSON.stringify([
  {
    number: 66,
    state: 'MERGED',
    title: 'impl(WO-0061): NULL-fix — the usage screen known-spend basis',
    headRefOid: 'b26a663',
    headRefName: 'wo-0061-null-fix',
    baseRefName: 'main',
    reviewDecision: '',
    mergedAt: '2026-09-19T00:00:00Z',
    url: 'https://github.com/eneskaradeniz/docket/pull/66',
    mergeCommit: { oid: 'e9f10a6' },
  },
]);

// report §5 — `gh api repos/…/commits/<sha>/pulls` resolving PR #65 from EITHER sha kind
const REST_PULL = JSON.stringify([
  {
    number: 65,
    title: 'impl(WO-0060): appbar drive/limit chip — the account health in one glance',
    state: 'closed',
    merged_at: '2026-09-18T22:42:28Z',
    html_url: 'https://github.com/eneskaradeniz/docket/pull/65',
    head: { ref: 'wo-0060-appbar-cipi', sha: 'f5d9299' },
    base: { ref: 'main' },
    merge_commit_sha: '9f0e9fa',
  },
]);

// report §4 — REST check-runs (whisper-case; one concluded, one not)
const CHECK_RUNS = JSON.stringify({
  total_count: 2,
  check_runs: [
    { name: 'check', status: 'completed', conclusion: 'success' },
    { name: 'typecheck', status: 'completed', conclusion: null },
  ],
});

describe('health (report §1)', () => {
  it('ok on the observed success shape', async () => {
    const f = forgeWith(() => ok(AUTH_OK));
    expect(await f.health()).toBe('ok');
  });

  it('degraded on non-zero exit — the reason is the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Not logged in to any hosts'));
    expect(await f.health()).toEqual({ degraded: 'gh: Not logged in to any hosts' });
  });

  it('degraded when the host exists but no entry is a live success', async () => {
    const f = forgeWith(() =>
      ok(`{"hosts":{"github.com":[{"state":"failure","active":true,"host":"github.com","login":"x"}]}}`),
    );
    expect(await f.health()).toEqual({ degraded: 'auth state: failure' });
  });

  it('degraded, never a guess, when the status output is unparseable', async () => {
    const f = forgeWith(() => ok('not json at all'));
    expect(await f.health()).toEqual({ degraded: 'auth status returned unparseable output' });
  });

  it('degraded on spawn failure (absent binary — the unprobed shape, exit 127)', async () => {
    const f = forgeWith(() => fail('', 127));
    expect(await f.health()).toEqual({ degraded: 'auth status failed (exit 127)' });
  });
});

describe('pullRequests (report §3)', () => {
  it('normalizes at THIS edge — UPPERCASE state → lowercase, \'\' reviewDecision → none', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual([
        'pr', 'list', '--repo', 'eneskaradeniz/docket', '--state', 'open', '--json',
        'number,state,title,headRefOid,headRefName,baseRefName,reviewDecision,mergedAt,url,mergeCommit',
      ]);
      return ok(PR_LIST);
    });
    expect(await f.pullRequests(ref, 'open')).toEqual([
      {
        number: 66,
        state: 'merged',
        title: 'impl(WO-0061): NULL-fix — the usage screen known-spend basis',
        headSha: 'b26a663',
        headBranch: 'wo-0061-null-fix',
        baseBranch: 'main',
        reviewDecision: 'none',
        mergedAt: '2026-09-19T00:00:00Z',
        url: 'https://github.com/eneskaradeniz/docket/pull/66',
        mergeSha: 'e9f10a6',
      },
    ]);
  });

  it('null wire values stay ABSENT — mergedAt/mergeSha/reviewDecision carry no keys', async () => {
    const raw = JSON.parse(PR_LIST) as Record<string, unknown>[];
    raw[0]!.reviewDecision = null;
    raw[0]!.mergedAt = null;
    delete raw[0]!.mergeCommit;
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    const pr = (await f.pullRequests(ref, 'all'))[0]!;
    expect('reviewDecision' in pr).toBe(false);
    expect('mergedAt' in pr).toBe(false);
    expect('mergeSha' in pr).toBe(false);
  });

  it('an unknown wire state is the shaped unknown, not a guess', async () => {
    const raw = JSON.parse(PR_LIST) as Record<string, unknown>[];
    raw[0]!.state = 'FUTZ';
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    await expect(f.pullRequests(ref, 'open')).rejects.toThrow(ForgeError);
    await expect(f.pullRequests(ref, 'open')).rejects.toThrow('unknown pull-request state "FUTZ"');
  });

  it('non-zero exit → ForgeError carrying the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Could not resolve to a Repository'));
    await expect(f.pullRequests(ref, 'open')).rejects.toThrow('gh: Could not resolve to a Repository');
  });
});

describe('pullRequestForSha (report §5, §8)', () => {
  it('resolves from the MERGE sha — REST closed+merged_at normalizes to state merged', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['api', 'repos/eneskaradeniz/docket/commits/9f0e9fa/pulls']);
      return ok(REST_PULL);
    });
    expect(await f.pullRequestForSha(ref, '9f0e9fa')).toEqual({
      number: 65,
      state: 'merged',
      title: 'impl(WO-0060): appbar drive/limit chip — the account health in one glance',
      headSha: 'f5d9299',
      headBranch: 'wo-0060-appbar-cipi',
      baseBranch: 'main',
      url: 'https://github.com/eneskaradeniz/docket/pull/65',
      mergedAt: '2026-09-18T22:42:28Z',
      mergeSha: '9f0e9fa',
    });
  });

  it('resolves from the HEAD sha — the evidence record’s sha kind (report §5)', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['api', 'repos/eneskaradeniz/docket/commits/f5d9299/pulls']);
      return ok(REST_PULL);
    });
    const pr = await f.pullRequestForSha(ref, 'f5d9299');
    expect(pr?.number).toBe(65);
  });

  it('this path carries NO review fact — reviewDecision stays absent, never invented', async () => {
    const f = forgeWith(() => ok(REST_PULL));
    const pr = await f.pullRequestForSha(ref, '9f0e9fa');
    expect(pr && 'reviewDecision' in pr).toBe(false);
  });

  it('an unmerged association keeps the REST state (open/closed) as-is', async () => {
    const raw = JSON.parse(REST_PULL) as Record<string, unknown>[];
    raw[0]!.merged_at = null;
    raw[0]!.merge_commit_sha = null;
    raw[0]!.state = 'open';
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    const pr = (await f.pullRequestForSha(ref, 'abc123'))!;
    expect(pr.state).toBe('open');
    expect('mergedAt' in pr).toBe(false);
    expect('mergeSha' in pr).toBe(false);
  });

  it('an empty association is undefined — no PR, not a failure', async () => {
    const f = forgeWith(() => ok('[]'));
    expect(await f.pullRequestForSha(ref, 'abc123')).toBeUndefined();
  });

  it('a bad sha is the 422’s JSON message as the reason (report §8) — NOT undefined', async () => {
    const f = forgeWith(() =>
      fail('gh: No commit found for SHA: 00…0 (HTTP 422)', 1, '{"message":"No commit found for SHA: 00…0"}'),
    );
    await expect(f.pullRequestForSha(ref, '0'.repeat(40))).rejects.toThrow(ForgeError);
    await expect(f.pullRequestForSha(ref, '0'.repeat(40))).rejects.toThrow('No commit found for SHA: 00…0');
  });
});

describe('checks (report §4)', () => {
  it('REST check-runs normalize at this edge — lowercase, null conclusion stays absent', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['api', 'repos/eneskaradeniz/docket/commits/b26a663/check-runs']);
      return ok(CHECK_RUNS);
    });
    expect(await f.checks(ref, 'b26a663')).toEqual([
      { name: 'check', status: 'completed', conclusion: 'success' },
      { name: 'typecheck', status: 'completed' },
    ]);
  });

  it('non-zero exit → ForgeError with the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Bad credentials', 1));
    await expect(f.checks(ref, 'b26a663')).rejects.toThrow('gh: Bad credentials');
  });
});

describe('parseRepoRemote (WO-0063 answer 1, report §6)', () => {
  it('parses the ONE observed form, with and without the .git suffix', () => {
    expect(parseRepoRemote('https://github.com/eneskaradeniz/docket.git')).toEqual({
      kind: 'ok',
      ref: { owner: 'eneskaradeniz', name: 'docket' },
    });
    expect(parseRepoRemote('https://github.com/antreo-app/api')).toEqual({
      kind: 'ok',
      ref: { owner: 'antreo-app', name: 'api' },
    });
  });

  it('any other shape is the shaped unknown — and the reason never echoes the input', () => {
    for (const remote of [
      'git@github.com:eneskaradeniz/docket.git',
      'https://git.someserver.dev/o/r.git',
      'not a remote',
      '',
    ]) {
      const parsed = parseRepoRemote(remote);
      expect(parsed.kind).toBe('unknown');
      if (parsed.kind === 'unknown' && remote !== '') expect(parsed.reason).not.toContain(remote);
    }
  });
});

describe('the production runner', () => {
  it('is a seam the tests could have written — a function yielding exit/stdout/stderr', () => {
    expect(typeof ghProcessRunner()).toBe('function');
  });
});

// ===== WO-0065 — the closure-candidate search (measured 2026-09-19, the order carries the probe) =====
const SEARCH_HIT = JSON.stringify([
  {
    number: 67,
    state: 'MERGED',
    title: 'WO-0062 — forge surface probe: the read surface measured, the Forge port sketched',
    headRefOid: '6c6ba3a673fada7181917756a3fe16b41a32de0f',
    headRefName: 'wo-0062-forge-probe',
    baseRefName: 'main',
    reviewDecision: '',
    mergedAt: '2026-09-18T23:50:45Z',
    url: 'https://github.com/eneskaradeniz/docket/pull/67',
    mergeCommit: { oid: 'd61ea1f7bbbaa8350618a8ab259a4a471befb486' },
  },
]);

describe('searchPullRequests (WO-0065 — measured live)', () => {
  it('one call: the closed page + in-title search, normalized by the shared mapper', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual([
        'pr', 'list', '--repo', 'eneskaradeniz/docket', '--state', 'closed',
        '--search', 'WO-0062 in:title', '--json',
        'number,state,title,headRefOid,headRefName,baseRefName,reviewDecision,mergedAt,url,mergeCommit',
      ]);
      return ok(SEARCH_HIT);
    });
    expect(await f.searchPullRequests(ref, 'WO-0062')).toEqual([
      {
        number: 67,
        state: 'merged',
        title: 'WO-0062 — forge surface probe: the read surface measured, the Forge port sketched',
        headSha: '6c6ba3a673fada7181917756a3fe16b41a32de0f',
        headBranch: 'wo-0062-forge-probe',
        baseBranch: 'main',
        reviewDecision: 'none',
        mergedAt: '2026-09-18T23:50:45Z',
        url: 'https://github.com/eneskaradeniz/docket/pull/67',
        mergeSha: 'd61ea1f7bbbaa8350618a8ab259a4a471befb486',
      },
    ]);
  });

  it('the no-match shape (the probe’s other observation) is an empty page, not an error', async () => {
    const f = forgeWith(() => ok('[]'));
    expect(await f.searchPullRequests(ref, 'WO-9999')).toEqual([]);
  });

  it('non-zero exit → ForgeError with the stderr line (the search is a read like the rest)', async () => {
    const f = forgeWith(() => fail('gh: search failed'));
    await expect(f.searchPullRequests(ref, 'WO-0062')).rejects.toThrow('gh: search failed');
  });
});

// ===== WO-0068 / ADR-0018 — the OPERATOR'S console writes (adapter-extra methods, never on the
// Forge port; only the composition root's console channels reach them) =====

describe('console writes (WO-0068, ADR-0018)', () => {
  it('createPr: one call with the head/title/body vector; the PR url parsed from stdout', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual([
        'pr', 'create', '--repo', 'eneskaradeniz/docket', '--head', 'wo-0068-degisiklikler-konsolu',
        '--title', 'WO-0068 — değişiklikler konsolu', '--body', 'operatörün özeti',
      ]);
      return ok('Creating pull request for wo-0068-degisiklikler-konsolu:\nhttps://github.com/eneskaradeniz/docket/pull/72\n');
    });
    expect(
      await f.createPr(ref, { head: 'wo-0068-degisiklikler-konsolu', title: 'WO-0068 — değişiklikler konsolu', body: 'operatörün özeti' }),
    ).toBe('https://github.com/eneskaradeniz/docket/pull/72');
  });

  it('createPr: non-zero exit → ForgeError carrying the stderr line', async () => {
    const f = forgeWith(() => fail('gh: pull request creation failed for head branch'));
    await expect(f.createPr(ref, { head: 'x', title: 't', body: 'b' })).rejects.toThrow(ForgeError);
    await expect(f.createPr(ref, { head: 'x', title: 't', body: 'b' })).rejects.toThrow('gh: pull request creation failed for head branch');
  });

  it('createPr: a success stdout without a url is a ForgeError — never a silent no-op', async () => {
    const f = forgeWith(() => ok('nothing recognizable'));
    await expect(f.createPr(ref, { head: 'x', title: 't', body: 'b' })).rejects.toThrow('pr create returned no pull-request url');
  });

  it('mergePr: one call with the number and the merge-commit kind', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['pr', 'merge', '72', '--repo', 'eneskaradeniz/docket', '--merge']);
      return ok('✓ Merged pull request #72');
    });
    await expect(f.mergePr(ref, 72)).resolves.toBeUndefined();
  });

  it('mergePr: non-zero exit → ForgeError carrying the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Pull request is not mergeable'));
    await expect(f.mergePr(ref, 72)).rejects.toThrow(ForgeError);
    await expect(f.mergePr(ref, 72)).rejects.toThrow('gh: Pull request is not mergeable');
  });

  it('the Forge PORT carries no write method — the compile-level fact (ADR-0018 decision 4)', () => {
    const port: Forge = new GitHubForge((() => Promise.resolve(ok(''))) as GhRunner);
    expect(typeof (port as GitHubForge).createPr).toBe('function'); // the ADAPTER has it
    expect(typeof (port as GitHubForge).mergePr).toBe('function');
    // The canary: the port's TYPE cannot name the console write. Adding createPr to `Forge` makes
    // this line typecheck — and this test fails the boundary again.
    // @ts-expect-error — createPr exists on GitHubForge, never on the Forge port
    void port.createPr;
    // @ts-expect-error — same for mergePr
    void port.mergePr;
  });
});
