// src/adapters/remote/server.ts — the embedded HTTP+WS server (WO-0102, ADR-0020 #2).
//
// DUMB TRANSPORT over the core contract: every fact and write arrives through RemoteServerDeps
// (src/core/remote.ts), which the ONE composition root fills — the server never sees the
// pipeline, the store or a gate, so it can never re-derive a verdict (ADR-0020 #1). `ws` is the
// one new runtime dependency and lives only here (adapters-only, the ruled boundary). Transport-
// agnostic (ADR-0020 #4): zero Tailscale-specific code, zero QR rendering, zero discovery — the
// server supplies endpoint + token, the desktop screen renders.
//
// Auth: bearer device key on every REST route except POST /pair; the key's SHA-256 hash resolves
// through the DeviceStore (which stamps lastSeen). WS auth is a one-time 30 s ticket minted by
// an authenticated POST /ws-ticket and carried as a query param (browser WebSocket cannot set
// headers). v1 trusts the LAN — no TLS (the frozen decision; the Tailscale path is the encrypted
// transport when it comes).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  REMOTE_API_VERSION,
  REMOTE_TAIL_WINDOW,
  WS_TICKET_TTL_MS,
  type DeviceView,
  type RemoteAskAnswer,
  type RemoteServerDeps,
  type RemoteWsMessage,
} from '../../core/remote';

/** The request-body cap — a phone's payloads are tiny; anything bigger is not ours. */
const BODY_CAP_BYTES = 64 * 1024;

interface JsonFail {
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
};

const fail = (res: ServerResponse, f: JsonFail): void => send(res, f.status, { error: f.code, message: f.message, ...(f.extra ?? {}) });

/** Read + parse one JSON body, capped. Never throws — every failure is a discriminated 400. */
type ReadJson = { ok: true; body: Record<string, unknown> } | { ok: false; fail: JsonFail };
function readJson(req: IncomingMessage): Promise<ReadJson> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_CAP_BYTES) {
        req.destroy();
        resolve({ ok: false, fail: { status: 400, code: 'malformed', message: 'body exceeds 64 KiB cap' } });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({ ok: true, body: {} });
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          resolve({ ok: false, fail: { status: 400, code: 'malformed', message: 'body must be a JSON object' } });
          return;
        }
        resolve({ ok: true, body: parsed as Record<string, unknown> });
      } catch {
        resolve({ ok: false, fail: { status: 400, code: 'malformed', message: 'body is not valid JSON' } });
      }
    });
    req.on('error', () => resolve({ ok: false, fail: { status: 400, code: 'malformed', message: 'body read failed' } }));
  });
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** The AskAnswer wire shape: selection(labels[])/other(text)/dismissed/declined(message). */
function isAskAnswer(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  if (a.kind === 'selection') return Array.isArray(a.labels) && a.labels.every(isString);
  if (a.kind === 'other') return isString(a.text);
  if (a.kind === 'dismissed') return true;
  if (a.kind === 'declined') return isString(a.message);
  return false;
}

function parseAskAnswerBody(body: Record<string, unknown>): RemoteAskAnswer | undefined {
  if (body.kind === 'binary' && typeof body.allow === 'boolean') return { kind: 'binary', allow: body.allow };
  if (body.kind === 'structured' && Array.isArray(body.answered)) {
    const answered: Array<{ question: string; answer: never }> = [];
    for (const entry of body.answered) {
      if (typeof entry !== 'object' || entry === null) return undefined;
      const e = entry as Record<string, unknown>;
      if (!isString(e.question) || !isAskAnswer(e.answer)) return undefined;
      answered.push({ question: e.question, answer: e.answer as never });
    }
    return { kind: 'structured', answered };
  }
  return undefined;
}

/**
 * Build the server. `listen` binds (host, port) — port 0 for ephemeral — and resolves with the
 * ACTUAL bound port (the pairing endpoint must carry it; the fallback path depends on it).
 * `close` tears the WS clients, the ping loop and the HTTP server down.
 */
export function createRemoteServer(deps: RemoteServerDeps): {
  listen(port: number, host: string): Promise<{ port: number; close(): Promise<void> }>;
} {
  // The one-time WS tickets: minted by POST /ws-ticket, spent at the upgrade. In-memory by
  // design — 30 s single-use nothing durable.
  const tickets = new Map<string, number>(); // ticket -> expiresAt (epoch ms)

  const auth = async (req: IncomingMessage): Promise<DeviceView | JsonFail> => {
    const header = req.headers.authorization;
    if (!isString(header) || !header.startsWith('Bearer ')) {
      return { status: 401, code: 'unknown_bearer', message: 'missing bearer device key' };
    }
    const device = await deps.devices.deviceByKeyHash(deps.ids.keyHash(header.slice('Bearer '.length)), deps.now());
    if (device === undefined) return { status: 401, code: 'unknown_bearer', message: 'unknown device key' };
    return device;
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        await route(req, res);
      } catch (e) {
        // The catch-all: an unexpected throw is the one 500 in the taxonomy — never a crash, and
        // never a stack trace on the wire (message only, diagnostic-only per the contract).
        fail(res, { status: 500, code: 'internal', message: (e as Error)?.message ?? 'unexpected failure' });
      }
    })();
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://docket.invalid');
    const segments = url.pathname.split('/').filter((s) => s !== '').map(decodeURIComponent);
    const method = req.method ?? 'GET';

    // The ONLY unauthenticated route: the pairing exchange.
    if (method === 'POST' && segments[0] === 'pair') {
      const read = await readJson(req);
      if (!read.ok) return fail(res, read.fail);
      const body = read.body;
      const code = body.code;
      const deviceName = body.deviceName;
      if (!isString(code) || !isString(deviceName) || deviceName.trim().length < 1 || deviceName.trim().length > 64) {
        return fail(res, { status: 400, code: 'malformed', message: 'code: 6-digit string, deviceName: 1-64 chars' });
      }
      const outcome = await deps.devices.exchange(code, deviceName.trim(), deps.now());
      if (outcome.kind === 'paired') return send(res, 200, { deviceId: outcome.deviceId, deviceKey: outcome.deviceKey });
      if (outcome.kind === 'invalid_code') {
        return fail(res, { status: 401, code: 'invalid_code', message: 'the code does not match', extra: { attemptsLeft: outcome.attemptsLeft } });
      }
      return fail(res, { status: 410, code: 'token_dead', message: 'the pairing token is dead', extra: { reason: outcome.reason } });
    }

    // Everything else is bearer-authenticated.
    const device = await auth(req);
    if ('status' in device) return fail(res, device);

    if (method === 'GET' && segments[0] === 'console') {
      return send(res, 200, await deps.consoleView());
    }

    if (segments[0] === 'settings' && segments.length === 1) {
      if (method === 'GET') return send(res, 200, await deps.readSettings());
      if (method === 'PUT') {
        const read = await readJson(req);
        if (!read.ok) return fail(res, read.fail);
        const body = read.body;
        const patch: { locale?: 'tr' | 'en'; theme?: 'system' | 'light' | 'dark' } = {};
        if (body.locale !== undefined) {
          if (body.locale !== 'tr' && body.locale !== 'en') {
            return fail(res, { status: 400, code: 'invalid_value', message: 'locale must be tr|en' });
          }
          patch.locale = body.locale;
        }
        if (body.theme !== undefined) {
          if (body.theme !== 'system' && body.theme !== 'light' && body.theme !== 'dark') {
            return fail(res, { status: 400, code: 'invalid_value', message: 'theme must be system|light|dark' });
          }
          patch.theme = body.theme;
        }
        if (patch.locale === undefined && patch.theme === undefined) {
          return fail(res, { status: 400, code: 'malformed', message: 'at least one of locale, theme' });
        }
        return send(res, 200, await deps.writeSettings(patch));
      }
      return fail(res, { status: 405, code: 'unknown_route', message: `method ${method} not allowed on /settings` });
    }

    if (segments[0] === 'devices' && segments.length === 1 && method === 'GET') {
      return send(res, 200, { devices: await deps.devices.listDevices() });
    }
    if (segments[0] === 'devices' && segments.length === 2 && method === 'DELETE') {
      const revoked = await deps.devices.revokeDevice(segments[1]!);
      return revoked ? send(res, 200, { revoked: segments[1] }) : fail(res, { status: 404, code: 'unknown_device', message: 'no such device' });
    }

    if (segments[0] === 'asks' && segments.length === 3 && segments[2] === 'answer' && method === 'POST') {
      const read = await readJson(req);
      if (!read.ok) return fail(res, read.fail);
      const body = read.body;
      const answer = parseAskAnswerBody(body);
      if (answer === undefined) {
        return fail(res, { status: 400, code: 'malformed', message: 'RemoteAskAnswer shape expected' });
      }
      const outcome = await deps.intents.answerAsk(segments[1]!, answer);
      return outcome === 'resolved' ? send(res, 200, { resolved: segments[1] }) : fail(res, { status: 404, code: 'unknown_ask', message: 'no live ask holds that requestId' });
    }

    if (segments[0] === 'drives' && segments.length === 3 && method === 'POST') {
      const owner = segments[1]!;
      if (segments[2] === 'stop') {
        const stopped = await deps.intents.stopDrive(owner);
        return stopped ? send(res, 200, { stopped: owner }) : fail(res, { status: 404, code: 'unknown_owner', message: 'nothing runs under that owner' });
      }
      if (segments[2] === 'resume') {
        const outcome = await deps.intents.resumeDrive(owner);
        if (outcome === 'spawned') return send(res, 200, { spawned: owner });
        if (outcome === 'running') return fail(res, { status: 409, code: 'drive_running', message: 'one drive per owner is already running' });
        return fail(res, { status: 404, code: 'no_retained_drive', message: 'no retained drive input for that owner' });
      }
    }

    if (segments[0] === 'budget' && segments.length === 2 && segments[1] === 'raise-and-rerun' && method === 'POST') {
      const read = await readJson(req);
      if (!read.ok) return fail(res, read.fail);
      const body = read.body;
      if (!isString(body.workspaceId) || typeof body.capUsd !== 'number' || !(body.capUsd > 0)) {
        return fail(res, { status: 400, code: 'invalid_value', message: 'workspaceId: string, capUsd: number > 0' });
      }
      const outcome = await deps.intents.raiseBudget(body.workspaceId as never, body.capUsd);
      if (outcome === 'unknown_workspace') return fail(res, { status: 404, code: 'unknown_workspace', message: 'no such workspace' });
      return send(res, 200, outcome);
    }

    if (segments[0] === 'drafts' && segments.length === 3 && method === 'POST') {
      const wsId = segments[1]!;
      if (segments[2] === 'approve') {
        const outcome = await deps.intents.approveDraft(wsId as never);
        if (outcome === 'approved') return send(res, 200, { approved: wsId });
        if (outcome === 'unparsable') return fail(res, { status: 409, code: 'draft_unparsable', message: 'the draft fails the parse guard — nothing was written' });
        return fail(res, { status: 404, code: 'no_draft', message: 'no pending draft for that workspace' });
      }
      if (segments[2] === 'reject') {
        const outcome = await deps.intents.rejectDraft(wsId as never);
        return outcome === 'discarded'
          ? send(res, 200, { discarded: wsId })
          : fail(res, { status: 404, code: 'no_draft', message: 'no pending draft for that workspace' });
      }
    }

    if (segments[0] === 'ws-ticket' && segments.length === 1 && method === 'POST') {
      // Mint a fresh ticket; stale entries are swept opportunistically (30 s single-use nothings).
      const nowMs = Date.parse(deps.now());
      for (const [t, expiresAt] of tickets) if (expiresAt < nowMs) tickets.delete(t);
      const ticket = deps.ids.ticket();
      tickets.set(ticket, nowMs + WS_TICKET_TTL_MS);
      return send(res, 200, { ticket, expiresAt: new Date(nowMs + WS_TICKET_TTL_MS).toISOString() });
    }

    return fail(res, { status: 404, code: 'unknown_route', message: `no route for ${method} ${url.pathname}` });
  }

  // ===== The WebSocket half =====

  const wss = new WebSocketServer({ noServer: true });
  const live = new Set<WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();
  const frame = (ws: WebSocket, message: RemoteWsMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  wss.on('connection', (ws) => {
    live.add(ws);
    alive.set(ws, true);
    ws.on('pong', () => {
      alive.set(ws, true);
    });
    // The designed sequence: hello (version + the advertised tail window), then one tail per
    // owner with buffered history, then the live tap. Never full history (ADR-0020 #8).
    frame(ws, { type: 'hello', version: REMOTE_API_VERSION, tailWindow: REMOTE_TAIL_WINDOW });
    for (const { owner, events } of deps.stream.tail()) {
      // The wire-bound lives HERE: never more than the window crosses, whatever the source holds
      // (the composition root's ring caps memory; this caps the radio payload — ADR-0020 #8).
      const windowed = events.slice(-REMOTE_TAIL_WINDOW);
      if (windowed.length > 0) frame(ws, { type: 'tail', owner, events: windowed });
    }
    const untap = deps.stream.tap((owner, event) => frame(ws, { type: 'event', owner, event }));
    ws.on('close', () => {
      untap();
      live.delete(ws);
    });
    ws.on('message', () => {
      // client frames are none in v1 — ignored by contract, never an error
    });
  });

  // Liveness: protocol-level pings every 30 s; a client that stops answering is terminated
  // (reconnect is the phone's designed state, not an error here).
  const ping = setInterval(() => {
    for (const ws of live) {
      if (!alive.get(ws)) {
        ws.terminate();
        live.delete(ws);
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  ping.unref?.();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://docket.invalid');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const ticket = url.searchParams.get('ticket');
    const expiresAt = ticket !== null ? tickets.get(ticket) : undefined;
    // single-use: the spend deletes the entry; TTL: an expired ticket is gone
    if (ticket === null || expiresAt === undefined || expiresAt < Date.parse(deps.now())) {
      tickets.delete(ticket ?? '');
      socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n\r\n{"error":"ticket_invalid","message":"the WS ticket is unknown, expired, or already used"}');
      socket.destroy();
      return;
    }
    tickets.delete(ticket);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return {
    listen(port: number, host: string) {
      return new Promise<{ port: number; close(): Promise<void> }>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const bound = server.address();
          const actualPort = typeof bound === 'object' && bound !== null ? bound.port : port;
          resolve({
            port: actualPort,
            close: () =>
              new Promise<void>((resolveClose, rejectClose) => {
                clearInterval(ping);
                for (const ws of live) ws.terminate();
                wss.close(() => server.close(() => resolveClose()));
                server.once('error', rejectClose);
              }),
          });
        });
      });
    },
  };
}
