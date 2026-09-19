---
id: WO-0065
title: "Kapanış kanıtı — the closure gate observes: the operator attestation gains its forge fact (WO-NNNN-in-title match, measured)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0065 — Kapanış kanıtı — the closure gate observes

## Objective

The forge chain's fourth link, and the queue's item 5: the M2 floor's OPERATOR-ATTESTED closure
(`closeWorkOrder` — merged_at set by operator say-so, the closure sha the decision-store HEAD)
gains its observed counterpart. When the operator closes a work order, Docket asks the forge —
ONE search call per connected repo — whether a MERGED pull request carries this work order's
number in its title, and records what it SAW as a `forge_merge` event: the observed merge
(number + merge sha + url), the honest absence («no PR found — closed on attestation»), or the
unknown («could not look: <reason>»). The attestation stops being silent; the closure gate
never claims a merge it did not see, and never blocks on a forge it could not reach.

## Context

- **Measured today (2026-09-19, the M0 discipline applied inline — two read-only calls, both
  observed excerpts):**
  `gh pr list --repo eneskaradeniz/docket --state closed --search "WO-0062 in:title" --json
  number,state,title,mergedAt,url,mergeCommit` → `[{"number":67,"state":"MERGED","title":
  "WO-0062 — forge surface probe…","mergedAt":"2026-09-18T23:50:45Z","url":"…/pull/67",
  "mergeCommit":{"oid":"d61ea1f…"}}]`, exit 0; the no-match shape → `[]`, exit 0. The
  WO-NNNN-in-title convention is real in this repo's PR discipline (every PR title since
  WO-0060 carries its number) — the match rule is a DOCUMENTED convention, not a guess.
- **The chain so far:** probe (WO-0062) → port (WO-0063) → observation (WO-0064). The port's
  four methods serve the scan; this WO adds the FIFTH read (`searchPullRequests` — the same
  `pr list` call with a `--search` filter, the probe matrix's row-3 family) and consumes
  closure-side, not scan-side.
- **The M2 floor stands underneath:** `canClose` (plan + steps + verdicts) is UNCHANGED — the
  forge fact is EVIDENCE recorded at close, not a new precondition. A degraded forge yields
  `unknown` and closure proceeds (the health ruling: a degraded dependency never stops the
  app); the timeline says so. TD-008's full stage re-derivation is its own M3 line, NOT here.
- **The schema anticipated this:** the `wo_event` comment — "M3's forge events (pr/ci/merge)
  join this table". Adding the `forge_merge` kind needs the CHECK-list migration; the store's
  rebuild precedent (migrate(), :688) is the mechanism.
- **Layering:** the store stays adapter-free — the composition root observes BEFORE closing
  (it owns the forge) and hands the evidence INTO `closeWorkOrder` as an optional third
  parameter; absent = the legacy attested close (the CLI/test surface path, byte-for-byte
  unchanged). The match itself is pure core (testable against a fake forge).

## Scope

In scope:

- **Port (core, test-first):** `Forge.searchPullRequests(repo, inTitle): Promise<ForgePr[]>`
  (one call; the closed state page filtered by an in-title search; fixtures = today's observed
  excerpts); the `ClosureEvidence` union (`observed` carrying prNumber/mergeSha/url/mergedAt ·
  `absent` · `unknown` carrying the reason); `observeClosureEvidence({ forge, targets, woId })`
  — per connected repo one search, the merged rows only (latest `mergedAt` wins), first hit
  wins across repos; every repo erroring → `unknown` with the last reason; successes without a
  hit → `absent`. Never throws.
- **Store:** the `wo_event` kind CHECK-list gains `forge_merge` (rebuild migration, tested);
  `closeWorkOrder(id, note, evidence?)` appends the `forge_merge` event with a JSON detail
  (`{ basis, prNumber?, mergeSha?, url?, mergedAt?, reason? }`) when evidence was handed in;
  the event detail carries targets and messages only — never auth output. Everything else in
  closeWorkOrder (the step/plan re-check, the closure sha, tracks' merged_at, `closed` event)
  is untouched.
- **Composition root:** the close handler observes first (`store.forgeScanTargets` of the WO's
  workspace → parse → `observeClosureEvidence`) and closes with the evidence; a store read for
  the WO's workspace id (concrete method).
- **UI:** the timeline renders `forge_merge` — label + detail composer (observed:
  «#67 birleşti · gözlemlendi», absent: «PR bulunamadı — beyanla kapandı», unknown: «forge'a
  bakılamadı: <reason>»); labels in both bundles. The close card itself unchanged (pre-close
  the fact is not knowable without a live call — the card claims nothing).
- **Tests:** core (observed hit, closed-unmerged filtered out, no hit → absent, forge error →
  unknown, multi-repo first-hit-wins), adapter (the search call's args + today's observed
  fixture + the empty page), store (the migration accepts the new kind; close-with-evidence
  appends `forge_merge`; the legacy close writes none).

Out of scope:

- TD-008 (stage derived from the observed cache; `EvidenceStatus.unknown`) — its own M3 line.
- The gate engine's strict transitions; any change to `canClose`, the plan gate, or the budget
  gate; agent git actions (the WO→PR link's durable home — the title match is the v1 rule
  until branches/shas land in records); the track rows (their merge columns stay attested).
- Any forge WRITE; WO detail's record scroll; the ROADMAP/tech-debt docs (closure updates only).

## Acceptance criteria

1. `searchPullRequests` is fixture-pinned to today's observed shapes (hit with mergeCommit,
   empty page); `observeClosureEvidence` is pinned for observed/absent/unknown/multi-repo.
2. Closing a WO with evidence appends exactly one `forge_merge` event carrying the JSON basis;
   the legacy two-arg close appends none and is byte-identical to today.
3. The migrated CHECK list accepts `forge_merge`; a pre-migration DB upgrades in place (the
   rebuild path tested).
4. The timeline renders all three bases in both locales, key parity.
5. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the continuing
  BUILD-FIRST delegation; the two live probes above are the measured ground).
- probe_permissions: RESOLVED — the two read-only `gh pr list` calls sat inside the WO-0062
  matrix's row-3 family (list + JSON field set); no new write-shaped surface; both excerpts
  became the adapter fixture.
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — the
  scenario joins the deferred tour: close a merged WO, read the timeline's «gözlemlendi» line.
- ci_green: RESOLVED — green, 2026-09-19: typecheck (both tsconfigs), **980 unit tests** (+11:
  3 adapter search pins, 5 closure-evidence pins, 3 store pins incl. the migration), build,
  `check:boundaries` 8/8 clean.
- pr_open / closure: RESOLVED — PR #70 (`https://github.com/eneskaradeniz/docket/pull/70`),
  head `116abd7`, merged `d300c4d`; closed at this commit.

## Stop-and-ask gates

- A forge WRITE, or the match rule widening beyond the title convention without a measured
  basis (a sha/branch column arriving = agent-git-actions territory, stop and re-design there).
- Closure blocking on a degraded forge (unknown never stops the app), or an `unknown`
  rendered as failure.
- Auth output / token material anywhere in the `forge_merge` detail.
- A stage column appearing anywhere (TD-008's line, not this one).

## Notes

- Chain position: probe → port → observation → **closure evidence (this)** → agent git
  actions + Changes surface (the durable WO→PR link lands there; the title match is its v1
  stand-in, documented as such).
- The match searches the CLOSED page (closed + merged both live there); only `state ===
  'merged'` rows count as observed merges — a closed-unmerged PR is a hit that is NOT evidence.
