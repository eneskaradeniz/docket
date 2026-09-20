---
id: WO-0084
title: "The drive chip leaves the front of the nav row — status reads last, the audit learns the header"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0083"]
---

# WO-0084 — the drive chip leaves the front of the nav row

## Objective

Operator finding (2026-09-21): the appbar's «1 sürüyor» chip sits at the FRONT of the right
cluster — visually leading the Pano·Yol Haritası·Kullanım·Genel bakış row. Geometry says every
box is center-aligned (cy 23.5 across); the defect is ORDER: a passive status badge never leads
the navigation row. WO-0060 put it first for two real constraints — outside the workspace guard
(the account fact outlives workspaces) and inside the no-drag cluster — both of which hold at the
cluster's END just as well.

And the meta-finding, owned: the audit tool never scanned the header chrome (main-only) and had
no center/order checks — that is why this survived five sweeps.

## The fix

- `AppShell`: the chip moves to the cluster's END (after the settings gear — the tray position).
  The WO-0060 constraints are restated in the comment; nothing else changes.
- `e2e/audit-design-once.mjs` gains a header pass: per-element order/geometry dump for every page
  plus a vertical-center mismatch flag (>2px inside a flex row) — the chrome is audited from now on.

## Verification

- Mechanical pass; atelier re-capture: the chip reads at the cluster's end on every page that has
  one; the header audit reports zero center mismatches.
