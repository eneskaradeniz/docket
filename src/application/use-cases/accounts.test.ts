// accounts use cases — rules A-13 (saveAccount / removeAccount) and A-14 (saveBinding) from
// docs/v2/application.md, driven over the in-memory port fakes. The secret-leak acceptance test
// serialises every fake store and asserts the secret string appears nowhere it must not.
import { describe, expect, it } from 'vitest';

import {
  isUlid,
  parseSlug,
  parseUlid,
  type AccountId,
  type AccountRoute,
  type Actor,
  type RoleBinding,
  type Slug,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord, AppDeps, BindingScope } from '../ports';
import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeSecretVault,
  type FakeEventLog,
  type FakeRouteKind,
  type FakeSecretVault,
} from '../ports/fakes';

import { removeAccount, saveAccount, saveBinding } from './accounts';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const OTHER_ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA3');

const SECRET = 'sk-super-secret-value-123';
const SECRET_REF = `account/${ACCOUNT}/api-key`;

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-a',
  label: 'Work account',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const bindingFor = (role: string, accounts: readonly AccountRoute[] = [{ accountId: ACCOUNT }]): RoleBinding => ({
  role: slugOf<'role'>(role),
  accounts,
});

const GLOBAL_SCOPE: BindingScope = { level: 'global' };
const REPO_SCOPE: BindingScope = { level: 'repo', repo: slugOf<'repo'>('ws') };
const WORK_ORDER_SCOPE: BindingScope = { level: 'workOrder', workOrderId: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV') };

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
  readonly secrets: FakeSecretVault;
}

const makeHarness = (routeKinds: readonly FakeRouteKind[] = []): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const secrets = createFakeSecretVault();
  const deps = createFakeDeps({ clock, log, secrets, capabilities: createFakeCapabilityCatalog(routeKinds) });
  return { deps, log, secrets };
};

// --- saveAccount (A-13) -----------------------------------------------------------------------------

describe('saveAccount', () => {
  it('A-13: stores a secret only through the vault; the secret appears in no record, audit entry or return value', async () => {
    const h = makeHarness();
    const record = accountRecord({ secretRef: SECRET_REF });

    const result = await saveAccount(h.deps, { record, secret: SECRET, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    // The one legitimate copy lives in the vault, keyed by the record's ref.
    expect(await h.deps.secrets.get(SECRET_REF)).toBe(SECRET);
    // Serialise every fake store: the record store, the audit trail and the return value.
    const snapshot = JSON.stringify({ records: await h.deps.accounts.list(), audit: h.log.entries(), result });
    expect(snapshot).not.toContain(SECRET);
    // The record itself is stored verbatim, secretRef pointing at the vault key.
    expect(await h.deps.accounts.get(ACCOUNT)).toEqual(record);
  });

  it('A-13: a secret without a secretRef fails with secret_without_ref and writes nothing', async () => {
    const h = makeHarness();
    const record = accountRecord(); // no secretRef

    const result = await saveAccount(h.deps, { record, secret: SECRET, actor: USER });

    expect(result).toEqual({ ok: false, error: 'secret_without_ref' });
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('A-13: saving without a secret leaves the vault untouched', async () => {
    const h = makeHarness();

    const result = await saveAccount(h.deps, { record: accountRecord(), actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.list()).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]).toMatchObject({
      at: 1_000,
      actor: USER,
      action: 'account.saved',
      subject: { kind: 'account', id: ACCOUNT },
    });
  });

  it('A-13: re-saving the same ref without a secret keeps the stored secret', async () => {
    const h = makeHarness();
    await saveAccount(h.deps, { record: accountRecord({ secretRef: SECRET_REF }), secret: SECRET, actor: USER });

    const result = await saveAccount(h.deps, { record: accountRecord({ secretRef: SECRET_REF, label: 'Renamed' }), actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.secrets.get(SECRET_REF)).toBe(SECRET);
    expect((await h.deps.accounts.get(ACCOUNT))?.label).toBe('Renamed');
  });

  it('saveAccount appends exactly one audit entry and never mutates the input record', async () => {
    const h = makeHarness();
    const record = accountRecord({ secretRef: SECRET_REF });
    const before = JSON.parse(JSON.stringify(record)) as AccountRecord;

    await saveAccount(h.deps, { record, secret: SECRET, actor: USER });

    expect(record).toEqual(before);
    expect(h.log.entries()).toHaveLength(1);
    expect(isUlid(h.log.entries()[0].id)).toBe(true);
  });

  // --- route fields (A-43, A-44) -------------------------------------------------------------------

  // `route-endpoint` plays a compatible-endpoint preset: it fixes the host A-43 matches against;
  // `route-machine` fixes none, like the machine-login routes the registry ships today.
  const ROUTE_KINDS: readonly FakeRouteKind[] = [
    { id: 'route-endpoint', provider: 'provider-a', authMode: 'api_key', endpointHost: 'api.preset.example' },
    { id: 'route-machine', provider: 'provider-a', authMode: 'subscription' },
  ];

  it('A-43: an endpoint that is not an https URL fails with invalid_endpoint and writes nothing', async () => {
    const h = makeHarness(ROUTE_KINDS);

    const http = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', secretRef: SECRET_REF, endpoint: 'http://api.preset.example/v1' }),
      secret: SECRET,
      actor: USER,
    });
    const unparsable = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', endpoint: 'api.preset.example' }),
      actor: USER,
    });

    expect(http).toEqual({ ok: false, error: 'invalid_endpoint' });
    expect(unparsable).toEqual({ ok: false, error: 'invalid_endpoint' });
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(await h.deps.secrets.get(SECRET_REF)).toBeUndefined();
    expect(h.log.entries()).toEqual([]);
  });

  it('A-43: an endpoint whose host differs from the host fixed by the account’s route kind fails with endpoint_mismatch', async () => {
    const h = makeHarness(ROUTE_KINDS);

    // provider-a + api_key resolves to route-endpoint by default, whose host is api.preset.example.
    const result = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', endpoint: 'https://api.other.example/v1' }),
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'endpoint_mismatch' });
    expect(await h.deps.accounts.list()).toEqual([]);
  });

  it('A-43: a matching host passes; an explicit routeKind replaces the default; no fixed host means nothing to mismatch', async () => {
    const h = makeHarness(ROUTE_KINDS);

    const matching = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', endpoint: 'https://api.preset.example/v1' }),
      actor: USER,
    });
    const explicit = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', routeKind: 'route-machine', endpoint: 'https://any.example/v1' }),
      actor: USER,
    });
    const hostlessDefault = await saveAccount(h.deps, {
      record: accountRecord({ endpoint: 'https://any.example/v1' }), // subscription default: route-machine
      actor: USER,
    });

    expect(matching).toEqual({ ok: true, value: undefined });
    expect(explicit).toEqual({ ok: true, value: undefined });
    expect(hostlessDefault).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.list()).toHaveLength(1); // the same id upserts
  });

  it('A-43: an identityDir that is not an absolute path, or set on a non-subscription account, fails with identity_dir_not_allowed', async () => {
    const h = makeHarness(ROUTE_KINDS);

    const relative = await saveAccount(h.deps, {
      record: accountRecord({ identityDir: 'configs/agent-a' }),
      actor: USER,
    });
    const wrongMode = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', identityDir: '/Users/op/.config/agent-a' }),
      actor: USER,
    });
    const allowed = await saveAccount(h.deps, {
      record: accountRecord({ identityDir: '/Users/op/.config/agent-a' }),
      actor: USER,
    });

    expect(relative).toEqual({ ok: false, error: 'identity_dir_not_allowed' });
    expect(wrongMode).toEqual({ ok: false, error: 'identity_dir_not_allowed' });
    expect(allowed).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.list()).toHaveLength(1);
  });

  it('A-43: validation order — secret_without_ref first, then invalid_endpoint, endpoint_mismatch, identity_dir_not_allowed', async () => {
    const h = makeHarness(ROUTE_KINDS);

    const noRef = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', endpoint: 'http://wrong.example', identityDir: 'relative' }),
      secret: SECRET,
      actor: USER,
    });
    const notHttps = await saveAccount(h.deps, {
      record: accountRecord({ authMode: 'api_key', secretRef: SECRET_REF, endpoint: 'http://wrong.example', identityDir: 'relative' }),
      secret: SECRET,
      actor: USER,
    });
    const hostMismatch = await saveAccount(h.deps, {
      record: accountRecord({
        authMode: 'api_key',
        secretRef: SECRET_REF,
        endpoint: 'https://wrong.example/v1',
        identityDir: 'relative',
      }),
      secret: SECRET,
      actor: USER,
    });
    const identity = await saveAccount(h.deps, {
      record: accountRecord({
        authMode: 'api_key',
        secretRef: SECRET_REF,
        endpoint: 'https://api.preset.example/v1',
        identityDir: 'relative',
      }),
      secret: SECRET,
      actor: USER,
    });

    expect(noRef).toEqual({ ok: false, error: 'secret_without_ref' });
    expect(notHttps).toEqual({ ok: false, error: 'invalid_endpoint' });
    expect(hostMismatch).toEqual({ ok: false, error: 'endpoint_mismatch' });
    expect(identity).toEqual({ ok: false, error: 'identity_dir_not_allowed' });
    // No leg wrote anything — not the record, not the secret, not the audit trail.
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(await h.deps.secrets.get(SECRET_REF)).toBeUndefined();
    expect(h.log.entries()).toEqual([]);
  });

  it('A-44: a record saved before the route fields existed reads back unchanged — no defaults are injected', async () => {
    const h = makeHarness(ROUTE_KINDS);
    const record = accountRecord({ secretRef: SECRET_REF });

    await saveAccount(h.deps, { record, secret: SECRET, actor: USER });

    expect(await h.deps.accounts.get(ACCOUNT)).toEqual(record);
    expect(await h.deps.accounts.list()).toEqual([record]);
  });
});

// --- removeAccount (A-13) ---------------------------------------------------------------------------

describe('removeAccount', () => {
  it('A-13: removing an account removes the vault entry too', async () => {
    const h = makeHarness();
    await saveAccount(h.deps, { record: accountRecord({ secretRef: SECRET_REF }), secret: SECRET, actor: USER });

    const result = await removeAccount(h.deps, { id: ACCOUNT, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toBeUndefined();
    expect(await h.deps.secrets.get(SECRET_REF)).toBeUndefined();
    const audit = h.log.entries();
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      at: 1_000,
      actor: USER,
      action: 'account.removed',
      subject: { kind: 'account', id: ACCOUNT },
    });
  });

  it('removing an unknown account fails with not_found and writes nothing', async () => {
    const h = makeHarness();

    const result = await removeAccount(h.deps, { id: ACCOUNT, actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.log.entries()).toEqual([]);
  });

  it('removing an account without a secretRef succeeds without touching the vault', async () => {
    const h = makeHarness();
    await saveAccount(h.deps, { record: accountRecord(), actor: USER });

    const result = await removeAccount(h.deps, { id: ACCOUNT, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.list()).toEqual([]);
  });

  it('U-13: removing an account referenced by any binding fails with binding_exists listing the referencing roles', async () => {
    const h = makeHarness();
    await saveAccount(h.deps, { record: accountRecord(), actor: USER });
    await saveAccount(h.deps, { record: accountRecord({ id: OTHER_ACCOUNT, label: 'Spare' }), actor: USER });
    await saveBinding(h.deps, { scope: GLOBAL_SCOPE, binding: bindingFor('worker'), actor: USER });
    await saveBinding(h.deps, {
      scope: REPO_SCOPE,
      binding: bindingFor('reviewer', [{ accountId: ACCOUNT }, { accountId: OTHER_ACCOUNT }]),
      actor: USER,
    });
    // Same role as the global binding, but routed elsewhere: it must not add a duplicate role.
    await saveBinding(h.deps, {
      scope: WORK_ORDER_SCOPE,
      binding: bindingFor('worker', [{ accountId: OTHER_ACCOUNT }]),
      actor: USER,
    });

    const result = await removeAccount(h.deps, { id: ACCOUNT, actor: USER });

    expect(result).toEqual({
      ok: false,
      error: { code: 'binding_exists', roles: [slugOf<'role'>('worker'), slugOf<'role'>('reviewer')] },
    });
    // The refusal happens before any write: the account stays, no removal is audited.
    expect(await h.deps.accounts.get(ACCOUNT)).toBeDefined();
    const audit = h.log.entries();
    expect(audit).toHaveLength(5); // two account saves and three binding saves, nothing else
    expect(audit.some((entry) => entry.action === 'account.removed')).toBe(false);
  });

  it('U-13: bindings that route only to other accounts do not block the removal', async () => {
    const h = makeHarness();
    await saveAccount(h.deps, { record: accountRecord(), actor: USER });
    await saveAccount(h.deps, { record: accountRecord({ id: OTHER_ACCOUNT, label: 'Spare' }), actor: USER });
    await saveBinding(h.deps, {
      scope: GLOBAL_SCOPE,
      binding: bindingFor('worker', [{ accountId: OTHER_ACCOUNT }]),
      actor: USER,
    });

    const result = await removeAccount(h.deps, { id: ACCOUNT, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toBeUndefined();
  });
});

// --- saveBinding (A-14) -----------------------------------------------------------------------------

describe('saveBinding', () => {
  it('A-14: an empty account chain fails with empty_chain and writes nothing', async () => {
    const h = makeHarness();

    const result = await saveBinding(h.deps, { scope: GLOBAL_SCOPE, binding: bindingFor('reviewer', []), actor: USER });

    expect(result).toEqual({ ok: false, error: 'empty_chain' });
    expect(await h.deps.bindings.get(GLOBAL_SCOPE, slugOf<'role'>('reviewer'))).toBeUndefined();
    expect(h.log.entries()).toEqual([]);
  });

  it('A-14: saves the binding and appends one binding.saved audit entry naming the role', async () => {
    const h = makeHarness();
    const role = slugOf<'role'>('reviewer');
    const binding = bindingFor('reviewer', [{ accountId: ACCOUNT }, { accountId: OTHER_ACCOUNT }]);

    const result = await saveBinding(h.deps, { scope: REPO_SCOPE, binding, actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.bindings.get(REPO_SCOPE, role)).toEqual(binding);
    const audit = h.log.entries();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      at: 1_000,
      actor: USER,
      action: 'binding.saved',
      subject: { kind: 'binding', role },
      detail: { role: 'reviewer' },
    });
  });

  it('saves per scope, so global, repo and work-order levels stay independent', async () => {
    const h = makeHarness();
    const role = slugOf<'role'>('worker');

    await saveBinding(h.deps, { scope: GLOBAL_SCOPE, binding: bindingFor('worker', [{ accountId: ACCOUNT }]), actor: USER });
    await saveBinding(h.deps, {
      scope: WORK_ORDER_SCOPE,
      binding: bindingFor('worker', [{ accountId: OTHER_ACCOUNT }]),
      actor: USER,
    });

    expect(await h.deps.bindings.get(GLOBAL_SCOPE, role)).toEqual(bindingFor('worker', [{ accountId: ACCOUNT }]));
    expect(await h.deps.bindings.get(WORK_ORDER_SCOPE, role)).toEqual(bindingFor('worker', [{ accountId: OTHER_ACCOUNT }]));
    expect(h.log.entries()).toHaveLength(2);
  });
});
