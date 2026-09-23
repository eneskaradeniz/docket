---
id: WO-0089
title: "The local gate — Docket measures the mechanical evidence itself; a CI exemption needs a substitute, not a hole"
workspace: docket
status: open
mode: direct # plan | direct (operator ruling 2026-09-22: the parallel wave runs direct)
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0089 — the local gate

## Objective

`ci_green` is the only mechanical evidence Docket observes rather than believes. When a target repo
cannot run CI — quota exhausted, private runner, offline — the track is marked **CI-exempt**, and an
exempt evidence "does NOT block the gate" (`types.ts:377`). The mechanical half of verification then
disappears silently and the only thing left is the session's own report of it.

This WO adds a second observed evidence kind, **`local_gate`**: Docket runs the target repo's declared
gate commands in the drive cwd and records **what it measured**, not what the session said. An
exemption then requires a substitute rather than opening a hole.

## Context (measured 2026-09-22)

**The hole, in code:**
- `EvidenceKind = 'plan_approval' | 'pr_open' | 'ci_green' | 'verification' | 'closure'`
  (`src/core/types.ts:38`). Of these, only `pr_open` and `ci_green` come from the forge; the rest are
  produced by, or attested from, the session side.
- Evidence is three-valued and **exempt does not block** (`src/core/types.ts:377-378`, pinned by
  `derive.test.ts:360` "ci_green is exempt with a reason on a CI-exempt track").
- `decision-store.ts:144` defines `ci_green` as "all required checks `success`" — an external
  observation. There is no counterpart when the forge has nothing to report.
- TD-012 already recorded this failure mode once: "`ci_green` has been exempt for every work order so
  far … the exemption is no longer justified by circumstance." It was closed by giving Docket's OWN
  repo a CI. That fix does not travel to target repos.

**The empirical case (antreo wave, 2026-09-21/22, `antreo-app/wt/ORKESTRA.md`):**
Three work orders ran in parallel against a repo whose CI quota is exhausted. Two of three reported
gate numbers that were wrong:
- #238 reported `dart format --set-exit-if-changed → exit 0`. An independent run returned **exit 1**
  (`Changed test/build_config/orientation_drift_test.dart`). A real gate failure reported as a pass;
  it reached PR review before anyone noticed.
- #268 reported the full suite as **3275 passed**. An independent run returned **3311 passed** —
  36 tests unaccounted for.
It happened under two different vendors (Claude Agent SDK via z.ai, and Antigravity on Sonnet 4.6),
so this is not a vendor defect. A self-reported gate is not evidence.

**The principle already exists in this codebase.** `verdict.ts` refuses to read an absent verdict as
auto-proceed: `unknown` is treated as `revise`. `Ci` models `unknown` as "we could not look" and never
passes a gate. `local_gate` is the same rule applied to the commands a repo runs on itself.

## Frozen decisions

- **Docket runs the commands, not the agent session.** Independence is the whole point; a gate the
  session runs is a report, not an observation.
- **Declared per workspace, not inferred.** Docket does not guess a repo's test command.
- **`local_gate` sits BESIDE `ci_green`, it does not replace it.** A repo with working CI keeps CI as
  its mechanical evidence.
- **An exemption needs a substitute.** A CI-exempt track must satisfy `local_gate`; the two may not
  both be exempt. This is the rule the WO exists for.
- **Unknown never passes** (ADR-0001, the `Ci` precedent): not-run and could-not-run are the same
  non-passing state, distinct from measured-and-failed.

## Open design questions (settled in implementation, pinned by tests)

- **Where the commands are declared:** `.workflow/workspace.yaml` (versioned in git, matches
  invariant 2 — the definition is a document, not app state) vs a store table. Lean: workspace.yaml,
  a named list, each entry a command plus `expect_exit: 0`.
- **What is recorded:** exit code alone, or exit code + a captured tail + a parsed count? The antreo
  case argues for a count where one exists ("3311 passed" is the number that disagreed), but parsing
  counts per ecosystem is a rabbit hole. Lean: exit code is the gate; a captured tail is evidence for
  the operator to read; no parsing in v1.
- **When it runs:** on PR open, on demand, or both. It must run at a known sha so the evidence points
  somewhere — the same discipline verification already uses for `path:line` pointers.
- **Serialization.** Gate commands are heavy (a full suite, a build). Under WO-0088 N drives run at
  once; N simultaneous suites exhausted RAM in the antreo wave and the OS killed processes. A single
  host-wide gate lock is needed (antreo's `wt/heavy` is the reference shape). This is a hard
  dependency on WO-0088's landing, not a nicety.

## Scope

- `src/core/`: the `local_gate` evidence kind, its status derivation, and the exempt-needs-substitute
  rule. Pure, test-first.
- Adapter: a runner that executes declared commands in the drive cwd, capturing exit code + tail,
  under the host-wide lock.
- Store: the recorded result, keyed to a sha.
- UI: the evidence row beside `ci_green`, with its measured result readable (degraded faces speak
  operator words — WO-0078).

## Non-goals

- Parsing per-ecosystem test counts (see open questions).
- Replacing CI where CI works.
- Teaching Docket any repo's commands by inference.

## Acceptance

- [ ] A CI-exempt track cannot reach the verification gate with `local_gate` unsatisfied or exempt.
- [ ] A declared gate command that exits non-zero renders as measured-and-failed, distinct from
      not-run (`unknown`), and neither passes.
- [ ] The recorded evidence names the sha it was measured at, and the tail is readable in-app.
- [ ] Two concurrent drives never run gate commands simultaneously (lock pinned by a test).
- [ ] A workspace declaring no gate commands behaves exactly as today (no new blocking).

## Notes

The antreo wave's runbook (`antreo-app/wt/ORKESTRA.md`, step 6) carries the human version of this rule:
"Rapordaki kapı sayılarına ASLA güvenme." It is currently enforced by an operator remembering to run
three shell commands. This WO moves that enforcement into the product, which is where invariant 1
says it belongs: no transition without evidence.
