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
import { createFakeClock, createFakeDeps, createFakeEventLog, createFakeSecretVault, type FakeEventLog, type FakeSecretVault } from '../ports/fakes';

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

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const secrets = createFakeSecretVault();
  const deps = createFakeDeps({ clock, log, secrets });
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
