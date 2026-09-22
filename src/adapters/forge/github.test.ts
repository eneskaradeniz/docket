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

// ===== WO-0087 — the depo row's lazy detail (prDetail + prDiff) =====
describe('prDetail + prDiff — the depo row\'s lazy detail (WO-0087)', () => {
  const antreo = { owner: 'antreo-app', name: 'mobile' };
  const PR_VIEW = JSON.stringify({
    number: 269,
    title: 'fix(#267): ana sayfa cihaz-turu düzeltmeleri — misafir davet metni, Keşfet başlık+nav, konum çipi header\'da',
    body: 'Misafir akışındaki davet metni güncellendi; Keşfet başlığı ve alt navigasyon hizaya alındı.',
    author: { login: 'eneskaradeniz' },
    headRefName: 'feature/267-home-tur',
    baseRefName: 'main',
    additions: 142,
    deletions: 38,
    changedFiles: 6,
    url: 'https://github.com/antreo-app/mobile/pull/269',
  });

  it('prDetail: the wire maps verbatim — author login, the branch pair, the forge\'s own counts', async () => {
    let seen: string[] = [];
    const f = forgeWith((args) => {
      seen = args;
      return ok(PR_VIEW);
    });
    const d = await f.prDetail(antreo, 269);
    expect(seen.slice(0, 4)).toEqual(['pr', 'view', '269', '--repo']);
    expect(d).toEqual({
      number: 269,
      headBranch: 'feature/267-home-tur',
      baseBranch: 'main',
      url: 'https://github.com/antreo-app/mobile/pull/269',
      title: 'fix(#267): ana sayfa cihaz-turu düzeltmeleri — misafir davet metni, Keşfet başlık+nav, konum çipi header\'da',
      body: 'Misafir akışındaki davet metni güncellendi; Keşfet başlığı ve alt navigasyon hizaya alındı.',
      author: 'eneskaradeniz',
      additions: 142,
      deletions: 38,
      changedFiles: 6,
    });
  });

  it('empty title/body/author stay ABSENT (never empty strings)', async () => {
    const f = forgeWith(() =>
      ok(JSON.stringify({ number: 5, title: '', body: '', author: { login: '' }, headRefName: 'a', baseRefName: 'b', additions: 0, deletions: 0, changedFiles: 0, url: 'https://github.com/o/r/pull/5' })),
    );
    const d = await f.prDetail(antreo, 5);
    expect(d.title).toBeUndefined();
    expect(d.body).toBeUndefined();
    expect(d.author).toBeUndefined();
    expect(d.additions).toBe(0); // a real zero: the forge computed it
  });

  it('failure → the shaped ForgeError with the wire message', async () => {
    const f = forgeWith(() => fail('pull request 269 not found'));
    await expect(f.prDetail(antreo, 269)).rejects.toThrow('pull request 269 not found');
  });

  it('prDiff: the unified diff passes through VERBATIM — never trimmed at the edge', async () => {
    const DIFF = 'diff --git a/src/a.ts b/src/a.ts\nindex 000..111 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n';
    const f = forgeWith((args) => {
      expect(args[0]).toBe('pr');
      expect(args[1]).toBe('diff');
      return ok(DIFF);
    });
    expect(await f.prDiff(antreo, 269)).toBe(DIFF);
  });

  it('prDiff failure → ForgeError', async () => {
    const f = forgeWith(() => fail('unknown PR'));
    await expect(f.prDiff(antreo, 269)).rejects.toThrow();
  });
});

// ===== WO-0092 — the issue bridge (the WO-0081 probe's frozen contract, report §(a)/(e)) =====
// Fixtures fed the probe's RAW LOGS verbatim: the list rows from raw/10-api-issue-list-all.json
// (url + closedByPullRequestsReferences per the frozen §(a) field set; the closedByPrs payload
// from raw/24-closedlink-milestone-nested.txt:2), the drill-down row from raw/18-api-rest-issue-333.json
// (body included — the spawn prefill's ONE fetch), the nested milestone from raw/24:4-43, the
// milestones page from raw/19-milestones-all-repos.txt:1-10.
const api = { owner: 'antreo-app', name: 'api' };

const ISSUE_FIELDS =
  'number,title,state,labels,milestone,createdAt,updatedAt,closedAt,url,closedByPullRequestsReferences';

// raw/10 rows #333 + #331 (OPEN) — verbatim, plus the §(a) field-set keys the probe's first cut omitted
const ISSUES_LIST = JSON.stringify([
  {
    closedAt: null,
    createdAt: '2026-09-20T18:37:15Z',
    labels: [],
    milestone: null,
    number: 333,
    state: 'OPEN',
    title: '[API] OTP paketi bittiğinde tam kesinti, önceden uyarı yok — Netgsm bakiye izleme + düşük paket alarmı',
    updatedAt: '2026-09-20T18:37:15Z',
    url: 'https://github.com/antreo-app/api/issues/333',
    closedByPullRequestsReferences: [],
  },
  {
    closedAt: '2026-09-18T21:38:33Z',
    createdAt: '2026-09-18T18:20:52Z',
    labels: [{ name: 'bug' }],
    milestone: {
      url: 'https://api.github.com/repos/antreo-app/docs/milestones/2',
      html_url: 'https://github.com/antreo-app/docs/milestone/2',
      number: 2,
      title: 'Faz 1 — Antrenör Profil Sistemi',
      description: '',
      creator: { login: 'Burakzturk34' },
      open_issues: 1,
      closed_issues: 7,
      state: 'open',
      created_at: '2026-08-18T07:54:57Z',
      updated_at: '2026-09-16T17:08:40Z',
      due_on: null,
      closed_at: null,
    },
    number: 324,
    state: 'CLOSED',
    title: '[API] Media guard test iyileştirmeleri — platform-koşullu bare-path testi + stand-in çapa sıkılaştırması',
    updatedAt: '2026-09-18T21:39:33Z',
    url: 'https://github.com/antreo-app/api/issues/324',
    closedByPullRequestsReferences: [
      {
        id: 'PR_kwDOT2H5sM8AAAABEJfCRw',
        number: 327,
        repository: { id: 'R_kgDOT2H5sA', name: 'api', owner: { id: 'O_kgDOEyk-EA', login: 'antreo-app' } },
        url: 'https://github.com/antreo-app/api/pull/327',
      },
    ],
  },
]);

// raw/18-api-rest-issue-333.json — the REST row VERBATIM (37 keys; the body is the operator's spec)
const REST_ISSUE_333 = `{"url":"https://api.github.com/repos/antreo-app/api/issues/333","repository_url":"https://api.github.com/repos/antreo-app/api","labels_url":"https://api.github.com/repos/antreo-app/api/issues/333/labels{/name}","comments_url":"https://api.github.com/repos/antreo-app/api/issues/333/comments","events_url":"https://api.github.com/repos/antreo-app/api/issues/333/events","html_url":"https://github.com/antreo-app/api/issues/333","id":5519710196,"node_id":"I_kwDOT2H5sM8AAAABSQAX9A","number":333,"title":"[API] OTP paketi bittiğinde tam kesinti, önceden uyarı yok — Netgsm bakiye izleme + düşük paket alarmı","user":{"login":"eneskaradeniz"},"labels":[],"state":"open","locked":false,"assignees":[],"milestone":null,"comments":0,"created_at":"2026-09-20T18:37:15Z","updated_at":"2026-09-20T18:37:15Z","closed_at":null,"assignee":null,"author_association":"MEMBER","issue_field_values":[],"type":null,"active_lock_reason":null,"sub_issues_summary":{"total":0,"completed":0,"percent_completed":0},"issue_dependencies_summary":{"blocked_by":0,"total_blocked_by":0,"blocking":0,"total_blocking":0},"body":"## Bulgu\\n\\nNetgsm OTP paketi bittiğinde API kod **60** dönüyor.","closed_by":null,"state_reason":null}`;

// raw/19-milestones-all-repos.txt:1-10 — the api page's first rows, wire-shaped
const MILESTONES = JSON.stringify([
  { number: 1, title: 'Faz 0 — Kullanıcı Altyapısı', state: 'open', open_issues: 0, closed_issues: 8, due_on: null, created_at: '2026-08-12T09:19:53Z', description: 'Şifresiz giriş, roller, KVKK.' },
  { number: 8, title: 'Faz 7 — Admin Panel & Moderasyon', state: 'closed', open_issues: 0, closed_issues: 11, due_on: null, created_at: '2026-09-14T06:31:26Z', description: '' },
]);

describe('issues (WO-0092 — report §2/§a, raw/10)', () => {
  it('the frozen one-shot call: the scan page args are pinned; the wire normalizes at this edge', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual([
        'issue', 'list', '--repo', 'antreo-app/api', '--state', 'open', '--limit', '50', '--json', ISSUE_FIELDS,
      ]);
      return ok(ISSUES_LIST);
    });
    expect(await f.issues(api, 'open')).toEqual([
      {
        number: 333,
        repo: api,
        state: 'open',
        title: '[API] OTP paketi bittiğinde tam kesinti, önceden uyarı yok — Netgsm bakiye izleme + düşük paket alarmı',
        url: 'https://github.com/antreo-app/api/issues/333',
        labels: [],
        createdAt: '2026-09-20T18:37:15Z',
        updatedAt: '2026-09-20T18:37:15Z',
      },
      {
        number: 324,
        repo: api,
        state: 'closed',
        title: '[API] Media guard test iyileştirmeleri — platform-koşullu bare-path testi + stand-in çapa sıkılaştırması',
        url: 'https://github.com/antreo-app/api/issues/324',
        labels: ['bug'],
        milestone: { number: 2, title: 'Faz 1 — Antrenör Profil Sistemi', state: 'open' },
        closedAt: '2026-09-18T21:38:33Z',
        updatedAt: '2026-09-18T21:39:33Z',
        createdAt: '2026-09-18T18:20:52Z',
        closedByPrs: [{ number: 327, url: 'https://github.com/antreo-app/api/pull/327', repo: api }],
      },
    ]);
  });

  it('LIST rows never carry a body — the field is not asked, the mapped shape cannot hold one', async () => {
    const f = forgeWith(() => ok(ISSUES_LIST));
    for (const row of await f.issues(api, 'open')) expect('body' in row).toBe(false);
  });

  it('null wire values stay ABSENT — milestone/closedAt/closedByPrs carry no keys', async () => {
    const raw = JSON.parse(ISSUES_LIST) as Record<string, unknown>[];
    delete raw[0]!.closedByPullRequestsReferences;
    const f = forgeWith(() => ok(JSON.stringify([raw[0]])));
    const row = (await f.issues(api, 'open'))[0]!;
    expect('milestone' in row).toBe(false);
    expect('closedAt' in row).toBe(false);
    expect('closedByPrs' in row).toBe(false);
    expect('stateReason' in row).toBe(false); // the list path carries no state_reason at all
  });

  it('an unknown wire state is the shaped unknown, not a guess', async () => {
    const raw = JSON.parse(ISSUES_LIST) as Record<string, unknown>[];
    raw[0]!.state = 'FUTZ';
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    await expect(f.issues(api, 'open')).rejects.toThrow(ForgeError);
    await expect(f.issues(api, 'open')).rejects.toThrow('unknown issue state "FUTZ"');
  });

  it('non-zero exit → ForgeError carrying the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Issues are disabled for this repository'));
    await expect(f.issues(api, 'open')).rejects.toThrow('gh: Issues are disabled for this repository');
  });
});

describe('issue — the drill-down (WO-0092, report §4/§a, raw/18)', () => {
  it('the REST row maps: html_url is the display url, the body rides, the count fields never do', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['api', 'repos/antreo-app/api/issues/333']);
      return ok(REST_ISSUE_333);
    });
    const issue = await f.issue(api, 333);
    expect(issue).toEqual({
      number: 333,
      repo: api,
      state: 'open',
      title: '[API] OTP paketi bittiğinde tam kesinti, önceden uyarı yok — Netgsm bakiye izleme + düşük paket alarmı',
      url: 'https://github.com/antreo-app/api/issues/333',
      labels: [],
      createdAt: '2026-09-20T18:37:15Z',
      updatedAt: '2026-09-20T18:37:15Z',
      body: '## Bulgu\n\nNetgsm OTP paketi bittiğinde API kod **60** dönüyor.',
    });
  });

  it('a null state_reason stays ABSENT; closedByPrs stays ABSENT — this path carries no closure fact', async () => {
    const f = forgeWith(() => ok(REST_ISSUE_333));
    const issue = await f.issue(api, 333);
    expect('stateReason' in issue).toBe(false);
    expect('closedByPrs' in issue).toBe(false);
  });

  it('a closed REST row maps state_reason lowercase and the milestone object by number/title/state (raw/24)', async () => {
    const raw = JSON.parse(REST_ISSUE_333) as Record<string, unknown>;
    raw.state = 'closed';
    raw.state_reason = 'completed';
    raw.closed_at = '2026-09-18T21:38:33Z';
    raw.milestone = JSON.parse(JSON.stringify((JSON.parse(ISSUES_LIST) as Record<string, unknown>[])[1]!.milestone));
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    const issue = await f.issue(api, 333);
    expect(issue.state).toBe('closed');
    expect(issue.stateReason).toBe('completed');
    expect(issue.closedAt).toBe('2026-09-18T21:38:33Z');
    expect(issue.milestone).toEqual({ number: 2, title: 'Faz 1 — Antrenör Profil Sistemi', state: 'open' });
  });

  it('an empty body stays ABSENT (the spawn prefill reads undefined, never an empty string)', async () => {
    const raw = JSON.parse(REST_ISSUE_333) as Record<string, unknown>;
    raw.body = '';
    const f = forgeWith(() => ok(JSON.stringify(raw)));
    expect((await f.issue(api, 333)).body).toBeUndefined();
  });

  it('a missing issue → the wire message as the reason (the spawn refusal, nothing prefilled)', async () => {
    const f = forgeWith(() => fail('gh: Not Found (HTTP 404)', 1, '{"message":"Not Found"}'));
    await expect(f.issue(api, 329)).rejects.toThrow('Not Found');
  });
});

describe('milestones (WO-0092 — display facts only, report §5, raw/19)', () => {
  it('the one-shot REST page maps to the frozen shape; due_on null stays ABSENT', async () => {
    const f = forgeWith((args) => {
      expect(args).toEqual(['api', 'repos/antreo-app/api/milestones?state=all']);
      return ok(MILESTONES);
    });
    expect(await f.milestones(api)).toEqual([
      { number: 1, title: 'Faz 0 — Kullanıcı Altyapısı', state: 'open', openIssueCount: 0, closedIssueCount: 8 },
      { number: 8, title: 'Faz 7 — Admin Panel & Moderasyon', state: 'closed', openIssueCount: 0, closedIssueCount: 11 },
    ]);
  });

  it('non-zero exit → ForgeError carrying the stderr line', async () => {
    const f = forgeWith(() => fail('gh: Could not resolve to a Repository'));
    await expect(f.milestones(api)).rejects.toThrow('gh: Could not resolve to a Repository');
  });
});
