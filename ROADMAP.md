# Roadmap

Updating this file is a closure gate. A work order is not closed until its entry here is accurate.

> **Product spec:** [`docs/PRODUCT.md`](docs/PRODUCT.md) — the architect-led, plan-driven,
> evidence-gated loop. This roadmap is being reordered toward that spec (2026-08-06): workspace +
> repo management → work-order creation with context → plan-driven steps + architect review loop →
> real forge (gh) for PR/CI/merge. The approved UI direction (warm-dark "evidence-ticket" design,
> Turkish) has lived in the real renderer since WO-0013 (the `design-mock/` staging dir was deleted
> by WO-0043).

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
- [x] **WO-0004** — Workspace connection management (ADR-0009). DELIVERED PIECEMEAL, before its own
      order was drafted (marked closed 2026-09-19): workspace create/edit with per-action
      repo-connection add / path-edit / remove is WO-0014 + the WO-0031b kit restyle + WO-0033's
      ledger; full-cascade workspace deletion (counted confirm, running-drive guard, `--yes` CLI
      mirror) is WO-0032; the switcher + add-workspace entry are the WorkspaceSwitcher/WsListModal
      pair in the appbar; the per-workspace knobs (budget, structure root) moved into the modal
      with WO-0047/0049 and WO-0059's rev-4 settings. Onboarding path = the same create flow.
      The fixture FIRST-RUN seed (Docket + DateApp) remains by design — M3's yaml scanner
      replaces it (the store header records this); until then operator-created workspaces
      coexist with the seeds.
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
- [x] **WO-0031c** — Kontrol Konsolu v2: the operator-approved v4 mockup IS the detail screen now. Done
      (PR #34 `19f2b13` + PR #35 `182158e`, two stacked PRs): the content-aware strip/substrip/body/rail
      spine with ONE turn classifier (`deriveTurnState`), global remembered SADE/DETAY, DETAY tabs
      <1080px (Radix forceMount — xterm scrollback survives tab switches) / 250px rack ≥1080px, the card
      language (plans render as step CARDS, never JSON), the ONE working Durdur in the rail (Faz B's dead
      `window.stop` buttons deleted) with wind-down notes + 5s Zorla kes, esc=geri layered, glow washes,
      juice (pop/flash/progress hairline). c2: the per-WO permission rule (`ask_every` default — no
      silent auto-approval; `risky_excluded` = CI/lockfile/agent-config/sensitive-files/destructive-shell
      via core `risky.ts`; ask-card lift + strip badge + timeline audit), `updateWorkOrder` + pencil
      editing + the review badge (Kapılarda↔Her adımda), pre-approval plan EDITING with the honest
      per-step counter and "düzenlenmiş onay · N değişiklik", the Denetim session ledger (archive default
      + DETAY section; step cards carry ⏱/$), diff peek (realpath-jailed to the WO's repo roots, budgeted
      LCS), the step-fail card with expandable diagnostics + Yeniden dene, ⏎ on rail primaries (close
      deliberately ⏎'süz), `Oluştur ve plan iste`, and the notification contract (3-kind toast with the
      on-screen rule in one place, "(n) izin bekliyor" title, OS notifications). The E2E harness repairs
      A6 (screens named truly, board shots on the board) and gains a scripted fake runner under DOCKET_E2E
      (real clicks, token-free — 18 specs). Pre-merge hardening: the five operator fixes (diff-peek jail,
      diff budgets, fence-less edit guard, `adım {idx}` into labels, fail-card detail). 452 tests (+55);
      **TD-036** (preload IPC arity) + **TD-037** (Faz C P2 batch) opened; a latent React #185 seed loop
      (since F14) found and fixed. Spec: `docs/work-orders/WO-0031c-kompakt-detay/order.md`.
- [x] **WO-0031d** — Faz C + the operator's tour findings: **ADR-0012** landed as the console's one
      interaction/micro-copy/density/juice contract. Done (PR #36 `7dbd924`, one PR): the `.ibtn`/
      `.irow`/`.ichip` hover tokens + the labels purge (explainers/jargon/standing hints gone,
      "Repolar") + the 12–14px density band; empty surfaces are **invitations** (the real appbar +
      hero on an empty DB, the zero-WO board hero, empty buckets absent); Düzenle/Sil/Kapat are
      **kit dialogs**, absent with a reason line while a drive runs (wind-down included);
      step-transition **juice** (flash, drawn ✓, mini fill, `adım N/T` segments) + the closure
      **results card** (seal + Süre/Maliyet/Kanıt stats, once, ≤400ms, reduced-motion safe); the
      P2 folds (title-counter assert, "Bağımsız" audit rows, plan-retry resume, fresh-file
      diff-peek all-adds, risky case-blindness, the ADR-0006 CI carve-out). The operator's tur-2
      rode the same PR: A1–A7 (the "Kapandı" turn state, tab hiding, 7-char sha, steps-fence
      prose, paddings, 5-row textarea, the N/T jump) + D1 the only-closed "Bütün işler tamam"
      platform, D2 Kanıt chips with n/total, D3 TrackLane + the Repolar section deleted. 464
      tests (+12); E2E 26 specs (+8). **TD-037** narrowed; **TD-038** (review P2s) opened. Spec:
      `docs/work-orders/WO-0031d-faz-c-cila/order.md`.
- [x] **WO-0031e** — Tur-3 cila. Done (PR #37 `d7cc33e`, one PR): the board grows a **kapatılabilir
      peronu** — when no live work is left (`working` empty, non-closable `up` empty) it says "N iş
      kapatılmayı bekliyor" + one CTA into the first closable detail; the closable card carries ▸
      `Kapatılabilir` (`closeable` = the canClose predicate derived at hydrate — the stage/cost
      precedent, never stored; the all-closed "Bütün işler tamam" platform unchanged); the strip
      progress hairline fills **green** (`--color-proceed`, matching `.stepfill`); the Denetim rows
      **expand** to their session transcript (`sourceIdx` core change, test-first; mono DOM via
      `transcriptLineText`, height-capped, empty transcript → no toggle); a DETAY tab switch
      **scrolls** the opened panel into view (<1080 tabs; rack unaffected). Pre-merge (operator
      tour): closed cards never claim Kapatılabilir — `deriveCardAction` guards `stage === 'closed'`
      (derivePrimaryAction re-derives the close intent after closure) and the closed reason is the
      done line "Tamamlandı", never "Sonraki oturum bekleniyor". 472 tests (+8); E2E 29 specs (+3,
      seeded `raf` workspace). TD-036 untouched — `closeable` rides the existing `getWorkOrders`
      payload. Spec: `docs/work-orders/WO-0031e-tur-3-cila/order.md`.
- [x] **WO-0031f** — UI final turu: three mockup rounds on one day (v5, 12 rulings; v6 structure
      tour after "Apple gibi — daha az yüzey"; v7 feel tour after "her şey gerektiğinde… sıcak,
      animasyonlu, oyunlaştırılmış, ödüllendirilmiş, çeken") become one restructure + one feel pass:
      DETAY's six tabs collapse into **Akış | Kayıt** — the live terminal lives **inside the active
      step's row** (pinned), done steps carry their report under their row, Kayıt = kanıt chips +
      belgeler + döküm (arşiv gövdesi), **Çizelge yüzeyi ölür**; the **gaze anchor** spotlights the
      row you're reading into (owner raises, siblings dim by background); the **substrip becomes a
      filled band** (sıra · odak · ilerleme — the middle carries the current focus, never empty);
      **reward = the moment**
      (step pop+✓+flash+hairline advance, closure seal, board's one green arrival pulse — no
      points/badges, money never animates); **entrance glides return** as ADR-0012's named
      exception (≤400ms, once, reduced-motion-killed — consciously reversing the .rise removal);
      **D3 "Sıcak"** direction pass; board **closed-list toggle** (three surfaces, >5 collapsed) +
      all-done peron's inline **invitation CTA** + card **Süre** (session-sum, finished-only);
      **closed WO immutable** (pencil absent + reason, inert badges, store guard, Sil stays with an
      error line); running-empty stream line; TD-038 (all five) + TD-037 load lines + two
      ADR-0012 amendment sentences. Spec: `docs/work-orders/WO-0031f-final-turu/order.md`; mockups
      `docs/ui-mockups/wo-0031-v5-final-turu.html` + `wo-0031-v6-yapi.html` + `wo-0031-v7-his.html`.
- [x] **WO-0032** — Workspace deletion (full cascade, UI + CLI). Done: the existing-but-unwired
      `deleteWorkspace` port/IPC became real — the store cascades every WO of the workspace (rows +
      the Docket-authored `docs/work-orders/WO-*` dirs, reusing the per-WO delete) and guards on a
      running session; `deleteWorkOrder`'s dormant dir bug (the folder was never removed — the path
      resolved after the row delete) is fixed, and deletes resolve the decision store strictly from
      connection rows, never the cwd fallback. UI: the edit-modal Sil entry (absent + reason under a
      live drive) → the counted, ⏎'süz confirm; deleting the active or last workspace falls back to
      another board / the hero. CLI: `remove-workspace <id|ad> [--yes]` (refuses without `--yes`,
      naming the blast radius). ADR-0009 gained the workspace-deletion addendum. 484 tests (+4);
      E2E 36 specs (+2, seeded `çöp` workspace). Spec: `docs/work-orders/WO-0032-workspace-silme/order.md`.
- [x] **WO-0033** — Depo bağlantıları (Defter). Done: two new ports — `repoConnections` (the full
      paths, which `Workspace.repos` never carried) and `updateRepoPath` (basename-is-identity: a
      path naming a different basename refuses) — over IPC; the basename-collision refusal on add
      (the silent `INSERT OR REPLACE` collapse that lost the second repo dies). The settings modal's
      repo section becomes the operator-ledger: two-line cards (basename + full mono path in
      `title`), ONE anatomy for create and edit, per-action commits in edit mode (Kaydet applies
      name + karar deposu only), confirmless removal with three guards (karar deposu · open-WO
      track · last repo — locked-in-place ✕ + reason tooltip, ADR-0001's 2026-08-21 addendum), the
      `+ Depo ekle` reveal with its Vazgeç ✕, in-list karar deposu pick (BookMarked button), inline
      field errors (persistent while invalid, live while editing, first-invalid focused on submit),
      and the vocabulary pass (repo → depo, Workspace ayarları → Çalışma alanı ayarları, merge_track
      → Depoyu birleştir); no bare icon buttons anywhere (tooltips via labels.ts). A six-round
      operator review shaped the surface; E2E 37 specs. Spec:
      `docs/work-orders/WO-0033-depo-baglantilari/order.md`.
- [x] **WO-0036** — İş emri form hataları. Done: both WO dialogs join the WO-0033 form contract —
      errors under their field (`role="alert"`, persistent while invalid, cleared on typing),
      first-invalid focused on a failed submit, save failures as top-right hata toasts (review round:
      no dialog footer carries error copy — create, edit AND WsSettingsModal converted), and Kaydet
      never locked
      for validity (ADR-0001's no-disabled rule extended to `locked`; ADR-0012 gained the
      "form errors sit under their field" decision). The edit dialog's four UX-review P0s paid:
      a cleared description now saves empty (the silent swallow dies), Vazgeç/ESC resets the
      description too, `save()` catches the closed-WO store throw into the footer, the hand-rolled
      labels became kit `Field` (label-key collapse + shared example placeholders). Textareas one
      row up (3→4 create, 5→6 edit); required-ness marked the minority way (`aria-required` +
      "(isteğe bağlı)" suffix — no asterisk/legend); the create dialog's stolen open-focus (Radix →
      the close X) fixed. E2E 42 specs (+2). Spec:
      `docs/work-orders/WO-0036-is-emri-form-hatalari/order.md`.

## M3 — Evidence layer

- [x] **WO-0062** — Forge surface probe (PR #67, merge `d61ea1f`, 2026-09-19): the read surface
      measured before the port freezes — four gh calls cover ingestion + reconciliation + health;
      sha → PR resolves for BOTH head and merge shas; the 5000/h budget makes a 30s reconciler
      free; one token reads docket + the antreo-app org. Findings + the vendor-neutral port
      sketch: `docs/work-orders/WO-0062-forge-probe/report.md` — the Forge WO's Context, five
      open design questions carried there.
- [x] **WO-0063** — Forge port (PR #68, merge `9e2e433`, 2026-09-19): the probe-frozen read
      surface — the vendor-neutral `Forge` port in core (`health` / `pullRequests` /
      `pullRequestForSha` / `checks`; `ForgeError` as the shaped unknown) + the adapter over
      `gh` in `src/adapters/forge/`, edge-only normalization, fixture tests fed the probe's
      observed outputs (25 pins). The five design answers frozen in the order
      (`docs/work-orders/WO-0063-forge-port/order.md`); one refinement recorded:
      `reviewDecision` optional — the sha→PR path carries no review fact (absence, never a
      guess). No consumer yet — health / reconciliation / ingestion are the chain's next WOs.
- [x] **WO-0064** — Forge observation (PR #69, merge `717b828`, 2026-09-19): the port's first
      consumer — the observed forge cache (`forge_scan`/`forge_pr`/`forge_check`, discardable,
      `observed_at` on every row), the core reconciler (per-repo isolation, a degraded scan
      never wipes, replace-on-scan, checks for open heads only), the composition-root wiring
      (`docket:forge:*`, in-flight guard) and the board's **Depo** section — health + open PRs +
      «son gözlem», triggered on open/focus/after-action/manual/the 60 s tick. The git half of
      reconciliation (the yaml scanner) and the closure-gate upgrade stay open.
- [x] **WO-0065** — Kapanış kanıtı (PR #70, merge `d300c4d`, 2026-09-19): the closure gate
      observes — the M2 attestation gains its forge fact. `searchPullRequests` (the fifth read,
      measured live: closed page + `"<WO-id> in:title"`), the `ClosureEvidence` union
      (observed/absent/unknown — never throws, a degraded forge never blocks closure), the
      `forge_merge` audit event (CHECK migration, rows preserved), and the timeline rendering
      all three bases. `canClose` untouched — evidence, not precondition. Order:
      `docs/work-orders/WO-0065-kapanis-kaniti/order.md`.
- [x] `Forge` interface, GitHub implementation over `gh` (WO-0063)
- [x] **WO-0066** — Sağlık yüzeyi (PR #71, merge `b4f5631`, 2026-09-19): the health-check line —
      `gitHealth` (new, seam-injected) + the forge's `health()` + `checkProvider` composed as the
      `SystemHealthWatch`; the board's health strip (tool · ✓ · version, degraded reasons
      verbatim); the first-run gate — an observed git/agent degradation makes the create action
      ABSENT with reasons (ADR-0001; the forge is visible-only; a failed look never gates; the
      gate never fires again once a workspace exists). Order:
      `docs/work-orders/WO-0066-saglik-yuzeyi/order.md`.
- [x] **WO-0067** — Agent git actions (PR #72, merge `e511e4f`, 2026-09-19; **ADR-0017**): the
      implementer commits on a `wo-NNNN-*` branch, pushes and opens the PR — the world-writes
      (push, `gh pr create|merge`) witnessed under every rule but full_auto. The fence review's
      yield: `gh pr create` was SILENTLY allowed (no `gh` dispatch) — the classifier's gh branch
      + the risky patterns close it. The observed link: the scan fills `track.pr_url`/
      `pr_head_sha` by the word-boundary title rule — NULL since the fixture era, now real.
      Order: `docs/work-orders/WO-0067-agent-git-actions/order.md`.
- [ ] **Reconciliation** — re-read git and the forge on open, focus, after actions, on manual refresh and on
      a background interval. Observation wins over what Docket last showed. Merged-outside-Docket is normal
- [x] **WO-0069** — M3'nin kuyruğu (PR #74, merge `64d8c35`, 2026-09-19): `EvidenceStatus` gains
      `unknown` (+ every consumer; a gate never satisfies on unknown); the verification gate is
      COMPUTED — `extractPointers` + record-time path resolution replace the closure-time `= 1`
      attestation (a WO closing without a resolvable verifier report stays honest at
      `implementation`); track CI learns unknown from the scan's degraded meta. Subagent-
      implemented, independently verified. Order:
      `docs/work-orders/WO-0069-m3-kuyrugu/order.md`.
- [ ] `stage` refined from OBSERVED forge facts (TD-008's remaining half — the unknown half
      landed with WO-0069; plan-approval-from-sha stays TD-005's line)
- [x] A defined home in the decision store for architect verdicts and verifier reports (TD-009)
      — delivered since WO-0020 (reports/ + verdicts/; tech-debt closed it); the derivation
      residue landed with WO-0069
- [x] PR / head sha / check-run ingestion (WO-0064)
- [x] Pointer resolution — the v1 cut landed with WO-0069 (record-time working-tree
      resolution; sha-level resolution is the named follow-up, the `unknown` arm keeps the
      door shaped right)
- [x] Gate engine: transitions absent, not disabled, when evidence is missing — the grammar
      delivered with WO-0031e (the mechanical disabled-ban), the unknown-evidence arms with
      WO-0069
- [x] **Agent git actions** — implementer sessions commit their own work and open the PR; revises
      the operator-commits ruling (the decision-store adapter's design note) — needs an ADR and a
      fence/risky review (commit/PR are writes) (WO-0067, ADR-0017)
- [x] **WO-0068** — Değişiklikler konsolu (PR #73, merge `8fb16fd`, 2026-09-19; **ADR-0018**):
      the Changes surface — per-repo branch/porcelain/diff cards in the WO detail's record
      stack, one-click commit/push/PR/merge (counted confirm), all six `docket:console:*`
      channels repo-jailed; the `Forge` port stays read-only (`@ts-expect-error` canaries).
      Subagent-implemented, independently verified. Order:
      `docs/work-orders/WO-0068-degisiklikler-konsolu/order.md`.
- [x] **Operator git console** — the diff-peek idiom grown into a work-order Changes surface
      (repo-jailed) with one-click commit / PR / merge (WO-0068)

## M3.5 — Shell foundations

Presentation-only, no domain change. Cheap because ADR-0006 kept `core` free of display strings and
WO-0002 routed all copy through `labels.ts`.

- [x] Locale `en` / `tr`, keyed labels, `en` fallback, preference persisted (ADR-0007) — delivered
  early as WO-0035 (2026-08-21, pulled ahead of M3 by the operator): per-locale bundles in
  `src/ui/data/labels/` read via `useLabels()`, the runtime en-fallback clause superseded by
  compile-time completeness (`const en: Labels`), a fresh install detects the system language, the
  stored choice wins.
- [x] Theme light / dark / system via semantic tokens, preference persisted (ADR-0007) — delivered
  as WO-0040 (2026-08-24): Sistem/Açık/Karanlık in Settings, dark re-tuned to layered black, light
  pure white, renderer-local localStorage per the standing app-settings ruling (ADR-0007's
  2026-08-24 addendum reverses the 2026-08-21 dark-only note).
- [x] Lint rule against hardcoded strings and literal colours in components — WO-0035's share
  (compiler-driven bundle completeness) landed; the grep itself remains open. **Landed with
  WO-0070** (PR #75, 2026-09-19): c7 literal colours + c8 non-ASCII display copy, both
  demonstrated failing before landing.
- [x] **Prompt overrides** — the role/plan prompt templates (architect / implementer / verifier /
  review, today compile-time constants in `src/core/order-md.ts`) editable in Settings: the
  AppSettings port → `app_setting` rows → IPC → a modal section; prompt assembly falls back to
  the built-ins when an override is absent. **Landed with WO-0070** (PR #75): five whole-text
  templates, one JSON row, override-first assembly, the built-in byte-identical when absent.

## M4 — Second workspace

- [ ] DateApp onboarded (multi-repo, dedicated decision store, cross-repo tracks with `depends_on`)
      — the machinery below is DONE; the onboarding itself is the operator's deferred-tour act
- [x] Briefing bundle assembly, including cross-repo contracts — **WO-0071** (PR #76, merge
      `f5f8816`, 2026-09-19): `track_depends_on`'s first runtime write path (validate-first,
      refusal writes nothing), the order.md `tracks:` fence round-trips `depends_on:`, and a
      dependent implementer's prompt carries each dependency's latest report PATH (paths, never
      contents; byte-identical without). Order: `docs/work-orders/WO-0071-m4-makine/order.md`.
- [x] Workspace switcher — delivered with the WO-0014 management UI (the appbar WorkspaceSwitcher
      + the WsListModal add entry; marked 2026-09-19)

## M5 — Workspace overview

A read-only projection of the decision store, not a planning surface (ADR-0008). Third consumer of the same
gate model, after the board and the detail view.

- [x] **WO-0072** — Genel bakış (PR #77, merge `be0a566`, 2026-09-19): the fourth AppShell
      surface — Sıra (open WOs grouped by whose turn; every open stage mapped and pinned),
      Borçlar (tech-debt.md parsed at view time, TD rows linked to OPEN WOs, ragged rows →
      named diagnostics), Hazır (startable WOs + planli tasks with clear faz blockers).
      Derived per mount, read-only, rows navigate. Subagent-implemented, independently
      verified. Order: `docs/work-orders/WO-0072-genel-bakis/order.md`.

- [x] **WO-0073** — GUI-only: the CLI removed (PR #78, merge `954e2f0`, 2026-09-20; operator ruling;
      faz-1 inventory → operator approval → removal): `src/cli/` (8 files, 1653 lines — WO-0024's second composition root, 11
      commands) + the `cli` script + both tsconfig entries + `COMPOSITION_ROOTS`' CLI arm (the ONE root is
      `electron/main.ts`; checks' meaning unchanged, 10/10 clean) + `usageRowsFor`/`usageRowsForWo` (the
      concrete-only CLI `show` read; `hydrateUsageRow` and the WO-0054 facts read stay — persistence
      semantics re-witnessed column-level in store.test.ts) + `quickProviderCheck` and its two provider
      consts (the ONE operator exception to the adapters gate; the port, `createRunner`, `checkProvider`
      untouched) + the 2 CLI-native E2E specs (operator-approved; `tsx` stays — `e2e/seed.ts` uses it).
      Integrity verified: the SDK imports ONLY in `src/adapters/runner/`, the Forge port + single
      `github.ts` adapter stand. ADR-0006 addendum (history kept, not rewritten); CLAUDE.md's two
      live-rule spots updated; TD-032 closed (its subject is gone). Ladder green: typecheck ×2, 1056
      unit tests, build, boundaries 10/10. E2E HONEST BASELINE: the suite is 60/98 red on `main`
      itself — the E2E-untested queue WOs' selector/assertion rot (the switchWs cascade, the
      WO-0065/0069/0072 surface changes) — and this branch's failure set is IDENTICAL (0 new, 0 gone;
      the 2 deleted CLI specs had been green). The red suite is the deferred operator test phase's
      opening inventory. Order: `docs/work-orders/WO-0073-gui-only/order.md`.

- [x] **WO-0074** — E2E rot repair: the baseline's 60 red specs → **all green** (PR #79, merge
      `b2931ac`, 2026-09-20; operator approved the approach + the one app fix). MEASURED root cause
      (live probes + the store tests'
      own recipe, never guesswork): ONE primary + its cascade. WO-0069's tightened `closed`
      derivation (a RECORDED verifier report with resolvable pointers) left the seed's closed
      fixtures deriving `implementation` — the app was honest, the seed stale; the first failed
      spec abandoned the app mid-flow and every later spec's positional/`switchWs` navigation
      inherited the lie (byte-identical failure sets proved the determinism). Fix: the seed's
      closed fixtures ('Kapandı', 'Eski iş') + the closable fixtures ('Raf işi') + the NEW
      'Tamamlanmış iş' carry the honest two-leg plan + `recordStepReport` (the store tests' own
      recipe); the WO-0069 wording re-anchored where the contract legitimately moved
      (EvidencePanel's `unknown` chip, `.readout`'s uppercase innerText, WO-0068's `sec-changes`
      record section, WO-0070's third settings item). PLUS the one REAL app bug the repair exposed,
      stop-and-ask honored, operator-approved: a workspace switch kept the previous workspace's
      detail open under the new header (`onSwitch` never cleared the open detail — the WO-0032
      delete flow's guard was its missing twin); the switch now lands on the new workspace's board.
      E2E 96/96 green · 1056 unit · typecheck ×2 · build · boundaries. Order:
      `docs/work-orders/WO-0074-e2e-curume-onarimi/order.md`.

- [x] **WO-0075** — the app home is `~/.docket` (PR #80, merge `ea9b9c7`, 2026-09-20; the operator's "~/.claude gibi"
      proposal, split in the discussion: the DECISION STORE stays in the repo — project knowledge,
      the evidence chain stands on it; the RUNTIME STATE moves to the dotdir home): the pure
      `resolveDbPath` resolver (override verbatim, never migrates; fresh machine → `~/.docket/
      docket.db`; a legacy Electron-userData db is mkdir+RENAMED into place exactly once, never
      copied; un-migratable legacy is fail-safe back to the legacy file), wired in the composition
      root — its only caller since WO-0073. +6 resolver tests; E2E untouched by construction (the
      harness's explicit `DOCKET_DB_PATH` never migrates). CLAUDE.md's app-home line.
      Order: `docs/work-orders/WO-0075-docket-evi/order.md`.

- [ ] Milestone progress from work-order `milestone` front matter — superseded by M6/ADR-0016 (the
- [x] **WO-0076** — probe: AskUserQuestion through the SDK (PR #81, merge `a1da146`, 2026-09-20;
      subagent-run, orchestrator-verified against the raw logs): the structured-question surface is
      REAL and host-answerable on 0.3.221 — the model calls it in a plain session; the fence sees
      `{questions:[{question,header,options:[{label,description}],multiSelect}]}` verbatim (the
      recommendation is ONLY a `"(Recommended)"` label suffix — no field); the host answers by
      folding into the permission response (`updatedInput.answers` keyed by the exact question
      string; multi-select comma-joined) — all four arms measured end-to-end: option pick, free-text
      "Other" (the CLI flips to a follow-what-they-say template), dismissed (bare allow), denied
      (deny+message → `is_error` result). Six real sessions, $2.16. Zero production code — the
      report freezes WO-0077's shapes. Order: `docs/work-orders/WO-0076-askq-probe/order.md`.

- [x] **WO-0077** — the structured ask card (PR #82, merge `d81a696`, 2026-09-20; the subagent
      pipeline: implementer → reviewer → orchestrator ladder/E2E): when an agent calls
      AskUserQuestion the ask card renders the question STRUCTURED — radio (single-select) /
      checkbox (multiSelect) options with descriptions, a free-text "Diğer" answer, and an
      "önerilen" badge on the option carrying the "(Recommended)" marker — and the answer folds
      back through the permission fence (the four WO-0076-measured arms: selection ", "-joined,
      Other, dismissed bare-allow, declined deny). Core `askq.ts` pure + strict-parse fail-open
      (any malformed payload → the binary card byte-for-byte); the fence classifies the tool as
      'ask' (the review's catch: unclassified it self-resolved before any operator saw it);
      `PermissionDecision` gains optional `updatedInput` (the minimal seam — pipeline/IPC
      untouched); radio groups are useId-scoped (parallel cards). 1100/1100 unit (+39: the
      probe's verbatim payloads + 4 adapter settle pins with red→green proof) · E2E 98/98
      (+2 scripted structured-ask specs). Order: `docs/work-orders/WO-0077-askq-card/order.md`.

- [x] **WO-0081** — probe: the gh issue surface (PR #83, merge `db6369e`, 2026-09-21; subagent-run,
      orchestrator-verified): the antreo bridge's contract, measured READ-ONLY. The org reality —
      `antreo-app` carries 6 repos (4 with issue activity: api ~333 / mobile ~263 / docs ~101 /
      admin-web ~70; org-wide open 38); milestones ARE the operator's Faz layer (api 8, docs 7,
      all due_on null) and a second collaborator exists. `gh issue list` takes 27 json fields
      (body/comments accepted but ~10x heavier); REST names differ (user/html_url, comments a
      count) and paginates by cursor. THE HONEST SURPRISE: the cross-repo issue chain lives in
      TITLE TEXT (`🔒 api#330` tokens — every structured link field empty) and the tokens are
      first-class search terms; search is the scarce budget (30/min vs core 5000/h). report.md
      freezes WO-0082's contract: the 3-call read surface, `issue:` front-matter primary + search
      secondary, one-page scan policy, NO milestone port (the roadmap fazlar stay the planning
      truth). Order: `docs/work-orders/WO-0081-issue-probe/order.md`.
      roadmap layer replaces the milestone front-matter idea; ADR-0008's derived-read discipline
      carries over)
- [x] Open work orders grouped by whose turn it is (WO-0072)
- [x] Open tech debt linked to the work orders that opened it (WO-0072)
- [x] "Ready to start" computed from closed dependencies and unsatisfied gates (WO-0072)
- [x] WO-0037 — okunur akış: xterm retired; the Ray chat column (role-barred turns, collapsible tool blocks, colored code) everywhere transcripts live (2026-08-22)
- [x] base-mobile deneme düzeltmeleri — sıra-durumu önceliği (derive), boot penceresi bayrağı, canlı kart overlay'i; WO-0037/0038 PR'ının içinde (2026-08-22)
- [x] WO-0038 — DOSYA: the single-view dossier — SADE/DETAY, tabs/rack, substrip, plan cards, the audit table and the standing evidence showcase died; header band + one scroll + session cards with artifact-headline özet + an honest plan editor + the pipeline-level plan-approval guard (2026-08-22)
- [x] WO-0039 — Ray öldü, kararlar bağlamına indi: the decision band under the plan rows, Düzenle in the section heading, DriveControls on the live pane's header, the EnterMark ⏎ badge, Turkish step aims — plus the stabilization round (2026-08-23→24): the overwrite incident's guard trio (store parse-guard + the resume-after-stop prompt rule + the planOnTable question-card gate), the "Plan submitted." sys-line classifier, an intentional Durdur ending STOPPED via the `interrupted` event (never the fail card), and ADR-0014 (one adapter per vendor over a machine-readable mode; terminal scraping rejected) — merged #45 (`921d386`)
- [x] WO-0041 — silme metni + detayın girişi: the delete confirmations speak user terms ("iş emri dokümanı, plan, raporlar ve tüm oturum kayıtları" — no order.md/plan.md), and the detail opens as the DOSYA's own banded cascade (strip → karar → enstrüman → adımlar → kayıtlar, the board's `.glide` reused verbatim — no new motion vocabulary — and a CLOSED order opens calm per r1) — merged #47 (`1af3983`)
- [x] WO-0042 — canlı döküm ▾ oku: a collapsed tool block that leaves the column fully visible retires the jump chip and re-arms the bottom-pin — a ResizeObserver on the content column (geometry, not scroll events; the collapse fires none), the measure rule moved to `.chat-col > *` — merged #48 (`8f2bdeb`)
- [x] WO-0043 — dead-code cleanup: the residue the restructures left behind (kit Tabs/ScrollArea + the two Radix deps, MarkdownDoc, the docs fixture, the SADE simplePhase cluster, TD-006's enum variants, 10 dead label keys + the `askingRole` family, dead CSS blocks, `shot.mjs`, `design-mock/`, the Google Fonts link; `seedFixtureWorkOrders` relocated test-side; WO-0025-test deleted by operator ruling) — deletions only, zero behavior change — merged #49 (`3b6bfe3`)
- [x] WO-0044 — tek canlı dil (tur 1 + tur 2, mockup-approved `wo-0044-live-top.html`): the ONE live instrument rides band-adjacent at the TOP (every drive kind — the driven row stopped carrying the pane), speaking the shared `pane-chrome` grammar (activity verb line + döküm chip, transcript behind it); the spine below is a pure status list (Aktif — true even when interrupted · Bekliyor); the ledger is PURE HISTORY (WO-0039/C's live pointer died; a session joins as a plain card when it ends — and the section is absent while a resume leg's continued session is the only row) whose cards declare themselves (`PLAN — MİMAR` KİM—ROL head, role edge, aim line, visible `--bord` border); ActionCard absent while a drive runs and never renders the resume intent (Sürdür lives only in DriveControls); words deduped ("0/2 adım", "Denetim: kapıda"); özet derives in core (markdown-proof `sessionHeadline`) — the first real step-drive dogfood's rulings (2026-08-25) — merged #50 (`b8f698c`)
- [x] WO-0045 — operatör tempo (probe-first, `docs/probes/cc-surface/` §S): steering a RUNNING drive — a note queued from the live pane's header bar (PaneSteerBar, one grammar for the three surfaces) applies ONCE at the next agent-turn boundary, renders as the OPERATÖR transcript line, and EXTENDS the same drive (operator ruling 2026-08-26: intermediate per-command results suppressed into one terminal turn_complete with delta-accumulated cost; delivery detected via command_lifecycle — notes never echo as user messages); Durdur persists the mirror on the session row (`pending_notes`, latest-wins) and Sürdür delivers (first note via the prompt channel, rest re-queued); retract best-effort (`cancelAsyncMessage`, s5/s5b) with the stopped-mirror route through the data port — PLUS the `Akış` chip beside Denetim: per-WO `flow_mode` in order.md front-matter, pipeline-enforced (origin:'auto' spawns refused in manual, the planApprovedFor shape), locked only on a closed WO (a mode flip never touches the running drive and never fires a start), the "sıradaki: Adım/Denetim N [Başlat]" card in the decision stack (nextManuelAction; outranks the all-done close card — the last review leg still needs the click); ADR-0015; TD-049/050/051; the operator's real-drive test round deferred by ruling — merged #51 (`ece1bee`)
- [x] WO-0046 — canlı dürüstlük (probe-first, `docs/probes/cc-surface/` §C): the live instrument reports CONCRETE PROGRESS, not just motion — a context readout (`bağlam %62 · 124k/200k`, text in the costline's voice — operator ruling) fed fire-and-forget from `getContextUsage()` at tool events / turn boundaries / throttled (≥30s) thinking bursts, never persisted, absent-until-reported; the live costline speaks the card's `formatCost` vocabulary (`$0,41 · 68k→2.1k` — the ride-along `cost` on the context event is the only mid-drive token source, D3 intact); the staleness line (`3 dk'dır yeni çıktı yok`, operator-ruled threshold) replaces the indefinite Düşünüyor when the LIVENESS anchor (`lastLifeAt` — stamped entries + fresh readings + the ask-answer stamp; probe c1: long thinking streams no entries while healthy) ages past 3 min, superseding the tool verb with dots off, never on a stopped/errored/asking fold — informs, never acts; resume-leg cost VERIFIED NOT A BUG with the review round's axis split (usd cumulative-within-process / reset-at-resume — the store's prior+input is correct; usage tokens per-result, summed — TD-052) plus TD-053 found live in the checkpoint and fixed (runIdx's mount-only initializer froze on a detail opened before its plan — approval mounted no instrument until re-entry); ADR-0012 addendum; the staleness/live-cost live observation deferred by operator move-on (WO-0045 precedent, E2E-pinned) — merged #52 (`28c1b9c`)
- [x] WO-0047 — bütçe kapısı: a workspace month-spend threshold (warn percent + hard cap, Paperclip's shape), pipeline-enforced in the `planApprovedFor` tradition — every drive refused before the runner spawns when the calendar-month spend meets the cap, the refusal a TWO-CHOICE card (raise-and-re-run / keep-the-cap), the warn level an informative mono line on the board card + the band; raising the cap is a permanent `app_setting` write (operator rulings 2026-08-26) — merged #53 (`f7e3b89`)
- [ ] Recently closed, with closing sha

## M6 — Yol Haritası (roadmap → faz → görev)

The planning layer ABOVE the work order — the pattern antreo-app runs by hand today (9 faz docs +
"Ana Görev / Görev N" issues + manual cross-repo links) becomes one managed chain: a per-workspace
`docs/roadmap.md` (one ```fazlar fence, the ```steps tradition), faz→task→iş emri links carried in
order.md front-matter, statuses DERIVED from linked work orders (never stored — ADR-0016 supersedes
ADR-0008's no-planning-surface stance for this artifact while keeping its derivation discipline).
Planning round 2026-08-27: four locked decisions (persistent tasks + 1:N WO links; ONE architect
draft session for both generation and import; the spine→GUI→AI split; the sibling `Pano | Yol
Haritası` screen) + the mockup tour (`docs/ui-mockups/wo-0048-yol-haritasi.html`, 7 frames — faz
strip, task fill, `sıradaki`, collapsed past, ✦ dialog, TASLAK card, prefilled spawn).

- [x] **WO-0048** — spine. Done (merged #54, `30cf26c`): the ```fazlar fence contract
      (`roadmap-md.ts`, 33 tests — all-or-nothing parse with named reasons, 11 diagnostic codes,
      fence-only surgical edits, canonical serialization) + the derivation (`roadmap.ts` — task/faz
      statuses, spawn absent-reasons, `RoadmapView` absent|invalid|ready, sıradaki = first
      spawnable; the mockup frame-01 facts pinned through real files + DB rows); the `task:` link
      ONLY in order.md (round-trip pinned, PRAGMA diff EMPTY — no column, view-time join = TD-055);
      the `docs_root:<wsId>` structure root (one resolver, fail-open read / refusing write, files
      never move, .gitignore never written); `saveRoadmap` parse-guarded; CLI `roadmap
      show|validate` + `docs-root` + `create-work-order --task`; 5 IPC channels ready for WO-0049.
      700 tests / typecheck both / boundaries / build / E2E 56 green. **TD-055 opened.**
      Spec: `docs/work-orders/WO-0048-yol-haritasi-omurga/order.md`.
- [x] **WO-0049** — GUI. Done (merged #55, `759f432`): the sibling `Pano | Yol Haritası` screen
      (strip/fill/`sıradaki`/donefold/Bloke line/open-WO chip → detail → back), Ekle-only editing
      (`+ Faz ekle`/`+ görev ekle` — re-read at save, parse-guarded write), the prefilled spawn
      writing `task:`, the detail chip with the orphan degrade (core `roadmapTaskOf`;
      `openWoIds` branded — no identity casts in ui), the settings `Yapı kökü` section, labels
      tr/en (33 keys + `FAZ_STATUS_LABELS` + `fazLabel` + the 11 diagnostics), E2E 56→62
      (the `yol` world; ids printed, never hard-coded). ADR-0007 addendum: faz/task ids join the
      WO-NNNN carve-out (`fazIdLabel`). 705 tests / typecheck both / boundaries / build green.
      Spec: `docs/work-orders/WO-0049-yol-haritasi-gui/order.md`.
- [x] **WO-0050** — AI: the WO-less architect draft drive (session migration: nullable
      `work_order_id` + `workspace_id`, budget accounting widened, `roadmap_draft` pending table,
      parse-guard), source-doc import as paths-in-prompt, the cwd fix from the connection table,
      draft UI (RoadmapPane + TASLAK card), CLI `roadmap draft|approve`, E2E FakeRunner scenarios.
      Delivered as `DriveInput = WoDriveInput | DraftDriveInput` (isDraftDrive the narrowing point;
      isPlanDrive true unchanged — zero runner-adapter change) + `roadmap-draft.ts` (paths-not-
      contents prompt, `draftSummaryOf`); the transactional session rebuild backfills
      `workspace_id` through the WO join; the month sum keys on the workspace so a draft can never
      bypass the cap (`budgetBlockForDraft`); plan_ready → the pending `roadmap_draft` row (fresh
      drafts supersede, İtiraz resumes, Onayla = the parse-guarded atomic write — commit the
      operator's); the cwd fix (`driveCwd` from the connection table, every GUI drive); the
      roadmap screen's live half (RoadmapPane `MİMAR — TASLAK`, the ✦ dialog, the TASLAK card with
      the structured Düzenle, ask/question cards, the refusal card); CLI `roadmap draft|approve`;
      E2E 62→69 (the `taslak`/`taslak-kirli`/`taslak-kapi` worlds). ADR-0013 (the second live
      surface) + ADR-0016 (the draft mechanics) addenda, CLAUDE.md lines, TD-056/057. Operator
      rulings 2026-08-27: structured Düzenle, supersede, draft spend out of the head. 743 tests /
      typecheck both / boundaries / build / 69 E2E green. Spec:
      `docs/work-orders/WO-0050-yol-haritasi-taslak/order.md`.
- [x] **WO-0051** — ✦ belge kaynağı: the draft's channel composition (depo scan ∪ ek belgeler ∪
      serbest keşif), the TD-057 döküm chip, the TD-056 fence alignment (merged #57, `d0afba8`).
      The source set is the operator's free composition — a recursive `.md` scan of the structure
      root at dialog open (`docket:list-decision-docs`; ALL included by default, exceptions at
      group level), picked paths (any path, deduplicated against the store), and an opt-in
      exploration clause (exactly ONE sentence iff on); the prompt carries the path UNION,
      contents never. Persistence carries COUNTS, never paths (`roadmap_draft.source_summary`,
      keep-prior across an İtiraz resume, dead with the row at approval). The TASLAK card's
      `Dökümü aç/kapat` chip opens the identity line + the archived transcript (TD-057 closed);
      the architect write fence aligns with `docs_root:<wsId>` via the main-filled,
      never-renderer-set `decisionStoreRoot` (TD-056 closed). Presentation per the operator's
      rev-3 round (`789d01d`): one block, one row language, names first — the channel word said
      at most once. CLI `--explore`; E2E 69→78 (the `taslak-depo` grouped + `taslak-duz` flat
      worlds, the `DOCKET_E2E` staged-pick seam). Reviewer round `bec3fe0` (1 major: the
      renderer-settable fence root — fixed). 769 tests / typecheck both / boundaries / build /
      E2E green. Spec: `docs/work-orders/WO-0051-belge-kaynagi/order.md`.

## M7 — Kullanım enstrümantasyonu (usage floor → ekranlar)

The token tour (`docs/research/2026-08-28-token-usage-tour.md`, `277b3a9`) measured what Docket
drops that the provider already reports; this milestone builds the recording floor first, then
the two screens that read it (the operator's 2026-08-28 sequencing: floor → limit screen →
usage screen). Remaining tour candidates wait unopened: the ✦ read-mass budget, the checkpoint
diet, the plan.md embed diet.

- [x] **WO-0052** — the recording floor (merged #58, `d0ea490`). A new `turn_usage` RunnerEvent —
      one per OBSERVED provider result, emitted BEFORE the adapter's hold check so a steered
      drive's held intermediates escape too — carries the per-result `usd_delta` under the
      unchanged `applyResultCost` baseline plus the rich detail the SDK already reports: cache
      read/creation split, per-model usage map (model ids as row DATA), `numTurns`,
      `durationMs`/`durationApiMs` (leg-cumulative-so-far, persisted verbatim, never summed).
      Store: `session_usage` (append-only, OWNED half — a reseed never drops observed history;
      resume legs append to the same owner pair, no double-count) + nullable session checkpoints
      `ctx_used_tokens`/`ctx_max_tokens` (the LATEST `context_usage` reading, every `record()`)
      and `final_model_usage`; PRAGMA-guarded additive migration, `SESSION_REBUILD_COPY`
      extended, pre-WO-0052 rows stay honestly NULL. Synthetic plan-exit and interrupts write no
      row — nothing was observed. Budget math byte-identical (`monthSpendRow` two-ref diff'd
      IDENTICAL); no UI, no new SDK control calls (the `usage_EXPERIMENTAL` surface is the limit
      screen's). `show <woId>` gained the per-session floor (ctx line, last-usage line, per-turn
      tail — absent fields print NOTHING) + its first tests. Plan round `bf7e7cb` (mimar verdict:
      design upheld, 4 deviations ruled justified, fill-history = floor-only — no tail, additive
      path open); review round 9 gates clean + the array-blob hydration guard (`9dab9b4`);
      verifier report AC1-6 PASS at head (PR body's E2E count corrected 84→78 — non-spec
      checkmarks). 802 tests (+33, both absence directions pinned) / typecheck both /
      boundaries / build / E2E 78 green. ADR-0006 + ADR-0010 addenda, CLAUDE.md Records sentence,
      TD-058 open. Spec: `docs/work-orders/WO-0052-kullanim-enstrumantasyonu/order.md`.

- [x] **WO-0053** — the limit screen (merged #59, `28f8801`). The two channels WO-0052 reserved
      are read: the push `rate_limit_event` (status neutralized `allowed|allowed_warning|rejected`
      → `ok|warning|blocked`, the epoch `resetsAt` → ISO at the boundary) and the pull
      `usage_EXPERIMENTAL` control at the `emitContext` cadence (windows only, `rate_limits_available
      === false` absent, one-rejection kill). Every 429-shaped death classifies to `rate_limited`
      (`error_during_execution` + `terminal_reason`/`errors[0]`; `api_error_status` never read;
      `overloaded` out — capacity, not the window). Core: the `limit_windows` feed + the `limit?`
      stop payload (the refusal pattern) + the fold + `limitCrossing` + the seed boundary (a
      stopped row never re-raises the limit). Store: `session.limit_reset_at` — set at the limit
      terminal, CLEARED by a clean leg (a stale stamp is a lie), kept through non-limit throws;
      PRAGMA-guarded, rebuild-copy extended. UI (operator round 2): the INFORMATIVE card —
      actionless, wait-state only, the crossing unmounts it («kart gider, Sürdür düğmesi gelir»);
      the ONE «Sürdür» locked in its normal home while the limit holds (attribute-free, ADR-0001's
      guarded register), ⏎ held off; the provider-signal-only warn line (running-gated); the
      board's `limit_stopped` reason line (clock-free; a clean leg reverts it); the stamp-less
      degrade to the localized fail-card title. CLI names the stamp + the resume path. Mockup rev
      1 `cf28681` (6 rulings, round 2 revised them); architect plan round REVISE (8 findings
      folded) → PROCEED `6629b5e`; reviewer round 1 blocker + 3 majors folded `1c1e5de` (the
      load-bearing one: the real death folds `done` — the surfaces branch on their own
      discriminator); verifier AC1-8 PASS at head, its closure gap (the board arm's core test)
      fixed at close. 842 tests at merge (+4 at close) / typecheck both / boundaries / build /
      E2E 82/82 (the live 9s tick crossing pinned for real). ADR-0013 needed NO addendum in the
      end (round 2 dissolved the card-button tension); TD-016's pinned-surface list gains the two
      channels. Spec: `docs/work-orders/WO-0053-limit-ekrani/order.md`.

- [x] **WO-0054** — the usage screen (merged; plan round `344505d` — one architect REVISE with
      4 findings + 1 nit, second round PROCEED on 3 folded amendments). The third M7 surface
      reads the floor: a pure `deriveUsageView` (month-windowed `usd_delta` sums → byRole /
      byModel row-partition / cache split / per-WO ledger with the ✦ draft rows VISIBLE for the
      first time; `num_turns`/durations structurally unselected; empty≠zero, counted honesty
      qualifiers) behind `WorkOrderSource.workspaceUsage`, rendered by `UsageScreen` (month
      head = the EXISTING budget view; live quota panel = both arms — WO + ✦ draft —
      provider-signal-only, text pct; the head/breakdown basis divergence NARRATED by pure
      predicates on RAW accumulates, never reconciled; the byModel split's own divergence
      narrated the same way) + the two delete cascades completing WO-0052's append-only
      promise against the OWNER. Reviewer round: SHIP (0 blocker / 0 major; the raw-compare
      predicates, the head's readout-XOR-budgetLine, the reactive draft arm folded). Operator
      copy round: internal jargon E2E-pinned OFF the screen («WO-0052», «per-turn» never
      render). The checkpoint interlude shipped PR #61 (the unreadable ✦ draft's Sürdür/Sil —
      WO-0050's addendum). 877 tests / typecheck both / boundaries / build / E2E all green.
      Follow-up queued: interrupted legs record NULL cost (the $0,00-wall fix, operator
      approved). Spec: `docs/work-orders/WO-0054-kullanim-ekrani/order.md`.

## M8 — Canlı görünürlük (the agent-task lifecycle on the live surface)

- [x] **WO-0055** — live agent visibility (merged #63, `93e3f1f`): the SDK's agent-task lifecycle (probe t1:
      `task_started`/`task_notification`, `parent_tool_use_id` nesting link, `task_type:
      'local_agent'` discriminator, the wire tool name `Agent`) becomes ONE core event kind
      (`agent_task`, phase-discriminated); the fold keys its replay guards on OPEN tasks (a
      task legitimately re-opens after its end — the SendMessage restart); agent rows ride the
      schema-free transcript (no migration, no audit row); the live panes render the composite
      delegation block (the subagent's own rows nested inside — clamped while running,
      click-collapsed when ended; the end digest fills the body until the real report wins the
      pair), the activity line counts running agents (`N ajan sürüyor`, between staleness and
      the tool verb), ambient/`local_bash` tasks never render. Spec:
      `docs/work-orders/WO-0055-canli-ajan-gorunurlugu/order.md`.

## M9 — Paralel (the wave spine)

The antreo wave (N issues → worktrees → parallel sessions across two CLIs) becomes Docket's own
shape: N work orders + a ✦ draft driving at once, each in its own working copy. Discovery round
2026-09-21/22: the four single-drive layers measured and keyed; the wave's remaining pieces queued
below (operator ruling 2026-09-22: the round's three finding-WOs keep 0089-0091).

- [x] **WO-0088** — the parallel spine (PR #93, merge `6138f03`, 2026-09-22): one active drive per
      owner (work order / ✦ draft), N owners in parallel, a WO's own steps still serial. The four
      layers keyed by `driveOwnerTag` — per-drive runner instances at the composition root (the
      adapter untouched; the port gained four optional keyed methods), the tag riding every
      `docket:runner:event`, keyed steer/interrupt/decide in the pipeline, the renderer drive-store
      a Map of active keys. Per-WO cwd override: order.md front-matter `cwd:` (validated; the fence
      jails to that root). The ask card names its WO. The review round's M1 (a dead-key Durdur
      falling through to the last-started sibling) closed red→green in-PR. 1141 unit · E2E green
      incl. the multi-drive spec — the count figure in #93's body was wrong; the true count at
      merge was 99 specs (corrected at WO-0092's review). Order:
      `docs/work-orders/WO-0088-paralel-omurga/order.md`.
- [ ] **WO-0089** — the local gate: a CI exemption needs a substitute, not a hole — Docket runs the
      repo's gate commands and records what it measured (drafted by the WO-0088 round; tracking
      issue #90).
- [ ] **WO-0090** — the briefing resolves before it ships: stale context caught at assembly, not
      mid-drive (drafted by the WO-0088 round; tracking issue #91).
- [ ] **WO-0091** — the stall gate: a live drive that stops making progress becomes the operator's
      turn (drafted by the WO-0088 round; touches WO-0046's informs-never-acts line — ADR round owed;
      tracking issue #92).
- [x] **WO-0092** — the issue bridge (PR #94, merge `2f1ebe2`, 2026-09-22): the frozen 3-call
      read as adapter-extra methods (probe-log fixtures), the observed `forge_issue` cache
      (never a body; issue reads isolated per-repo — a failed look never wipes), the Depo
      issues fold, and the spawn: ▸ İş emri aç (title/body via one drill-down, `issue:`
      front-matter, batch with one counted confirm, retry-honest) + the two-way link. The
      review round closed the seed-incident hazard at BOTH ends — writes refuse on a
      disconnected decision store (fail-fast, operator words) and the state is unreachable
      from the UI (remove/re-point refuses). 1173 unit · E2E 103/103 (the true count; #93's
      "105" corrected). Order: `docs/work-orders/WO-0092-issue-koprusu/order.md`.
- [ ] **WO-0093** — worktree automation: "Başlat" prepares the working copy, closure removes it —
      amends WO-0088's operator-worktree ruling (operator: "setup.sh olmasın, repoyu kirletmesin").
- [ ] **WO-0094** — agent issue creation: `gh issue create` joins the risky set (the WO-0088 round
      silently wrote three issues from the fence — the classifier knows pr create/merge, not issue
      create) + ADR-0017 revision + the reconciliation join.
- [ ] **WO-0095** — probe: the `agy` stream-json surface against the ADR-0014 bar (cost? permission
      holds answerable in print mode? plan gate? steering? quota windows — the operator's 2026-09-22
      panel shows GROUP-based weekly + 5-hour limits, a `limit_windows` mapping candidate).
- [ ] **WO-0096** — the second vendor adapter (Antigravity), if the WO-0095 probe passes.
- [ ] **WO-0097** — billing axes made explicit: subscription quota vs API cost per backend/workspace
      (the operator, 2026-09-22: "claude, agy, codex... abonelik ve api istek ücreti ayrılıyor");
      the two feeds already exist (WO-0053's `limit_windows` + `cost_usd`) — the WO names the axis
      on every cost surface and re-anchors the budget gate's meaning per metering kind.
- [ ] **WO-0100** — the app's own face: name, Kuyruk icons, native menu, running-work tray;
      packager config (signing/notarization/auto-update stay on Later). Order:
      `docs/work-orders/WO-0100-uygulama-kimligi/order.md`.
- [ ] merge-time rebase of the remaining wave branches (operator's DEVIR.md discipline, unnumbered
      until the pieces above land).

## Later

- Packaging and distribution
- Open source release: docs, workspace.yaml authoring, contribution guide
- **Customization & freedom pass** — Docket stays fully user-owned: user-definable roles/aims
  (PRODUCT.md's open question — custom aims defining their own write-scope/fence), every knob
  Docket itself controls (prompts, rules, vocabulary) surfaced as user data, not constants
