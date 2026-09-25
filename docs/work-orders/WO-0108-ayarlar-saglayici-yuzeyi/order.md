---
id: WO-0108
title: "The settings surface for the driver-route chain — Modeller's driver selector, the vendor-grouped Sürücüler, the workspace + WO overrides"
workspace: docket
status: implementing
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0108 — the settings surface (Faz E)

Issue #109 · Phase E of `docs/research/2026-09-25-multi-cli-provider-architecture.md`.

## Objective

The last mile: every level of the driver-route chain Faz A introduced gets its surface — the
Modeller role rows gain the DRIVER selector (vendor · profile) beside the model tier with a
PER-VENDOR model roster; the Sürücüler screen groups its cards by vendor (the builtin vendor's
profiles + form, every other wired vendor's Varsayılan, and a «henüz değil» group of plain info
rows for the probe-pending cast — ADR-0001); the workspace dialog's picker becomes the one
DriverSelect writing the `driver:<wsId>` route; the WO create dialog gains a vendor segment
(appearing only when a second wired vendor exists); and the live pane's evidence line names the
vendor the route resolved (the profile/model evidence rule, widened).

## Frozen decisions

- **ONE picker widget** (`DriverSelect`): a native select styled to the kit's input look
  (vendors × profiles outgrow a segmented bar); every option label is adapter DATA or the
  bundle's own words. The first option is always the CHAIN arm («Varsayılan» = no preference at
  this level). A stored value the options no longer carry keeps its own option — the row SHOWS
  what is stored (findable), never a blank lie.
- **The builtin vendor's options write the vendor EXPLICITLY** — naming the default is NOT
  dropped to a bare profile (a lower level naming another vendor would otherwise hijack the
  pick: the chain falls through, Varsayılan at a level means "not decided here").
- **Probe-pending vendors never enter pickers** (an action whose evidence is unmet is absent) —
  they render ONLY as «henüz değil» info rows with the reason and, when found, the detected path.
- **Per-vendor profiles are a named follow-up (TD-069)**: the global profile list belongs to
  the BUILTIN vendor (VendorInfo.builtin names it); another wired vendor offers Varsayılan alone.
- **The pane shows the resolved vendor verbatim** when the route named one (evidence, the
  profile rule) — the pinned-passthrough spec's claim narrowed accordingly (no PROFILE claim).
- **The WO create's vendor segment waits for a second vendor** — with one wired vendor it is
  inherit ≡ the only choice, pure noise.

## Scope

In scope: DriverSelect + the four surfaces above; the per-vendor model roster (modelOptions
scoped by the route's vendor); tr/en labels; the pane evidence line; VendorInfo.builtin; E2E
(the vendor-grouped Sürücüler + the pending cast + the role-route write-through + the
pane/row evidence; the WO-0098 spec migrated to the select).

Out of scope: per-vendor profiles (TD-069), the onboarding wizard (Figma-gated), flipping
CODEX_PROBE_PASSED (the operator's authenticated probe run), the budget card's "Codex spend not
counted" sentence refinement (TD-067's follow-up — lands when Codex is enabled).

## Acceptance criteria

1. The Modeller row writes {vendor, profile} through instantly (the map-of-record discipline);
   the chain arm drops both halves; the tier segments follow the route's own vendor roster.
2. Sürücüler: the builtin group (cards + form), the pending cast (info rows, adapter-named), a
   per-vendor Test et (the check's vendor axis).
3. The workspace dialog writes the whole route in one call; the WO create carries vendor: into
   order.md when picked.
4. A stale profile list never blanks the picker (re-read on section switch — the E2E-found bug).
5. CI green; E2E 101 specs green.

## Evidence required

- The four CI checks; the new E2E spec block; the settings-vendors + settings-models-driver shots.
- The operator's end-of-wave tour: Settings → Modeller/Sürücüler, the workspace picker, and —
  when a codex login exists — `node docs/probes/codex-cli/probe.mjs` then the flip.

## Stop-and-ask gates

- If a picker ever offers a probe-pending vendor — stop and ask (ADR-0001).
- If the vendor word is asked to HIDE for the builtin adapter — stop and ask: the route named
  it; hiding evidence is a fold concern, not a picker one.

## Notes

- The stale-profiles bug (creating a profile under Sürücüler did not reach Modeller's options)
  was found by the E2E run — the fix (re-read on section switch) is pinned by the spec's flow.
