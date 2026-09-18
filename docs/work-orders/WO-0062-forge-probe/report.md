# WO-0062 — Forge surface probe — findings

Probed 2026-09-19 against `gh` 2.101.0, authenticated as `eneskaradeniz` (keyring token, https
protocol, scopes `gist, read:org, repo, workflow`). Sample repos: `eneskaradeniz/docket` (private)
and the `antreo-app` org (private). Every command is in the order's read-only matrix; every output
below is an observed excerpt.

**Verdict up front: the read surface Docket needs fits in four gh calls, all of them one-shot
JSON, and the 5000/h rate budget makes a 30s reconciler free. The `Forge` port sketch is at the
end.**

## 1. Presence / version / auth

```
gh --version          → gh version 2.101.0 (2026-09-15)
gh auth status        → ✓ Logged in to github.com account eneskaradeniz (keyring)
                        Token scopes: 'gist', 'read:org', 'repo', 'workflow'   (exit 0)
gh auth status --json → needs a field list; `--json hosts` yields:
{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com",
  "login":"eneskaradeniz","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow",
  "gitProtocol":"https"}]}}
```

Finding: the health check gets a machine-readable, one-command auth shape (`--json hosts` —
state + scopes + protocol per host). `state != "success"` and a non-zero exit are the degraded
signals. Absent-binary and network-down shapes were NOT simulated (revoking the operator's auth
to test is out of proportion) — **unknown, by refusal, not by omission**; the health check
should treat `exit != 0` from any of these as degraded and display why.

## 2. Rate budget

```
gh api rate_limit → core {limit: 5000, remaining: 5000}, graphql {limit: 5000, remaining: 5000}
```

Finding: 5000/h REST + 5000/h GraphQL, currently untouched. A 30s-interval reconciler worst case
is ~120 calls/h against a 5000 budget — **two orders of magnitude of headroom**; polling is a
viable v1 without webhooks or conditional requests.

## 3. PR ingestion — ONE call answers the board question

```
gh pr list --state all --limit 3 \
  --json number,state,headRefOid,headRefName,baseRefName,reviewDecision,mergedAt,url,mergeCommit
{"n":66,"state":"MERGED","head":"wo-0061-null-fix","sha":"b26a663","mergedAt":"…","mergeSha":"e9f10a6"}
```

Findings:
- A single `gh pr list --json <set>` returns the full ingestion set, including `headRefOid` (the
  head sha Docket's closure candidates carry) and `mergeCommit.oid` (the merge sha the closure
  gate wants). No per-PR follow-up needed for the board-level fact set.
- `state` arrives UPPERCASE (`MERGED`/`OPEN`/`CLOSED`); `reviewDecision` arrives as an EMPTY
  STRING when no reviews exist (the solo case — every sampled PR). The adapter must normalize
  both; `'' → 'none'` and lowercase state, once, at the adapter edge.
- Default page is 30; `--limit N` controls it. A repo like docket (~66 PRs over 7 weeks) paginates
  cheaply; an `--state open` filter shrinks the default reconciliation path.

## 4. Check-runs — two shapes, one normalization

```
gh pr view 66 --json statusCheckRollup
  [{__typename:"CheckRun", name:"check", status:"COMPLETED", conclusion:"SUCCESS"}, …]   (UPPERCASE)
gh api repos/{o}/{r}/commits/{sha}/check-runs
  {total_count:2, check_runs:[{name:"check", status:"completed", conclusion:"success"}]} (lowercase)
```

Findings: both work, including on a MERGED PR's head sha — history stays auditable after merge.
They disagree on case (GraphQL shouts, REST whispers) and the rollup mixes `__typename`s
(CheckRun vs StatusContext — not sampled here, but the field exists). Pick ONE source for the
port (the REST endpoint — it takes the sha Docket already has, no PR lookup first) and normalize
`status/conclusion` to lowercase at the adapter edge.

## 5. Sha → PR resolution — the closure-candidate path works for BOTH sha kinds

```
gh api repos/{o}/{r}/commits/<merge-sha 9f0e9fa>/pulls
  [{number:65, title:"WO-0060 — …", state:"closed", merged_at:"2026-09-18T22:42:28Z"}]
gh api repos/{o}/{r}/commits/<head-sha f5d9299>/pulls
  [{number:65, state:"closed", merged_at:"2026-09-18T22:42:28Z"}]
```

Finding: the commit-association endpoint resolves a PR from EITHER the merge sha or the head sha
— exactly the two shas Docket's records carry (evidence cites head, the forge produces merge).
One call, no branch knowledge needed. `gh pr list --head <branch> --state all` also works
(resolved #66 from its branch name) and is the fallback when only the branch name is known.

## 6. Remote parsing — one form observed, parser kept honest anyway

```
git remote get-url origin (docket)  → https://github.com/eneskaradeniz/docket.git
git remote get-url origin (antreo)  → https://github.com/antreo-app/{api,docs,mobile,mobile-design}.git
```

Findings:
- Every remote on this machine is `https://github.com/{owner}/{repo}.git` — the parser needs:
  strip `.git`, split the path after the host. That is the whole observed case.
- ssh/`git@alias:`/enterprise-host forms are **unknown** (none exist here to observe). The
  mapping function should still be total — return a shaped `unknown` for unparseable forms
  (the health-check ruling), not a guess.
- Antreo note: the org holds **4** repos, not the 3 in session memory (`mobile-design` exists
  alongside api/docs/mobile). The M4 onboarding numbers must use 4.

## 7. Multi-repo auth — one token reads both accounts' privates

```
gh pr list --repo antreo-app/api --state all --limit 3
  → 3 MERGED PRs, titles carrying issue refs: "test(media, api#324): …", "fix(locations, api#314): …"
```

Finding: the same token (scopes `repo` + `read:org`) reads docket (personal, private) and the
`antreo-app` org's private repos — no per-repo auth configuration is needed for the read layer.
Bonus finding: antreo's PR titles carry the cross-repo issue chain (`api#324`) — the issue
observation feature, if it lands, can read the chain from titles alone on day one.

## 8. Failure shapes — the honest-degraded inputs

```
bad sha        → HTTP 422, JSON {"message":"No commit found for SHA: 00…0"}, stderr "gh: … (HTTP 422)", exit 1
no-such repo   → GraphQL "Could not resolve to a Repository …", exit 1
auth ok        → exit 0
```

Finding: `exit != 0` is the universal degraded signal; when the failure has a JSON body (REST)
the message is displayable verbatim. Adapter contract: catch exit codes, prefer the JSON
message, carry the stderr line as the reason — "a degraded dependency yields `unknown`, never a
guess" maps directly. Not simulated: revoked-token and network-down (see §1).

---

## The `Forge` port sketch (vendor-neutral shape — the next WO freezes it)

Mirrors the `SessionRunner` precedent: a core interface, one adapter per forge, names the vendor
only in the adapter. Methods annotated with the observed gh call and cost.

```ts
// core: the port. No forge vocabulary in method names beyond the domain's own (PR, check).
interface Forge {
  /** Health: is the forge reachable and authorized, per repo's host? Observed cost: 1 call. */
  health(): Promise<ForgeHealth>;                       // 'ok' | { degraded: reason } — never a guess
  /** The repo's PRs with the board-level fact set. Observed cost: 1 call per page (30). */
  pullRequests(repo: RepoRef): Promise<ForgePr[]>;
  /** Resolve a sha (head OR merge) to its PR — the closure-candidate path. 1 call. */
  pullRequestForSha(repo: RepoRef, sha: string): Promise<ForgePr | undefined>;
  /** CI facts for a sha. Observed cost: 1 call. */
  checks(repo: RepoRef, sha: string): Promise<ForgeCheck[]>;
}
type RepoRef = { owner: string; name: string };         // resolved from connection.repo_remote
interface ForgePr {
  number: number;
  state: 'open' | 'closed' | 'merged';                  // normalized from UPPERCASE
  headSha: string; headBranch: string; baseBranch: string;
  reviewDecision: 'none' | string;                      // '' → 'none' at the edge
  mergedAt?: string; url: string; mergeSha?: string;
}
interface ForgeCheck { name: string; status: string; conclusion: string | undefined; }
```

### Open design questions for the Forge WO (answer with the report in hand)

1. **Where does remote → `RepoRef` resolution live?** Observed: one URL form on this machine.
   Recommendation: resolve in the adapter at read time (no new `connection` column — the
   best-effort `repo_remote` already persisted stays the source), shape `unknown` for
   unparseable forms. Revisit only when a real ssh/enterprise remote appears.
2. **Reconciliation triggers and cadence.** Rate budget is a non-constraint (§2). Start:
   on open/focus/after-actions + manual refresh (the M3 list's own words), background interval
   later. Observation wins over the last shown state.
3. **One check source.** REST `/commits/{sha}/check-runs` (sha-first, no PR lookup) over the
   GraphQL rollup; normalize case at the edge. Revisit when a repo uses StatusContext-only
   checks (unsampled).
4. **Pagination policy** for `pullRequests`: `--state open` default, full scan only in
   history views.
5. **What enters the evidence record** (the Records line): PR number/url/shas/check names are
   record targets — fine; the token and `gh auth status` output details are not.

*Probe scripts: none needed — every command was a one-liner from the matrix; excerpts above are
the artifacts.*
