---
id: WO-0104
title: "Role → vendor routing — the driver route: {vendor, profile, model} resolved through the WO-0098 precedence chain"
workspace: docket
status: implementing
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0104 — role → vendor routing (Faz A)

Issue #105 · Phase A of `docs/research/2026-09-25-multi-cli-provider-architecture.md`.

## Objective

Widen the per-role model preference (`RoleModels`, WO-0059 rev 2 — a bare model-id string per
role) into a per-role DRIVER ROUTE `{vendor?, profile?, model?}`, and resolve vendor + profile
through the SAME precedence chain WO-0098 already uses for backend profiles: work order
(order.md front-matter) → workspace default → role-level account default → the built-in. No new
vendor lands here — `undefined` (the built-in) resolves to today's SDK adapter unconditionally,
and the composition root gains the vendor SELECTOR shape (a runner factory keyed by the resolved
vendor id + a wired-vendor set the pipeline gates on). Pure plumbing that de-risks Faz B/C by
proving the chain and the selector before a second vendor exists to select.

## Context

- `src/core/app-settings.ts:28` — `RoleModels = Partial<Record<SessionRole, string>>` (the type
  being widened); `getModels`/`setModels` (the `models` app_setting row, WO-0059 rev 2).
- `src/core/backend-profile.ts` — `resolveProfile` (WO → workspace → built-in), the chain this
  WO extends with a third level (role) and a second axis (vendor).
- `src/core/pipeline.ts:231` — the profile gate (`store.backendProfileFor`); `src/core/session-store.ts:109`
  — the port method being widened into `driverRouteFor`.
- `src/adapters/runner/index.ts` — the ONE adapter; the vendor id vocabulary is minted HERE
  (ADR-0006: a vendor name is adapter data; core/ui never see one — the boundary check's c1
  list is unchanged).
- `docs/research/2026-09-25-multi-cli-provider-architecture.md` — the three axes (vendor /
  profile / role→tier); only the vendor axis is new.

## Frozen decisions

- **Vendor ids are DATA, minted adapter-side.** Core speaks `vendor?: string` — opaque. The
  built-in is `undefined` ("the composition root's default adapter"), never a name core or ui
  could spell. ADR-0006's vendor-name grep is untouched.
- **One chain, per-axis fall-through.** vendor = WO `vendor:` → workspace `driver:<wsId>` →
  role route → built-in; profile = WO `profile:` → workspace default → role route → built-in
  (the EXISTING two levels unchanged, one added); model stays ROLE-LEVEL ONLY (a workspace/WO
  model override is not in any phase's scope).
- **A route naming an unwired vendor REFUSES the drive** — the `missing`-profile discipline:
  never a silent spawn on another backend. The pipeline gates on a `vendors()` set injected by
  the composition root (the registry's ids); the refusal is an error event carrying a
  `vendorRefusal` payload (the `profileRefusal` pattern).
- **The renderer never controls the vendor.** The pipeline overwrites `input.vendor` from its
  own store resolution (the `profile` posture — the environment is not renderer-controllable).
- **Backwards compatibility is a read-time migration, not a schema event.** A stored `models`
  row of bare strings reads as `{model: <string>}`; a stored `profile:<wsId>` raw row reads as
  the `driver:<wsId>` route's profile half. Writes land in the new shapes only.
- **Evidence: the `started` event and the session row carry the vendor** (the WO-0098
  profile/model posture): the pipeline stamps `vendor` beside `profile`, the row gains a
  `driver_vendor` column (additive, PRAGMA-guarded, NULL = the built-in).

## Scope

In scope:

- `src/core/driver-route.ts` (new, pure): the `RoleRoute` shape, route normalization, and the
  one resolver (`resolveDriverRoute`) composing vendor + profile through the chain.
- `RoleModels` widened; `modelOptions`/`providerName` port signatures gain an optional vendor
  parameter (registry routing is the composition root's; unknown vendor → honest empty).
- `SessionStore.backendProfileFor` → `driverRouteFor(owner, role)`; `ProfileResolution` gains
  the `'role'` source; `RecordSessionInput` + `SessionRef` + the fold gain the vendor.
- order.md `vendor:` front-matter (parse + the set/drop edit patch, the `profile:` idiom).
- The workspace driver row (`driver:<wsId>`, JSON `{vendor?, profile?}`) with legacy
  `profile:<wsId>` fallback at read; the old get/setWorkspaceProfile pair DELEGATES to it.
- The pipeline vendor gate + the widened runner factory (`(owner, route)`); main wires the
  one-entry registry and stamps the resolved model from the route's `.model`.
- Type-driven UI touch-ups only (the Modeller segment writes `{model}`); the driver SELECTOR
  UI is Faz E (#109).

Out of scope:

- The generic CLI-spawn adapter (Faz B, #106), any second vendor (Faz C, #107),
  auto-discovery (Faz D, #108), the settings surfaces (Faz E, #109).
- Per-vendor model options content, per-vendor profiles (a profile list per vendor arrives
  with the second vendor that needs one).

## Acceptance criteria

1. Core tests (test-first): `resolveDriverRoute` covers the chain per axis (WO > workspace >
   role > built-in; blanks are absent; a role profile rides under WO/workspace absence); the
   stored-shape normalizer maps legacy strings to `{model}` and drops garbage.
2. The pipeline refuses a drive whose resolved vendor is not in the injected set — an error
   event with `vendorRefusal {vendor, source}` naming where the reference lived, BEFORE the
   runner spawns; a wired vendor passes and the runner factory RECEIVES the route (pinned by
   the pipeline fake).
3. The store round-trips: dual-shape `models` reads, `driver:<wsId>` write + legacy fallback,
   `driverRouteFor` over a real order.md (`vendor:` + `profile:`), the session row's
   `driver_vendor` three-state write.
4. The `started` event carries `vendor` when the route names one; the fold exposes
   `driveVendor`; `seedLiveState` re-seeds it from the row.
5. `npm run typecheck`, `npm test`, `npm run build`, `npm run check:boundaries` green; the
   E2E suite green (the WO-0098/0059 assertions updated to the route shape).

## Evidence required

- The four CI checks above on the PR.
- A manual scenario (deferred to the operator's end-of-wave tour per the 2026-09-19 ruling):
  Settings → Modeller sets a tier (still writes instantly); a `vendor: ghost` line in an
  order.md refuses the drive with the naming line.

## Stop-and-ask gates

- If the route resolution needs to touch the budget/profile gate ORDER (today: budget first),
  stop and ask — this WO adds the vendor gate AFTER budget, changing no existing precedence.
- If a second vendor id turns out to be needed anywhere in `src/core/` or `src/ui/`, stop and
  ask — that is an ADR-0006 break, not a plumbing detail.

## Notes

- The remote folds (`remote/server.ts`) consume the `started` event's profile today; the
  vendor rides the same event and needs no remote-side change until a second vendor exists
  (ADR-0020 #6's quota rows stay profile-keyed).
- `checkProvider` stays profile-scoped this WO — vendor-scoped checks arrive with the first
  real second vendor (Faz C).
