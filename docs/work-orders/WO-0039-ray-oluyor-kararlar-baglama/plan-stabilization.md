# WO-0039 stabilization plan — the next session's work order

Written 2026-08-23, end of the WO-0039 mega-session. Execute in a FRESH session (context rule).
Every item below is diagnosed but NOT yet implemented unless marked. All were operator-reported.

## P0 — the plan-submission stabilization trio (the overwrite incident)

**Incident recap (proven):** run 20:58–21:09 — the architect submitted the real plan (18:02
plan_saved, cost ✓), then on detail RE-ENTRY a resume path restarted the SAME session; the agent
(directed by architectPrompt's "submit via ExitPlanMode") submitted "bekliyorum" as the plan and
`savePendingPlan` OVERWROTE plan.md (18:08) with one sentence. The real plan survived only in the
agent's own file: `~/.claude/plans/you-are-the-architect-wild-hanrahan.md` (verified: 2508 bytes,
full Context/Yaklaşım + ```steps fence).

1. **Store guard (src/adapters/store/index.ts `savePendingPlan`):** refuse to overwrite an
   existing plan that PARSES (`parsePlanSteps` non-empty) with a new one that does NOT parse.
   Mechanical rule, no judgment. A degenerate resubmission can never clobber a real plan.
2. **architectPrompt stop-rule extension (src/core/order-md.ts + test in
   `src/core/__tests__/order-md.test.ts`):** "If your session resumes AFTER the plan-submission
   stop notice, do NOT call ExitPlanMode again — answer in one short sentence and end your turn."
   (Complements the 2026-08-23 STOP rule that ended the triple-resubmit.)
3. **The question-card gate (SessionPane `showQuestion`):** requires NO plan on disk — the
   controller passes `planOnTable={!!docs.plan}` (or equivalent); `showQuestion` gains `&& !planOnTable`.
   A plan on the table IS the answer; "Mimar seni bekliyor" + Yanıtla must not render there. This
   closes the re-entry resume trigger regardless of which button fired.
4. **Gate-denial classification (ChatTranscript grouping):** an orphan tool_result matching
   `/^Plan submitted\./` renders the "Mimar planını sundu" sys line (twin of the existing
   "User has approved…/rejected…" classifiers) — kills the "→ sonuç — eşleşen çağrı yok" row the
   operator asked about.
5. **Restore WO-0001's plan.md (base-mobile repo, operator approval required):** copy the
   recovered plan from the agent's plan file into
   `docs/work-orders/WO-0001-faz-6c-3-…/plan.md`, then re-parse (steps must show 3 rows).

## P1 — Durdur must never say "Oturum çöktü" (diagnose first)

6. **Diagnose:** with the fake runner + the real app, press Durdur mid-drive; find why the fold
   shows the fail card (likely: the interrupt closes the stream without a recognizable
   turn_complete → the drive-store/pipeline fold lands in error/retry state → failTitle
   "Oturum çöktü" / driveStreamCrashed).
7. **Fix:** an intentional interrupt ends as STOPPED — DriveControls' stopped state
   ("Durduruldu. Rapor kısmi kalır." + ▶ Sürdür), never the fail card. The synthesized
   close / completion-guarantee path must mark the interrupt as intentional (the adapter already
   swallows AbortError; carry that intent through to the fold state).

## P2 — the multi-vendor decision (ADR)

8. **Write ADR-0014 (docs/adr/):** one adapter per vendor over a machine-readable mode (SDK or
   stream-json); the RunnerEvent port (product concepts, ADR-0006) is the contract; terminal
   scraping REJECTED with this session's evidence (cost rides the result message only; the plan
   gate emits pseudo-results; gates/fences require interception a pty cannot provide; xterm was
   retired by operator ruling WO-0037). Optional cheap hybrid on record: the raw vendor
   transcript as a display-only attachment on session cards — no parsing, ever.

## Close-out (same session as above)

- Full chain: typecheck ×2, vitest, build, check:boundaries, E2E suite, review round, ROADMAP +
  tech-debt updates, commit (operator approval gate stands).
- WO-0039's order.md Notes already carry the full incident trail of 2026-08-23; this file is the
  executable remainder.
