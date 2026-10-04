import { describe, expect, it } from 'vitest';

import type { SettingsAccountView } from '../../api/queries';
import { settingsAccountRows } from './settings-accounts';
import type { AccountDisplay } from './settings';

const view = (patch: Partial<SettingsAccountView>): SettingsAccountView => ({
  id: 'acc-1',
  provider: 'claude',
  label: 'Max',
  authMode: 'subscription',
  billing: 'included',
  plan: null,
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: '~/.claude-max',
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
  ...patch,
});

const display = (detail: SettingsAccountView): AccountDisplay => ({
  id: detail.id,
  provider: detail.provider,
  label: detail.label,
  authMode: detail.authMode,
  plan: detail.plan,
  pools: detail.pools,
  meters: [],
  detail,
});

describe('settings account rows (U-43)', () => {
  it('U-43: a stored account becomes a row with its billing, path, host and status', () => {
    const [row] = settingsAccountRows([display(view({}))], []);
    expect(row).toMatchObject({ id: 'acc-1', providerId: 'claude', label: 'Max', billing: 'included', viaKey: false, path: '~/.claude-max', host: null, status: 'noData', unverified: false });
  });

  it('U-43: the billing tag follows the billing view — a key-based coding plan is a subscription, an unknown key is not', () => {
    const rows = settingsAccountRows(
      [
        display(view({ id: 'a', authMode: 'api_key', billing: 'included', endpointHost: 'api.z.ai', identityDir: null })),
        display(view({ id: 'b', authMode: 'api_key', billing: 'unknown', identityDir: null })),
      ],
      [],
    );
    expect(rows.map((row) => [row.billing, row.viaKey, row.path])).toEqual([
      ['included', true, ''],
      ['unknown', true, ''],
    ]);
    expect(rows[0]?.host).toBe('api.z.ai');
  });

  it('U-43: only an account whose provider reads Doğrulanamadı carries Test et', () => {
    const rows = settingsAccountRows(
      [display(view({ id: 'a', provider: 'claude' })), display(view({ id: 'b', provider: 'codex' }))],
      [
        { id: 'claude', statusKey: 'candidates.status.ready' },
        { id: 'codex', statusKey: 'candidates.status.unknown' },
      ],
    );
    expect(rows.map((row) => row.unverified)).toEqual([false, true]);
  });

  it('U-43: a failed test of class model sets the status to Model hatası in the error tone', () => {
    const failed = view({ test: { state: 'failed', class: 'model', at: 1, model: null, detail: '' } as unknown as SettingsAccountView['test'] });
    const [row] = settingsAccountRows([display(failed)], []);
    expect(row?.status).toBe('modelError');
    expect(row?.tone).toBe('error');
  });
});
