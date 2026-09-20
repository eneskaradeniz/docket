# WO-0081 — `gh issue` surface probe — findings

Probed 2026-09-20 against `gh` 2.101.0, authenticated as `eneskaradeniz` (keyring token, https,
scopes `gist, read:org, repo, workflow`) — the same identity the WO-0062 forge probe froze
(`raw/02-auth-status.txt:1-6`). READ-ONLY end to end: every command in
`docs/probes/forge-issue/probe-issue.sh` is a list/view/api-GET; the script carries zero
mutation flags (verified by grep — no create/edit/close/comment/label/milestone write, no
`-X POST|PATCH|PUT|DELETE`). Repos sampled: the four antreo repos with issue activity.

**Verdict up front: the issue surface is readable in THREE one-shot calls per repo
(`gh issue list --json <set>` for the board, `gh api repos/o/n/issues/N` for the card, one
`milestones` call) — and the org-wide open count is 38, so a full reconciliation is free
against the 5000/h budget. The operator's issues carry NO WO-NNNN ids: the link is the existing
`api#330`-style title/body ref convention, which search resolves in one call. Milestones are
not an extra planning layer — they ARE the operator's `Faz N` layer, already mirrored per-repo.
The `ForgeIssues` port sketch and the WO-0082 answers are at the end.**

## 1. The repo reality — 6 repos, 4 with issues, 38 open org-wide

```
gh repo list antreo-app --json name,pushedAt → mobile, api, admin-web, docs, mobile-design, web
                                               (raw/01-org-repos.json — TWO repos beyond the
                                                WO-0062 count of 4: admin-web, web are new)
gh issue list -R antreo-app/api         --state all → numbers up to 333 (raw/10-api-issue-list-all.json)
gh issue list -R antreo-app/docs        --state all → numbers up to 101
gh issue list -R antreo-app/mobile      --state all → numbers up to 263
gh issue list -R antreo-app/admin-web   --state all → numbers up to 70
gh issue list -R antreo-app/mobile-design --state all → []
gh issue list -R antreo-app/web           --state all → []
gh api search/issues q="is:issue is:open org:antreo-app" → total_count: 38
   first-page breakdown: {mobile: 24, api: 6}   (raw/25-org-open-count.txt:1-2)
```

Findings:
- Four live issue repos: **api** (~333 total), **mobile** (~263), **docs** (~101), **admin-web**
  (~70). **mobile-design and web have ZERO issues** — "no issues" is not degraded; the repo is
  simply not tracked that way.
- Open is cheap to count: 38 open issues org-wide. A board scan at `--state open --limit 50`
  is ONE page per repo — pagination never enters the hot path.
- The operator's issue titles are rich, structured Turkish: `[API]` / `[Flutter]` repo prefixes,
  cross-repo refs with a lock glyph (`(🔒 api#330)` in mobile#263's title), and the docs repo
  carries the faz/task naming inside issues: `Görev 9 (Faz 1): Antrenör Branşı Güncelleme (PUT)`
  (`raw/23-labels-pagesize-milestonefilter.txt`).

## 2. `gh issue list` — 27 valid `--json` fields; body/comments ACCEPT on list (and cost)

```
gh issue list -R o/n --json bogusfield → gh prints the authoritative list (raw/11-api-issue-list-fieldlist.txt:1-29):
  assignees, author, blockedBy, blocking, body, closed, closedAt, closedByPullRequestsReferences,
  comments, createdAt, id, isPinned, issueType, labels, milestone, number, parent, projectCards,
  projectItems, reactionGroups, state, stateReason, subIssues, subIssuesSummary, title, updatedAt, url
```

Findings:
- The board-level cut (`raw/10-api-issue-list-all.json:1`) returns exactly what was asked, in a
  compact camelCase row:
  `{"closedAt":null,"createdAt":"2026-09-20T18:37:15Z","labels":[],"milestone":null,"number":333,"state":"OPEN","title":"[API] OTP paketi bittiğinde…","updatedAt":"2026-09-20T18:37:15Z"}`
- `state` arrives **UPPERCASE** (`OPEN`/`CLOSED`) — the same wire quirk as `gh pr list`
  (WO-0062 §3); the same adapter-edge normalization applies.
- **`body` and `comments` ARE accepted on LIST** (exit 0): 2 issues with bodies+comments
  produced 7406 bytes (`raw/12-api-issue-list-body-comments.json`) vs ~1 KB for the same 2 rows
  without bodies. Accepted ≠ cheap — the list must NOT ask for bodies.
- Link-shaped fields exist right on the list: `blockedBy`, `blocking`, `parent`,
  `subIssues`, `subIssuesSummary`, `closedByPullRequestsReferences` (§6 for what they hold).
- Default page size is **30** (`raw/23a-default-pagesize.txt`: no `--limit` on the 101-issue docs
  repo returned 30 rows); `--limit N`, `--state open|closed|all` and `--search "<q> in:title"`
  are the flags that matter.
- The human table (`gh issue list -R o/n --state open`, `raw/13-api-issue-list-plain.txt:1`) is
  `NUMBER → STATE → TITLE → LABELS → UPDATED` with FULL ISO timestamps (not the old relative
  "about X ago") — nothing a Docket card needs that the JSON row lacks.

## 3. `gh issue view` — the per-issue card, and what NOT to lift

```
gh issue view 333 -R antreo-app/api --json number,title,state,body,labels,milestone,url,createdAt,closedAt
  → exit 0; 3418 bytes; keys: [body, closedAt, createdAt, labels, milestone, number, state, title, url]
  → body chars: 2850; labels: []; milestone: None
  → state: OPEN  url: https://github.com/antreo-app/api/issues/333   (raw/14-api-issue-view-333.json)
gh issue view 333 --json number,comments → {"comments":[],"number":333}   (raw/24-closedlink-milestone-nested.txt:45-47)
```

Findings:
- One call yields the whole card: title, state, url, timestamps, labels, milestone — plus the
  body (2850 chars on #333; the REST rows in §4 show bodies reaching ~5 KB). `comments` is a
  field too, on both list and view.
- **The ADR-0010 cut:** a Docket issue card renders number, title, state, url, timestamps,
  labels, milestone. The BODY is the operator's working spec (acceptance checklists, provider
  credentials handling, ops runbooks — see #331's table of Netgsm error codes) — lifting it
  adds KBs per row and a second place where a spec goes stale; the `url` click covers it.
  **Comments, reactions, project cards, timeline, events: not read at all** (see §f).

## 4. The REST shape — 37 snake_case keys; the gh wrapper hides the names

```
gh api "repos/antreo-app/api/issues?state=all&per_page=3"   (raw/16-api-rest-issues.json)
row keys (37): active_lock_reason, assignee, assignees, author_association, body, closed_at,
  closed_by, comments, comments_url, created_at, events_url, html_url, id, issue_field_values,
  issue_dependencies_summary, labels, labels_url, locked, milestone, node_id, number,
  performed_via_github_app, pinned_comment, reactions, repository_url, state, state_reason,
  sub_issues_summary, timeline_url, title, type, updated_at, url, user
```

Findings (what the gh wrapper hides — the names DIFFER):
- `author` (gh) → **`user`** (REST, an object with `login`); gh's `url` (the html url) →
  **`html_url`** (REST `url` is the API url); `comments` (gh, an array when asked) →
  **`comments`: int COUNT** on REST (`raw/18-api-rest-issue-333.json`: `comments type/value: int 0`).
- REST carries the dependency graph as a flat summary per row, no extra call:
  `"issue_dependencies_summary":{"blocked_by":0,"total_blocked_by":0,"blocking":0,"total_blocking":0}`
  and `"sub_issues_summary":{"total":0,"completed":0,"percent_completed":0}`.
- `state` is lowercase here (`"state":"open"`) vs gh's `OPEN`; `state_reason` rides alongside
  (§6: `"COMPLETED"` on a real closed issue); `author_association":"MEMBER"` marks the operator
  as an org member.
- Pagination header is a **cursor, not just a page number**
  (`raw/17-api-rest-issues-headers.txt:9`):
  `Link: <https://api.github.com/repositories/1331820976/issues?state=all&per_page=3&after=Y3Vyc29yOnYyOpLPAAABoMAbaSjPAAAAAUkAEp0%3D&page=2>; rel="next"`
  — plus per-call rate headers (`X-Ratelimit-Limit: 5000`, `X-Ratelimit-Remaining: 4963`,
  `X-Ratelimit-Used: 37`, `X-Ratelimit-Resource: core`, lines 23-27). `gh api -i` exposes both;
  the gh `--json` paths expose neither.

## 5. Milestones — IN REAL USE, and they ARE the `Faz N` layer

```
gh api repos/antreo-app/api/milestones?state=all → count: 8   (raw/19-milestones-all-repos.txt:1-10)
  {'number': 1, 'title': 'Faz 0 — Kullanıcı Altyapısı', 'state': 'open', 'open_issues': 0, 'closed_issues': 8, 'due_on': None, …}
  {'number': 6, 'title': 'Faz 2 — Değerlendirme Sistemi', …}          ← milestone #6 is Faz 2
  {'number': 8, 'title': 'Faz 7 — Admin Panel & Moderasyon', 'state': 'closed', 'closed_issues': 11, …}
antreo-app/docs    → count: 7  (Faz 0..6; milestone 2: open_issues 1, closed_issues 7)
antreo-app/mobile  → count: 1  (Faz 0 only)
antreo-app/admin-web → count: 0
```

Findings:
- **Milestones are the operator's faz tracking, mirrored per-repo** — titles `Faz 0 … Faz 7`,
  descriptions carrying planning prose (`raw/19-milestones-all-repos.txt:13`: docs' Faz 0
  description names the data-model groups and the dependency rule
  "Bu faz tamamlanmadan diğer fazlar (özellikle Faz 1 antrenör profili) başlatılamaz").
- Every `due_on` is **null** — milestones carry no dates; ordering is the title's `Faz N`, and
  even that is imperfect (`milestone #6 is Faz 2` — creation order ≠ faz order).
- The nested milestone on an issue row is the FULL object (`raw/24-closedlink-milestone-nested.txt:4-43`):
  `url`, `html_url`, `number`, `title`, `description`, `creator`, `open_issues`,
  `closed_issues`, `state`, `created_at`, `updated_at`, `due_on`, `closed_at`. Its `creator`
  is `Burakzturk34` — a **second collaborator** on the antreo repos (relevant later: a gated
  write at WO closure would not be single-actor).
- Milestone filter works at REST: `repos/o/n/issues?milestone=2` returned exactly the Faz-1
  issues (`raw/23-labels-pagesize-milestonefilter.txt`: docs#35, #58, #34, #33, #32 —
  `Görev N (Faz 1)` titles).

## 6. The link question — no WO ids anywhere; the `repo#N` title ref is the convention, and search resolves it

```
gh issue list --search "WO- in:title,body" → [] for api, docs, mobile, admin-web   (raw/21-search-wo-pattern.txt:2-12)
gh api search/issues q="WO- org:antreo-app is:issue"
  → {"total_count":0,"incomplete_results":false,"items":[],"search_type":"lexical"}   (:15-16)
```

The operator's real convention, observed on live titles:
- cross-repo refs IN the title, with a lock glyph for blocked: mobile#263's title ends
  `(🔒 api#330)`; admin-web#60: `Harcamalar ekranı — yalnızca Platform Yöneticisi (docs#101 / api#247)`;
  and in bodies: api#333's `## Bağımlılık` section says `api#331`
  (`raw/17-api-rest-issues-headers.txt:30`, body tail).
- the docs repo numbers its faz tasks as `Görev N (Faz M): <title>`.

Both search paths agree, and both resolve the convention:

```
gh issue list -R antreo-app/api --search "Netgsm in:title" --json number,title,state
  → #331, #333, #329                                   (raw/20-search-netgsm.txt)
gh api -X GET search/issues -f q="Netgsm in:title repo:antreo-app/api is:issue"
  → total_count: 3 — the same three, REST-shaped items  (raw/20a-search-netgsm rest section)
gh issue list -R antreo-app/mobile --search "api#330 in:title"
  → [{"number":263, … "(🔒 api#330)"}]                  (raw/22-search-crossref.txt:1-3)
gh api -X GET search/issues -f q="Netgsm in:title org:antreo-app is:issue"
  → total_count: 3 (org-wide, one call)                 (raw/22a section)
```

Findings:
- **`repo#N` tokenizes in `--search`** — Docket can find the issues that REFERENCE a repo#N
  (or a WO's repo) in one call, without any front-matter.
- The STRUCTURED link fields are all EMPTY on every sampled issue
  (`raw/15-mobile-issue-263-linkfields.json`):
  `"blockedBy":{"nodes":[],"totalCount":0},"blocking":{"nodes":[],"totalCount":0},"parent":null,"subIssues":{"nodes":[],"totalCount":0},"subIssuesSummary":{"completed":0,"percentCompleted":0,"total":0}`
  — the operator's chain is TEXT convention, not GitHub's dependency graph. Reading
  `blockedBy` as truth would find NOTHING the titles don't already say.
- One structured field DOES carry facts — `closedByPullRequestsReferences` on a closed issue
  (`raw/24-closedlink-milestone-nested.txt:2`):
  `{"closedByPullRequestsReferences":[{"id":"PR_kwDOT2H5sM8AAAABEJfCRw","number":327,"repository":{"id":"R_kgDOT2H5sA","name":"api","owner":{"id":"O_kgDOEyk-EA","login":"antreo-app"}},"url":"https://github.com/antreo-app/api/pull/327"}],"number":324,"state":"CLOSED","stateReason":"COMPLETED"}`
  — "this issue was closed by PR #327", free on the issue row, and the exact shape Docket's
  forge layer can join against a closure's merge candidate later.

## 7. Identity + limits — the same keyring identity; search is the scarce budget

```
gh auth status → ✓ Logged in to github.com account eneskaradeniz (keyring)
                 Token scopes: 'gist', 'read:org', 'repo', 'workflow'   (raw/02-auth-status.txt)
gh api rate_limit → core {limit:5000, used:0, remaining:5000},
                    search {limit:30, used:0, remaining:30},
                    graphql {limit:5000}, audit_log {limit:1750}, …  (raw/03-rate-limit.json)
X-Ratelimit headers per REST call: core resource, 4963 remaining after 37 calls (raw/17-…txt:23-27)
```

Finding: same identity and scopes as the WO-0062 forge reads — **the issue port shares the
forge adapter's `GhRunner` seam unchanged**. The budget that matters is not core (5000/h; the
whole org is 38 open issues) but **search: 30 requests/minute** — a title-ref fan-out must
stay single-digit per refresh and never sit in a polling loop.

---

## WO-0082 design consequences

### (a) The proposed read surface — three calls total, all one-shot JSON

Mirrors the frozen `Forge` port's discipline (one call per method, normalization at the edge):

```
issues(repo, state)   → gh issue list --repo o/n --state S --json
                        number,title,state,labels,milestone,createdAt,updatedAt,closedAt,url,closedByPullRequestsReferences
issue(repo, number)   → gh api repos/o/n/issues/N   (REST — one call; the row already carries
                        the full milestone object, issue_dependencies_summary, state_reason)
milestones(repo)      → gh api repos/o/n/milestones?state=all
```

The board needs nothing else: title/state/labels/milestone/updatedAt/url is the whole card,
and 38 open issues fit one `--limit 50` page per repo. Per-issue drill-down is
detail-click-only, never a list-time cost. `closedByPullRequestsReferences` rides the same
list call — the issue↔PR join the closure evidence can use later.

### (b) The link strategy — front-matter `issue:` PRIMARY, title-ref search SECONDARY

- **Primary: `issue:` front-matter on order.md** (the `task:` pattern, ADR-0010 rule 1) holding
  `owner/repo#N`. Stored as text, resolved at view time — no DB column, no backlink. This is
  the ruled direction (link-and-observe) and the only form that survives a search-index gap.
- **Secondary: `--search "<ref> in:title"` resolves the reverse direction** (find the issues
  that reference a repo#N) — measured working on live data (`raw/22-search-crossref.txt:1-3`).
  Offer it as an observe-side suggestion ("issues mentioning this repo"), never as stored truth.
- **The WO-NNNN convention does NOT exist in antreo** (`total_count: 0` org-wide,
  `raw/21-search-wo-pattern.txt:15-16`) — do NOT design a "search issues for WO-NNNN" feature;
  there is nothing to find. If Docket ever wants WO numbers in issue titles, that is a
  WRITE-side convention to introduce (out of scope for a read probe).

### (c) Pagination / scan policy

- Board reconciliation: `--state open --limit 50`, one page, no Link-header following. 38 open
  issues org-wide means full coverage at 4-5 core calls per refresh.
- History/detail: only on demand (`--state closed --limit N`, or the REST cursor `after=`
  when a repo exceeds one page). Never scan all ~333 api issues into a cache.
- Search fan-out ≤ 3 calls per refresh (search budget 30/min). No interval polling — reconcile
  on open/focus/after-action like the Forge port (WO-0062 answer 2), with a manual refresh
  before any timer.

### (d) Milestones — observe, do NOT port as planning

Milestones are the operator's EXISTING faz layer, and Docket's roadmap fazlar are the ruled
planning truth — two faz vocabularies would compete. Recommendation: **no milestone port
surface**. Read the milestone TITLE + state as a display fact on the linked issue's row (it is
already inside both the list JSON and the REST row — zero extra calls), and let a future
roadmap↔milestone mapping be an operator-authored correspondence, not a sync. `due_on` is null
everywhere — there is no date signal to lose.

### (e) The vendor-neutral shapes to freeze

```ts
// core: the port. No vendor vocabulary beyond the domain's own (issue, milestone).
// Implemented as adapter-extra methods on the EXISTING Forge adapter (same GhRunner seam).
interface ForgeIssues {
  issues(repo: RepoRef, state: 'open' | 'closed' | 'all'): Promise<ForgeIssue[]>;
  issue(repo: RepoRef, number: number): Promise<ForgeIssue>;      // the drill-down
  milestones(repo: RepoRef): Promise<ForgeMilestone[]>;
}
type IssueRef = `${string}/${string}#${number}`;   // the front-matter value: owner/repo#N

interface ForgeIssue {
  number: number;
  repo: RepoRef;
  title?: string;
  state: 'open' | 'closed';                   // normalized from OPEN/CLOSED (gh) / open|closed (REST)
  stateReason?: 'completed' | string;         // REST state_reason — ABSENT when null, never invented
  url: string;                                // the DISPLAY url: gh `url` / REST `html_url`
  labels: string[];                           // names only; colors never leave the adapter
  milestone?: { number: number; title: string; state: 'open' | 'closed' };
  createdAt?: string; updatedAt?: string; closedAt?: string;
  closedByPrs?: { number: number; url: string; repo: RepoRef }[];   // the closure-join fact
}
interface ForgeMilestone {
  number: number; title: string;
  state: 'open' | 'closed';
  openIssueCount: number; closedIssueCount: number;
  dueOn?: string;                             // observed always null — absent, never guessed
}
```

Edge normalizations to freeze with it: gh `OPEN/CLOSED` → lowercase (the WO-0062 precedent);
gh's `url` is the display url, REST's `url` is the API url (`html_url` is the display one);
REST `comments` is a count, gh `comments` is an array — the port carries NEITHER (§f).

### (f) What was deliberately NOT read (ADR-0010 minimalism)

- **Bodies** — measured accepted on list (~10x payload per row) and up to ~5 KB per issue; the
  detail card renders title/state/labels/milestone/url; the body stays one click away at GitHub.
- **Comments** — never fetched beyond the count (`comments: 0-1` on every sampled issue;
  nothing to read today, and the keep-fresh debt is not justified by zero observations).
- **Reactions, project cards/items, timeline, events, `issue_field_values`, `pinned_comment`**
  — fields that exist on the wire; none populated in any sampled antreo issue; not in the port.
- **Labels beyond the name** — the palette exists (`raw/23-rest-labels.json`: `api`, `backend`,
  `bug`, `documentation`, `enhancement`, …) but every sampled issue row had `labels: []`; the
  operator's signal lives in titles and milestones, not labels.
- **Writes of any kind** — no create/edit/close/comment/label/milestone call was made or
  scripted; the "gated single write at WO closure" stays a later WO's measured question.

### Probe artifacts

- Script: `docs/probes/forge-issue/probe-issue.sh` (re-runnable, parameterized by repo, all
  reads, zero mutation flags — verified by grep).
- Raw logs: `docs/probes/forge-issue/raw/00-…` through `25-…` — every quote above cites its
  file and line.
