---
id: WO-0001
title: Claude Code programmatic surface probe
workspace: docket
status: draft
mode: direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0001 — Claude Code programmatic surface probe

## Objective

Measure how Claude Code can be driven programmatically, before any UI assumption depends on it. Two points
are load-bearing and fragile: **plan-mode approval** and **tool permission prompts**. The stop-and-ask gate
is the most central region of the work order screen, and its shape is entirely determined by whether these
events are observable and answerable through a stable channel. Until this is measured, everything under the
UI floats.

This is a throwaway probe. It produces findings and a scratch script. It is not application code.

## Context

- `docs/adr/ADR-0004-technology-stack.md` — leaves the session-runner mechanism explicitly open
- `docs/adr/ADR-0002-session-roles-and-lifetimes.md` — role isolation must be enforced by configuration
- `docs/tech-debt.md` — TD-001 (architect write isolation in a single repo) is measured here

## Mode

`direct`. The shape of the work is fully specified below; there is no design decision to plan. The stop-and-
ask gates carry the judgement calls.

## Scope

In scope: running real sessions against a real repo, capturing raw output, writing down what was observed.

Out of scope: building an abstraction, writing the session runner, any Electron or UI code, any change to
`dateapp-api` or `dateapp-mobile` beyond scratch commits on a throwaway branch.

## Questions to answer

Each answer must be backed by a **verbatim captured excerpt**, not a description.

0. **CLI or SDK.** Does the Claude Agent SDK for TypeScript exist and expose a programmatic channel for
   permission decisions and plan approval? If it does, does spawning the CLI remain necessary at all?
   Record the version measured — this surface is not a stable contract.
1. **Stream schema.** With `--output-format stream-json`: what event types appear, in what order, and in
   which event does `session_id` first arrive? Is per-turn token/cost usage present, and where?
2. **Plan mode.** With `--permission-mode plan`: how is the finished plan signalled? Does the process
   **exit** or **wait** once the plan is ready? This determines what "plan is with the architect" means
   mechanically.
3. **Plan approval.** How is approval delivered programmatically? Is `--resume` plus an "approved, proceed"
   message sufficient, or must the permission mode change? Does an approved plan survive a resume?
4. **Permission prompts.** When a tool permission is requested, is there an **observable event in the
   stream**, or does the process simply block silently? What changes under `acceptEdits` and
   `bypassPermissions`? If there is no observable event, can hooks provide one? *This question decides the
   entire stop-and-ask design.*
5. **Resume.** Does `--resume <session-id>` work in `-p` mode? Is the session id stable across restarts, and
   what is its relationship to the on-disk session files?
6. **Write fencing (TD-001).** Can a session be restricted to writing only under `docs/**` while retaining
   read access to the rest of the repo? Attempt a write outside the fence and record what happens. If the
   fence does not hold, single-repo role separation is nominal and ADR-0002 needs revision.
7. **Interruption and persistence.** After the process is killed (SIGINT / hard kill), can the session be
   resumed? After an app restart, where is prior transcript read from?
8. **Other providers — survey only.** For at least two other agent CLIs (e.g. Codex, Gemini): do they expose
   a streaming event format, a resumable session id, and a programmatic permission channel? Documentation
   level is sufficient; do not install, configure or drive them. The purpose is to know which of questions
   1–5 are likely to generalise before M2 designs the session-runner port (ADR-0006). Half a page.

## Deliverables

- `docs/probes/cc-surface/findings.md` — one section per question: what was run, what came back (verbatim
  excerpt), the conclusion, and the versions measured
- `docs/probes/cc-surface/probe.mjs` — the scratch script used, committed as-is
- `docs/probes/cc-surface/raw/` — captured stream output per scenario
- A recommendation on question 0 (CLI vs SDK) with the reasoning, for the architect to rule on

## Acceptance criteria

1. All eight questions have an answer backed by a verbatim excerpt. "Could not determine" is an acceptable
   answer; an unsupported assertion is not.
2. Every claim in `findings.md` that refers to observed output cites the file under `raw/` that contains it.
3. Measured versions (`claude --version`, SDK package version if used) are recorded at the top of the
   findings.
4. Question 4 concludes with an explicit verdict: stop-and-ask is (a) observable in the stream, (b) observable
   only via hooks, or (c) not observable — and what each implies for the design.
5. Question 6 concludes with a verdict on TD-001: fence holds / does not hold, with the attempted violation
   and its result shown.

## Evidence required

- pr_open: PR URL, head sha
- ci_green: n/a — no CI on this repo yet. Recorded as an explicit exemption, not a silent skip.
- verification: verifier report; every `raw/` citation in the findings must resolve at head sha
- closure: track merged, `ROADMAP.md` M0 updated, `docs/tech-debt.md` TD-001 resolved or re-scoped

## Stop-and-ask gates

1. **After question 0.** If the SDK offers a contractual permission channel, stop and report before
   measuring the CLI in depth — the remaining questions may need reframing against a different surface.
2. **If question 4 concludes (c) not observable.** Stop. Do not design a workaround. This changes the
   product's central mechanism and is the architect's call.
3. **If question 6 concludes the fence does not hold.** Stop and report. ADR-0002 needs revision before any
   further work.

## Notes

The pipeline this work order describes is executed by hand: the tool that would run it does not exist yet
(TD-004). Evidence is recorded in git and in the PR, not in an application database. This is a one-time
bootstrap, not a precedent.
