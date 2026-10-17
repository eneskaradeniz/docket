// ConnectorRegistry tests — the list/switch/resolution service of the connector model. The
// connector list is always injected: these fixtures are synthetic modules (a host-matched forge,
// an id-selected tracker, a broken one), so the application tests prove the laws without any
// real connector import.
import { describe, expect, it } from 'vitest';

import type { Actor, RoleSlug, RunId } from '../../domain/index';
import { CONNECTOR_API_VERSION, err, ok, parseSlug } from '../../domain/index';
import type {
  CommandRunner,
  ConnectorContext,
  ConnectorModule,
  ConnectorReadiness,
  Forge,
  ForgeCapabilities,
  IssueTracker,
} from '../index';
import { createFakeAppSettingsRepo, createFakeCommandRunner, createFakeIdGen, type FakeAppSettingsRepo } from '../ports/fakes/index';

import { CONNECTORS_ENABLED_KEY, createConnectorRegistry, type ConnectorRegistry } from './connector-registry';

const USER: Actor = { kind: 'user', id: 'u1' };
const AGENT: Actor = {
  kind: 'agent',
  runId: '01ARZ3NDEKTSV4RRFFQ69G5F777' as RunId,
  role: 'worker' as RoleSlug,
};

const slug = (raw: string) => {
  const parsed = parseSlug<'connector'>(raw);
  if (!parsed.ok) throw new Error('fixture connector slug');
  return parsed.value;
};

const CAPS: ForgeCapabilities = { pullRequests: false, checks: false, issues: false };

/** A synthetic module: what it provides, which hosts select it, what its probe answers, and
 *  whether its factories behave. */
interface FixtureModule {
  readonly id: string;
  readonly provides: readonly ('forge' | 'tracker')[];
  readonly hostMatch: readonly string[];
  readonly readiness: ConnectorReadiness | 'throw';
  readonly forgeBehavior?: 'ok' | 'throw-member' | 'throw-factory';
  readonly manifestOverride?: Partial<ConnectorModule['manifest']>;
}

// Every probe invocation, `id:cwd`, so the caching law can count them.
const probeCalls: string[] = [];

const throwUp = (): never => {
  throw new Error('connector exploded');
};

const forgeOf = (id: string, behavior: FixtureModule['forgeBehavior']): Forge => ({
  kind: id,
  capabilities: CAPS,
  pushBranch: async () => (behavior === 'throw-member' ? throwUp() : ok(undefined)),
  openPullRequest: async () => ok({ number: 1, url: `https://${id}.example/pull/1` }),
  pullRequest: async () => ok({ state: 'open' as const }),
  checks: async () => ok([]),
  defaultBranch: async () => ok('main'),
  mergePullRequest: async () => ok(undefined),
});

const trackerOf = (id: string): IssueTracker => ({
  kind: id,
  search: async () => ok([]),
  get: async () => ok(undefined),
  comment: async () => ok(undefined),
  transition: async () => ok(undefined),
  probePermissions: async () => ok({ read: true, comment: true, transition: true, edit: false }),
  listMilestones: async () => ok({ items: [] }),
  listIssues: async () => ok({ items: [] }),
});

const moduleOf = (fixture: FixtureModule): ConnectorModule => ({
  manifest: {
    id: slug(fixture.id),
    name: fixture.id,
    version: '1.0.0',
    apiVersion: CONNECTOR_API_VERSION,
    provides: fixture.provides,
    hostMatch: fixture.hostMatch,
    network: ['api.example'],
    settings: [],
    requiresCli: 'demo',
    ...fixture.manifestOverride,
  },
  ...(fixture.provides.includes('forge')
    ? {
        createForge: async () => {
          if (fixture.forgeBehavior === 'throw-factory') throwUp();
          return forgeOf(fixture.id, fixture.forgeBehavior);
        },
      }
    : {}),
  ...(fixture.provides.includes('tracker') ? { createTracker: () => trackerOf(fixture.id) } : {}),
  probe: async (_context, cwd) => {
    probeCalls.push(`${fixture.id}:${cwd}`);
    const answer: ConnectorReadiness | 'throw' = fixture.readiness;
    if (answer === 'throw') throw new Error('probe fixture throws');
    return answer;
  },
});

const stubContext = (runner: CommandRunner): ConnectorContext => ({
  http: { request: async () => err('egress_denied') },
  secrets: { resolve: async () => undefined },
  commands: runner,
  clock: { now: () => 0 },
  ids: createFakeIdGen(),
  log: { line: () => undefined },
});

/** One registry over synthetic modules; every probe lands in `probeCalls`. */
const registryOf = (
  fixtures: readonly FixtureModule[],
  settings: FakeAppSettingsRepo = createFakeAppSettingsRepo(),
): { readonly registry: ConnectorRegistry; readonly settings: FakeAppSettingsRepo } => {
  probeCalls.length = 0;
  const runner = createFakeCommandRunner();
  return {
    settings,
    registry: createConnectorRegistry({
      connectors: fixtures.map(moduleOf),
      defaultEnabled: [slug('shipped')],
      settings,
      createContext: () => stubContext(runner),
    }),
  };
};

const REMOTE = 'https://forge.example/octo/demo.git';

describe('createConnectorRegistry', () => {
  it('A-415: an absent settings key leaves the default set enabled — the shipped-before-registry connectors', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
      { id: 'later', provides: ['forge'], hostMatch: ['other.example'], readiness: 'ready' },
    ]);
    const listed = await registry.list();
    if (!listed.ok) throw new Error('list failed');
    expect(listed.value.map((row) => [row.manifest.id, row.enabled])).toEqual([
      [slug('shipped'), true],
      [slug('later'), false],
    ]);
  });

  it('A-415: list() reports each manifest with its enabled flag and probed health', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
      { id: 'no-account', provides: ['tracker'], hostMatch: [], readiness: 'needs_account' },
      { id: 'no-cli', provides: ['tracker'], hostMatch: [], readiness: 'needs_cli' },
    ]);
    const listed = await registry.list();
    expect(listed.ok && listed.value.map((row) => [row.manifest.id, row.enabled, row.health])).toEqual([
      [slug('shipped'), true, 'ready'],
      [slug('no-account'), false, 'needs_account'],
      [slug('no-cli'), false, 'needs_cli'],
    ]);
  });

  it('A-415: a manifest failing R-182 is listed invalid with its error and is never enabled', async () => {
    const { registry, settings } = registryOf([
      { id: 'broken', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready', manifestOverride: { provides: [] } },
    ]);
    const listed = await registry.list();
    expect(listed.ok && listed.value[0]).toEqual({
      manifest: expect.objectContaining({ id: slug('broken') }),
      enabled: false,
      health: 'invalid',
      error: 'empty_provides',
    });
    // Both directions refuse: an invalid module cannot be switched at all, so it never carries weight.
    expect(await registry.setEnabled(slug('broken'), true, USER)).toEqual({ ok: false, error: 'invalid' });
    expect(await registry.setEnabled(slug('broken'), false, USER)).toEqual({ ok: false, error: 'invalid' });
    expect(await settings.get(CONNECTORS_ENABLED_KEY)).toBeUndefined();
  });

  it('A-415: setEnabled persists one connectors.enabled JSON array of ids through the settings port', async () => {
    const { registry, settings } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
      { id: 'later', provides: ['forge'], hostMatch: [], readiness: 'ready' },
    ]);
    expect(await registry.setEnabled(slug('later'), true, USER)).toEqual({ ok: true, value: undefined });
    expect(await settings.get(CONNECTORS_ENABLED_KEY)).toEqual([slug('shipped'), slug('later')]);
    expect(await registry.setEnabled(slug('shipped'), false, USER)).toEqual({ ok: true, value: undefined });
    expect(await settings.get(CONNECTORS_ENABLED_KEY)).toEqual([slug('later')]);
    const listed = await registry.list();
    expect(listed.ok && listed.value.find((row) => row.manifest.id === slug('later'))?.enabled).toBe(true);
  });

  it('A-415: only a user actor may switch a connector — every other actor answers user_only and nothing is written', async () => {
    const { registry, settings } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
    ]);
    expect(await registry.setEnabled(slug('shipped'), false, AGENT)).toEqual({ ok: false, error: 'user_only' });
    expect(await registry.setEnabled(slug('shipped'), false, { kind: 'system', component: 'sync' })).toEqual({
      ok: false,
      error: 'user_only',
    });
    expect(await settings.get(CONNECTORS_ENABLED_KEY)).toBeUndefined();
  });

  it('A-415: a corrupted connectors.enabled value answers the typed invalid_settings — never a silent default', async () => {
    for (const bad of [{ no: 'array' }, ['shipped', 7], ['shipped', 'not a slug!']]) {
      const store = createFakeAppSettingsRepo();
      await store.set(CONNECTORS_ENABLED_KEY, bad);
      const broken = registryOf(
        [{ id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' }],
        store,
      );
      const label = JSON.stringify(bad);
      expect(await broken.registry.list(), label).toEqual({ ok: false, error: 'invalid_settings' });
      expect(await broken.registry.setEnabled(slug('shipped'), false, USER), label).toEqual({
        ok: false,
        error: 'invalid_settings',
      });
      // Resolution fails closed too: a corrupt store never quietly becomes the default set.
      expect(await broken.registry.forForge({ path: '/repo', remote: REMOTE }), label).toBeUndefined();
    }
  });

  it('A-415: setEnabled on an unknown id answers not_found', async () => {
    const { registry } = registryOf([{ id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' }]);
    expect(await registry.setEnabled(slug('absent'), true, USER)).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-415: forForge picks the first enabled host-matching connector that probes ready', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
      { id: 'other', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
    ]);
    const forge = await registry.forForge({ path: '/repo', remote: REMOTE });
    expect(forge?.kind).toBe('shipped');
    // The probe runs in the checkout the selection names.
    expect(probeCalls).toEqual(['shipped:/repo']);
  });

  it('A-415: an explicit kind selects by id alone — no host test decides, and a foreign kind resolves undefined', async () => {
    const store = createFakeAppSettingsRepo();
    await store.set(CONNECTORS_ENABLED_KEY, [slug('shipped'), slug('chosen')]);
    const { registry } = registryOf(
      [
        { id: 'shipped', provides: ['forge', 'tracker'], hostMatch: ['forge.example'], readiness: 'ready' },
        { id: 'chosen', provides: ['forge'], hostMatch: [], readiness: 'ready' },
      ],
      store,
    );
    const byKind = await registry.forForge({ path: '/repo', remote: REMOTE, kind: 'chosen' });
    expect(byKind?.kind).toBe('chosen');
    // A tracker link naming a tracker no connector carries answers undefined without a probe.
    expect(await registry.forTracker({ path: '/repo', kind: 'absent-platform' })).toBeUndefined();
    expect(probeCalls.filter((call) => call.startsWith('shipped:'))).toHaveLength(0);
  });

  it('A-415: a disabled or not-ready connector resolves undefined, silently', async () => {
    const off = createFakeAppSettingsRepo();
    await off.set(CONNECTORS_ENABLED_KEY, []);
    const disabled = registryOf([{ id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' }], off);
    expect(await disabled.registry.forForge({ path: '/repo', remote: REMOTE })).toBeUndefined();
    expect(probeCalls).toHaveLength(0);

    const sleepy = registryOf([{ id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'needs_cli' }]);
    expect(await sleepy.registry.forForge({ path: '/repo', remote: REMOTE })).toBeUndefined();
    expect(await sleepy.registry.forTracker({ path: '/repo', remote: REMOTE })).toBeUndefined();
  });

  it('A-415: forTracker is the same law over the tracker family', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge', 'tracker'], hostMatch: ['forge.example'], readiness: 'ready' },
    ]);
    expect((await registry.forTracker({ path: '/repo', remote: REMOTE }))?.kind).toBe('shipped');
    expect((await registry.forTracker({ path: '/repo', kind: 'shipped' }))?.kind).toBe('shipped');
    // A remote no enabled connector claims resolves nothing, whichever family asks.
    expect(await registry.forForge({ path: '/repo', remote: 'https://elsewhere.example/x.git' })).toBeUndefined();
    expect(await registry.forTracker({ path: '/repo', remote: 'https://elsewhere.example/x.git' })).toBeUndefined();
  });

  it('A-415: the readiness probe runs once per connector — later resolutions and list() read the cache', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge', 'tracker'], hostMatch: ['forge.example'], readiness: 'ready' },
    ]);
    const selection = { path: '/repo', remote: REMOTE } as const;
    await registry.forForge(selection);
    await registry.forForge(selection);
    await registry.forTracker(selection);
    await registry.list();
    expect(probeCalls.filter((call) => call.startsWith('shipped:'))).toHaveLength(1);
  });

  it('A-417: a connector member that throws answers the typed connector_failed — no stack rides along', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready', forgeBehavior: 'throw-member' },
    ]);
    const forge = await registry.forForge({ path: '/repo', remote: REMOTE });
    if (forge === undefined) throw new Error('forge missing');
    expect(await forge.pushBranch({ id: 'demo', remote: REMOTE, defaultBranch: 'main' }, 'feature-x')).toEqual({
      ok: false,
      error: 'connector_failed',
    });
  });

  it('A-417: a throwing factory or probe fails closed to undefined — the caller sees an absent connector, never a crash', async () => {
    const { registry } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready', forgeBehavior: 'throw-factory' },
      { id: 'angry', provides: ['tracker'], hostMatch: [], readiness: 'throw' },
    ]);
    expect(await registry.forForge({ path: '/repo', remote: REMOTE })).toBeUndefined();
    expect(await registry.forTracker({ path: '/repo', kind: 'angry' })).toBeUndefined();
    // A throwing probe is a broken module: list() reports it invalid instead of crashing.
    const listed = await registry.list();
    const angry = listed.ok ? listed.value.find((row) => row.manifest.id === slug('angry')) : undefined;
    expect(angry?.health).toBe('invalid');
    expect(angry?.error).toBe('connector_failed');
  });

  it('A-417: the registry performs no write of its own — switching reaches only the settings key', async () => {
    const { registry, settings } = registryOf([
      { id: 'shipped', provides: ['forge'], hostMatch: ['forge.example'], readiness: 'ready' },
      { id: 'later', provides: ['forge'], hostMatch: [], readiness: 'ready' },
    ]);
    await settings.set('autonomy.level', 'manual');
    await registry.setEnabled(slug('later'), true, USER);
    await registry.list();
    expect(await settings.get(CONNECTORS_ENABLED_KEY)).toEqual([slug('shipped'), slug('later')]);
    // The neighbour key the registry does not own is untouched.
    expect(await settings.get('autonomy.level')).toBe('manual');
  });
});
