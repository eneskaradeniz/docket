// account-test.test.ts — U-39: the "Test et" rules. The row's `test` view becomes one result line,
// a `model` failure becomes the "Model hatası" status, each refusal has its label, the store
// disables the button while the command is open and re-queries on the answer, and no output text
// ever reaches a line (only the redacted `detail`, for the closed "Ayrıntı" disclosure).
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { AccountTestView, SettingsAccountView, SettingsAccountsView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import { accountStatus, accountStatusTone } from './account-editor';
import { accountTestLine, isModelError, providerUnverified, relativeTime, testRefusal } from './account-test';
import { providerRows } from './candidates';
import { commandResultKey } from './results';
import { createSettingsStore } from './settings';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const ACCOUNT: SettingsAccountView = {
  id: 'acc-1',
  provider: 'acme',
  label: 'Main',
  authMode: 'subscription',
  plan: null,
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
};

const failed = (cls: NonNullable<AccountTestView['class']>, detail: string | null = null): AccountTestView => ({
  state: 'failed',
  class: cls,
  model: null,
  at: 1_000,
  detail,
});

describe('U-39: the result line', () => {
  it('U-39: a never-tested account reads "Test edilmedi"', () => {
    expect(accountTestLine(null)).toEqual({ kind: 'untested', lead: 'accountTest.untested' });
    expect(TR['accountTest.untested']).toBe('Test edilmedi');
  });

  it('U-39: an ok view reads "Çalışıyor" with its time and model', () => {
    const line = accountTestLine({ state: 'ok', class: null, model: null, at: 5_000, detail: null });
    expect(line).toEqual({ kind: 'ok', lead: 'accountTest.ok', at: 5_000, model: null });
    expect(TR['accountTest.ok']).toBe('Çalışıyor');
    expect(TR['accountTest.defaultModel']).toBe('asistanın varsayılanı');
  });

  it('U-39: each failed class maps to its own sentence', () => {
    const expected = {
      auth: 'Giriş gerekli ya da anahtar geçersiz',
      limit: 'Bu model şu an kullanılamıyor — plan limiti',
      model: 'Bu model bu hesapta kullanılamıyor',
      network: 'Bağlantı kurulamadı ya da yanıt gelmedi',
      install: 'Asistan bu makinede çalıştırılamadı',
      unknown: 'Test başarısız oldu',
    } as const;
    for (const [cls, text] of Object.entries(expected)) {
      const line = accountTestLine(failed(cls as NonNullable<AccountTestView['class']>));
      expect(line.kind).toBe('failed');
      expect(TR[line.lead], cls).toBe(text);
      expect(EN[line.lead].length, cls).toBeGreaterThan(0);
    }
  });

  it('U-39: a running record reads as running', () => {
    expect(accountTestLine({ state: 'running', class: null, model: null, at: 1, detail: null }).kind).toBe('running');
  });

  it('U-39: detail is carried only when it is not empty; no other text of a test is ever read', () => {
    const withDetail = accountTestLine(failed('network', 'ECONNRESET'));
    expect(withDetail).toMatchObject({ kind: 'failed', detail: 'ECONNRESET' });
    for (const empty of [null, '', '   ']) {
      expect(accountTestLine(failed('network', empty)), String(empty)).toMatchObject({ detail: null });
    }
    // The line's shape has no field for the model's output: lead, time, model name, detail.
    expect(Object.keys(withDetail).sort()).toEqual(['at', 'detail', 'kind', 'lead', 'model']);
    expect(Object.keys(accountTestLine({ state: 'ok', class: null, model: 'm', at: 1, detail: 'ignored' })).sort()).toEqual(['at', 'kind', 'lead', 'model']);
  });

  it('U-39: the time reads relative to now in the active locale', () => {
    expect(relativeTime('en', 1_000, 1_000 + 3 * 60_000)).toBe('3 min. ago');
    expect(relativeTime('en', 1_000, 1_500)).toBe('now');
    expect(relativeTime('tr', 0, 2 * 3_600_000)).toContain('2');
  });
});

describe('U-39: the Model hatası status', () => {
  it('U-39: a failed test of class model sets the row status to "Model hatası" with the error tone', () => {
    const account = { ...ACCOUNT, test: failed('model') };
    expect(isModelError(account.test)).toBe(true);
    expect(accountStatus(account)).toBe('modelError');
    expect(accountStatusTone('modelError')).toBe('error');
    expect(TR['editor.status.modelError']).toBe('Model hatası');
  });

  it('U-39: other classes, ok and untested leave the status to the meters', () => {
    for (const cls of ['auth', 'limit', 'network', 'install', 'unknown'] as const) {
      expect(accountStatus({ ...ACCOUNT, test: failed(cls) }), cls).toBe('noData');
    }
    expect(accountStatus({ ...ACCOUNT, test: { state: 'ok', class: null, model: null, at: 1, detail: null } })).toBe('noData');
    expect(accountStatus(ACCOUNT)).toBe('noData');
  });
});

describe('U-39: refusals', () => {
  it('U-39: each refusal has its label; needs_spend_consent also links to Modeller', () => {
    const expected = {
      needs_spend_consent: "Bu model ücretli ya da doğrulanmadı — önce Modeller'de izin ve tavan ver",
      spend_cap_reached: 'Harcama tavanı doldu',
      busy: 'Test zaten sürüyor',
      unsupported: 'Bu hesap test edilemiyor',
      not_found: TR['error.not_found'],
    };
    for (const [code, text] of Object.entries(expected)) {
      const refusal = testRefusal(code);
      expect(TR[refusal.labelKey], code).toBe(text);
      expect(refusal.modelsLink, code).toBe(code === 'needs_spend_consent');
    }
  });

  it('U-39: a finished account.test maps to its own success key', () => {
    expect(commandResultKey('account.test', { ok: true })).toBe('success.account.test');
  });
});

describe('U-39: which rows carry the button', () => {
  it('U-39: only a provider whose login probe proved nothing reads Doğrulanamadı', () => {
    const rows = providerRows([
      { defId: 'ready', name: 'Ready', installUrl: null, binPath: '/bin/r', version: null, loggedIn: true, optionalFlags: [] },
      { defId: 'out', name: 'Out', installUrl: null, binPath: '/bin/o', version: null, loggedIn: false, optionalFlags: [] },
      { defId: 'unk', name: 'Unk', installUrl: null, binPath: '/bin/u', version: null, loggedIn: null, optionalFlags: [] },
      { defId: 'gone', name: 'Gone', installUrl: 'https://x.invalid', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);
    expect(rows.filter((row) => providerUnverified(rows, row.id)).map((row) => row.id)).toEqual(['unk']);
    expect(providerUnverified(rows, 'not-listed')).toBe(false);
  });

  it('U-39: the wizard line "Kurulumdan sonra Ayarlar\'da test edebilirsin" rides only the Doğrulanamadı provider', () => {
    const rows = providerRows([
      { defId: 'unk', name: 'Unk', installUrl: null, binPath: '/bin/u', version: null, loggedIn: null, optionalFlags: [] },
      { defId: 'out', name: 'Out', installUrl: null, binPath: '/bin/o', version: null, loggedIn: false, optionalFlags: [] },
    ]);
    expect(rows[0]?.testLaterKey).toBe('candidates.hint.testLater');
    expect(rows[1]?.testLaterKey).toBeNull();
    expect(TR['candidates.hint.testLater']).toBe("Kurulumdan sonra Ayarlar'da test edebilirsin");
  });
});

describe('U-39: the store intent', () => {
  const VIEW: SettingsAccountsView = { accounts: [ACCOUNT], bindings: [] };

  const harness = (result: CommandResult) => {
    const commands: Command[] = [];
    let queries = 0;
    let release: ((value: CommandResult) => void) | null = null;
    const api: Pick<Api, 'query' | 'command'> = {
      query: () => {
        queries += 1;
        return Promise.resolve(VIEW);
      },
      command: (_actor, command) => {
        commands.push(command);
        return new Promise<CommandResult>((resolve) => {
          release = resolve;
        });
      },
    };
    const store = createSettingsStore({
      api,
      changes: () => () => undefined,
      actor: ACTOR,
      locale: () => 'tr',
    });
    return { store, commands, queries: () => queries, answer: () => release?.(result) };
  };

  it('U-39: account.test sends no model, disables the button while open and re-queries on the answer', async () => {
    const h = harness({ ok: true });
    await h.store.load();
    const before = h.queries();
    const pending = h.store.testAccount('acc-1');
    expect(h.commands).toEqual([{ type: 'account.test', id: 'acc-1' }]);
    expect('model' in (h.commands[0] ?? {})).toBe(false);
    expect(h.store.state().testing).toEqual(['acc-1']);

    // A second press while the command is open sends nothing.
    await h.store.testAccount('acc-1');
    expect(h.commands).toHaveLength(1);

    h.answer();
    await pending;
    expect(h.store.state().testing).toEqual([]);
    expect(h.queries()).toBe(before + 1);
    expect(h.store.state().testRefusals).toEqual({});
  });

  it('U-39: a refusal lands under that account and clears when its next test starts', async () => {
    const h = harness({ ok: false, code: 'needs_spend_consent' });
    await h.store.load();
    const pending = h.store.testAccount('acc-1');
    h.answer();
    await pending;
    expect(h.store.state().testRefusals['acc-1']).toEqual(testRefusal('needs_spend_consent'));
    expect(h.store.state().testing).toEqual([]);

    void h.store.testAccount('acc-1');
    expect(h.store.state().testRefusals).toEqual({});
    expect(h.store.state().testing).toEqual(['acc-1']);
  });
});
