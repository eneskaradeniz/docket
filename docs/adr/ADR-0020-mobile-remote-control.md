# ADR-0020 — The mobile remote: a thin client over an embedded console server

- Status: accepted
- Date: 2026-09-24
- Deciders: Enes (operator), design session
- Origin: operator goal, 2026-09-24 — "Docket'i mobilden yönetmek; tamamen lokal, sunucu almadan; QR ile eşleştirme; Android APK önce, iOS belki sonra"

## Context

Docket is GUI-only with exactly one composition root (`electron/main.ts`, WO-0073 / ADR-0006). The
operator wants the console reachable from a phone: see every running drive, answer what is waiting,
steer, manage settings — while the desktop app stays open at home, with no cloud service purchased.
Same-Wi-Fi is the baseline; leaving the house means a VPN-grade path (Tailscale) rather than ports
or relays.

The existing machine already carries most of the load: the M9 parallel spine runs N drives at once
across workspaces; every gate (plan approval, the workspace budget cap WO-0047, backend profile
resolution WO-0098) is enforced in `src/core/`, never in a host; `AppbarDriveChip` already surfaces
account quota windows (`limitWarn {window, utilization, resetAt}`); the budget threshold is optional
per workspace; the label bundles already speak Turkish for roles and states.

A design phase ran first, by operator ruling: a 19-frame Figma set ("Docket Mobile") generated with
Figma AI under prompt packs we authored, then audited frame by frame (contract → values → geometry
→ visual; measurement decides, visual reports only hypothesize). The set covers Konsol, the health
panel in its three archetypes, work-order detail, the live transcript with both ask-card shapes, the
work-order list, pairing, roadmap + TASLAK, settings with every sub-surface, the connection-lost
state, and the empty console. Its approval is approval of the INFORMATION CONTRACT — a mock never
substitutes for the running UI (the WO-0051 rev-3 lesson), so a Flutter spike validates the token
ramp on a real device before the wave builds on it.

Stack: **Flutter on the base-mobile template** (contract-mirrored API layer, fake-first development,
three flavors, TDD) in a separate repo `docket-mobile`; Android APK sideloaded first, iOS the same
code if its day comes. Kotlin/Compose was considered and set aside — a fourth mobile stack with zero
accumulated base in this operator's fleet and a full rewrite waiting for iOS; Expo/RN was considered
for TS alignment and set aside too — a thin client has no business logic worth sharing, and every
existing mobile project here is Flutter.

## Decision

1. **The phone is a thin client; the phone carries no rules.** Every gate stays core-enforced —
   plan approval, budget, profile resolution, flow mode. The app renders state and posts intents;
   it never re-derives a verdict. A screen that could disagree with the pipeline is the defect
   this rule exists to prevent.
2. **One embedded server, one composition root.** An HTTP + WebSocket server adapter is wired in
   `electron/main.ts` alongside the existing root — no second root, no sidecar daemon. "The desktop
   app is open" is the stated deployment assumption, in the operator's own words.
3. **Pairing: the desktop shows, the phone scans.** The desktop "Cihazlar → Eşleştir" screen renders
   a QR carrying the endpoint (host:port) plus a one-time token; the phone scans it with its camera
   (a 6-digit manual code is the fallback). The one-time token exchanges for a per-device key;
   unknown bearers are refused; devices are listed and revocable. The QR direction is part of the
   contract — the phone never displays a code for the desktop to scan. The "Records & PRs" line
   extends here unchanged: event records may name tool targets, never environment values or keys.
4. **The endpoint is transport-agnostic.** The QR's host is whatever the current network offers —
   a LAN IP today, a Tailscale MagicDNS name tomorrow. No Tailscale-specific code exists in Docket;
   the macOS Local Network permission prompt is a setup fact, not a feature.
5. **Konsol is a mobile-only layer above the workspaces.** The desktop stays workspace-scoped; the
   phone's home screen is account-wide — every workspace's running drives and pending asks in one
   list, each card wearing its workspace label in dim mono. This adds a surface; it changes no
   desktop screen.
6. **Health is presence-derived and composite — there is no mode switch.** A quota-window row
   appears for every backend profile that reports one; a month-spend row appears for every
   workspace with a cap. A subscription-only operator sees no currency anywhere; an API-only
   operator sees no windows; an operator with both sees both, each row labeled with its kind and
   source ("abonelik · Pro", "api · <workspace>"). Configuration IS the mode; no `para|abonelik`
   setting exists. The top-bar LED is the single worst-tier fact (red > amber > green — the
   `appbarDriveTier` ladder), and tapping it opens the full panel.
7. **Three theme faces on mobile too** — Sistem / Açık / Karanlık (WO-0040 parity). The light face
   derives from the token set at implementation time; the design-phase mocks are dark-only by
   scope, not by omission of the feature.
8. **No push in v1.** Liveness exists while the app is foreground over the WebSocket; a later
   Android foreground service ("Docket bağlı") is an allowed addendum; FCM is not — it would break
   the no-cloud premise this whole design stands on.
9. **v1 write scope:** answering asks in both shapes (allow/reject and structured multi-choice with
   "Diğer…"), stop and resume drives, the budget raise-and-rerun card, draft approve/reject, theme
   and language. **Deferred with reasons:** work-order creation, plan requests, and the ✦ draft
   source composition (mobile file pickers degrade the composition contract; WO-0051's channel
   union deserves better) — desktop-only until an operator ruling says otherwise.
10. **The design language is the desktop's, mobile-adapted.** Same palette and pairing (Manrope +
    IBM Plex Mono), the 3px full-height lamp, amber strictly meaning "seni bekliyor" (never a tab
    state), a mobile type ramp (22/17/15, mono 12 meta), card text column at 12px from the card's
    outer edge (lamp included), page padding 16, gaps 8, quiet controls 32px, ask buttons 36px.
    Vocabulary flows from the label bundles (Uygulayıcı/Mimar/Doğrulayıcı; sorun yok/uyarı/doldu;
    "baskı" is not a word this product uses). Raw identifiers never render — connection facts do
    ("bağlı · aynı ağ").
11. **The contract's source is the code; the mirror is generated.** The API surface derives from
    core types in docket; `docket-mobile` carries a `contract/endpoints.yaml` mirror plus the fake
    transport (base-mobile's fake-first development). The mirror regenerates on contract change —
    hand-maintained mirrors drift, and drift here means a phone that lies about the console.

## Consequences

- docket gains a server adapter, a pairing endpoint and key store, a desktop "Cihazlar → Eşleştir"
  screen (a work-order series, each closed by the operator's manual tour); `docket-mobile` opens
  from base-mobile with wave 1 (pairing → Konsol + connection states → read surfaces), wave 2
  (live transcript + both ask shapes + drive control), wave 3 (management writes).
- Server-side logic lands test-first with the core fakes like every port; the adapter itself joins
  the E2E bridge's repertoire. The single-E2E-suite-per-host lock (WO-0101) governs any spec that
  drives the server.
- Operational notes: the macOS Local Network prompt on first listen; QR re-pairing when a LAN IP
  changes (a Tailscale name removes that class entirely); radio-friendliness — the server streams a
  tail-windowed event feed, never full history; reconnect is a designed state ("bağlantı yok" is a
  screen, not an error toast).
- Risks accepted: foreground-only liveness delays an ask's visibility until the operator opens the
  app (known, stated on the screen set, revisitable as a foreground-service addendum); a second
  mobile platform remains unbuilt until its day (Flutter keeps it one codebase away).
