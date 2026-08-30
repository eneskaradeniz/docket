# ADR-0013: The single-view dossier console (DOSYA)

Date: 2026-08-22 · Status: accepted · Supersedes: the dual-view rulings of ADR-0005 (SADE/DETAY
surfaces), the WO-0031f v6 Akış|Kayıt structure, and ADR-0012 r5's "SADE stays calm" clause (as
restated below — r5's motion budget itself survives unchanged).

## Context

The work-order detail screen had accumulated three standing layout decisions before reading a single
line: the SADE|DETAY global mode, the Akış|Kayıt tab pair (or the ≥1080 rack), and the substrip's
segment jump. The operator's radical ruling (2026-08-22, after a mockup tour over the operator's real
WO-0001 data and several in-app iterations): remove the dual view entirely — "kullanıcı dostu,
kullanıcıyı yormadan, temiz, sade, minimal". The same day's companion rulings: documents collapse to
rows (full-prose walls died), the plan proposal collapses to 32px rows, the standing evidence
showcase dies (evidence is contextual: the close card's checklist, and a gated action's reason line
at the moment it matters), and session history renders as CARDS whose aç/kapa is the old
SADE/DETAY distinction reborn — closed = özet (the artifact headline), open = the full Ray transcript
(WO-0037).

## Decision

The detail screen is ONE scroll at every width — a dossier, read top-to-bottom as
**what needs you → what is proposed → the live instrument → the record**:

- **Header band** (the old strip + substrip merged, ~46px): the turn state lives in a 3px lamp spine
  on the band's left edge (amber breathing = sıra sende) plus the phase readout; the sr-only
  `aria-live` turn announcement survives; the step progress hairline survives at the band's bottom.
- **One column, no forks**: no view mode, no tabs, no rack, no `useDetailLayout` breakpoint. The
  record sections (Belgeler · Kaynaklar · Oturum dökümü) are sections of the same scroll.
- **Belgeler are collapsed rows** — human name + filename pointer + section count; expansion is the
  `.repbody` idiom, height-capped. No derived teasers (a wrong guess is worse than none).
- **The plan is rows, not cards**; the editor edits IN those rows. Its commit model is honest:
  drafts stage and survive Bitti; Vazgeç is the only discard; İtiraz clears the stage; Onayla is
  absent while the editor is open (deciding happens after editing). Role choice is a picker
  (recognition), not a cycle ring.
- **Evidence is contextual, never a standing showcase** (amends ADR-0001's presentation of the
  evidence-gated pipeline): the close card carries the checklist; a gated action states its reason
  where it would have appeared. The gate MECHANISM (core derivation, order.md's Evidence required,
  the store) is untouched — and is now ENFORCED at the pipeline layer (`SessionStore.planApprovedFor`:
  step/review drives are refused with an error event before the runner spawns while the plan gate is
  closed; the 2026-08-22 incident showed the UI derivation alone is not a guard when the store
  deliberately parses a plan's fence into 'pending' rows before approval).
- **Sessions are cards**: meta (role lamp · name · range · duration · cost) + the artifact-headline
  özet (plan → the fence's count, review → the verdict, step/free → the agent's closing sentence)
  + the full transcript one click away. History sits closed; the running session's card opens
  itself.

## Consequences

- `view-mode.tsx`, `Substrip`, `DetailBody` (tabs/rack), `useDetailLayout`, `PlanApprovalCards` and
  `AuditTable` are deleted; the record's E2E hooks move to the card surface.
- ADR-0012 r5's clause "SADE stays calm" is restated: the calm surface is now the CLOSED CARD (özet
  only, no motion) — the motion budget (one 400ms live-append wash on reading variants, reduced-motion
  kill) is unchanged.
- Scanning a long implementation run means scrolling past the plan spine to older session cards;
  accepted (the driven row carries its live chat inline — the live thing travels with its step).
- Deferred: a Zaman (event timeline) section — the detail view has no event data wired; the stored
  stream and its port are untouched.

## Alternatives rejected

- **The focused pair** (chat pinned left, docket scrolling right): best live-session reading, but at
  980px it is cramped, at 760px it collapses to the single scroll anyway, and it re-introduces the
  "two places to look" fatigue the ruling targets.
- **Keeping SADE/DETAY for the transcript only** (a per-card toggle): rejected by the operator's
  simpler form — the card's own aç/kapa IS that distinction.

---

**Addendum (2026-08-22, WO-0039 — the rail dissolves, decisions go contextual):** the DOSYA scroll
no longer ends with a rail; `ActionRail.tsx` is deleted. Its two jobs split by nature: DOSSIER
DECISIONS render in the flow they decide on — İtiraz et + Onayla in a decision band directly under
the plan rows (the rail's message-left/actions-right grammar, inherited), Düzenle in the "PLAN
HAZIR" heading, Plan iste in an empty-state card (1 line + ≤1 action; the SessionPane's invitation
line and ActionCard's plan-stage branch died with it — exactly one Plan iste on the screen), Yeniden
dene on the fail card, the ask hint on the ask stack, the close hint inside the close card. PROCESS
CONTROL (Durdur / Zorla kes / ▶ Sürdür) rides the LIVE pane's header (`DriveControls`) — including
a slim plan-stage strip for a live re-planning drive while a plan is on the table (the WO-0038
"no instrument at the approval moment" ruling stands for the idle moment). The operator took the
full-removal ruling over the designer's split recommendation, accepting the trade on record:
Durdur scrolls away with its pane; the always-visible header band (turn lamp + phase line) and the
global ⏎ compensate. The proposal rows also lost their constant "hazır" column (zero information)
and gained the scoped row's repo suffix (StepList parity); the architect prompt now asks for short
Turkish aims (the aim is operator display text, rendered verbatim — ADR-0007's tension resolved at
the producer).

**Ruling (2026-08-23, first hands-on pass of WO-0039):** the bare plan stage carries ONLY the Plan
iste button — the "Henüz plan yok." empty-state card died on the operator's hand. The header band's
phase line already states the condition ("İş emri yazıldı — plan iste"); a line echoing it is
background noise. One action, zero lines.

**Addendum (2026-08-25, WO-0044 — one live grammar; the ledger is pure history):** the first REAL
step-drive dogfood (base-mobile WO-0001 run inside Docket) re-ruled two prior clauses, superseding
them dated (their text stands above). Revised same day by the tur-2 addendum below where noted.

- **"The running session's card opens itself" (this ADR) and WO-0039/C's Q1 pointer clause are
  REVERSED**: the ledger ("Oturum dökümü") is PURE HISTORY — a running drive carries NO card there at
  all (not the self-opening card, not the "▸ Canlı oturum" pointer; the pointer duplicated the driven
  row's live facts one scroll below in a grammar the completed cards do not speak). A session joins
  the ledger as a plain card the moment it ends; a first plan run renders no ledger (the empty group
  is absent, ADR-0012).
- **The ONE live surface is the driven row's instrument, and it speaks ONE grammar** — the
  SessionPane form WO-0039's 2026-08-23 revision gave it, now shared in `pane-chrome`
  (`usePaneActivity` + `PaneLogChip` + `usePaneLog`): the header row `● ROL — <etkinlik fiili>` +
  costline + DriveControls + the "Dökümü aç/kapat" chip, the Ray column BEHIND the chip, closed by
  default. StepPane's always-open inline transcript (v6's "never hidden behind a toggle" comment)
  and ReviewPane's toggle-less form died with it — three live surfaces, one language. The live thing
  still travels with its step (the accepted trade above stands); its DETAIL is one click away.
- **The ActionCard is absent while a drive is live, and never renders the resume intent** — the
  read-only "Çalışıyor / Oturumu sürdür" pairing was the label of a button that died in WO-0027,
  reading as a standing offer; Sürdür lives only in DriveControls ('▶ Sürdür', ⏎'s target).
- Word ownership, once each: "Çalışıyor" the WORD lives in the header band (lamp + sr-only line);
  live surfaces speak in activity verbs ("Dosya okuyor…"); the implementation phase line carries
  only the count ("0/2 adım" — the stage badge says the word); the driven row's meta carries its
  scope only; the review cadence chip names itself ("Denetim: kapıda"). (Revised by tur 2 below:
  the row's meta reopens with its state word — "Aktif", not "Çalışıyor".)

**Tur-2 addendum (2026-08-25, same day, mockup-approved `docs/ui-mockups/wo-0044-live-top.html` —
the operator drove a real review session on the tur-1 build and re-ruled the layout):**

- **The live instrument rides at the TOP, band-adjacent — every drive kind (step, review,
  plan/free).** This reverses both ADR-0013's "the driven row carries its live chat inline" trade
  and tur 1's "the live thing travels with its step" restatement: finding the live thing meant
  scrolling INTO the spine mid-run. The architect's live plan pane's old seat is the one seat.
- **The spine below is a pure STATUS list**: every row's meta opens with its state word —
  "Aktif" (the operator's word; TRUE even for an interrupted step, where "Çalışıyor" lied) ·
  "Bekliyor" ("sırada" flattened) · done keeps "tamam · ⏱ · $" + ▸ rapor. The driven row carries
  no pane and no live detail.
- **The record cards declare themselves**: the session card's first line is the KİM — ROL readout
  (`PLAN — MİMAR` · `ADIM 1 — UYGULAYICI` · `İNCELEME 1 — MİMAR` — the role word in its role hue,
  the 3px role edge, the step's aim on its own line), and every record card (session + document
  rows) wears the visible `--bord` edge — the same brightened hairline `.steprow.owner` uses; flow
  surfaces (step rows, the instrument) keep the plain hairline. "Whose session is this" reads at a
  glance; nothing floats frameless.

**Addendum (2026-08-27, WO-0047 — the budget gate joins the spine):** the workspace BUDGET gate is
pipeline-enforced exactly like the plan gate (`SessionStore.budgetBlockFor`, read at spawn time
ONLY): when the calendar-month spend of the drive's workspace meets its configured cap, EVERY
drive — plan, step, review, resume — is refused with an error event (carrying the refusal's facts:
observed + cap) before the runner spawns; a drive already running when the cap is crossed is never
touched (the refusal applies to the next drive; the surfaces say so). The refusal's surface is the
TWO-CHOICE card in the decision stack (raise-and-re-run / keep-the-cap — Paperclip's shape; no
third path, no force flag anywhere), and while it owns the moment NO instrument renders — there is
no transcript to read. The warn level (a percent of the cap) is an informative mono line on the
board card and the header band (ADR-0012's voice: text, never a fill bar; the known-spend basis
"bilinen harcama" stated when any in-window session row carries no recorded cost). Raising the cap
is a PERMANENT `app_setting` write that re-runs the refused drive (operator rulings 2026-08-26) —
never a host-side work-around.

**Addendum (2026-08-27, WO-0050 — the roadmap screen carries the console's SECOND live surface):**
`RoadmapPane` — the ✦ architect draft session, workspace-scoped (WO-less) — speaks the shared
pane-chrome grammar verbatim (activity verb line + costline + DriveControls + the döküm chip);
its header readout is the draft identity `MİMAR — TASLAK`, never a role word. A draft never
overlays a board card (the drive store's active snapshot stays WO-keyed — ADR-0016's locked
ruling 3). The roadmap head meta states `taslak sürüyor` while the draft runs — the honest
minimum when the operator leaves the surface: the pane unmounts, the drive survives in the
app-level store (the WO-0028 precedent), and a background draft ask toasts and switches to the
roadmap surface. Permission asks and the architect's text question surface as cards on the
roadmap screen itself, and the pane stands down while the budget refusal card owns the moment
(the instrument-selector rule, applied to the second surface). The TASLAK decision card — the
plan approval card's sibling: parsed per-faz preview, Onayla (the parse-guarded write; the
commit stays the operator's) / Düzenle (the structured editor over the fence) / İtiraz et (a
resume of the same provider session with the operator's note).

**Addendum (2026-08-28, WO-0051 — the chip grammar descends to the TASLAK card):** the finished
draft's transcript is one `Dökümü aç/kapat` away — the card head carries the `PaneLogChip`
grammar (default closed; only when a session row exists), and opening reveals a SIBLING log
surface below the card: the identity line (`MİMAR — TASLAK · clock · kaynak: N belge · M ek ·
$ · duration` — the counts' one honest echo, omitted honestly on pre-WO-0051 rows) + the
archived transcript (the `SessionCards` precedent). This is the card-level twin of the pane's
chip — TD-057 closed — and the record-card stance is unchanged: the draft session still never
enters a ledger, and after Onayla the roadmap file + git is the record (ADR-0010), the window
dying with the card.

**Addendum (2026-08-30, WO-0055 — agent-task rows live INSIDE the chip grammar):** the provider's
agent-task lifecycle renders as TRANSCRIPT CONTENT behind the existing `Dökümü aç/kapat` chip —
a composite tool block (the delegation call adopting its task: the task's own words in the
detail slot, the running lamp watching the TASK's status, the end digest filling the body until
the real report wins the pair), with the subagent's own rows nested INSIDE that block. It is
not a second live surface, not a pane, not a ledger card; the session cards and the draft card
re-nest identically through the same components. The activity verb line gains exactly one
precedence arm (running agents, between staleness and the tool verb); ambient/housekeeping
tasks (`skip_transcript`, `local_bash`) never render. The one live-edge exception to "nothing
opens itself": a RUNNING agent's children stay visible (clamped); once ended they collapse
behind the click like every other output.
