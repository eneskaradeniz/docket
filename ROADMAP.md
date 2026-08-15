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
- [x] **WO-0006** — ADR-0007/0003 live violations and detection gaps (TD-014, TD-015). Done: the `'' as RepoId`
      cast in `derive.ts` is gone (`primaryRepo` is now `RepoId | undefined`, an unused field); the work-order
      number on the card is permitted as display via `labels.ts` (`woIdLabel`) with an ADR-0007 carve-out — no
      raw `{id}`; boundary checks extended — a branded-type `as` cast ban (c2c), all Node builtins not just the
      four-name list (c3), and the `{...{ disabled: true }}` / `data-disabled` forms (c5). Each new check is
      demonstrated to fail on a deliberate violation. **TD-014 and TD-015 closed.**

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
- [x] **WO-0016** — Plan-driven flow: the plan loop. Done: a `written` WO's "Plan iste" starts an architect
      session (prompt assembled server-side from `order.md`); the architect's `ExitPlanMode` surfaces the
      plan; the operator approves; Docket writes `plan.md` into the decision store + flips `planApproved`
      → stage advances to "Uygulama" + the plan renders (PlanCard). New: pure `core/order-md.ts`
      (`parseOrderMd`/`architectPrompt`); decision-store `findWorkOrderDir`/`writePlanMdById`/`readWoDocs`
      (slug-free dir discovery); store `approvePlan` + real `getWorkOrderDocs` (working-tree reads, no
      fixtures); `approve-plan` IPC + main architect-prompt fill; SessionPane plan surface (written →
      single button; plan_ready → approve → `approvePlan` + reload — the architect is NOT resumed);
      `WorkOrderDetailView.stage`. `deriveStage` unchanged (`plan_requested`/`plan_ready` unrepresentable
      at restart → **TD-025**). Step-running + per-step review + `review_mode` branching are WO-0017;
      `plan_approval` is satisfied by the observed flag, not a commit sha (M3, TD-005).
- [x] **WO-0017** — Step execution. Done: an approved plan's ```steps block is parsed into a validated
      `StepSpec[]` (`core/plan-steps.ts`, test-first; `architectPrompt` produces the fence); each step runs as
      an implementer/verifier session in sequence on the existing runner (`DriveInput.stepIndex`; main fills
      the prompt + scope server-side via `stepPromptFor`); each step's final output is captured as
      `reports/step-NN-<role>.md` at `turn_complete` (the report home settles **TD-009** ADR-0010-aligned:
      text in git, status + pointer on a new observed `work_order_step` table + `session.step_idx`); the
      detail renders a `StepList` + `StepPane` + per-step `StepReport`. The architect verdict (proceed/revise)
      + `review_mode` loop branching are **WO-0018**; making `plan_requested`/`plan_ready`/`verification`/
      `architect_audit` derivable from persisted facts stays M3 (**TD-025**).
- [x] **WO-0018** — Dogfooding polish. Done: the first live step-execution trial surfaced 9 UX/correctness
      gaps, all fixed here — markdown overflow + GFM tables; short architect plans; **TD-025 narrowed** (the
      plan now survives restart via `savePendingPlan`); WO delete (cascade + confirm); plan shown once; role
      tabs hidden in the plan stage; **auto step sequencing** (`gates` cadence — no per-step click); "all
      steps done" banner; report markdown prompts. Fence read bug → **TD-026** (fixed by WO-0019);
      verdict/review-mode loop → WO-0020.
- [x] **WO-0019** — Fence read fix (TD-026). Done: the command classifier moved from the untested adapter into
      pure test-first core (`classifyCommandLine`, +27 tests) — quote-aware redirect (so `grep ">"`/
      `git log --format='>'` aren't writes), leading write verb (not substring), git subcommand split (closes a
      latent `git push`/`commit` false-negative), read allowlist. Unknown verbs now `ask` the verifier (was:
      silent allow — the TD-026 hole); implementer/architect unchanged. **TD-026 closed.** Verifier reads
      (`cat`/`git show`/`od`/`git log`/`grep`) now allow.
- [x] **WO-0020** — Architect review loop. Done: after each step's report an architect session reviews it and
      emits a verdict (proceed/revise); `review_mode` branches the loop — gates auto-proceeds on proceed and
      surfaces the operator only on revise/uncertain; every-step shows the verdict card after every step.
      Verdict home settles **TD-009** (text in `verdicts/step-NN.md`, outcome on `work_order_step`); verdict
      captured via `parseVerdict` on `turn_complete.result` (unknown → revise, safe side); `DriveInput.reviewStepIndex`
      + `ReviewPane` + `VerdictCard`; `deriveStage` unchanged (WO-level `architect_audit` stays M3/TD-025). The
      plan-driven pipeline `docs/PRODUCT.md` describes is now complete end-to-end.
- [x] **WO-0021** — UX debt: phase indicator + architect-plan cost. Done: a pure `derivePhase` → a one-line
      denim phase banner ("Plan hazır — onayla" / "Uygulama · 2/5 adım" / "Mimar denetimi · adım N" /
      "Tamamlandı") — the plan-driven macro phase is now the primary surface, the 9-stage rail stays secondary;
      and the architect plan session's cost is always captured (`shouldSynthesiseTurnComplete` — a safe
      synthetic `turn_complete` when a plan-mode stream ends without a `result`, so the session cost is never
      NULL; no-op if the SDK does emit `result`).
- [x] **WO-0022** — Cost display: token harcaması da. Done: `formatCost` (USD + giriş/çıkış token,
      "68k→2k" kısaltması) tüm maliyet yüzeylerinde (kart, detay meta, oturum/plan/review/step panları).
- [x] **WO-0023** — Host-agnostic session-drive pipeline (the testability spine). Done: the drive loop —
      prompt assembly, persistence side-effects, verdict capture, permission handling — moved out of
      `electron/main.ts` into `src/core/pipeline.ts` over injected ports (`SessionRunner` + a new `SessionStore`
      port + a `PermissionPolicy`). `isPlanDrive` (core) fixes the dogfood-audit **P1-1** root cause — an
      architect review/step drive is no longer run in plan mode, so it no longer overwrites the approved
      `plan.md`; `prepareDriveInput` selects review/step before plan. A `FakeRunner` + `FakeStore` make the loop
      unit-testable for the first time (+19 tests, 308 total). `main.ts` is a thin IPC forwarder; **P1-3** fixed
      (a remount resumes an interrupted review, not skips it). The CLI host is WO-0024 (second composition root →
      ADR-0006 amendment); P1-2 closure path + B1 API-key surface are WO-0025; audit findings tracked as
      TD-027..031. Re-opens the dogfood trial.
- [x] **WO-0024** — CLI host (drive the pipeline headlessly). Done: a second composition root `src/cli/index.ts`
      mirrors `electron/main.ts` minus IPC — `createStore` + `createRunner` (or a file-based FakeRunner) +
      `createPipeline({ …, permission: autoAllowPolicy() })`, driven directly. Commands: `drive <woId>` (plan /
      `--step N` / `--review N` / free-form, with `--fake SCRIPT` for deterministic token-free runs, `--format
      jsonl`, `--approve-plan auto`), `approve-plan`, `ls`, `show`; run via `npm run cli` (new `tsx` devDep). The
      reusable core (`buildDriveInput`/`runDrive`/`formatEvent`) is testable; +11 tests (319 total). ADR-0006
      widened to "a composition root" (Electron main **or** the CLI); the boundary `COMPOSITION_ROOTS` + c2a/c2c
      exemptions updated. Delivers the "GUI olmadan test" goal — the verdict/review loop is now drivable and
      assertable from the CLI, deterministically (FakeRunner) or against the real SDK. **Bootstrap (second pass,
      same WO):** `create-workspace` / `create-work-order` added — pure argv→input mappers in `src/cli/create.ts`
      (validation mirrors WoCreateModal; repeatable `--repo`/`--track`), handlers + id branding in `index.ts`
      (`--workspace` by id or label; tracks default to code repos minus the decision store; a fresh `--db` is
      created + migrated; unknown command → rc 2) — the CLI now spans workspace → WO → drive without the GUI.
      Only interactive `--policy ask` remains deferred (TD-032).
- [x] **WO-0025** — Closure path (P1-2) + provider/auth surface (B1). Done: `closeWorkOrder` (port + store +
      IPC + CLI `close` + the all-steps-done card's "İş emrini kapat" flow) closes a finished WO the M2 way —
      **operator-attested**, the mirror of the plan gate's ruling: preconditions re-checked from the DB
      (`canClose` in core, test-first), a `## Closure` note appended to order.md, merges recorded as attested,
      closure sha = decision-store HEAD → stage `closed`. Provider surface: a neutral `ProviderErrorCode` on
      error events (adapter classifies; `PROVIDER_ERROR_LABELS` render Turkish in all three panes), an
      `AppSettings` port with the provider key stored in the shared `app_setting` table (GUI settings modal:
      key + status + zero-token `Test et`; CLI `doctor [--verify]`), the key threaded into the runner env, and
      a non-fake `drive` preflight. **TD-027 + TD-028 closed** (TD-027 keeps an M3 attestation→observation
      upgrade note). The CLI also refuses `--fake` runs against the default (GUI) db.
- [x] **WO-0026** — Daily-use hardening (TD-030/031 + B2–B5). Done: the pipeline's drive loop gained the
      **completion guarantee** — a `finally` records `idle` whenever a started session never got a terminal
      record (interrupt-without-turn_complete, consumer/window close; the audit's four stuck-`running` paths
      close to zero-code) — and `createStore` sweeps leftover `running` rows on open (the process-kill path).
      The transcript is now **persisted**: the pipeline folds every event (same `foldSessionEvent` as the panes)
      and checkpoints it into the session row (`TranscriptLine[]` unified; the dead `TranscriptEntry` removed);
      SessionPane/StepPane **seed from the persisted session** on open (F14 — resume appends instead of
      blanking). The synthesized plan-exit turn records **no cost** (honest NULL instead of fake $0.00,
      TD-030). UX blockers: the first **ErrorBoundary** (B2), detail-load failure shows an error card with
      Geri/Yeniden dene instead of an eternal spinner (B3), board-load failure gets a retry (B4), and both
      modals surface save errors instead of swallowing them (B5). +7 tests (335).

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
