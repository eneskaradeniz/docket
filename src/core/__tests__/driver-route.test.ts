// src/core/__tests__/driver-route.test.ts — WO-0104 (Faz A): the driver-route resolver + the
// stored-shape normalizers, PURE. The chain pins: per-axis fall-through (WO → workspace →
// role → built-in), blanks are absent, the profile half delegates to resolveProfile (whose
// own tests own missing/builtin), and the legacy models-row shape reads as {model}.
import { describe, expect, it } from 'vitest';
import { DRIVER_ROLES, normalizeRoleRoute, normalizeRoleRoutes, resolveDriverRoute } from '../driver-route';
import type { BackendProfile } from '../backend-profile';

const P1: BackendProfile = { name: 'glm', env: { A: '1' } };
const P2: BackendProfile = { name: 'max', env: { B: '2' } };
const PROFILES = [P1, P2];

describe('normalizeRoleRoute', () => {
  it('reads a legacy bare string as the model tier', () => {
    expect(normalizeRoleRoute('opus')).toEqual({ model: 'opus' });
    expect(normalizeRoleRoute('  sonnet ')).toEqual({ model: 'sonnet' });
  });

  it('keeps the known string fields of an object, trimmed; blanks drop', () => {
    expect(normalizeRoleRoute({ vendor: ' x ', profile: 'glm', model: 'opus' })).toEqual({ vendor: 'x', profile: 'glm', model: 'opus' });
    expect(normalizeRoleRoute({ vendor: '', profile: undefined, model: 'haiku' })).toEqual({ model: 'haiku' });
    expect(normalizeRoleRoute({ vendor: 'x', model: '  ' })).toEqual({ vendor: 'x' });
  });

  it('drops garbage shapes and all-absent entries', () => {
    expect(normalizeRoleRoute(undefined)).toBeUndefined();
    expect(normalizeRoleRoute(42)).toBeUndefined();
    expect(normalizeRoleRoute([])).toBeUndefined();
    expect(normalizeRoleRoute('   ')).toBeUndefined();
    expect(normalizeRoleRoute({ vendor: 7, model: {} })).toBeUndefined();
    expect(normalizeRoleRoute({})).toBeUndefined();
  });
});

describe('normalizeRoleRoutes', () => {
  it('keeps known roles only, entries through the route guard', () => {
    expect(
      normalizeRoleRoutes({
        architect: { vendor: 'x', model: 'opus' },
        implementer: 'sonnet', // legacy string entry
        verifier: { profile: 'glm' },
        admin: 'ghost-x', // unknown role drops
      }),
    ).toEqual({
      architect: { vendor: 'x', model: 'opus' },
      implementer: { model: 'sonnet' },
      verifier: { profile: 'glm' },
    });
  });

  it('non-object input is the empty map (fail-open read)', () => {
    expect(normalizeRoleRoutes(null)).toEqual({});
    expect(normalizeRoleRoutes('x')).toEqual({});
    expect(normalizeRoleRoutes([1])).toEqual({});
  });

  it('DRIVER_ROLES is exactly the three session roles', () => {
    expect([...DRIVER_ROLES].sort()).toEqual(['architect', 'implementer', 'verifier']);
  });
});

describe('resolveDriverRoute — the vendor axis', () => {
  it('nothing written anywhere = the built-in (no vendor key, builtin profile)', () => {
    expect(resolveDriverRoute({ profiles: PROFILES })).toEqual({ profile: { kind: 'builtin' } });
  });

  it('WO beats workspace beats role; blanks are absent at every level', () => {
    expect(
      resolveDriverRoute({ profiles: PROFILES, woVendor: 'a', wsVendor: 'b', roleRoute: { vendor: 'c' } }).vendorSource,
    ).toBe('wo');
    expect(resolveDriverRoute({ profiles: PROFILES, woVendor: '  ', wsVendor: 'b', roleRoute: { vendor: 'c' } }).vendorSource).toBe('workspace');
    expect(resolveDriverRoute({ profiles: PROFILES, woVendor: '', wsVendor: '', roleRoute: { vendor: 'c' } }).vendorSource).toBe('role');
    const wo = resolveDriverRoute({ profiles: PROFILES, woVendor: 'a' });
    expect(wo.vendor).toBe('a');
    expect(wo.vendorSource).toBe('wo');
  });

  it('a route with only model/profile carries no vendor half at all', () => {
    const r = resolveDriverRoute({ profiles: PROFILES, roleRoute: { model: 'opus', profile: 'glm' } });
    expect(r.vendor).toBeUndefined();
    expect(r.vendorSource).toBeUndefined();
    expect(r.profile).toEqual({ kind: 'profile', profile: P1, source: 'role' });
  });
});

describe('resolveDriverRoute — the profile axis (delegates to resolveProfile)', () => {
  it('WO > workspace > role > builtin, each naming its source', () => {
    expect(resolveDriverRoute({ profiles: PROFILES, woProfile: 'max', wsProfile: 'glm', roleRoute: { profile: 'glm' } }).profile).toEqual({
      kind: 'profile',
      profile: P2,
      source: 'wo',
    });
    expect(resolveDriverRoute({ profiles: PROFILES, wsProfile: 'glm', roleRoute: { profile: 'max' } }).profile).toEqual({
      kind: 'profile',
      profile: P1,
      source: 'workspace',
    });
    expect(resolveDriverRoute({ profiles: PROFILES, roleRoute: { profile: 'glm' } }).profile).toEqual({
      kind: 'profile',
      profile: P1,
      source: 'role',
    });
  });

  it('a dangling role-level profile is missing naming the role source (refused, never silent)', () => {
    expect(resolveDriverRoute({ profiles: PROFILES, roleRoute: { profile: 'yok' } }).profile).toEqual({
      kind: 'missing',
      name: 'yok',
      source: 'role',
    });
  });

  it("`default` at a level that WINS pins the built-in — a lower level's default never overrides a higher explicit pick", () => {
    // the WO explicitly pins the built-in over a configured workspace default
    expect(resolveDriverRoute({ profiles: PROFILES, woProfile: 'default', wsProfile: 'glm' }).profile).toEqual({ kind: 'builtin' });
    // the role route alone naming default → the built-in
    expect(resolveDriverRoute({ profiles: PROFILES, roleRoute: { profile: 'default' } }).profile).toEqual({ kind: 'builtin' });
    // but a role-level default does NOT override the workspace's explicit pick (precedence wins)
    expect(resolveDriverRoute({ profiles: PROFILES, wsProfile: 'glm', roleRoute: { profile: 'default' } }).profile).toEqual({
      kind: 'profile',
      profile: P1,
      source: 'workspace',
    });
  });

  it('the axes are independent: a WO profile does not pin the vendor and vice versa', () => {
    const r = resolveDriverRoute({ profiles: PROFILES, woVendor: 'x', roleRoute: { profile: 'glm' } });
    expect(r.vendor).toBe('x');
    expect(r.profile).toEqual({ kind: 'profile', profile: P1, source: 'role' });
  });
});
