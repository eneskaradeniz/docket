---
id: WO-0039
title: Ray öldü — kararlar bağlamına indi (plan karar bandı, panel başlığında süreç denetimi, sözlük)
workspace: docket
status: closed
mode: direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0039 — Ray öldü, kararlar bağlamına indi

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

The bottom action rail is dissolved (operator ruling, mockup-approved 2026-08-22 —
`docs/ui-mockups/wo-0039-dosya.html`). Its two jobs split by nature: DOSSIER DECISIONS render in the flow
they decide on — İtiraz et + Onayla in a decision band under the plan rows, Düzenle in the "PLAN
HAZIR" heading, Plan iste in an empty-state card ("Henüz plan yok.", 1 line + ≤1 action), Yeniden
dene on the fail card, the ask hint on the ask cards, the close hint inside the close card — while
PROCESS CONTROL (Durdur / Zorla kes / ▶ Sürdür) rides the live pane's header (`DriveControls`).
The ⏎ stays ONE derived primary, now visibly badged on the button it fires (never on Kapat, never
during an ask). The vocabulary debts die with it: the meaningless "hazır"×N on proposal rows, the
board card's "Plan commiti bekleniyor" twin (one state, one sentence: "Plan onayı bekleniyor"), the
English step aims (the architect prompt now asks for short Turkish labels — the aim renders
verbatim in the UI), and the "Kapılarda" chip's silence (a per-mode tooltip teaches what the
cadence does). The role chip teaches too: its tooltip composes the role's duty line.

## Context

- The operator's four complaints on the base-mobile WO-0001 screen (2026-08-22): the English step
  rows ("1 Uygulayıcı plan draft hazır…"), "Plan commiti bekleniyor", Düzenle's home (the bottom
  bar while it edits the plan rows), and the rail itself ("kaldırsak, farklı bir yaklaşımla").
- src/ui/components/detail/ActionRail.tsx (DELETED) — the bottom bar carried both decision buttons
  and process control; decisions were physically far from their context.
- The five English task names were never UI copy: they are the architect agent's `aim` data from
  plan.md's ```steps fence, rendered verbatim (src/core/order-md.ts architectPrompt asked for
  English "agent-facing" labels while the UI renders them as display text).
- "Plan commiti bekleniyor" (tr.ts cardReasonText) vs "Plan onayı bekleniyor" (ABSENT_REASON_LABELS)
  — twin sentences for one state (`awaiting_plan_commit`); "commit" leaked operator copy.
- "hazır" (UI.stepReady) sat on every proposal row — a constant column, zero information.
- The ui-ux-designer pass (2026-08-22) recommended SPLIT (decisions contextual, a live-process
  bar); the operator chose FULL REMOVAL — Durdur lives in the pane header and may scroll away.
  Compensation on record: the always-visible header band (turn lamp + phase line) and the global ⏎.
- ADR-0013 (the DOSYA order ends with "the rail"), ADR-0012 (the single-⏎ exception names "the
  rail ⏎ badge") — both amended by this order.

## Scope

In scope:

- PlanSection: heading Düzenle (secondary; absent for a fence-less plan, hidden while editing),
  proposal rows drop "hazır" and gain the scoped row's ` · repo` suffix (StepList parity), the
  decision band (hint + İtiraz et + Onayla⏎; `planApproveHintEdited(n)` names the staged edit
  count) and the editor band (Vazgeç + Bitti⏎ + the empty-aim reason) in the SAME slot.
- New `DriveControls` (src/ui/components/session/): the run/stopping/force/stopped states with
  their v4 rules intact; mounted in StepPane's header (via StepList), SessionPane's and
  ReviewPane's headers, and a slim plan-stage strip when a drive is live while a plan is on the
  table (the objection re-planning case — no instrument renders there by WO-0038 ruling).
- WorkOrderDetail: the rail contract deleted; ONE derived `primary` (⏎) + the `drive` bundle; the
  plan stage's lone Plan iste button (2026-08-23 ruling — the empty-state card and its
  "Henüz plan yok." line died on the operator's first hands-on pass; the SessionPane invitation
  line and ActionCard's plan-stage branch die with it — no duplicate Plan iste); ask hint on the
  ask stack; retry on the fail card; close hint in the close card.
- Labels tr/en: rail* keys renamed to their new homes (planApprove*, drive*, askHint, closeHint),
  `stepReady` and `planWaitingHint` deleted, new `planEmptyLine`, `planApproveHintEdited`,
  `reviewModeGatesHint`/`EveryHint`, `roleDutyTip`, `termStopped`; `cardReasonText`'s
  awaiting_plan_commit branch reads `ABSENT_REASON_LABELS` (single source, both locales).
- RoleChip tooltip (the duty line); the review-cadence chip swaps its dead `title` for a kit
  Tooltip per mode; `EnterMark` — the visible ⏎ badge on the current primary.
- src/core/order-md.ts: architectPrompt asks for SHORT TURKISH aims (operator console language);
  the prompt body stays agent-facing English.
- E2E: the rail specs re-anchored to `[data-plan-decision]`, `[data-plan-editor-band]`,
  `[data-plan-cards]` (heading Düzenle), `[data-drive-controls]`; new assertions for the
  empty-state card, the dead invitation line, the single Plan iste, and the staged hint's edit
  count.
- docs: ADR-0012 + ADR-0013 dated addenda; CLAUDE.md's two rule lines updated.

Out of scope:

- Locale plumbing for the aim language (an en-locale operator would need the prompt to know the
  UI locale — deferred until a second locale actually drives plans).
- The base-mobile WO-0001 plan's five English aims — the operator hand-fixes them via the editor
  (2 minutes; that repo is not touched by this order).
- Any merge/merge-review UI (merge stays operator-attested at closure — unchanged).

## Acceptance criteria

1. The rail exists nowhere: `ActionRail.tsx` deleted, `[data-rail]` never renders — E2E.
2. Plan proposal: rows carry role chip + aim + scoped ` · repo` and NO status word; the decision
   band carries İtiraz et + Onayla + the consequence hint; Düzenle sits in the heading — E2E.
3. Editor: Vazgeç/Bitti in the same slot as the decision band; no Onayla while editing; the
   empty-aim reason survives Bitti; the staged hint names the edit count ("düzenlenmiş plan (2
   değişiklik)") — E2E.
4. Process control: exactly one Durdur (the live pane header) while running, nothing else in the
   controls; stopped shows "Durduruldu. Rapor kısmi kalır." + ▶ Sürdür — E2E.
5. A closed WO renders no drive controls and no decision band — E2E.
6. The board card reason for an unapproved plan reads "Plan onayı bekleniyor" in tr (the "commiti"
   twin is dead) — code review (no seeded board assertion).
7. ⏎: one visible badge, on the current primary only (Onayla / Bitti / ▶ Sürdür / Yeniden dene /
   Plan iste / Gönder); never on Kapat; no primary while an ask is pending or a drive runs — the
   one exception (2026-08-23, süre şişmesi C katmanı): a plan-mode drive that already DELIVERED its
   plan (the fold says plan_ready) is the approval moment, not work; Onayla keeps the badge.
8. `architectPrompt` requests short Turkish aims; the fence template says `"<short Turkish
   label>"` — unit-level review (core is test-first: the prompt test updates).
9. ADR-0012 + ADR-0013 carry the dated addenda; CLAUDE.md's two lines updated; ROADMAP ticked at
   closure with the merge sha.
10. CI green: typecheck (both), test, build, check:boundaries, test:ui (zero renderer console
    errors).

## Evidence required

- plan_approval: (mode: direct — waived, WO-0005 precedent)
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: reviewer report, `path:line` pointers resolve at head sha
- closure: merged, `ROADMAP.md` updated (commit sha)

## Stop-and-ask gates

- The mockup gate (2026-08-22): the operator approved `docs/ui-mockups/wo-0039-dosya.html` — the design
  contract this order implements. Mid-flight UI rulings stop the session and report.

## Notes

- **Incident (2026-08-23, üçlü plan sunumu — the soft denial backfired):** the denied plan gate
  DID end each turn with a costed result (cost now records ✓), but the SDK streaming conversation
  fed the denial back to the architect, who read it as "check whether the operator approved" —
  it read DOCKET'S OWN SQLite and RESUBMITTED the plan three times (3× plan_saved events,
  17:49/17:50/17:51; cost tripled; the ledger showed an ended card + a live pointer for the same
  session and the pane said "Bitti" while the board said "Çalışıyor"). FIX, twin-armed: the gate's
  deny message is now TERMINAL ("Plan submitted. STOP: end your turn now with no further tool
  calls. Do not investigate approval status, do not resubmit…") and architectPrompt carries the
  matching STOP rule ("After you submit the plan you will receive a stop notice — obey it: end
  your turn immediately. NEVER investigate approval status, read Docket's own files, or
  resubmit") +1 core test. One submission → one turn → one result → one card.
- Operator ruling (2026-08-23, WO-0039/C "Defter &amp; Canlı" — mockup-approved, all app-verified):
  (Q1) ONE live surface — the pane owns the running stream; the ledger's running session is a
  POINTER card (card-level facts + breathing dot + "▸ Canlı oturum"; the click scrolls to the
  pane AND opens its döküm via a nonce signal; step drives jump to their spine row). The ledger
  renders with ZERO persisted rows during a first run, and the aside counts the pointer. (Q2)
  the pane's expanded döküm is DEFINITELY the viewport cap while open (`filled` → h-calc) and
  the flex chain is closed (`min-h-0` on ChatTranscript's root — the chain break CLIPPED the
  lower half of long transcripts); the header/activity/controls sit at learned, unmoving
  positions while the column scrolls inside. Snap open/closed, no height transition. (Q3) ONE
  shared right edge: `.chat > * { max-width: var(--chat-measure) }` (562px — 60ch prose ≈ 85
  mono cols); the frame stays full-width. Polish: tool rows are a GRID [▸][label 7rem][—][detail]
  — the dash sits on one x for every row and the closed row is a single clamped line; the
  activity line carries a cycling ellipsis (`.live-dots`, reduced-motion → static "…"). The
  objection re-plan hole closed: a live drive at the plan stage renders the instrument (only
  the plan_ready wind-down keeps the slim strip — WO-0038's ruling preserved).
- **Incident (2026-08-23, maliyet kaybı — ROOT CAUSE FOUND, SDK-probe-proven):** the earlier
  "incremental cost capture" fix was wrong — SDK typings prove `total_cost_usd` rides the RESULT
  message ONLY; stream messages carry nothing, so the capture could never fire. The real chain,
  reproduced with live SDK probes (probe 3 = the app's shape, probe 4 = the fix): our canUseTool
  fence AUTO-ALLOWED the ExitPlanMode plan gate → the SDK read that as host-approved → the model
  started CODING → the turn never ended → no result message → $0.00 (and the 5s grace abort then
  killed the stream mid-turn, which also loses cost). FIX: the plan gate is DENIED with "Plan
  submitted. The operator will review and decide." — the model ends its turn naturally, the
  result message arrives WITH cost, the stream closes on its own (probe 4: result/success
  cost=0.088). The 5s grace-abort machinery is deleted (nothing hangs anymore); the synthesized
  close survives as the Durdur-mid-plan safety net with honest zeros. Docket's REAL approval
  stays where it always was — the operator's own gate (approvePlan).
- **Superseded incident (2026-08-23, maliyet kaybı — "plan yazıldı ama $0,00 diyor"):** the plan-exit grace
  abort lands mid-turn, where the SDK's result message (the ONLY cost source before) never
  arrives — the synthesized close carried zeros and the pipeline recorded no cost (the honest
  no-claim rule), so real spend vanished ($0.00 · 0→0). Fix: the adapter captures cost
  INCREMENTALLY (the SDK carries cumulative total_cost_usd/usage on stream messages — lastKnownCost
  rides the synthesized close wherever the stream dies), and the pipeline records a REAL (>0)
  synthesized cost while all-zero still records none (+2 pipeline tests).
- Operator ruling (2026-08-23, canlı panel revizyonu — six-part, ui-ux-designer-designed, all
  app-verified): (1) Durdur is kit `xs` (24px + a leading stop glyph — the readout owns the pane
  header; Zorla kes stays sm, the louder escalation); (2) the döküm toggle is a VERB chip
  ("Dökümü aç/kapat" + the tool blocks' chevron, ichip-on when open — "DÖKÜM" named a noun, not
  an act); (3) the SADE line renders an ACTIVITY STATE, never raw content — the per-tool
  progressive verb map (TOOL_VERBS: Dosya okuyor / Komut çalıştırıyor / … + fallbacks
  "Araç çalıştırıyor", "Araç çağrısı"), "Düşünüyor" when composing, the fold's state words when
  not running; (4) the pane card is viewport-bounded (`max-h calc(100dvh-140px)`, the open
  transcript `flex-1` INSIDE it) — the header is pinned by construction, the page stays THE
  scroller; (5) transcript pairing is by `callId` (now carried through the fold — core change,
  +2 runner tests; FIFO fallback for pre-callId rows; a true orphan renders ONE clamped honest
  row "sonuç — eşleşen çağrı yok", never a headerless wall; unknown tools read "Araç çağrısı —
  <ad>" with the name as data); (6) the plan surface is gated on SESSION END, not the plan_ready
  fold — S2 (plan delivered, drive winding ≤5s) shows no plan, the SADE line says
  "Plan hazır — oturum kapanıyor" and Durdur stays armed; S3 (turn_complete OR a mid-grace
  Durdur) lands the plan rows + decision row in ONE transition (also closes the stale-docs.plan
  leak on re-proposals).
- Operator ruling (2026-08-23, "İlk öneriye dön" — same-day replacement of the in-session
  Sıfırla): the editor trio is [BİTTİ ⏎ · ÖNERİNE DÖN · VAZGEÇ] at natural widths (the 92px
  equal-box rule stays the DECISION pair's). Restore returns the work order to the AGENT's
  originally proposed steps — discarding saved AND unsaved operator edits — behind an "Emin misin"
  confirm dialog (danger footer). Mechanism: the FIRST operator overwrite (savePlanDraft)
  snapshots the then-current plan.md into a new `plan_original` table (one row per WO; an
  ADR-0010-line call — it is not the live document, plan.md stays the truth; it is the one
  historical fact git cannot give mid-flight); `savePendingPlan` (a fresh agent proposal) clears
  the snapshot so restore always means "the agent's latest proposal". The button renders guarded
  (dim, inert — kit `locked`) when no snapshot exists or the table already shows it with nothing
  unsaved; the restore writes the original back as the pending plan (plan_saved ·
  "ajanın ilk önerisine dönüldü"), gate untouched, editor closed, detail reloaded. e2e: the
  full save → confirm → original-returns flow.
- Operator ruling + incident (2026-08-23, "Bitti = kaydet"): the editor's stage lived only in
  memory — edit → Bitti → board → back silently reverted to the OLD plan (the component unmount
  destroyed the drafts; only Onayla ever wrote plan.md). Bitti now PERSISTS a valid stage as the
  PENDING plan (new `savePlanDraft` port method → store `savePendingPlan` write + a plan_saved
  event, detail 'operator-edit' → timeline copy "operatör düzenlemesi"; NO gate flip — approval
  stays its own act). Empty-aim / fence-less stages still close the chrome only (unwritable);
  Esc keeps its old meaning (chrome closed, drafts in memory — the edited:N approval path).
  Vazgeç now discards UNSAVED edits only; reopening re-seeds from the saved proposal. E2E: the
  exact regression (edit → Bitti → board → back → persisted) is asserted.
- Same-day fix (the drop's "animation resets"): the rows were keyed and sortable-id'd by POSITION
  (`idx`) — the drop renumbered the keys, React REMOUNTED the row instead of moving it, and every
  transform collapsed at once (the snap). The stage now carries a STABLE `uid` per row (minted on
  seed/add, riding reorders; `applyStepEdits` serializes role/aim/scope explicitly so the uid
  never reaches the fence); React keys, sortable ids and `moveStep` all use it — DOM-verified the
  marked node MOVES to its new slot (`sameNodeMovedTo` probe) and the drop settles in place.

- Operator ruling (2026-08-23, eighth pass — drag-and-drop): the editor's ▲▼ pair died for a GRIP
  drag (@dnd-kit core+sortable+utilities, MIT — chosen for its KeyboardSensor: Space lifts, arrows
  place, Space drops, so reordering stays reachable without the buttons). The grip is the only
  drag surface (the aim input keeps its pointer events; a 4px activation distance kills accidental
  lifts); the drop calls the pure core `moveStep(from, to)` (test-first, renumbers the 1-based
  idx); ✕ stays guarded. The grip's grab/grabbing cursors live in index.css's `.grip` (the
  semantic-class home, ADR-0012 — and the cursor property's own name is a stop-and-ask hit in code
  files by the vendor grep's design). dnd-kit's announcements/instructions are bundle copy
  (tr/en); the shift animation dies under reduced-motion. E2E drags with the real mouse (lift
  needs a small move + beat before the travel).
- Operator ruling (2026-08-23, seventh pass — the editor state): while editing, the decision pair
  (Onayla + İtiraz et) stays VISIBLE, inert — the kit's attribute-free `locked` form (the
  ADR-0001 terminal-lock exception; a `disabled` attribute stays CI-banned), no ⏎ (Bitti owns
  it) — and Bitti + Vazgeç render in DÜZENLE's heading slot instead of replacing the decision row.
  The decision position never empties; the heading keeps one action position. The empty-aim copy
  follows: "doldurunca Onayla açılır" (it unlocks, it no longer "comes").
- Operator ruling (2026-08-23, order.md view): the creation template's UNFILLED skeleton sections
  (Context's _(added during planning)_ placeholder, Scope's bare In/Out lists, Acceptance's bare
  "1.") render nowhere — the İş emri document view shows filled sections only
  (`stripUnfilledSections`, +4 core tests; one real line saves a section). The FILE is untouched
  (the repo keeps its template discipline); the view's section count follows the view text. The
  deeper question — whether the creation template should emit those sections at all, and who owns
  an order.md's richness (the architect cannot fill them in read-only plan mode) — recorded as a
  product discussion, deliberately not decided here.
- Operator ruling (2026-08-23, "boş başlığı da sök"): the Plan document view strips a trailing
  "## Steps" heading whose only content was the fence — after the fence leaves the prose (it
  renders as the PLAN HAZIR rows), the dangling heading read like a truncated document ("devamı
  yok"). `splitStepsFence` drops it (+2 tests); a heading that still carries text after the fence
  is a real section and stays.
- **Incident (2026-08-23, döküm kaybı — "plan kartına tıklıyorum detay açılmıyor"):** the running
  transcript lived only in the pane's memory — record() checkpoints fire solely at started / asks /
  turn_complete / close, so a plan drive that never asks and never completes (the süre şişmesi
  hang) had ONE empty 'started' row; the restarts during this order's UI passes killed the memory
  fold, and the post-restart stop's final record wrote `transcript: []` over the row (the upsert
  is DELETE+INSERT with no merge rule for the transcript). The ledger card renders no body for an
  empty transcript ("the toggle is honest") — hence "detay açılmıyor". Fix (operator-approved;
  the ledger's body is THE AGENT'S RECORD — what it did, tool call by tool call — never the plan
  document, per the operator's same-day ruling that rejected the document body):
  (1) the pipeline checkpoints `record('running')` on EVERY tool_result — the fold lives in the
  row, restarts lose nothing (+1 pipeline test); (2) the store's transcript column joins the
  monotonic columns — the LONGER row wins, a late short/empty record can no longer wipe a fuller
  checkpoint; (3) a session whose transcript never persisted (the pre-checkpoint rows) opens with
  ONE honest line ("Döküm kaydı yok.") instead of reading broken (+e2e).
- **Incident (2026-08-23, süre şişmesi — found on the WO-0001 base-mobile pilot):** the plan
  session showed 34dk 34sn for ~4dk of work. Root cause chain, DB-proven: the architect delivered
  the plan at 22:04:40 (`plan_saved`), but an SDK plan-mode stream does not END at ExitPlanMode —
  it awaits an in-session plan approval Docket never gives (approval is the operator's host action,
  `approvePlan`), so the drive loop hung open; the operator's stop 31 minutes later ran the
  completion guarantee, which stamped `ended_at = new Date()` — billing the idle deliberation as
  session time. Fix, four layers (operator-approved A+B+C+D): (A) the adapter aborts a plan drive
  5s after ExitPlanMode when no result follows — the AbortError path + the existing synthesized
  plan-exit `turn_complete` close the session at its last real activity; (B) the core pipeline
  stamps `ended_at` at the LAST ACTIVITY moment, never at the (possibly much later) close — 2 new
  pipeline tests; (C) the decision row no longer stands down while a delivered plan awaits the
  operator (the fold's `plan_ready` is the approval moment, not a re-plan — Onayla stayed hidden
  for the whole wait before), and a failed approval toasts instead of dying as an unhandled
  rejection; (D) the pilot's session row repaired to the `plan_saved` moment (22:04:40).
- Operator ruling (2026-08-23, first hands-on pass): the bare plan stage is ONLY the Plan iste
  button — "henüz plan yok yazmaya gerek yok, arka plan olmasın; plan iste butonu yeterli". The
  header band's phase line already states the condition; ADR-0013 carries the dated ruling.
- Operator ruling (2026-08-23, second pass): the live plan pane joins the session cards' özet→döküm
  grammar — SADE body (one truncated activity line, the running dot, the drive's own `$ · ⏱`
  costline in the header), the full Ray column behind the ▸ döküm toggle. The old firehose default
  rendered every tool call and wrapped path walls ("sade detay gibi görünüş olmalı").
- Operator ruling (2026-08-23, sixth pass): the decision pair is EQUAL-SIZED (both min-w 92px —
  DOM-verified identical) and İtiraz et wears the kit SIGNAL variant (amber — the operator-judgment
  action, the ask cards' allowAll grammar; red stays the machine stop); the heading's Düzenle went
  GHOST (borderless, dim — the bordered box read loud beside the readout). The editor and objection
  pairs share the same equal-width treatment.
- Operator ruling (2026-08-23, fifth pass + same-day correction): Onayla and İtiraz et sit SIDE BY
  SIDE on the left (the primary leads — not split to the edges); the editor mirrors it (Bitti +
  Vazgeç adjacent); the gate reason flows after the pair. The objection layer was redesigned in the
  current idiom (breathing signal lamp, readout, full-width input, GÖNDER ⏎ + Vazgeç adjacent) and,
  while it is open, the decision row stands down and ⏎ IS Gönder — Enter can never read as Onayla
  from behind the layer (the reported ambiguity dies; both focus paths — in-input and body — now
  send the same action).
- Operator ruling (2026-08-23, fourth pass): the standing consequence lines DIED
  ("Onayla — adımlar sırayla koşar. kaldır") — `planApproveHint`/`planApproveHintEdited` deleted from
  both bundles; the decision row's buttons sit LEFT (the lone Plan iste's position), and the only
  line the row may carry is the GATE reason (an empty aim — Onayla's absence must say why,
  ADR-0001), flowing after the buttons. The staged edit count lives in the record (plan_approved
  `edited:N`), not on the row.
- Operator revision round (2026-08-23, third pass, ui-ux-designer-reviewed): ONE DECISION POSITION —
  İtiraz et + Onayla (and the editor's Vazgeç + Bitti) render in the slot Plan iste occupies, ABOVE
  the plan section (the band under the rows died); İtiraz et = secondary (rework, not loss); Durdur =
  danger (the machine's E-stop; Zorla kes is the escalated red, states never co-render); the decision
  row stands down while a drive rewrites the plan; every editOpen flip scrolls the row into view.
  ChatTranscript: NOTHING auto-opens anymore (WO-0037's live-edge auto-open reversed — output
  strictly on click; a failed-and-closed block carries a steady red dot), expanding scrolls the
  block into view, and the jump chip is a 28px circular icon button ("En alta git" in the label).
- The accepted trade on record: Durdur scrolls away with the pane (full-removal ruling). If it
  hurts in practice, the fallback is a slim live indicator on the header band — observe first.
- The WO-0038 ruling stands at the idle plan-approval moment (no instrument while a plan is on the
  table); the plan-stage drive strip renders ONLY while a drive is live there.
- The KAPILARDA tooltip is the first place the cadence is explained anywhere in the app; the
  copy lives in the bundles, per ADR-0007.
- **Stabilization round (2026-08-23, plan-stabilization.md executed — the overwrite incident's
  remainder):** the P0 trio + P1 + P2, all chain-verified (typecheck ×2, 528 vitest, build,
  boundaries, E2E suite green incl. the 4 pre-existing reds repaired): (1) the STORE GUARD —
  `savePendingPlan` refuses to overwrite a plan that PARSES with one that does not
  (`parsePlanSteps` both sides, mechanical; a new `plan_save_refused` wo_event kind — schema CHECK
  widened + migration + timeline labels — records the refusal; the `plan_original` snapshot
  survives a refusal too); (2) architectPrompt's resume rule — "If your session resumes AFTER the
  plan-submission stop notice, do NOT call ExitPlanMode again — answer in one short sentence and
  end your turn" (+1 core test; the incident's re-entry resume submitted "bekliyorum" via a second
  ExitPlanMode); (3) the question-card gate — `showQuestion` requires NO plan on disk
  (`planOnTable={!!docs.plan}` at both the controller and SessionPane; a plan on the table IS the
  answer — "Mimar seni bekliyor" + Yanıtla never renders over one, whichever resume path fired);
  (4) the gate-denial classifier — an orphan tool_result matching `/^Plan submitted\./` renders the
  "Mimar planını sundu" sys line (the approved/rejected classifiers' twin), killing the
  "→ sonuç — eşleşen çağrı yok" row; (5) WO-0001's plan.md RESTORED in base-mobile from the agent's
  own plan file (`~/.claude/plans/you-are-the-architect-wild-hanrahan.md` — 3 steps re-parse ✓,
  operator approval pending). P1: an intentional interrupt now ends as STOPPED, never the fail
  card — the runner carries the interrupt's INTENT (`interruptRequested`): post-interrupt throws
  of ANY shape and error-shaped result messages are the abort's echo (swallowed), and a stream
  closed without turn_complete emits the new `interrupted` RunnerEvent → the fold's new
  `'stopped'` status (LiveSessionStatus + `deriveTurnState` + SADE line + labels tr/en) → "Durduruldu.
  Rapor kısmi kalır." + ▶ Sürdür; the pipeline records the session idle (no step report, no
  verdict — a stopped step stays 'active' for Sürdür; +2 fold tests, +3 pipeline tests, +2 turn
  tests, E2E assertions: no fail card / crash line / error glow after Durdur). The e2e fake
  runner's interrupt now emits the same `interrupted` event (with its scripted cost) instead of a
  fake turn_complete. P2: ADR-0014 written — one adapter per vendor over a machine-readable mode
  (SDK or stream-json), terminal scraping rejected on this session's evidence (cost rides the
  result message; the plan gate emits pseudo-results; fences need canUseTool interception; xterm
  retired WO-0037); the raw-transcript-as-display-only-attachment hybrid is on record, not
  decided. E2E repairs in the same round (pre-existing reds from the uncommitted tree, not new
  regressions): the locked-Onayla probe force-clicks (pointer-events:none is unhittable by
  design), the F7 spec re-anchored to the 2026-08-23 contract (the header's "Düşünüyor" IS the
  empty-run state; the second line is dead), the chat spec opens the döküm + the tool block by
  CLICK (the nothing-opens-itself ruling), the tool-header assertion split to the grid's two
  cells, and the ledger count-aside assertion inverted (the aside is dead — the cards are the
  count).
- **Operator-found, same day (the re-entry DUPE — "oturum dökümünde 2 plan gözüktü"):** live-run
  verification of the stabilization build surfaced the ledger's identity hole: while a drive runs,
  the pipeline's checkpoint writes a `running` session ROW, and a detail re-entry loaded that row —
  so the ledger rendered the row's card (auto-opened, "Çalışıyor · 0ms") BESIDE the live pointer
  card ("Çalışıyor · 18sn · ▸ Canlı oturum"): one live session, two cards, two durations. Root fix
  (operator ruling: "kökten çözülmesi lazım, arkaplanda çalışmalı"): IDENTITY MERGE — the
  controller passes the live drive's provider session id (`store.sessionId(driveKey)`) into the
  record stack, and a ledger row carrying that id renders AS the pointer, in its own sorted
  position (WO-0039/C Q1's own "ONE live surface" principle applied to the row); the appended
  pointer survives only for the boot window before the row exists. One session, one card, whatever
  the reload timing; the background drive itself was never the problem (the app-level store keeps
  it running across navigation — the spec asserts the pane still carries the one Durdur after the
  re-entry). +E2E spec reproducing the exact repro (Plan iste → leave → come back → exactly one
  card, the pointer).
- **Operator-found, same day (round 2 — the re-entry AUTO-START + the stale archived döküm):** two
  more live-run findings. (1) "Geri dönüp tekrar girince otomatik ajanı çalıştırıyor": `autoPlanFor`
  (the "Oluştur ve plan iste" flag) was set once and NEVER cleared — every re-entry of that work
  order re-fired the architect auto-start (a stopped session restarted itself on the next visit;
  this also explains the first dupe report's running row). The flag is now ONE-SHOT: the App clears
  it the moment the named detail's DATA arrives (the commit where DetailScreen mounts — child
  effects run first, so WorkOrderDetail consumes the true prop exactly once; clearing on
  selectedId alone was too early — the detail mounts a load later, and the flag died unconsumed).
  +E2E: the create+plan spec re-enters and asserts no Çalışıyor, no Durdur. (2) "Durdur dedim,
  oturum dökümündeki güncel değil": the archived card's transcript ended at the last tool_result
  checkpoint — the stop's punctuation (⏸/■) is live-only by the WO-0031c ruling and never reached
  the ledger. The `interrupted` event now APPENDS the session's own fact line to the fold's
  transcript (`note · interrupted` → "⏸ oturum durduruldu"; the pipeline records after folding, so
  the row carries it — the operator-side ⏸/■ notes stay live-only; this line is the session's
  fact, not Docket commentary). +fold test, +E2E (the settled card opens with the stop line).
- **Operator ruling + fix (2026-08-23, round 3 — "devam et butonu gidiyor… arkaplanda kalmıyor",
  proposal approved):** the Sürdür OFFER now DERIVES from durable facts, never screen memory. (1)
  In-app re-entry: `stoppedNow = stopped || fold.status === 'stopped'` — the controller flag covers
  the just-wound-down moment, the app-level fold (durable since the `interrupted` event) covers
  every leave-and-come-back; ▶ Sürdür + "Durduruldu. Rapor kısmi kalır." survive navigation (the
  stopped READOUT is gated to the stopped moment — not the resume's boot window, where the fold
  stays 'stopped' until the resumed drive's first event). (2) Across app restarts (the fold dies
  with the renderer): the empty-state button's LABEL is derived from the rows — a persisted
  architect plan session (role architect, no stepIdx, providerSessionId) means requestPlan RESUMES
  it, so the button says "▶ Sürdür", not "Plan iste" (the behavior always resumed; the label lied).
  Diagnosis on record: the WO-0001 plan.md restore was wiped by the operator's own Sil +
  yeniden oluştur cycle at 23:41 (deleteWorkOrder removes the WO FOLDER — the documented cascade;
  wo_event shows a single fresh `created`); the agent deleted nothing. The recreated WO stays
  plan-less; the recovered plan file remains at
  `~/.claude/plans/you-are-the-architect-wild-hanrahan.md` if re-placement is wanted. +E2E: the
  dupe spec's tail now leaves → re-enters → asserts the Sürdür offer → resumes (Durdur returns);
  the six later exact-'Plan iste' clicks went label-tolerant.
- **Operator ruling + fix (2026-08-24, round 4 — "state orada yanlış, hepsi senkron olmalı",
  proposal A–D approved):** the STOPPED fact is now a DURABLE session fact, and every surface
  derives from it. (A) `SessionRef.status` gains **'stopped'** — the interrupted close records it
  (not 'idle'; the session-table CHECK widens + a rename/recreate/copy migration); (B) the board
  card reason for a WO with a stopped session row is **"Oturum durduruldu"** (new `session_stopped`
  CardReason; a running row still outranks it — it sat at "Plan onayı bekleniyor" over a plan that
  did not exist); (C) `derivePhase` reads the sessions: planning + a stopped row →
  **"Plan önerisi durduruldu"** (new `plan_stopped` phase; the phase dot goes calm; plan_ready
  still outranks it); (D) `seedLiveState` maps a stopped ROW to the fold's 'stopped' — after an
  app RESTART the "Durduruldu — istersen sürdür" turn line and the Sürdür offer derive too (the
  fold's memory dies with the renderer; the row does not). Plus the flagged cost honesty: the
  board card draws its `$ · tokens` segment only when some session actually carried an observed
  cost (`costKnown` on the card view) — a summed $0,00 over zero observed rows was a claim
  (TD-030's rule, now on the card; an interrupted drive's unrecorded spend stays honestly absent).
  Found the hard way: the first run of (A) threw inside the record (the old session CHECK rejected
  'stopped') and the pipeline's catch surfaced it as a fail card — the probe (turn="Yeniden dene")
  caught it before the operator did. +5 core tests (phase, card reason, seed, pipeline record),
  +E2E (phase line, board reason, no $0,00).
- **Operator ruling + fix (2026-08-24, round 5 — "hangi saniye… onun dışında olmuş gibi duruyor" +
  the completed session's missing lifecycle, proposal approved):** the transcript is now a TIMELINE.
  The lifecycle events carry an ISO receive-time stamp (`started`/`turn_complete`/`interrupted` gain
  `at?` — the adapter stamps, the e2e fake too), and the fold turns each into a CLOCKED note:
  **"● oturum açıldı — 02:22"** (started; a resumed session accumulates one per run — the multi-run
  timeline), **"■ oturum bitti — 02:24"** (turn_complete — a completed session used to show only its
  work, no lifecycle at all), **"⏸ oturum durduruldu — 02:23"** (the existing stop line, now
  clocked). The notes ride the event stream, so BOTH the live pane and the archived card carry
  them; the clock renders through the locale's auditClock. The UI's own ⏸/■ notes gained clock
  prefixes (composed display-side). Also (operator: "0 lar gözükmesin"): a document row with ZERO
  `##` sections draws NO count (a fence-only plan read "0 bölüm" — noise, not information). Test
  fallout worth recording: the e2e fake runner's constant `e2e-<role>` session id let a later drive
  on ANOTHER work order inherit a foreign transcript (the store's upsert is global by provider id;
  the longer-transcript-wins merge then kept it) — the fake's ids are now per (work order, role),
  matching the real SDK's never-reuse; re-drives on the same WO still share the id (the
  resume-like single accumulating row). +2 fold tests, +2 transcript expectations updated, +3 E2E
  assertions.
- **Reviewer round (2026-08-24, pre-merge — the reviewer agent over the full pending diff):** no
  blockers; four low-cost fixes landed: (1) the dnd-kit screen-reader announcements read `Number(uid)`
  = NaN since the stable-uid rekey — they now resolve the row POSITION (same resolution as
  onDragEnd); (2) the stale-rail comment sweep (DetailScreen/SessionPane/useDetailKeys/WorkOrderDetail
  headers still described the dead rail as the live schema; the dead control name Sıfırla → Önerine
  dön); (3) `mockups/` moved to the repo's conventional `docs/ui-mockups/` home (order.md refs
  updated); (4) the store gained its own unit test file (`src/adapters/store/store.test.ts`, 7
  tests): the parse-guard + `plan_save_refused`, the plan_original lifecycle (a REFUSED save keeps
  the snapshot), the longer-transcript-wins merge, the work-order-scoped upsert (the e2e incident's
  structural close), and the session CHECK migration against a real old-shape DB — the exact
  live failure round 4 hit. Hardening on the reviewer's record, also landed: the session rebuild
  migration is transactional (BEGIN IMMEDIATE/COMMIT — a crash mid-rebuild can no longer orphan
  `session_legacy` beside an empty recreated table), the synthesized plan-exit turn_complete carries
  its `at` stamp, and the gate's deny message lost its in-the-wild parenthetical (tokens spent
  naming the artifact the agent must not investigate). Recorded, deliberately NOT changed: the
  silent void refusal (`savePendingPlan` returns nothing — the UI's session-end gating already
  keeps the degenerate text off the plan surface; a boolean return is a future port widening), and
  the App's one-shot `autoPlanFor` clear holding if the detail LOAD fails (the next entry of that WO
  auto-starts once — a real-but-rare edge, named).

## Closure

Merged PR #45 (`921d386`, 2026-08-24) — the mega-WO (the rail dissolution, operator-approved on the
mockup) and the five stabilization rounds its live testing drove, in one branch: the overwrite
incident's guard trio, the durable 'stopped' session fact with every surface deriving from it, the
re-entry repairs (one-shot auto-plan, the ledger identity merge, the fold-derived Sürdür), the
clocked transcript timeline, and ADR-0014. The reviewer agent swept the pending diff pre-merge: no
blockers; the NaN drag announcements, the stale-rail comments, the mockup home, the store unit suite
(6 tests incl. the CHECK migration the live run had broken), the transactional rebuild, the stamped
synthesized close and the lean gate message all landed in the same commit. CI green on the PR (check
+ GitGuardian); locally typecheck ×2, 540 vitest, build, boundaries, E2E 45/45 with zero renderer
console errors. Deliberately not changed, on record in the Notes: the silent void refusal (a future
port widening) and the one-shot clear's failed-load edge.

_Closed 2026-08-24 at 921d386._
