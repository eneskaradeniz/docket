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
