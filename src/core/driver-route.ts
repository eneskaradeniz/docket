// src/core/driver-route.ts — the per-role DRIVER ROUTE, PURE (WO-0104 / Faz A, issue #105).
//
// Three axes steer a drive (docs/research/2026-09-25-multi-cli-provider-architecture.md):
// vendor (which adapter) — NEW here; profile (which account within a vendor, WO-0098) and
// role→model (WO-0059 rev 2) exist. This module widens the per-role preference into a
// {vendor, profile, model} route and resolves vendor + profile through the SAME precedence
// chain WO-0098 uses for profiles — work order (order.md front-matter) → workspace default →
// role-level account default → the built-in — with each axis falling through INDEPENDENTLY
// (a WO that names only a profile does not pin the vendor; the role route may carry either).
// The model stays ROLE-LEVEL ONLY: no workspace or WO model override exists in any phase.
//
// A vendor id is DATA minted adapter-side (ADR-0006: core never names a vendor) — the
// built-in is `undefined`, "the composition root's default adapter". Whether an id is WIRED
// is the composition root's registry; the pipeline gates on it (the missing-profile
// discipline — a dangling vendor reference refuses the drive, never a silent spawn on
// another backend). This module knows names, not wiring.

import type { SessionRole } from './types';
import type { BackendProfile, ProfileResolution } from './backend-profile';
import { resolveProfile } from './backend-profile';

/** One role's driver preference. Every field optional: an absent field falls through the
 *  chain; a route that is all-absent is no route at all (the provider's own defaults). */
export interface RoleRoute {
  /** The vendor adapter id (DATA, adapter-minted; `undefined` = the built-in adapter). */
  vendor?: string;
  /** A backend profile NAME within that vendor (WO-0098 vocabulary). */
  profile?: string;
  /** The model id / alias tier (WO-0059 rev 2 vocabulary, carried verbatim). */
  model?: string;
}

/** Where a resolved reference was WRITTEN — the refusal names it so the fix is findable. */
export type RouteSource = 'wo' | 'workspace' | 'role';

/** The pipeline's one route read: the vendor half (absent = the built-in adapter) plus the
 *  profile resolution WO-0098 already defined (its source union gains 'role'). */
export interface DriverRouteResolution {
  vendor?: string;
  vendorSource?: RouteSource;
  profile: ProfileResolution;
}

/** The roles a stored route map may carry (the store's shape guard; SessionRole at rest). */
export const DRIVER_ROLES: ReadonlySet<SessionRole> = new Set<SessionRole>(['architect', 'implementer', 'verifier']);

/** A non-blank trimmed reference, or undefined — blank is ABSENT everywhere in the chain
 *  (an empty `vendor:` line in order.md never pins anything). */
function refOf(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
}

/** Resolve the whole route: vendor = WO → workspace → role → the built-in; profile = the
 *  same chain through core's resolveProfile (which owns the missing/builtin semantics).
 *  PURE — the caller (the store) supplies every level; tests pin each fall-through. */
export function resolveDriverRoute(input: {
  profiles: readonly BackendProfile[];
  woVendor?: string;
  woProfile?: string;
  wsVendor?: string;
  wsProfile?: string;
  roleRoute?: RoleRoute;
}): DriverRouteResolution {
  const woV = refOf(input.woVendor);
  const wsV = refOf(input.wsVendor);
  const roleV = refOf(input.roleRoute?.vendor);
  const vendor = woV ?? wsV ?? roleV;
  const vendorSource: RouteSource | undefined =
    woV !== undefined ? 'wo' : wsV !== undefined ? 'workspace' : roleV !== undefined ? 'role' : undefined;
  return {
    ...(vendor !== undefined ? { vendor, ...(vendorSource !== undefined ? { vendorSource } : {}) } : {}),
    profile: resolveProfile({
      profiles: input.profiles,
      woOverride: input.woProfile,
      workspaceDefault: input.wsProfile,
      roleProfile: input.roleRoute?.profile,
    }),
  };
}

/** One stored route entry's SHAPE guard (the settingModels posture): a legacy bare STRING
 *  (the pre-WO-0104 models row) reads as `{model}`; an object keeps its known string fields;
 *  anything else — garbage types, an all-blank entry — is no route. Vendor/profile/model ride
 *  verbatim after trim; validity (is the vendor wired? does the profile exist?) is NEVER
 *  judged here — the chain's gates own that. */
export function normalizeRoleRoute(raw: unknown): RoleRoute | undefined {
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t !== '' ? { model: t } : undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { vendor, profile, model } = raw as { vendor?: unknown; profile?: unknown; model?: unknown };
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const out: RoleRoute = {};
  const v = str(vendor);
  const p = str(profile);
  const m = str(model);
  if (v !== undefined) out.vendor = v;
  if (p !== undefined) out.profile = p;
  if (m !== undefined) out.model = m;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The whole stored role map's SHAPE guard: unknown role keys drop, each entry through
 *  normalizeRoleRoute, an empty map is nothing. Read FAIL-OPEN (a corrupt row falls back to
 *  every built-in, never a crash) and written NORMALIZED (the store never persists what this
 *  would drop). */
export function normalizeRoleRoutes(raw: unknown): Partial<Record<SessionRole, RoleRoute>> {
  const out: Partial<Record<SessionRole, RoleRoute>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [role, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!DRIVER_ROLES.has(role as SessionRole)) continue;
    const route = normalizeRoleRoute(entry);
    if (route) out[role as SessionRole] = route;
  }
  return out;
}
