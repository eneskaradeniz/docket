---
id: WO-0019
title: Fence read fix — classify shell commands without false-positive writes (TD-026)
workspace: docket
status: draft
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0019 — Fence read fix (TD-026)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Root cause (confirmed by reproducing the old classifier)](#root-cause-confirmed-by-reproducing-the-old-classifier)
- [Decisions](#decisions)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Fix the role write-scope fence mis-classifying read-only shell commands as writes. The WO-0018 dogfooding
trial found the verifier's `cat`/`git show`/`od`/`git log`/`grep` DENIED with "verifier may not write there
(ADR-0002)" — breaking the verification leg of the pipeline. The fence is meant to be read-asymmetric
(`fenceDecision` already `allow`s every non-write); the bug was entirely in the adapter's command classifier.

## Context

- TD-026 (opened by WO-0018) — the over-blocking fence.
- `src/core/runner.ts` — `fenceDecision` (read-asymmetric, correct), `WriteAttempt`.
- `src/adapters/runner/index.ts` — `classifyShell` (the bug site, untested per ADR-0006 "adapters verified by
  running").
- The verdict/review-mode loop (WO-0020) depends on a working verifier, so this is fixed first.

## Root cause (confirmed by reproducing the old classifier)

1. **Redirect regex matched `>` inside arguments/quotes** — `grep ">"`, `git log --format='>%h'`, `cmd 2>&1` →
   wrongly WRITE (deny).
2. **Write-verb substring match** — `npm install`, `xinstall` → WRITE (verb found anywhere).
3. **Latent false-negative** — `git push`/`commit`/`restore` → READ (verb `git` never matched). Closed as a
   side benefit.

## Decisions

- **Move the pure classification into `core`** (`classifyCommandLine`), test-first. The boundary check bans
  `node:path` in `src/core/`, so the redirect target is returned as an UNRESOLVED token; the adapter shim only
  resolves it against `cwd` (the one Node-dependent step, no interesting branches). This puts 100% of the
  bug-prone string logic in tested core.
- **Policy**: (1) quote-aware redirect (strip quoted spans, then match `(?:>>|>)\s*([^\s;&|()<>]+)` — `&`
  excluded so `2>&1` isn't a file write); (2) leading-verb write detection (not substring); (3) `git` subcommand
  split (write/read sub lists; unmapped → ambiguous); (4) read allowlist; (5) `sed` always write (catches
  `sed -i`; `sed -n` sacrificed); (6) **ambiguous → role-aware**: verifier → `ask` (the TD-026 fix),
  architect/implementer → `allow` (trusted to write in scope).
- **ADR-0002 read-asymmetry preserved** for known reads; the only behavior change is unknown verbs now `ask`
  the verifier (was: silent allow — the hole TD-026 fixes).

## Scope

In scope: `classifyCommandLine` + helpers in core; `WriteAttempt.ambiguous`; `fenceDecision` ambiguous branch;
adapter `classifyShell` shim; core tests. Out of scope: the verdict loop (WO-0020); perfect shell parsing
(irreducible Bash-heuristic gap, TD-001).

## Acceptance criteria

1. `cat`/`git show`/`git log`/`grep`/`od` (known reads) → `allow` for the verifier.
2. `grep ">"`, `git log --format='>%h'`, `cmd 2>&1` → read (quoted/fd `>` not a redirect).
3. `git push`/`commit`/`restore`, `cp`/`rm`/`sed`, real redirects → write (gated).
4. `npm install`/`make`/`./s.sh` → ambiguous; verifier `ask`, implementer/architect `allow`.
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light`)
- pr_open / ci_green / verification: the core fence test suite (27 new cases: `classifyCommandLine` + the
  ambiguous policy) + typecheck + build + boundaries; manual dogfood re-run pending (verifier reads allow).

## Notes

- TD-026 closed. Residual: arbitrary binaries/scripts (`./evil.sh`) still escape the fence — the irreducible
  Bash-heuristic gap TD-001/ADR-0002 concede; the design closes it for the verifier (the TD-026 subject) and
  leaves implementer/architect untouched rather than trading verifier correctness for friction.
