// electron/e2e-forge.ts — a scripted fake GhRunner, wired ONLY under DOCKET_E2E (WO-0092).
// Mirrors e2e-runner.ts: same seam as the production gh binary, zero network — the answers
// below are the WO-0081 probe's observed wire shapes over a fixture repo (antreo-app/api), so
// the issue-bridge E2E specs drive REAL UI flows against REAL adapter parsing without a single
// gh spawn. The seam types are declared here structurally (the composition root may not import
// the adapter's internals from a second module — ADR-0006; GitHubForge accepts them as-is).
interface GhResult {
  exit: number;
  stdout: string;
  stderr: string;
}
type GhRunner = (args: string[]) => Promise<GhResult>;

const ok = (stdout: string): GhResult => ({ exit: 0, stdout, stderr: '' });

// `gh auth status --json hosts` (the probe's observed success shape, health read).
const AUTH_OK = `{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"eneskaradeniz","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}]}}`;

// `gh issue list --state open --limit 50 --json <frozen set>` — the fixture open page (raw/10 rows).
const ISSUE_LIST = JSON.stringify([
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
    closedAt: null,
    createdAt: '2026-09-19T09:12:00Z',
    labels: [{ name: 'bug' }],
    milestone: {
      number: 2,
      title: 'Faz 1 — Antrenör Profil Sistemi',
      state: 'open',
      open_issues: 1,
      closed_issues: 7,
      due_on: null,
    },
    number: 330,
    state: 'OPEN',
    title: '[API] OTP SMS şablonsuz — mesaj gövdesi çıplak 6 hane',
    updatedAt: '2026-09-20T18:39:58Z',
    url: 'https://github.com/antreo-app/api/issues/330',
    closedByPullRequestsReferences: [],
  },
  {
    closedAt: null,
    createdAt: '2026-09-19T09:20:00Z',
    labels: [],
    milestone: null,
    number: 329,
    state: 'OPEN',
    title: '[API] Telefon sözleşmesinin sunucu yarısı hiç yazılmamış',
    updatedAt: '2026-09-20T18:40:01Z',
    url: 'https://github.com/antreo-app/api/issues/329',
    closedByPullRequestsReferences: [],
  },
  {
    closedAt: null,
    createdAt: '2026-09-18T11:00:00Z',
    labels: [],
    milestone: null,
    number: 328,
    state: 'OPEN',
    title: 'Sosyal giriş (Google/Apple) kayıtsız kimlikle hesap açabilsin',
    updatedAt: '2026-09-20T11:35:56Z',
    url: 'https://github.com/antreo-app/api/issues/328',
    closedByPullRequestsReferences: [],
  },
]);

// `gh api repos/antreo-app/api/issues/N` — the REST drill-down rows; #329 intentionally FAILS so
// the degraded-drill-down refusal path is drivable end to end.
const restIssue = (n: number, title: string, body: string): string =>
  JSON.stringify({
    url: `https://api.github.com/repos/antreo-app/api/issues/${n}`,
    repository_url: 'https://api.github.com/repos/antreo-app/api',
    html_url: `https://github.com/antreo-app/api/issues/${n}`,
    number: n,
    title,
    user: { login: 'eneskaradeniz' },
    labels: [],
    state: 'open',
    locked: false,
    assignees: [],
    milestone: null,
    comments: 0,
    created_at: '2026-09-20T18:37:15Z',
    updated_at: '2026-09-20T18:37:15Z',
    closed_at: null,
    body,
    state_reason: null,
  });

const ISSUE_333 = restIssue(333, '[API] OTP paketi bittiğinde tam kesinti, önceden uyarı yok — Netgsm bakiye izleme + düşük paket alarmı', '## Bulgu\n\nNetgsm OTP paketi bittiğinde tam kesinti. E2E gövdesi.');
const ISSUE_330 = restIssue(330, '[API] OTP SMS şablonsuz — mesaj gövdesi çıplak 6 hane', 'E2E gövdesi: şablon eksikliği.');
const ISSUE_328 = restIssue(328, 'Sosyal giriş (Google/Apple) kayıtsız kimlikle hesap açabilsin', 'E2E gövdesi: sosyal giriş.');

// `gh pr list` — the fixture repo carries no open PRs (issue facts are what the specs drive).
export function e2eGhRunner(): GhRunner {
  return async (args) => {
    const head = args[0];
    const tail = args.join(' ');
    if (head === 'auth' && tail.includes('auth status')) return ok(AUTH_OK);
    if (head === 'pr' && tail.includes('pr list')) return ok('[]');
    if (head === 'issue' && tail.includes('issue list')) return ok(ISSUE_LIST);
    if (head === 'api' && /repos\/antreo-app\/api\/issues\/333$/.test(args[1] ?? '')) return ok(ISSUE_333);
    if (head === 'api' && /repos\/antreo-app\/api\/issues\/330$/.test(args[1] ?? '')) return ok(ISSUE_330);
    if (head === 'api' && /repos\/antreo-app\/api\/issues\/328$/.test(args[1] ?? '')) return ok(ISSUE_328);
    // The shaped unknown: #329's drill-down dies like an unreachable forge — the spawn must
    // refuse with a reason and write nothing (acceptance 3).
    if (head === 'api' && /repos\/antreo-app\/api\/issues\/\d+$/.test(args[1] ?? ''))
      return { exit: 1, stdout: '{"message":"Not Found"}', stderr: 'gh: Not Found (HTTP 404)' };
    if (head === 'api' && tail.includes('/milestones?state=all')) return ok('[]');
    return { exit: 0, stdout: '[]', stderr: '' };
  };
}
