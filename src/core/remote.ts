// src/core/remote.ts — the remote console's CONTRACT, PURE (WO-0102, ADR-0020).
//
// The phone is a thin client over an embedded HTTP+WS server in the one composition root
// (electron/main.ts). This module is the wire contract's SOURCE — ADR-0020 #11: "the contract's
// source is the code; the mirror is generated" — every constant, type and pure derivation the
// server adapter, the composition root and docket-mobile agree on. The yaml mirror
// (contract/endpoints.yaml) is EMITTED from these shapes by remote-contract.ts and never
// hand-maintained.
//
// Purity: no React, no I/O, no Node — the same line as the rest of core. Keys and tokens never
// appear in any event, log line or record (CLAUDE.md Records & PRs, extended by ADR-0020 #3);
// core sees key HASHES only — randomness and SHA-256 live adapter-side. The server NEVER
// re-derives a verdict (ADR-0020 #1): every write intent here is a thin delegate shape over an
// existing call; the gates (plan approval, budget, profile) stay enforced in the pipeline
// exactly as for the GUI host.
import { askDecisionAll, parseAskRequest } from './askq';
import type { AskAnswer, AskQuestion } from './askq';
import type { Locale, Theme } from './app-settings';
import type { PermissionDecision, RunnerEvent } from './runner';
import { workspaceBudgetView } from './budget';
import type { BudgetThreshold, WorkspaceBudgetView } from './budget';
import type { LimitWindow, PermissionAsk, SessionRole, WorkOrderId, WorkspaceId } from './types';

// ===== The frozen constants (plan §2.1; orchestrator rulings 2026-09-24, architect-confirmed) =====

/** The whole contract's version stamp — docket-mobile pins it; a change is a new contract. */
export const REMOTE_API_VERSION = 1;
/** The fixed default listen port. A paired phone's saved endpoint survives reboots on it. */
export const REMOTE_DEFAULT_PORT = 47654;
/** The pairing code's digit count — one code, two renderings (the QR embeds it; manual typing). */
export const PAIRING_CODE_DIGITS = 6;
/** A pairing grant's lifetime (ADR-0020 #3): 5 minutes. */
export const PAIRING_TTL_MS = 5 * 60_000;
/** Failed exchanges that kill a grant (the 5-strike rule). */
export const PAIRING_MAX_ATTEMPTS = 5;
/** The WS auth ticket's lifetime: 30 s, single-use, carried as a query param. */
export const WS_TICKET_TTL_MS = 30_000;
/** The tail window: the last N events per owner replayed on every WS (re)connect — never full
 *  history (ADR-0020 #8). Advertised to the client in the hello frame. */
export const REMOTE_TAIL_WINDOW = 200;
/** The deny reason a remote binary answer carries — byte-parity with the GUI's deny
 *  (WorkOrderDetail.tsx answerAsk); the surfaces must never disagree on the recorded reason. */
export const REMOTE_DENY_REASON = 'Denied by operator';

/** A grant's expiry stamp: mint time + PAIRING_TTL_MS (pure, so tests and the adapter agree). */
export function grantExpiresAt(now: string): string {
  return new Date(Date.parse(now) + PAIRING_TTL_MS).toISOString();
}

// ===== Pairing (ADR-0020 #3: the desktop shows, the phone scans) =====

/** What a minted grant looks like on the wire (the QR and the manual fallback render the code). */
export interface PairingGrantView {
  /** Exactly PAIRING_CODE_DIGITS digits. */
  code: string;
  /** ISO — grantExpiresAt(mint time). */
  expiresAt: string;
  /** PAIRING_MAX_ATTEMPTS at mint; counts down on wrong codes. */
  attemptsLeft: number;
}

/** The endpoint a phone pairs against — host is whatever the current network offers (LAN IP
 *  today, a Tailscale name tomorrow — transport-agnostic, ADR-0020 #4). */
export interface PairEndpoint {
  host: string;
  /** The ACTUAL bound port (ephemeral-fallback aware — the QR never carries a stale port). */
  port: number;
}

/** What the mint IPC returns to WO-0103's screen: the grant + the endpoint + the QR string. */
export interface PairingStartView extends PairingGrantView {
  endpoint: PairEndpoint;
  /** serializePairingQr's output — the screen renders it, the phone's camera reads it. */
  qr: string;
}

/** The /pair exchange's outcome. `deviceKey` plaintext exists in THIS result and on the phone. */
export type PairingExchangeResult =
  | { kind: 'paired'; deviceId: string; deviceKey: string }
  | { kind: 'invalid_code'; attemptsLeft: number }
  | { kind: 'dead'; reason: 'expired' | 'used' | 'struck' | 'unknown' };

/** The persisted grant's state machine input — what a `pairing_token` row holds. */
export interface StoredGrant {
  code: string;
  expiresAt: string;
  attemptsLeft: number;
  used: boolean;
}

export type PairingVerdict =
  | { kind: 'ok' }
  | { kind: 'wrong_code'; attemptsLeft: number }
  | { kind: 'dead'; reason: 'expired' | 'used' | 'struck' | 'unknown' };

/**
 * The single-use / TTL / attempt-cap verdict, PURE over an injected clock (the adapter applies
 * it and persists the state transitions; nothing here reads time or randomness itself). An
 * undefined grant is `dead/unknown` — the server refuses everything with no outstanding token.
 * A wrong code on the last attempt strikes the grant out.
 */
export function pairingVerdict(grant: StoredGrant | undefined, code: string, now: string): PairingVerdict {
  if (grant === undefined) return { kind: 'dead', reason: 'unknown' };
  if (grant.used) return { kind: 'dead', reason: 'used' };
  if (now >= grant.expiresAt) return { kind: 'dead', reason: 'expired' };
  if (code !== grant.code) {
    const left = grant.attemptsLeft - 1;
    return left <= 0 ? { kind: 'dead', reason: 'struck' } : { kind: 'wrong_code', attemptsLeft: left };
  }
  return { kind: 'ok' };
}

/** The QR payload's grammar (frozen): `docket-pair://<host>:<port>?v=1&code=<6 digits>`. */
export interface PairingQrPayload {
  version: 1;
  endpoint: PairEndpoint;
  code: string;
}

const QR_PREFIX = 'docket-pair://';

export function serializePairingQr(payload: PairingQrPayload): string {
  return `${QR_PREFIX}${payload.endpoint.host}:${payload.endpoint.port}?v=${payload.version}&code=${payload.code}`;
}

/**
 * Parse a scanned/typed pairing string. STRICT — the askq.ts posture: any malformed shape is
 * undefined, never a throw. v must be 1; the code must be exactly 6 digits; the port a valid
 * integer; the host non-empty (a LAST-colon split, so a future IPv6 literal cannot be cut in
 * half).
 */
export function parsePairingQr(text: string): PairingQrPayload | undefined {
  if (!text.startsWith(QR_PREFIX)) return undefined;
  const rest = text.slice(QR_PREFIX.length);
  const q = rest.indexOf('?');
  if (q === -1) return undefined;
  const hostPort = rest.slice(0, q);
  const colon = hostPort.lastIndexOf(':');
  if (colon === -1) return undefined;
  const host = hostPort.slice(0, colon);
  const port = Number(hostPort.slice(colon + 1));
  if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  const m = /^v=(\d+)&code=(\d+)$/.exec(rest.slice(q + 1));
  if (!m || Number(m[1]) !== 1 || !/^\d{6}$/.test(m[2])) return undefined;
  return { version: 1, endpoint: { host, port }, code: m[2] };
}

// ===== The account-wide Konsol read (ADR-0020 #5 — the mobile-only layer above workspaces) =====

/** One running drive's card. `owner` is the owner tag (driveOwnerTag) — the phone never parses it. */
export interface RemoteDriveCard {
  owner: string;
  kind: 'wo' | 'draft';
  /** The drive's workspace (the WO join / the draft's own) — the card's dim-mono workspace line. */
  workspaceId: WorkspaceId;
  /** kind 'wo'. */
  woId?: WorkOrderId;
  /** kind 'wo' — undefined while the composition root's lookup is in flight (honest absence). */
  title?: string;
  role: SessionRole;
  /** asking ⇔ the drive holds ≥1 pending ask. */
  status: 'running' | 'asking';
}

/** One pending ask, BOTH shapes (WO-0077): `questions` present ⇔ the structured parse view. */
export interface RemoteAskCard {
  owner: string;
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  title?: string;
  reason?: string;
  /** core askq.parseAskRequest(tool, input) — the same call the GUI card makes. */
  questions?: AskQuestion[];
}

/** A composite health row (ADR-0020 #6 — presence-derived, no mode switch anywhere). */
export type RemoteHealthRow =
  | { kind: 'quota'; profile: string; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }
  | { kind: 'spend'; workspaceId: WorkspaceId; view: WorkspaceBudgetView };

/** The GET /console payload — the account-wide Konsol view-model. */
export interface RemoteConsoleView {
  version: 1;
  /** wo cards by woId ascending, then drafts by workspaceId. */
  drives: RemoteDriveCard[];
  /** by owner then requestId. */
  asks: RemoteAskCard[];
  /** quota rows by profile name ascending, then spend rows by workspaceId. */
  health: RemoteHealthRow[];
  /** The label join — labels are operator data carried verbatim. */
  workspaces: { id: WorkspaceId; label: string }[];
  /** No drives and no asks — the phone's empty-console state. */
  quiet: boolean;
}

/** What the composition root feeds the pure derivation — the facts main already holds or reads. */
export interface RemoteConsoleFacts {
  /** ISO, caller-supplied — tests control the clock. */
  now: string;
  drives: Array<{
    owner: string;
    kind: 'wo' | 'draft';
    workspaceId: WorkspaceId;
    woId?: WorkOrderId;
    title?: string;
    role: SessionRole;
    asks: PermissionAsk[];
  }>;
  /** Only profiles that REPORTED windows — presence is the row's whole legitimacy. */
  quota: Array<{ profile: string; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }>;
  /** Only capped workspaces. */
  budgets: Array<{ workspaceId: WorkspaceId; threshold: BudgetThreshold; monthUsd: number; hasUnknown: boolean }>;
  workspaces: ReadonlyArray<{ id: WorkspaceId; label: string }>;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assemble the Konsol view-model. PURE: no field the core types lack is invented, the input is
 * never mutated, identical facts give an identical view. The server adapter's /console route is
 * a thin call to this over the composition root's facts (plan §2.3).
 */
export function deriveRemoteConsole(facts: RemoteConsoleFacts): RemoteConsoleView {
  const woCards: RemoteDriveCard[] = [];
  const draftCards: RemoteDriveCard[] = [];
  const asks: RemoteAskCard[] = [];
  for (const d of facts.drives) {
    const card: RemoteDriveCard = {
      owner: d.owner,
      kind: d.kind,
      workspaceId: d.workspaceId,
      role: d.role,
      status: d.asks.length > 0 ? 'asking' : 'running',
      ...(d.kind === 'wo' && d.woId !== undefined ? { woId: d.woId } : {}),
      ...(d.title !== undefined ? { title: d.title } : {}),
    };
    (d.kind === 'wo' ? woCards : draftCards).push(card);
    for (const ask of d.asks) {
      const questions = parseAskRequest(ask.tool, ask.input);
      asks.push({
        owner: d.owner,
        requestId: ask.requestId,
        tool: ask.tool,
        input: ask.input,
        ...(ask.title !== undefined ? { title: ask.title } : {}),
        ...(ask.reason !== undefined ? { reason: ask.reason } : {}),
        ...(questions !== undefined ? { questions } : {}),
      });
    }
  }
  woCards.sort((a, b) => byString(a.woId ?? '', b.woId ?? ''));
  draftCards.sort((a, b) => byString(a.workspaceId, b.workspaceId));
  asks.sort((a, b) => byString(`${a.owner}#${a.requestId}`, `${b.owner}#${b.requestId}`));
  const quota = facts.quota
    .map((q) => ({ kind: 'quota' as const, ...q }))
    .sort((a, b) => byString(a.profile, b.profile));
  const spend = facts.budgets
    .map((b) => ({
      kind: 'spend' as const,
      workspaceId: b.workspaceId,
      view: workspaceBudgetView(b.monthUsd, b.hasUnknown, b.threshold),
    }))
    .sort((a, b) => byString(a.workspaceId, b.workspaceId));
  const drives = [...woCards, ...draftCards];
  return {
    version: REMOTE_API_VERSION,
    drives,
    asks,
    health: [...quota, ...spend],
    workspaces: facts.workspaces.map((w) => ({ id: w.id, label: w.label })),
    quiet: drives.length === 0 && asks.length === 0,
  };
}

// ===== Write intents (v1 scope, ADR-0020 #9 — thin delegates, never a verdict) =====

/** The POST /asks/{requestId}/answer body. The structured arm keys each answer by the QUESTION
 *  string — askq's answer key; option labels and free text ride `AskAnswer` verbatim. */
export type RemoteAskAnswer =
  | { kind: 'binary'; allow: boolean }
  | { kind: 'structured'; answered: Array<{ question: string; answer: AskAnswer }> };

/**
 * The ask answer as a PermissionDecision — the measured fold reused, not re-derived. The
 * structured arm delegates to core askq.askDecisionAll (it reads only `question.question`, so
 * the wire's bare question string wraps into the minimal question object); parity with the GUI
 * card is pinned by test against askDecisionAll on the same input.
 */
export function remoteAskDecision(input: Record<string, unknown>, answer: RemoteAskAnswer): PermissionDecision {
  if (answer.kind === 'binary') {
    return answer.allow ? { allow: true } : { allow: false, reason: REMOTE_DENY_REASON };
  }
  return askDecisionAll(
    input,
    answer.answered.map(({ question, answer: a }) => ({
      question: { question, header: question, options: [], multiSelect: false },
      answer: a,
    })),
  );
}

// ===== Devices (the registry's wire model — GET /devices and the revoke route) =====

/** A paired device's row on the wire. Lives here (not in device-store.ts) because it IS contract
 *  surface: the yaml mirror's models section is type-tied to it (amendment 2). */
export interface DeviceView {
  id: string;
  /** The operator-given name — operator data, rendered verbatim by every surface. */
  name: string;
  createdAt: string;
  /** null = never seen since pairing. */
  lastSeenAt: string | null;
}

// ===== Settings (theme joins locale — WO-0102's frozen decision) =====

/** GET /settings's shape: locale + theme + the per-workspace caps the remote surface manages. */
export interface RemoteSettingsRead {
  /** null = no explicit operator choice (the honest absence getLocale reports). */
  locale: Locale | null;
  /** getTheme's value, 'system' when nothing is stored. */
  theme: Theme;
  workspaces: RemoteWorkspaceCap[];
}

export interface RemoteWorkspaceCap {
  id: WorkspaceId;
  label: string;
  /** undefined = no cap configured. */
  cap?: BudgetThreshold;
}

// ===== The WS envelope (read-only stream; client frames are none in v1) =====

export type RemoteWsMessage =
  /** First frame, once: the contract version + the advertised tail window. */
  | { type: 'hello'; version: 1; tailWindow: number }
  /** Right after hello: one per owner with buffered history — the last REMOTE_TAIL_WINDOW events. */
  | { type: 'tail'; owner: string; events: RunnerEvent[] }
  /** Live, in stream order — the SAME RunnerEvent stream the IPC forward loop yields. */
  | { type: 'event'; owner: string; event: RunnerEvent };
