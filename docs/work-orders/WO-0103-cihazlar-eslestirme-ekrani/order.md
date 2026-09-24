---
id: WO-0103
title: "Cihazlar → Eşleştir — the desktop pairing screen: paired-device list with revoke, a QR carrying endpoint + one-time token, and the 6-digit manual fallback"
workspace: docket
status: open
review: light # light | full
mode: direct # plan | direct
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0103 — Cihazlar → Eşleştir

**BLOCKED-BY WO-0102** — this order opens only after WO-0102 merges (it consumes 0102's IPC
channels; with 0102 open there is nothing to render). Do not start it earlier.

## Objective

ADR-0020 #3: the desktop shows, the phone scans. This WO is the desktop half of pairing: the
Cihazlar surface (Ayarlar modal section — app-level, not workspace-scoped) listing paired
devices with revoke, and the Eşleştir flow rendering a QR that carries the endpoint plus the
one-time token, with the 6-digit manual code beside it. It consumes WO-0102's IPC — mint
grant / list devices / revoke device — and adds NO new core surface, no new main-side logic.

## Scope

- The Ayarlar "Cihazlar" section: the paired-device list (name, last-seen, revoke), the empty
  state (one invitation line + the ONE Eşleştir action, ADR-0012), and the kill-switch row
  reading/writing `remote:enabled`.
- The Eşleştir dialog: the QR (a small pure-JS QR encoder dependency in the renderer — no
  vendor-name issue, c3-safe) rendering 0102's pairing payload, the 6-digit code in mono
  beside it, the TTL line ("Kod 5 dakika geçerli"), a fresh grant on expiry or re-open.
- Label-bundle entries tr/en (same keys both, compile-time completeness): `devicesSection`
  ('Cihazlar'), `devicesEmpty`, `devicesPair` ('Eşleştir'), `deviceRevoke` ('Erişimi kaldır'),
  `deviceLastSeen`, `pairTtlLine`, `pairListenFailedReason`, `remoteEnabledLabel`.

## ADR applicability

- ADR-0001: when the server is not listening (kill-switch off / listen failed), Eşleştir is
  ABSENT with the reason line — never a disabled control. Revoke on a device row is always
  actionable (its evidence is the row itself) and CONFIRMLESS — re-pairing is cheap, the
  draft-Sil discipline; a failure toasts top-right.
- ADR-0012: kit dialog anatomy; no footer error copy (failures toast); no ⏎ badge (the dialog
  has no primary action); vertical rhythm on the 4px grid; no juice beyond kit transitions —
  this is a settings surface.
- ADR-0007: device names are operator data rendered verbatim (the repo-label posture); every
  fixed word lives in the bundles; the 6-digit code is data, not an identifier.

## Acceptance

1. With no devices: the invitation line + Eşleştir; pairing flow renders QR + code and
   completes against the running server (the deferred live tour).
2. A paired device appears with name + last-seen; revoke removes it and its key stops
   authenticating (checked via 0102's refusal shape).
3. Server off → Eşleştir absent with reason; the kill-switch row flips `remote:enabled` and
   the next boot obeys it.
4. Ladder green; E2E baseline unaffected (a spec for this screen, if any, obeys the WO-0101
   lock — default: none).

## Out

QR scanning on the phone, any mobile code (docket-mobile), key/token display beyond the
one-time code, revoke-all, device renaming.
