# Roadmap

Updating this file is a closure gate. A work order is not closed until its entry here is accurate.

> **Product spec:** [`docs/PRODUCT.md`](docs/PRODUCT.md) — the architect-led, plan-driven,
> evidence-gated loop. This roadmap is being reordered toward that spec (2026-08-06): workspace +
> repo management → work-order creation with context → plan-driven steps + architect review loop →
> real forge (gh) for PR/CI/merge. The approved UI direction (warm-dark "evidence-ticket" design,
> Turkish) lives in `design-mock/`.

## M0 — Probe the ground

Measure Claude Code's programmatic surface before any UI assumption is frozen. The stop-and-ask gate and
the plan-approval handoff are the most fragile parts of the design and the most central parts of the screen.

- [x] **WO-0001** — Claude Code surface probe. Done (merged `0d77313`): the Agent SDK (0.3.221) is a
      contractual surface — `canUseTool` makes stop-and-ask observable + answerable (Q4 verdict a) and the
      write-fence holds (Q6; TD-001 closed). SDK-primary ruled; M2's session-runner port is defined from these
      findings. Re-measure on version bump (TD-016).

## M1 — Clickable UI prototype

React + Tailwind, no Electron yet, no real sessions. Draw once, keep the code: components live at `src/ui/`
and do not move when the Electron shell arrives. Information architecture is settled in ADR-0005. The
transcript and stop-and-ask regions stay provisional until M0 reports.

- [x] **WO-0002** — Board + work order detail, fixture-driven, six states covered. Merged `042231f`.
      First work order to run the full pipeline. Two returns on acceptance-criteria misses, a blind
      verification with mutation checks, and a reconstructed plan (TD-005). 75 tests; `src/core/` pure and
      test-first; components carry no display copy. `ci_green` was exempt — see TD-012.
- [x] **WO-0005** — `CLAUDE.md`, CI, and watch scripts. Ends the `ci_green` exemption and moves the
      mechanical half of verification off the operator. Merged `b3860ba`; the green CI run on the PR was the
      first real, non-exempt `ci_green` (TD-012 closed). Verification surfaced three pre-existing ADR
      violations and detection gaps → WO-0006 (TD-014, TD-015); the branch-protection gap is TD-013.
- [ ] **WO-0003** — Visual hierarchy pass. The prototype is structurally right and visually flat; nothing is
      dominant, so the board does not answer "what needs me most" at a glance. Presentation only.
- [ ] **WO-0004** — Workspace connection management: add, update, remove connections (ADR-0009). Replaces the
      two hardcoded workspaces. Also the onboarding path a third party would use.
- [ ] **WO-0006** — ADR-0007/0003 live violations and detection gaps (TD-014, TD-015). Follow-up to WO-0005
      verification: three violations in WO-0002 code the checks miss, and the gaps that let them through.

Running ahead of M0 deliberately: the board, stage rail, track lanes and evidence panel do not depend on
Claude Code's surface. Only the session pane does, and it is isolated for that reason.

## M2 — Electron shell and session runner

- [x] **WO-0007** — Electron + TS scaffold, renderer = M1 prototype. Done (merged `c1feaad`): the
      M1 prototype runs inside an Electron shell; the composition root moved from `src/dev-main.tsx`
      to `electron/main.ts`, and the renderer reaches data only through the `WorkOrderSource` port
      (`src/core/source.ts`) over a sandboxed preload. The sync IPC bridge is throwaway (TD-017); the
      bare-Chromium screenshot path (`scripts/shot.mjs`) broke and is owed to WO-0003 (TD-018).
- [x] **WO-0008** — Session runner (Agent SDK). Done (merged `228279b`): a vendor-neutral
      `SessionRunner` port in `core` (test-first fence + event fold), one SDK adapter
      (`canUseTool` holds a write until `decide()`; plan approval = resume + mode off plan;
      cost from the `result` message), an async IPC bridge, and a live session pane. Boundary
      check 1 now exempts `src/adapters/` (ADR-0006). Sessions are in-memory this WO (TD-019);
      the transcript is a simple list, not xterm (TD-020); the SDK is pinned to 0.3.221
      (TD-016).
- [ ] xterm.js transcript (TD-020)
- [x] **WO-0009** — SQLite state store (read foundation). Done (merged `2763be2`): a `node:sqlite`
      store (built into Electron's Node, no native dep) with a visible observed | owned schema
      (`observed_at`; no `stage` column — `WorkOrder` and `Track` stage both derived; no document
      text), seeded from fixtures; `WorkOrderSource` is async and **TD-017 is paid** (the sync
      `sendSync` bridge is deleted); `App` has loading/error states; a reseed property test makes
      ADR-0010 a code property (the ADR gained a "schema encodes ownership" section). Live
      session/cost writes + resume are the fast-follow (TD-019); reseed is happy-path only (TD-021);
      junction tables lack `observed_at` (TD-022).
- [x] **WO-0010** — Session/cost persistence + resume. Done (merged `2cd596a`): live sessions persist
      to the owned `session` table as a main side-effect of driving (provider id, role, scope, status,
      per-session cost); the session pane resumes by id. **TD-019 closed.** Per-WO cost aggregation is
      the next item; the xterm transcript remains (TD-020).
- [x] **WO-0011** — Per-WO cost aggregation. Done (merged `f37d20a`): a work order's cost is DERIVED
      from its session rows at hydrate (`deriveWorkOrderCost`, ADR-0010 rule 2 — same as `stage`/TD-008),
      not read from the now-inert `work_order.cost_*` columns. `SessionRef.cost` is surfaced from the
      `session` row; `seedOwned` persists fixture session cost; the card/detail show the aggregate with a
      "No sessions yet" reason line. **TD-023 opened** (inert cost columns). The xterm transcript remains
      (TD-020).
- [x] **WO-0014** — Workspace + repo-connection management (create / edit / remove). Done (merged PR
      #12): the UI authors definitions directly into the observed tables + connections into the owned
      `connection` table (ADR-0009 M2 addendum); native folder picker; decision-store select. The
      seed-from-fixtures coexists with operator-created workspaces.
- [x] **WO-0015** — Work-order creation + context. Done: the operator creates a work order via a modal
      (title, description/objective, track checkboxes, local context files, denetim = `gates`/`every-step`).
      Docket authors `order.md` into the decision-store working tree (**does not commit** — operator
      commits, ADR-0009 second M2 addendum) and inserts a thin observed `work_order` row + tracks; the
      board shows the card at "Yazıldı" with "Plan iste". `deriveStage` gains `written` (no sessions +
      plan not approved) and a `just_written` card reason; the new `src/adapters/decision-store` adapter
      holds the first fs write (`nextWorkOrderNumber`/`buildOrderMd`/`writeOrderMd`, no git). Fixture
      work orders are no longer seeded (board starts empty; the constants stay as test data via
      `seedFixtureWorkOrders`). `review_mode` is written to order.md front-matter for WO-0016 to consume.
      M3's git scanner re-observes `order.md` (operator-authored rows not yet committed are orphaned —
      TD-021).

## M3 — Evidence layer

- [ ] `Forge` interface, GitHub implementation over `gh`
- [ ] **Health checks** — `git`, `gh auth status`, the agent CLI: presence, version, auth. Blocking on first
      run, visible and non-blocking afterwards; a degraded dependency yields `unknown`, never a guess
- [ ] **Reconciliation** — re-read git and the forge on open, focus, after actions, on manual refresh and on
      a background interval. Observation wins over what Docket last showed. Merged-outside-Docket is normal
- [ ] `stage` derived from observed facts rather than stored (TD-008); `EvidenceStatus` gains `unknown`
- [ ] A defined home in the decision store for architect verdicts and verifier reports (TD-009)
- [ ] PR / head sha / check-run ingestion
- [ ] Pointer resolution: every `path:line` claim must resolve at the recorded sha
- [ ] Gate engine: transitions absent, not disabled, when evidence is missing

## M3.5 — Shell foundations

Presentation-only, no domain change. Cheap because ADR-0006 kept `core` free of display strings and
WO-0002 routed all copy through `labels.ts`.

- [ ] Locale `en` / `tr`, keyed labels, `en` fallback, preference persisted (ADR-0007)
- [ ] Theme light / dark / system via semantic tokens, preference persisted (ADR-0007)
- [ ] Lint rule against hardcoded strings and literal colours in components

## M4 — Second workspace

- [ ] DateApp onboarded (multi-repo, dedicated decision store, cross-repo tracks with `depends_on`)
- [ ] Briefing bundle assembly, including cross-repo contracts
- [ ] Workspace switcher

## M5 — Workspace overview

A read-only projection of the decision store, not a planning surface (ADR-0008). Third consumer of the same
gate model, after the board and the detail view.

- [ ] Milestone progress from work-order `milestone` front matter
- [ ] Open work orders grouped by whose turn it is
- [ ] Open tech debt linked to the work orders that opened it
- [ ] "Ready to start" computed from closed dependencies and unsatisfied gates
- [ ] Recently closed, with closing sha

## Later

- Packaging and distribution
- Open source release: docs, workspace.yaml authoring, contribution guide
