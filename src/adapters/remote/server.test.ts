// src/adapters/remote/server.test.ts — the real server on 127.0.0.1:0 against core fakes
// (WO-0102, plan §8). The deps shape is itself the never-a-verdict pin: RemoteServerDeps carries
// no gate (planApprovedFor/budgetBlockFor/backendProfileFor are not on it — the routes CANNOT
// consult one); this file pins the delegate wiring (exact arguments recorded) and the whole
// refusal taxonomy, the WS tail/live sequence, ticket single-use, and the secrets bound (no key,
// token or hash ever rides an event payload — acceptance 5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { createRemoteServer } from './server';
import {
  PAIRING_MAX_ATTEMPTS,
  REMOTE_API_VERSION,
  REMOTE_TAIL_WINDOW,
  grantExpiresAt,
  pairingVerdict,
  type DeviceView,
  type PairingExchangeResult,
  type RemoteConsoleView,
  type RemoteServerDeps,
  type RemoteWsMessage,
} from '../../core/remote';
import type { DeviceStore } from '../../core/device-store';
import type { RunnerEvent } from '../../core/runner';

// ===== The fakes (core-shaped; the composition root is the other implementor) =====

const nowRef = { iso: '2026-09-24T12:00:00.000Z' };
const MINT_CODE = '123456';
const DEVICE_KEY = `dk_${'ab'.repeat(32)}`; // fixture-shaped (64 hex)
const KEY_HASH = createHash('sha256').update(DEVICE_KEY).digest('hex');

/** Applies core's pairingVerdict exactly as the SQL half does (one live grant; wrong codes spend
 *  the strike budget; a used row stays marked; dead rows are cleaned up). */
class FakeDevices implements DeviceStore {
  private grant: { code: string; expiresAt: string; attemptsLeft: number; used: boolean } | undefined;
  devices: DeviceView[] = [];

  async mintGrant(now: string) {
    this.grant = { code: MINT_CODE, expiresAt: grantExpiresAt(now), attemptsLeft: PAIRING_MAX_ATTEMPTS, used: false };
    return { code: MINT_CODE, expiresAt: this.grant.expiresAt, attemptsLeft: PAIRING_MAX_ATTEMPTS };
  }

  async exchange(code: string, deviceName: string, now: string): Promise<PairingExchangeResult> {
    const verdict = pairingVerdict(this.grant, code, now);
    if (verdict.kind === 'ok') {
      const id = 'dv_fixture1';
      this.devices.push({ id, name: deviceName, createdAt: now, lastSeenAt: null });
      this.grant!.used = true;
      return { kind: 'paired', deviceId: id, deviceKey: DEVICE_KEY };
    }
    if (verdict.kind === 'wrong_code') {
      this.grant!.attemptsLeft = verdict.attemptsLeft;
      return { kind: 'invalid_code', attemptsLeft: verdict.attemptsLeft };
    }
    if (this.grant !== undefined) this.grant = undefined;
    return { kind: 'dead', reason: verdict.reason };
  }

  async listDevices() {
    return [...this.devices];
  }
  async revokeDevice(id: string) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    return this.devices.length < before;
  }
  async deviceByKeyHash(keyHash: string, now: string) {
    // the fake keys devices by the same hash the server computes from the bearer
    const d = this.devices.length > 0 && keyHash === KEY_HASH ? this.devices[0] : undefined;
    return d ? { ...d, lastSeenAt: now } : undefined;
  }
}

const devices = new FakeDevices();
const calls: Array<{ intent: string; args: unknown[] }> = [];
const scripted = {
  answerAsk: 'resolved' as 'resolved' | 'unknown',
  stopDrive: true,
  resumeDrive: 'spawned' as 'spawned' | 'no_retained' | 'running',
  raiseBudget: { raised: true, rerun: false } as { raised: boolean; rerun: boolean } | 'unknown_workspace',
  approveDraft: 'approved' as 'approved' | 'no_draft' | 'unparsable',
  rejectDraft: 'discarded' as 'discarded' | 'no_draft',
};
const tailData: Array<{ owner: string; events: RunnerEvent[] }> = [];
const taps = new Set<(owner: string, ev: RunnerEvent) => void>();
const settingsState = { locale: 'tr' as 'tr' | 'en' | null, theme: 'system' as 'system' | 'light' | 'dark' };
const consoleFixture: RemoteConsoleView = {
  version: REMOTE_API_VERSION,
  drives: [{ owner: 'wo:WO-0001', kind: 'wo', workspaceId: 'ws-a' as never, woId: 'WO-0001' as never, title: 'İş', role: 'implementer', status: 'running' }],
  asks: [],
  health: [],
  workspaces: [{ id: 'ws-a' as never, label: 'Atölye' }],
  quiet: false,
};
let ticketSeq = 0;

const deps: RemoteServerDeps = {
  now: () => nowRef.iso,
  devices,
  consoleView: async () => consoleFixture,
  readSettings: async () => ({ locale: settingsState.locale, theme: settingsState.theme, workspaces: [] }),
  writeSettings: async (patch) => {
    if (patch.locale !== undefined) settingsState.locale = patch.locale;
    if (patch.theme !== undefined) settingsState.theme = patch.theme;
    return { locale: settingsState.locale, theme: settingsState.theme, workspaces: [] };
  },
  intents: {
    answerAsk: async (requestId, answer) => {
      calls.push({ intent: 'answerAsk', args: [requestId, answer] });
      return scripted.answerAsk;
    },
    stopDrive: async (owner) => {
      calls.push({ intent: 'stopDrive', args: [owner] });
      return scripted.stopDrive;
    },
    resumeDrive: async (owner) => {
      calls.push({ intent: 'resumeDrive', args: [owner] });
      return scripted.resumeDrive;
    },
    raiseBudget: async (workspaceId, capUsd) => {
      calls.push({ intent: 'raiseBudget', args: [workspaceId, capUsd] });
      return scripted.raiseBudget;
    },
    approveDraft: async (workspaceId) => {
      calls.push({ intent: 'approveDraft', args: [workspaceId] });
      return scripted.approveDraft;
    },
    rejectDraft: async (workspaceId) => {
      calls.push({ intent: 'rejectDraft', args: [workspaceId] });
      return scripted.rejectDraft;
    },
  },
  stream: {
    tail: () => tailData,
    tap: (fn) => {
      taps.add(fn);
      return () => taps.delete(fn);
    },
  },
  ids: {
    ticket: () => `wt_test${ticketSeq++}`,
    keyHash: (key) => createHash('sha256').update(key).digest('hex'),
  },
  log: () => {},
};

let base = '';
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const server = createRemoteServer(deps);
  const handle = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${handle.port}`;
  close = handle.close;
});
afterAll(async () => {
  await close?.();
});

const authed = (key: string): RequestInit => ({ headers: { authorization: `Bearer ${key}` } });

/** Pair once against the fixture grant — returns the device key. Resets the fixture registry so
 *  each test pairs against exactly one device. */
const pair = async (code = MINT_CODE): Promise<{ status: number; body: Record<string, unknown> }> => {
  devices.devices = [];
  await devices.mintGrant(nowRef.iso);
  const res = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName: 'Pixel 9' }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('remote server (WO-0102) — pairing + the happy path', () => {
  it('pairs: the code exchanges once for a device key', async () => {
    const { status, body } = await pair();
    expect(status).toBe(200);
    expect(body.deviceKey).toBe(DEVICE_KEY);
    expect(String(body.deviceId)).toMatch(/^dv_/);
  });

  it('reads the console, settings and devices with the paired key; a write lands through the delegate', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const consoleRes = await fetch(`${base}/console`, authed(key));
    expect(consoleRes.status).toBe(200);
    expect(await consoleRes.json()).toEqual(consoleFixture);

    const put = await fetch(`${base}/settings`, {
      ...authed(key),
      method: 'PUT',
      headers: { ...authed(key).headers, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', locale: 'en' }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ locale: 'en', theme: 'dark' });

    const devicesRes = await fetch(`${base}/devices`, authed(key));
    expect(await devicesRes.json()).toMatchObject({ devices: [{ id: expect.any(String), name: 'Pixel 9' }] });
  });

  it('revokes a device and its key stops authenticating (401 on every route)', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const id = body.deviceId as string;
    const del = await fetch(`${base}/devices/${id}`, { ...authed(key), method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ revoked: id });
    const after = await fetch(`${base}/console`, authed(key));
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: string }).error).toBe('unknown_bearer');
    // a second revoke is an honest 404
    const again = await fetch(`${base}/devices/${id}`, { ...authed(key), method: 'DELETE' });
    expect(again.status).toBe(401); // the revoking key was the revoked device's own key
  });
});

describe('remote server (WO-0102) — the refusal taxonomy', () => {
  it('refuses unknown bearers with 401 on every authenticated route', async () => {
    for (const [method, path] of [
      ['GET', '/console'],
      ['GET', '/settings'],
      ['PUT', '/settings'],
      ['GET', '/devices'],
      ['POST', '/ws-ticket'],
      ['POST', '/drives/wo:WO-0001/stop'],
      ['POST', '/budget/raise-and-rerun'],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method, ...authed('dk_bogus') });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('unknown_bearer');
    }
  });

  it('410 dead tokens: expired, used, struck, unknown', async () => {
    // expired — the clock passes the TTL
    await devices.mintGrant(nowRef.iso);
    nowRef.iso = '2026-09-24T12:05:00.001Z';
    let res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: MINT_CODE, deviceName: 'X' }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'token_dead', reason: 'expired' });
    nowRef.iso = '2026-09-24T12:00:00.000Z';

    // used — a replayed code after a successful exchange
    const { body } = await pair();
    res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: MINT_CODE, deviceName: 'X' }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'token_dead', reason: 'used' });
    expect(body.deviceKey).toBe(DEVICE_KEY);

    // struck — five wrong codes kill the token; the 4th reports the remaining budget
    await devices.mintGrant(nowRef.iso);
    for (let i = 0; i < PAIRING_MAX_ATTEMPTS - 1; i++) {
      res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: '000000', deviceName: 'X' }) });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'invalid_code', attemptsLeft: PAIRING_MAX_ATTEMPTS - 1 - i });
    }
    res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: '000000', deviceName: 'X' }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'token_dead', reason: 'struck' });
    // struck out: even the RIGHT code is refused now (the row is gone)
    res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: MINT_CODE, deviceName: 'X' }) });
    expect(await res.json()).toMatchObject({ error: 'token_dead', reason: 'unknown' });

    // unknown — no outstanding grant at all
    res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: '999999', deviceName: 'X' }) });
    expect(await res.json()).toMatchObject({ error: 'token_dead', reason: 'unknown' });
  });

  it('400 malformed: bad JSON, wrong shapes, oversized/absent fields', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const h = { ...authed(key).headers, 'content-type': 'application/json' } as Record<string, string>;
    const post = (path: string, raw: string) => fetch(`${base}${path}`, { method: 'POST', headers: h, body: raw });
    expect((await post('/pair', '{oops')).status).toBe(400);
    expect((await post('/pair', JSON.stringify({ code: 123, deviceName: 'X' }))).status).toBe(400);
    expect((await post('/pair', JSON.stringify({ code: MINT_CODE, deviceName: '  ' }))).status).toBe(400);
    expect((await fetch(`${base}/settings`, { method: 'PUT', headers: h, body: '{}' })).status).toBe(400);
    expect((await fetch(`${base}/settings`, { method: 'PUT', headers: h, body: '{"locale":"de"}' })).status).toBe(400);
    expect((await post('/asks/req-1/answer', '{"kind":"binary"}')).status).toBe(400);
    expect((await post('/asks/req-1/answer', '{"kind":"nonsense"}')).status).toBe(400);
    expect((await post('/budget/raise-and-rerun', '{"workspaceId":"ws-a","capUsd":0}')).status).toBe(400);
  });

  it('404/409 outcome mapping: unknown ask, unknown owner, resume states, drafts, raise', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const h = { ...authed(key).headers, 'content-type': 'application/json' } as Record<string, string>;
    const post = (path: string, raw?: string) => fetch(`${base}${path}`, { method: 'POST', headers: h, body: raw });

    scripted.answerAsk = 'unknown';
    expect(((await (await post('/asks/req-x/answer', '{"kind":"binary","allow":true}')).json()) as { error: string }).error).toBe('unknown_ask');
    scripted.answerAsk = 'resolved';

    scripted.stopDrive = false;
    expect(((await (await post('/drives/wo:WO-0001/stop')).json()) as { error: string }).error).toBe('unknown_owner');
    scripted.stopDrive = true;

    scripted.resumeDrive = 'no_retained';
    expect((await post('/drives/wo:WO-0001/resume')).status).toBe(404);
    scripted.resumeDrive = 'running';
    expect((await post('/drives/wo:WO-0001/resume')).status).toBe(409);
    expect(((await (await post('/drives/wo:WO-0001/resume')).json()) as { error: string }).error).toBe('drive_running');
    scripted.resumeDrive = 'spawned';

    scripted.approveDraft = 'no_draft';
    expect((await post('/drafts/ws-a/approve')).status).toBe(404);
    scripted.approveDraft = 'unparsable';
    expect((await post('/drafts/ws-a/approve')).status).toBe(409);
    scripted.approveDraft = 'approved';
    scripted.rejectDraft = 'no_draft';
    expect((await post('/drafts/ws-a/reject')).status).toBe(404);
    scripted.rejectDraft = 'discarded';

    scripted.raiseBudget = 'unknown_workspace';
    expect((await post('/budget/raise-and-rerun', '{"workspaceId":"ws-x","capUsd":25}')).status).toBe(404);
    scripted.raiseBudget = { raised: true, rerun: false };
    expect(await (await post('/budget/raise-and-rerun', '{"workspaceId":"ws-a","capUsd":25}')).json()).toEqual({ raised: true, rerun: false });

    // unknown route + wrong method
    expect((await fetch(`${base}/nope`, authed(key))).status).toBe(404);
    expect((await fetch(`${base}/console`, { ...authed(key), method: 'DELETE' })).status).toBe(404);
  });

  it('delegates every write to the intent with the EXACT wire arguments (never a verdict)', async () => {
    calls.length = 0;
    const { body } = await pair();
    const key = body.deviceKey as string;
    const h = { ...authed(key).headers, 'content-type': 'application/json' } as Record<string, string>;
    await fetch(`${base}/drives/wo:WO-0002/stop`, { method: 'POST', headers: h });
    await fetch(`${base}/drives/ws:ws-b/resume`, { method: 'POST', headers: h });
    await fetch(`${base}/budget/raise-and-rerun`, { method: 'POST', headers: h, body: '{"workspaceId":"ws-a","capUsd":30}' });
    await fetch(`${base}/drafts/ws-a/approve`, { method: 'POST', headers: h });
    await fetch(`${base}/asks/req-9/answer`, { method: 'POST', headers: h, body: '{"kind":"structured","answered":[{"question":"Yol?","answer":{"kind":"selection","labels":["A"]}}]}' });
    expect(calls).toEqual([
      { intent: 'stopDrive', args: ['wo:WO-0002'] },
      { intent: 'resumeDrive', args: ['ws:ws-b'] },
      { intent: 'raiseBudget', args: ['ws-a', 30] },
      { intent: 'approveDraft', args: ['ws-a'] },
      { intent: 'answerAsk', args: ['req-9', { kind: 'structured', answered: [{ question: 'Yol?', answer: { kind: 'selection', labels: ['A'] } }] }] },
    ]);
  });
});

describe('remote server (WO-0102) — the WS stream', () => {
  const connect = (ticket: string): Promise<{ ws: WebSocket; frames: RemoteWsMessage[]; opened: boolean; closed: boolean; code?: number }> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws${base.slice(4)}/ws?ticket=${encodeURIComponent(ticket)}`);
      const frames: RemoteWsMessage[] = [];
      let settled = false;
      ws.on('message', (data) => frames.push(JSON.parse(String(data)) as RemoteWsMessage));
      ws.on('open', () => {
        if (!settled) {
          settled = true;
          resolve({ ws, frames, opened: true, closed: false });
        }
      });
      ws.on('unexpected-response', (_req, res) => {
        if (!settled) {
          settled = true;
          resolve({ ws, frames, opened: false, closed: true, code: res.statusCode });
        }
      });
      ws.on('error', () => {
        if (!settled) {
          settled = true;
          resolve({ ws, frames, opened: false, closed: true });
        }
      });
    });

  const ticket = async (key: string): Promise<string> => {
    const res = await fetch(`${base}/ws-ticket`, { ...authed(key), method: 'POST' });
    return ((await res.json()) as { ticket: string }).ticket;
  };

  it('sends hello, the per-owner tail window (bounded), then live events keyed by owner', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    // 250 seeded events: the tail must carry exactly REMOTE_TAIL_WINDOW (never full history)
    tailData.length = 0;
    tailData.push({
      owner: 'wo:WO-0001',
      events: Array.from({ length: 250 }, (_, i): RunnerEvent => ({ kind: 'assistant_text', text: `line-${i}` })),
    });
    const t = await ticket(key);
    const { ws, frames } = await connect(t);
    // hello + tail arrive before we resolve on frames — poll until the tail lands
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (frames.some((f) => f.type === 'tail')) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    const hello = frames.find((f) => f.type === 'hello');
    expect(hello).toEqual({ type: 'hello', version: REMOTE_API_VERSION, tailWindow: REMOTE_TAIL_WINDOW });
    const tail = frames.find((f) => f.type === 'tail');
    expect(tail).toMatchObject({ type: 'tail', owner: 'wo:WO-0001' });
    const tailEvents = tail !== undefined && tail.type === 'tail' ? tail.events : [];
    expect(tailEvents.length).toBe(REMOTE_TAIL_WINDOW);
    expect(tailEvents[0]).toMatchObject({ kind: 'assistant_text', text: `line-${250 - REMOTE_TAIL_WINDOW}` });
    // live: the tap forwards with the owner tag
    for (const fn of taps) fn('wo:WO-0001', { kind: 'tool_use', callId: 'c1', tool: 'Bash', input: {} });
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (frames.some((f) => f.type === 'event')) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(frames[frames.length - 1]).toEqual({ type: 'event', owner: 'wo:WO-0001', event: { kind: 'tool_use', callId: 'c1', tool: 'Bash', input: {} } });
    // client frames are ignored (never an error): sending one changes nothing
    ws.send('hello?');
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
    tailData.length = 0;
  });

  it('spends the ticket on the upgrade: a replayed ticket is refused', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const t = await ticket(key);
    const first = await connect(t);
    expect(first.opened).toBe(true);
    first.ws.close();
    const second = await connect(t);
    expect(second.opened).toBe(false);
    expect(second.code).toBe(401);
    // an unknown ticket is refused the same way
    const bogus = await connect('wt_never-minted');
    expect(bogus.opened).toBe(false);
    expect(bogus.code).toBe(401);
  });

  it('never lets a key, token or hash ride an event payload or an error body (acceptance 5)', async () => {
    const { body } = await pair();
    const key = body.deviceKey as string;
    const t = await ticket(key);
    const { ws, frames } = await connect(t);
    for (const fn of taps) fn('wo:WO-0001', { kind: 'error', message: 'drive refused' });
    await new Promise((r) => setTimeout(r, 50));
    // error bodies collected across this suite's refusal tests
    const errorBodies = await Promise.all(
      ([
        [`${base}/console`, { headers: { authorization: 'Bearer dk_bogus' } }],
        [`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: '000000', deviceName: 'X' }) }],
      ] as const).map(async ([u, init]) => {
        const res = await fetch(u, init as RequestInit);
        return await res.text();
      }),
    );
    const wire = JSON.stringify(frames) + errorBodies.join('');
    expect(wire).not.toContain('dk_');
    expect(wire).not.toContain(KEY_HASH);
    expect(wire).not.toContain(DEVICE_KEY);
    expect(wire).not.toContain(t);
    ws.close();
  });
});
