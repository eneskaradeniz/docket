// The API-key route catalog adapter (P-29 section 3): the provider's documented model-list
// endpoint, driven over the real fetch against the fake endpoint fixture
// (fixtures/fake-model-list-server.cjs), so the wire — path, query, the key's own header, the
// version header, status handling — is what production sees. The fixture's sentinel key must
// never surface in a result, an error message or the request log.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listApiKeyRouteModels } from './api-key-catalog';
import {
  createFakeModelListPool,
  FAKE_MODEL_LIST_KEY,
  type FakeModelListPool,
} from './fixtures/fake-model-list-server-harness';
import { createFakeSecretVault } from '../../../application/ports/fakes/index';
import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';

const ACCOUNT: AccountId = parseUlidOrThrow('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const SECRET_REF = 'ref-api-key';

function parseUlidOrThrow(input: string): AccountId {
  const parsed = parseUlid<'account'>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

function account(overrides?: Partial<AccountRecord>): AccountRecord {
  return {
    id: ACCOUNT,
    provider: 'agent-cli',
    label: 'main',
    authMode: 'api_key',
    limitPolicy: 'wait_resume',
    caps: [],
    secretRef: SECRET_REF,
    ...(overrides === undefined ? {} : overrides),
  };
}

/** The documented row shape: type, id, display_name and an optional capabilities block whose
 * effort object names the levels the model supports. */
const row = (id: string, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'model',
  id,
  display_name: `${id} display`,
  ...fields,
});

const page = (
  rows: readonly Record<string, unknown>[],
  extra: { readonly hasMore?: boolean; readonly lastId?: string } = {},
): string =>
  JSON.stringify({
    data: rows,
    first_id: rows.length > 0 ? String(rows[0]?.id) : null,
    has_more: extra.hasMore ?? false,
    last_id: extra.lastId ?? (rows.length > 0 ? String(rows[rows.length - 1]?.id) : null),
  });

const EFFORT_CAPS = {
  capabilities: {
    effort: {
      supported: true,
      low: { supported: true },
      medium: { supported: true },
      high: { supported: true },
      xhigh: { supported: false },
      max: { supported: false },
    },
  },
};

let pool: FakeModelListPool;

beforeAll(() => {
  pool = createFakeModelListPool();
});

afterAll(() => {
  pool.dispose();
});

const secretsWithKey = async () => {
  const secrets = createFakeSecretVault();
  await secrets.put(SECRET_REF, FAKE_MODEL_LIST_KEY);
  return secrets;
};

describe('listApiKeyRouteModels (P-29)', () => {
  it('P-29: a documented answer maps rows to live models — id verbatim, display name, efforts from the row capability block', async () => {
    const server = await pool.start([
      { status: 200, body: page([row('claude-fable-5-1[1m]', EFFORT_CAPS), row('claude-sonnet-5-5')]) },
    ]);

    const result = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: server.endpoint,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          id: 'claude-fable-5-1[1m]',
          displayName: 'claude-fable-5-1[1m] display',
          efforts: ['low', 'medium', 'high'],
        },
        { id: 'claude-sonnet-5-5', displayName: 'claude-sonnet-5-5 display' },
      ]);
    }
  });

  it('P-29: the request follows the documented shape — GET on the model-list path, the key in its own header, the version header, the maximum page size', async () => {
    const server = await pool.start([{ status: 200, body: page([row('claude-sonnet-5-5')]) }]);

    await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

    const requests = server.requests();
    expect(requests.length).toBe(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('/v1/models?limit=1000');
    expect(requests[0]?.key).toBe('match');
    expect(requests[0]?.version).toBe('2023-06-01');
  });

  it('P-29: rows without a display name or without a capability block map without those fields; unusable rows are skipped, not fatal', async () => {
    const server = await pool.start([
      {
        status: 200,
        body: JSON.stringify({
          data: [
            { type: 'model', id: 'bare-row' },
            { type: 'model', id: '', display_name: 'empty id' },
            'not an object',
            { type: 'model', display_name: 'no id at all' },
            { type: 'model', id: 'caps-off', capabilities: { effort: { supported: false, low: { supported: true } } } },
          ],
          has_more: false,
          last_id: null,
        }),
      },
    ]);

    const result = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: server.endpoint,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ id: 'bare-row' }, { id: 'caps-off' }]);
    }
  });

  it('P-29: pagination follows has_more — the next page asks after_id=last_id and the pages join in order', async () => {
    const server = await pool.start([
      { status: 200, body: page([row('claude-opus-5-5'), row('claude-sonnet-5-5')], { hasMore: true, lastId: 'claude-sonnet-5-5' }) },
      { status: 200, body: page([row('claude-haiku-4-5')]) },
    ]);

    const result = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

    const requests = server.requests();
    expect(requests.length).toBe(2);
    expect(requests[1]?.url).toBe('/v1/models?limit=1000&after_id=claude-sonnet-5-5');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual([
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-haiku-4-5',
      ]);
    }
  });

  it('P-29: an endpoint that never finishes paginating fails rather than handing back a truncated list', async () => {
    const server = await pool.start([
      { status: 200, body: page([row('claude-sonnet-5-5')], { hasMore: true, lastId: 'claude-sonnet-5-5' }) },
    ]);

    const result = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed');
  });

  it('P-29: an answer that promises more pages but names no cursor fails malformed', async () => {
    const server = await pool.start([
      { status: 200, body: JSON.stringify({ data: [row('claude-sonnet-5-5')], has_more: true, last_id: null }) },
    ]);

    const result = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed');
  });

  it('P-29: a 401 or 403 answer fails not_logged_in — the message names neither the key nor the body', async () => {
    for (const status of [401, 403]) {
      const server = await pool.start([{ status, body: JSON.stringify({ error: { message: `bad key ${FAKE_MODEL_LIST_KEY}` } }) }]);

      const result = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_logged_in');
        expect(result.error.message).not.toContain(FAKE_MODEL_LIST_KEY);
      }
    }
  });

  it('P-29: a 5xx answer fails endpoint_error and the message names the status, never the body', async () => {
    const server = await pool.start([{ status: 503, body: `overloaded ${FAKE_MODEL_LIST_KEY}` }]);

    const result = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: server.endpoint });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('endpoint_error');
      expect(result.error.message).toContain('503');
      expect(result.error.message).not.toContain(FAKE_MODEL_LIST_KEY);
    }
  });

  it('P-29: a 200 body that is not the documented shape fails malformed — not JSON, or no data array', async () => {
    const notJson = await pool.start([{ status: 200, body: '<html>not json</html>' }]);
    const asNotJson = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: notJson.endpoint,
    });
    expect(asNotJson.ok).toBe(false);
    if (!asNotJson.ok) expect(asNotJson.error.code).toBe('malformed');

    const noData = await pool.start([{ status: 200, body: JSON.stringify({ has_more: false }) }]);
    const asNoData = await listApiKeyRouteModels(account(), { secrets: await secretsWithKey(), baseUrl: noData.endpoint });
    expect(asNoData.ok).toBe(false);
    if (!asNoData.ok) expect(asNoData.error.code).toBe('malformed');
  });

  it('P-29: an account with no key in the vault fails not_logged_in before any request is made', async () => {
    const server = await pool.start([{ status: 200, body: page([row('claude-sonnet-5-5')]) }]);
    const secrets = createFakeSecretVault(); // nothing put: the ref resolves to nothing

    const noRef = await listApiKeyRouteModels(account({ secretRef: undefined }), {
      secrets,
      baseUrl: server.endpoint,
    });
    expect(noRef.ok).toBe(false);
    if (!noRef.ok) expect(noRef.error.code).toBe('not_logged_in');

    const emptyRef = await listApiKeyRouteModels(account(), { secrets, baseUrl: server.endpoint });
    expect(emptyRef.ok).toBe(false);
    if (!emptyRef.ok) expect(emptyRef.error.code).toBe('not_logged_in');

    expect(server.requests().length).toBe(0);
  });

  it('P-29: a silent endpoint times out — timeout error, and the key never appears in it', async () => {
    const server = await pool.start([{ hang: true }]);

    const result = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: server.endpoint,
      timeoutMs: 150,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.message).not.toContain(FAKE_MODEL_LIST_KEY);
    }
  }, 10_000);

  it('P-29: a failed transport — unreachable endpoint, broken base URL — fails endpoint_error or unsupported, never a throw', async () => {
    const failing = async (): Promise<never> => {
      throw new Error(`network is down ${FAKE_MODEL_LIST_KEY}`);
    };
    const unreachable = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: 'http://127.0.0.1:1',
      fetch: failing,
      timeoutMs: 500,
    });
    expect(unreachable.ok).toBe(false);
    if (!unreachable.ok) {
      expect(unreachable.error.code).toBe('endpoint_error');
      expect(unreachable.error.message).not.toContain(FAKE_MODEL_LIST_KEY);
    }

    const broken = await listApiKeyRouteModels(account(), {
      secrets: await secretsWithKey(),
      baseUrl: 'not a url',
      fetch: failing,
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.code).toBe('unsupported');
  });

  it('P-29: the key never surfaces anywhere — no result, no error, no log line carries it', async () => {
    const server = await pool.start([
      { status: 200, body: page([row('claude-sonnet-5-5')]) },
      { status: 500, body: `boom ${FAKE_MODEL_LIST_KEY}` },
    ]);
    const secrets = await secretsWithKey();

    const good = await listApiKeyRouteModels(account(), { secrets, baseUrl: server.endpoint });
    server.setPayload([{ status: 500, body: `boom ${FAKE_MODEL_LIST_KEY}` }]);
    const bad = await listApiKeyRouteModels(account(), { secrets, baseUrl: server.endpoint });

    const seen = JSON.stringify({ good, bad });
    expect(seen).not.toContain(FAKE_MODEL_LIST_KEY);
    expect(readFileSync(server.logPath, 'utf8')).not.toContain(FAKE_MODEL_LIST_KEY);
  });
});
