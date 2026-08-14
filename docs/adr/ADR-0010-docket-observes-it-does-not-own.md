# ADR-0010 — Docket observes; it does not own

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

Two questions were raised together and turn out to be the same question.

First: Docket depends on external tools — `git`, `gh`, an agent CLI. It should check they exist, are
authenticated and work, at first run and afterwards.

Second: work happens outside Docket. A PR gets merged on github.com. A document is edited in the operator's
editor. A branch is pushed from a terminal. Docket must be able to see that and correct itself.

Both reduce to: Docket is not the system of record, and must never behave as if it were.

## Decision

### Every fact has exactly one owner

| Owner | Facts |
| --- | --- |
| **git** | work order text, plan text, ADRs, roadmap, tech debt, verifier reports, architect verdicts, closure commits |
| **forge** | PR existence and state, head sha, check runs, merge state |
| **Docket** | workspace connections, local paths, session ids and their role/scope, operator preferences, evidence *pointers* |

Docket's own state is deliberately tiny and, apart from live session ids, entirely reconstructible. Losing
the database must cost the operator a re-scan, not a decision.

### The schema encodes ownership

When the state store is built, the ownership table above is not a comment — it is the schema's shape.

Tables fall into exactly two categories:

- **Observed.** A cache of what git and the forge said. Every row carries `observed_at`. Discardable by
  definition: dropping every observed table and re-scanning must lose nothing but time.
- **Owned.** Session ids with their role and scope, workspace connections, operator preferences, evidence
  pointers. Small, and the only thing a backup would be for.

Two rules follow, and both are testable:

1. **Document text never enters the store.** `order.md`, `plan.md` and every referenced document are read at
   view time and rendered (ADR-0005). Caching their text is the second copy this project refuses; it is also
   the copy most likely to be stale, because the operator edits those files in an editor all day.
2. **No observed table has a `stage` column.** Stage is derived (below). A column for it is a stored claim
   wearing a schema.

A work order in the store is therefore a thin record: identity, which repos and tracks, pointers to where its
documents live, and when each observed fact was last seen. The substance stays in git.

### Stage is derived from observed facts, not stored

A work order's position is computed from what git and the forge say, not from a field Docket mutates:
`plan.md` committed, PR open at a sha, checks concluded, merge commit present, a commit touching the closure
paths. Docket-owned facts (which sessions exist) fill the rest.

A stored stage is a claim. A derived stage is an observation. Only one of those survives a merge performed on
github.com.

Consequence: **architect verdicts must be recorded as artifacts in git, not held in Docket alone.** A verdict
that exists only in a session transcript is unrecoverable and unverifiable — which is exactly how TD-005
happened. The verdict is committed alongside the plan it approves.

**Addendum (WO-0025): a third category — operator preferences.** The observed|owned split covers facts about
work; an operator preference (e.g. the stored provider key) is neither. It lives in a tiny `app_setting`
key-value table: machine-local app configuration, backup-worthy like owned rows, but never projected into any
observed/derived model. Theme stays renderer-local storage — presentation, not configuration.

### Reconciliation is explicit and continuous

Docket re-reads the world: on workspace open, on window focus, after any action it takes, on a manual
refresh, and on a slow background interval. Reconciliation is idempotent and read-only.

When observation disagrees with what Docket last showed, observation wins and the change is surfaced rather
than applied silently. "Merged outside Docket" is a normal event, not an error.

### Unknown is a fourth evidence state

Evidence is `satisfied`, `unsatisfied`, `exempt`, or `unknown`. `unknown` carries what was last observed and
when.

If `gh` is missing, unauthenticated or failing, CI and PR facts are **unknown** — not unsatisfied and
certainly not satisfied. A gate never passes on `unknown`, and an `unknown` is never rendered as a failure,
because "we could not look" and "we looked and it failed" are different statements and only one of them is
the operator's problem to fix in the code.

This is the same lesson as three-valued evidence in ADR-0001, one level further out: modelling an unknown as
a false is a silent lie.

### Health is a first-class, visible state

Docket checks its external dependencies at first run and on every reconciliation: presence, version, and
authentication where applicable (`git`, `gh auth status`, the agent CLI).

First run blocks on anything required and explains what is missing and how to fix it. Afterwards, health is
visible but non-blocking; a degraded dependency turns the facts it feeds into `unknown` rather than stopping
the app. Docket never silently degrades, and never guesses in place of a tool it could not reach.

## Consequences

- WO-0002's view model stores `stage` as raw state. Under this ADR it becomes derived. Recorded as TD-008;
  not reworked inside an open PR.
- `EvidenceStatus` gains `unknown`, and every consumer must handle it — the board, the rail, the evidence
  panel and the gate engine.
- The verifier's report and the architect's verdict need a defined location in the decision store. Until they
  have one, the verification and audit gates cannot be derived, only asserted.
- A "last observed" timestamp becomes part of the UI vocabulary. A screen that cannot say when it last looked
  is claiming more than it knows.

## Alternatives rejected

- **Docket as the source of truth, with git as an export target.** Faster to build, and it makes every change
  made outside Docket a conflict to resolve. The operator works outside Docket constantly; that is the normal
  case, not the exception.
- **Reconcile only on manual refresh.** Puts the burden of remembering on the operator, which is the entire
  problem this product exists to remove.
- **Treat a missing tool as a hard failure everywhere.** Makes Docket unusable offline or mid-setup for
  reasons unrelated to most of what it does.
