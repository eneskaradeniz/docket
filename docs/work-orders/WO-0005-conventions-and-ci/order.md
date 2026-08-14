---
id: WO-0005
title: CLAUDE.md, CI, and watch scripts
workspace: docket
milestone: M1
status: draft
mode: direct
review: light
tracks:
  - repo: app
    depends_on: []
---

# WO-0005 — CLAUDE.md, CI, and watch scripts

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Mode and review weight](#mode-and-review-weight)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Closure](#closure)

## Objective

Write down the rules every session must obey, and move the mechanical half of verification off the operator
and into CI. This work order exists to make every work order after it cheaper, and to end the `ci_green`
exemption that has been waived for every work order so far (TD-012).

## Context

- `docs/adr/ADR-0011-repository-conventions-and-mechanical-enforcement.md` — the decisions this implements
- `docs/tech-debt.md` — TD-012
- WO-0002's verification report is the source for which checks are mechanical

## Mode and review weight

`direct` and `review: light`. The content is specified by ADR-0011; there is no design decision to plan. This
is also the first work order to run under the lighter review weight: the verifier goes straight to verifying,
and the architect audit is a spot check.

## Scope

**`CLAUDE.md` at the repository root.** Rules only, each with a pointer to the ADR that decided it. Cover the
layering rule, test-first for `core`, no display copy or raw identifiers in components, absent-not-disabled,
no agent-vendor names, English for code and documents, and where work orders and decisions live. Keep it
short enough that a session reads all of it. If a line needs a paragraph of reasoning to make sense, it
belongs in an ADR and `CLAUDE.md` links to it instead.

**GitHub Actions workflow** on pull request and on push to `main`:

- `tsc --noEmit`
- `npm test`
- `npm run build`
- boundary checks, each failing the job with a message naming the rule and the ADR:
  - no agent-vendor name anywhere in `src/`
  - **no workspace identity in `src/core/` or `src/ui/`**, expressed as two checks:
    - *structural, name-independent:* no branded-identifier constructor (`wid(`, `rid(`, and any sibling)
      is called outside `src/adapters/`. Only the adapter constructs identities; this is the durable form
      of the rule and it keeps working when workspaces arrive from `workspace.yaml` instead of fixtures.
    - *literal:* the pilot project name `dateapp` (case-insensitive) appears nowhere in `src/core/` or
      `src/ui/`. This is a fixed historical check from WO-0002 AC5, not a list read from anywhere.

    The check must **not** derive its list of names from the fixtures. A check whose input comes from the
    thing it is checking will one day have an empty list and pass in silence.

    `Docket` as a display string is explicitly allowed: it is the application's own name in chrome
    (`labels.ts` `productName`), not a workspace identity. That the self-managed workspace happens to share
    the name is a coincidence, and the two diverge as soon as workspaces come from configuration.
  - no `electron`, `fs`, `node:`, `path` or `child_process` import in `src/core/` or `src/ui/`
  - no adapter import outside the composition root
  - no `disabled` attribute in `src/ui/`
  - no `.replace(` used to turn an identifier into display text in `src/ui/`

Prefer a small checked-in script over a wall of inline shell, so the same checks can be run locally.

**Watch scripts.** `npm run test:watch`; confirm `npm run dev` gives HMR and document it in the README if it
does not.

**Housekeeping.** Add `.claude/settings.local.json` to `.gitignore`.

Out of scope: fixing anything the new checks discover in existing code beyond what is needed to make CI green
on `main` at the time of the PR; branch protection settings; anything in `src/core/` or `src/adapters/`.

## Acceptance criteria

1. `CLAUDE.md` exists, contains only mechanically checkable rules, and every rule points to the ADR that
   decided it. No rationale is restated.
2. CI runs on pull request and on push to `main`, and is green on this PR.
3. Each boundary check fails the job on violation with a message naming the rule and its ADR. Demonstrate
   this by showing one check failing against a deliberate local violation, then reverted.
4. The same checks can be run locally with one command.
5. `npm run test:watch` works.
6. `.claude/settings.local.json` is ignored.
7. No file under `src/core/` or `src/adapters/` is modified.

## Evidence required

- pr_open: PR URL, head sha
- ci_green: **not exempt.** This is the first work order to satisfy this gate for real; the CI run on this PR
  is its evidence
- verification: verifier report, `path:line` at head sha, plus the deliberate-violation demonstration from
  AC3
- closure: track merged, `ROADMAP.md` updated, TD-012 closed in `docs/tech-debt.md`

## Stop-and-ask gates

1. **If a boundary check cannot be expressed without false positives.** Report it rather than loosening it
   until it passes. A check that is green because it stopped looking is worse than no check.
2. **If making CI green requires changing `src/core/` or `src/adapters/`.** Stop — that is a finding about
   existing code, not part of this work order.

## Closure

Merged as `b3860ba` (PR #2, merge commit). `ci_green` satisfied for real: the GitHub Actions run on the PR
concluded `success` for `tsc --noEmit`, tests, build, and boundary checks — the first non-exempt `ci_green`
(TD-012 closed). Verification report is the verifier comment on PR #2, with `path:line` pointers at head sha
`239d793` and the AC3 deliberate-violation demonstration in the PR body. All seven ACs pass.

**`architect_audit` — operator-covered.** The architect session was unavailable, so the operator, as sole
authority, performed the `review: light` spot-check against the verifier report and the green CI. Recorded
here per ADR-0001: an override carries a written reason on the work order. A defined home in the decision
store for verdicts and reports is still open (TD-009).

Follow-up: WO-0006 (TD-014, TD-015) for the three pre-existing ADR violations and the detection gaps; TD-013
for the branch-protection gap (`ci_green` observed, not enforced).
