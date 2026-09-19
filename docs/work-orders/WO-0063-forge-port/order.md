---
id: WO-0063
title: "Forge port — the probe-frozen read surface: the `Forge` interface in core + the GitHub adapter over `gh`"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0063 — Forge port — the probe-frozen read surface

## Objective

M3's evidence layer starts with its first open checklist item: the `Forge` interface and its
GitHub implementation over `gh`. WO-0062 measured the read surface first (the M0 discipline's
second application) and ended with a vendor-neutral port sketch plus five open design
questions. This WO freezes that sketch into `src/core/forge.ts` (test-first), lands the adapter
in `src/adapters/forge/` (the one place the forge is named), and answers the five questions
with the findings in hand. It wires NO consumer — the health surface, reconciliation and
ingestion are the chain's next links; the adapter's fixture tests are this WO's verification.

## Context

- **The probe's verdict (WO-0062 `report.md`, 2026-09-19):** four one-shot gh calls cover the
  whole read surface — health (`auth status --json hosts`), PR list (`pr list --json …`, one
  call per page of 30), sha→PR (`repos/{o}/{r}/commits/{sha}/pulls` — resolves BOTH the head
  and the merge sha, the two shas Docket's records carry), checks (REST
  `commits/{sha}/check-runs`). The 5000/h budget makes any 30s-scale reconciler free.
- **Normalization debt observed at the edge:** PR `state` arrives UPPERCASE; `reviewDecision`
  arrives `''` when no reviews exist (the solo case — every sampled PR); check
  `status/conclusion` case depends on the endpoint (GraphQL shouts, REST whispers). Normalized
  ONCE in the adapter — never in core, never in ui.
- **Failure shapes (the honest-unknown inputs):** `exit != 0` is the universal degraded signal;
  REST failures carry a JSON `message` displayable verbatim, the stderr line is the reason.
  The M3 health ruling — a degraded dependency yields `unknown`, never a guess — is the
  contract for every method, including absent-binary and network-down (both unprobed, by
  refusal; both surface as exit≠0 / spawn failure).
- **The remote already persisted:** `connection.repo_remote` is filled best-effort at connect
  (`src/adapters/store/index.ts:792`, applied at `:821-822` and `:884-889`);
  `RepoConnectionInput.remote` (`src/core/source.ts:12-15`) exists but no UI sets it. The probe
  found ONE observed URL form on this machine (`https://github.com/{owner}/{repo}.git`); the
  ssh/`git@alias:`/enterprise forms are unknown — by refusal, not omission.
- **Vendor line (ADR-0006):** the port stays vendor-neutral — it reads like `SessionRunner`'s
  definition, PR/check/health vocabulary only (the domain's own words). `gh`/GitHub names
  appear ONLY in `src/adapters/forge/` and this docs folder.
- **Adapter precedent check:** the runner adapter is verified by running (SDK; ADR-0006's
  test-first carve-out for adapters). The forge adapter is the store/decision-store kind — a
  deterministic CLI translation — so it gets unit tests through an injected execution seam, fed
  the probe's observed JSON excerpts as fixtures. The probe outputs become the test corpus:
  the loop the M0 discipline exists to close.

## The five design questions — answered (the port freezes these)

1. **Remote → `RepoRef` lives adapter-side, at read time.** The GitHub adapter parses the
   persisted `connection.repo_remote` (it stays the only source — no new connection column, no
   UI write of `remote`); `https://github.com/{owner}/{repo}(.git)?` is the implemented form;
   any other shape returns the health-style shaped unknown, never a guess. Revisit only when a
   real ssh/enterprise remote appears.
2. **Reconciliation triggers/cadence are NOT frozen here** — they belong to the reconciliation
   WO, once consumers exist. The port commits only to the property that makes any cadence
   free: reads are one-shot, and observation wins over the last shown state.
3. **ONE check source:** REST `repos/{o}/{r}/commits/{sha}/check-runs` — sha-first (no PR
   lookup; takes the head sha the records already carry; stays queryable after merge). Case
   normalized to lowercase at the adapter edge. Revisit if a StatusContext-only repo appears
   (unsampled).
4. **Pagination:** `pullRequests` takes an explicit state filter; the open-state page is the
   default read; full scans only for history views. The default page (30) is the port's unit
   of cost.
5. **The Records line holds as-is:** PR number/url/shas/check names may enter evidence records
   as targets (the 2026-08-26 line); the token, `gh auth status` token-source details and
   scopes NEVER leave the adapter — `health()` returns a verdict + reason, not raw auth output.

## Scope

In scope:

- Core (test-first): `src/core/forge.ts` — the `Forge` port as the report sketched it:
  `health()`, `pullRequests(repo, state)`, `pullRequestForSha(repo, sha)`, `checks(repo, sha)`;
  `RepoRef`, `ForgePr` (lowercase `state`, `reviewDecision: 'none' | string`), `ForgeCheck`,
  `ForgeHealth` = `'ok' | { degraded: reason }`. Core tests pin what is pinnable without a
  forge (the type shapes); the behavior pins live in the adapter tests.
- Adapter: `src/adapters/forge/` — the GitHub implementation over the `gh` CLI (spawned as an
  executable, never an SDK), execution seam injected so the tests run offline; fixtures are the
  WO-0062 report's observed excerpts; every method's degraded path pinned (non-zero exit →
  degraded/unknown carrying the JSON message or the stderr line; bad sha → the 422 message as
  the reason; unparseable remote → shaped unknown); edge-only normalization pinned (no case
  repair anywhere else).
- Docs: the five answers above are the record; ROADMAP's WO-0063 line lands at closure citing
  the report and this order.

Out of scope:

- Any consumer: no health-check UI, no reconciliation wiring, no ingestion into the decision
  store, no `EvidenceStatus.unknown`, no stage derivation (TD-008), no gate engine.
- Any gh WRITE call — the read-surface WO; agent git actions and the Changes surface are later
  M3 items with their own ADR and fence.
- Composition-root wiring (the adapter is imported by a consumer WO's composition root, not
  before).
- Store/schema changes (`repo_remote` stays the best-effort string it is).

## Acceptance criteria

1. `src/core/forge.ts` compiles vendor-neutral; the boundary checks find no forge/gh name
   outside `src/adapters/forge/` and this docs folder.
2. The adapter's four methods are unit-pinned against the probe's observed fixtures, including
   the degraded shapes — non-zero exit, bad sha (422 message as reason), unparseable remote
   (shaped unknown), absent binary (spawn failure → degraded).
3. Normalization is edge-only: core receives lowercase state and `'none'` reviewDecision; no
   case repair exists outside the adapter.
4. Full ladder green: `npm run typecheck` (both tsconfigs), `npm test`, `npm run build`,
   `npm run check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — the architect plan round runs against this order; the probe
  report is the surface truth the plan builds on.
- probe_permissions: CARRIED — every gh call the adapter makes was allow-listed in the WO-0062
  read-only matrix; the implementation adds no new call shape.
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — a
  port with no consumer has no manual scenario; its tour rides the first consumer WO's.
- ci_green: PENDING — the ladder at the working tree, recorded at PR time.

## Stop-and-ask gates

- A consumer sneaking in (health UI, reconciliation, ingestion) — the chain's order is this
  port first.
- A gh call outside the WO-0062 read-only matrix, or any write-shaped call.
- Forge/gh vocabulary outside `src/adapters/forge/` and this docs folder (ADR-0006).
- A schema or `connection` change "needed" for the remote — the frozen answer is none; stop if
  the plan concludes otherwise.
- A `.replace(` in `src/ui/` or a vendor literal outside `src/adapters/` (ADR-0007 / ADR-0006).

## Notes

- This is the forge chain's second link: probe (WO-0062) → port (this WO) → consumers (health
  checks, reconciliation, ingestion — each its own WO, in M3's list order).
- The adapter is expected to read like the runner adapter's head comment: ONE header stating
  what it is, the ADR-0006 permission, and the design pointers (here: the WO-0062 report).
- Fixtures are literal excerpts quoted from the report — small and inline; no recorded live
  output files are needed, the report is the provenance.
