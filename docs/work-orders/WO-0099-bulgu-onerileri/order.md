---
id: WO-0099
title: "Findings become proposals — a session that spots a problem in ANOTHER repo surfaces ready work orders, previewed, operator-confirmed"
workspace: docket
status: open
mode: direct # plan | direct (operator ruling 2026-09-22: terminal-wave work)
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0092"]
---

# WO-0099 — findings become proposals

## Objective

The wave's real pattern: an implementer working the MOBILE repo discovers the root cause lives in
API. Today that knowledge dies in a report paragraph (or leaks into the agent's own scope, against
its fence). This WO builds the honest pipe: **the report carries structured findings; Docket parses
them into PROPOSED work orders targeting the named repo; the surface previews exactly what would be
created; the operator's one counted confirm creates them** — prefilled, linked back, each on the
right repo's track. The operator ruling 2026-09-22: "mobile'de çalışıyoruz, api'de bir sorun
farketti — farklı repolara da iş emri açabilsin ve neler açacağını göstersin."

## Context (measured 2026-09-22)

- A work order ALREADY targets any connected repo (tracks, WO-0015's per-repo checkboxes; the
  antreo workspace carries api + mobile + docs). The manual path exists; the discovery path does not.
- The parse-from-report precedent is proven: `parseVerdict` (`src/core/verdict.ts`) reads the
  architect's verdict from the final output at `turn_complete`; step reports land as
  `reports/step-NN-<role>.md` + a pointer row (WO-0017/TD-009's ruling).
- The spawn grammar exists: the issue bridge's ▸ İş emri aç prefills the normal create dialog,
  never a silent write (WO-0092); the batch counted confirm creates N in one operator act.
- The fence reality: an implementer writes ITS track repo only (ADR-0002); the decision store is
  the architect's. A finding must therefore travel as DATA in the report, and the work order's
  creation must be the operator's click.

## Frozen decisions (2026-09-22, operator)

- **The report contract grows a `## Bulgu` section** (Turkish key, the ```steps/```fazlar fence
  tradition): each entry `repo: <name>` + `path:line` + one-line problem (English code/repo
  documents rule; the SECTION KEY is the product vocabulary, labels localize the surface).
  Findings outside the fence are prose, never parsed.
- **Parse at record time** (the parseVerdict seam), store MINIMAL pending rows (repo, pointer,
  text, source session/step) — the roadmap_draft pending-table precedent; consumed or dismissed
  rows die; nothing derivable is stored twice.
- **The proposal is the preview.** A card per finding: title (from the problem line), target
  repo + its track, the pointer, the source session. Confirm is COUNTED ("2 iş emri açılacak")
  and creates via the EXISTING create path (nextWorkOrderNumber, order.md authored by Docket,
  description carrying the pointer + "WO-00XX sırasında bulundu" + the source session id).
  Dismissal is per-card, honest (dismissed stays dismissed — no re-proposing the same finding).
- **Cross-repo honesty:** a finding naming a repo NOT connected to the workspace renders the card
  locked-in-place with the reason (ADR-0001's guarded register — the karar deposu marker
  precedent); a finding naming the SAME repo as the source track is fine (a follow-up there).
- **No auto-anything:** no drive is started, no issue is opened, no plan is requested by the
  proposal. Created WOs land at Yazıldı like any operator-authored order.

## Open design questions (settled in implementation, pinned by tests)

- The section's exact fence shape (a ```bulgular fence vs `## Bulgu` heading) — lean fence, the
  all-or-nothing parse with named diagnostics (roadmap-md's discipline).
- Which reports parse: step reports + free-form implementer reports (verifier too? a verifier's
  job is finding problems — lean YES for verifier, the parse is role-blind and cheap).
- The card's home: the WO detail's decision stack (beside the sıradaki card) vs the record
  sections — lean decision stack; absent entirely when no pending findings (zero noise, pinned).
- Duplicate detection: identical repo+pointer already proposed or already a WO → the card says
  so instead of re-proposing (a hash/compare rule, pinned).

## Scope

**In**: the report-section contract + `parseFindings` (pure, test-first, red-first); pending
rows + their store seam; the proposal cards + counted confirm + dismissal; the prefill (target
repo track, pointer, source link); the unconnected-repo locked card; the created-WO link-back;
prompt contracts (the role prompts' report sections gain the fence instruction — WO-0070's
override-aware assembly); E2E (a scripted finding → cards → confirm → 2 WOs).
**Out**: GitHub issue creation from a finding (WO-0094's line — the card may later carry both
buttons, this WO builds only the Docket arm); auto-starting the created WOs; findings from the
architect plan drive; auto-worktrees for the created WOs (WO-0093's surface applies at START,
unchanged).

## Acceptance

1. A report carrying a fenced finding for ANOTHER connected repo produces the proposal card with
   exactly what would be created (title, repo/track, pointer, source); the counted confirm
   creates the WO on that repo's track, prefilled as specified, linked back from the source WO.
2. Multiple findings → multiple cards → one counted confirm → N sequential WOs (the 0092 batch
   grammar); the created order.md round-trips the source link (view-time join, orphan-honest).
3. A finding naming an unconnected repo renders locked with the reason; nothing is creatable
   from it. A report with no fence produces NO cards (absent, not empty — pinned).
4. Dismissal is per-card and durable; a re-run of the same report does not resurrect it; a
   duplicate repo+pointer already proposed/created says so.
5. The fence is honest end-to-end: no session ever writes the decision store through this path;
   creation happens only on the operator's confirm (pinned by a fence/permission test).
6. Mechanical ladder green: typecheck ×2, unit, boundaries, build, E2E.

## Notes

- The finding text is REPORT DATA (Records rule): repo names and path:line pointers are its job;
  no environment values ride it.
- Composes with WO-0094: when the agent-issue arm lands, the card grows the second button
  (İş emri aç / Issue aç) — this WO's card carries one button and the seam for the second.
- Queue: a terminal-wave candidate (independent of 0098; shares only the create seam).
