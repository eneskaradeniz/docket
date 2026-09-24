// src/core/remote-contract.ts — the GENERATED yaml mirror's emitter, PURE (WO-0102 / ADR-0020 #11).
//
// "The contract's source is the code; the mirror is generated." emitEndpointsYaml() projects
// src/core/remote.ts's constants and types into the deterministic yaml docket-mobile carries as
// its contract/endpoints.yaml mirror. Hand-rolled serializer, emit-only — NO yaml parser
// dependency ever exists here (the DUR condition's premise never arises). Byte-stable by
// construction: fixed section order, fixed key order, LF endings, exactly one trailing newline.
//
// Amendment 2 (plan §15): every object model's emitted field list is a doc array whose `name`s
// are typed `keyof <Model>`, with a compile-time completeness check — adding a field to a model
// breaks THIS FILE at typecheck, not only the drift test. Compiler over convention: hand-listed
// field sets drift silently otherwise.
import {
  PAIRING_CODE_DIGITS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  REMOTE_API_VERSION,
  REMOTE_DEFAULT_PORT,
  REMOTE_TAIL_WINDOW,
  WS_TICKET_TTL_MS,
  type DeviceView,
  type PairingGrantView,
  type RemoteAskCard,
  type RemoteConsoleView,
  type RemoteDriveCard,
  type RemoteSettingsRead,
} from './remote';

// ===== The type tie (amendment 2) =====

/** One emitted model-field doc line. `name` is typed against the model — the compile tie. */
interface FieldDoc<T> {
  name: keyof T & string;
  type: string;
  optional?: boolean;
}

/** true iff the doc lists EVERY key of the model (optional keys included — keyof sees them). */
type FieldsComplete<T, D extends readonly FieldDoc<T>[]> = Exclude<keyof T, D[number]['name']> extends never
  ? true
  : never;

// Each exported completeness const fails to compile when its model grows an undocumented field.
const CONSOLE_DOC = [
  { name: 'version', type: '1 (REMOTE_API_VERSION)' },
  { name: 'drives', type: 'RemoteDriveCard[] — wo cards by woId asc, then drafts' },
  { name: 'asks', type: 'RemoteAskCard[] — by owner then requestId' },
  { name: 'health', type: 'RemoteHealthRow[] — quota rows by profile, spend rows by workspace' },
  { name: 'workspaces', type: '{id, label}[] — the label join, labels verbatim operator data' },
  { name: 'quiet', type: 'boolean — no drives and no asks (the empty console)' },
] as const satisfies readonly FieldDoc<RemoteConsoleView>[];
const DRIVE_DOC = [
  { name: 'owner', type: "string — the owner tag (wo:<id> | ws:<id>); never parsed by renderers" },
  { name: 'kind', type: "'wo' | 'draft'" },
  { name: 'workspaceId', type: 'WorkspaceId' },
  { name: 'woId', type: 'WorkOrderId (kind wo)', optional: true },
  { name: 'title', type: 'string (kind wo; undefined while the lookup is in flight)', optional: true },
  { name: 'role', type: "'implementer' | 'architect' | 'verifier'" },
  { name: 'status', type: "'running' | 'asking' (asking = at least one pending ask)" },
] as const satisfies readonly FieldDoc<RemoteDriveCard>[];
const ASK_DOC = [
  { name: 'owner', type: 'string — the asking drive’s owner tag' },
  { name: 'requestId', type: 'string' },
  { name: 'tool', type: 'string' },
  { name: 'input', type: 'object — the tool input, verbatim' },
  { name: 'title', type: 'string', optional: true },
  { name: 'reason', type: 'string', optional: true },
  { name: 'questions', type: 'AskQuestion[] (parseAskRequest view; absent = the binary form)', optional: true },
] as const satisfies readonly FieldDoc<RemoteAskCard>[];
const DEVICE_DOC = [
  { name: 'id', type: 'string (dv_ + 16 hex)' },
  { name: 'name', type: 'string — the operator-given name, rendered verbatim' },
  { name: 'createdAt', type: 'ISO' },
  { name: 'lastSeenAt', type: 'ISO | null (stamped on every authenticated call)' },
] as const satisfies readonly FieldDoc<DeviceView>[];
const SETTINGS_DOC = [
  { name: 'locale', type: "'tr' | 'en' | null (null = no explicit choice)" },
  { name: 'theme', type: "'system' | 'light' | 'dark' ('system' when nothing stored)" },
  { name: 'workspaces', type: 'RemoteWorkspaceCap[] — {id, label, cap?}' },
] as const satisfies readonly FieldDoc<RemoteSettingsRead>[];
const GRANT_DOC = [
  { name: 'code', type: 'string — exactly 6 digits, two renderings (QR embeds it; manual typing)' },
  { name: 'expiresAt', type: 'ISO' },
  { name: 'attemptsLeft', type: 'number (PAIRING_MAX_ATTEMPTS at mint, counts down on wrong codes)' },
] as const satisfies readonly FieldDoc<PairingGrantView>[];

export const _consoleDocComplete: FieldsComplete<RemoteConsoleView, typeof CONSOLE_DOC> = true;
export const _driveDocComplete: FieldsComplete<RemoteDriveCard, typeof DRIVE_DOC> = true;
export const _askDocComplete: FieldsComplete<RemoteAskCard, typeof ASK_DOC> = true;
export const _deviceDocComplete: FieldsComplete<DeviceView, typeof DEVICE_DOC> = true;
export const _settingsDocComplete: FieldsComplete<RemoteSettingsRead, typeof SETTINGS_DOC> = true;
export const _grantDocComplete: FieldsComplete<PairingGrantView, typeof GRANT_DOC> = true;

// ===== The serializer (mechanically frozen: 2-space indent, fixed order, LF, one trailing \n) =====

/** A scalar as yaml: numbers/booleans bare; strings double-quoted, single-quoted only when the
 *  value itself contains double quotes (JSON examples) — '' doubled per yaml single-quote rules. */
const q = (v: string | number | boolean): string => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v.includes('"') ? `'${v.replaceAll("'", "''")}'` : `"${v}"`;
};

interface EndpointDoc {
  method: string;
  path: string;
  auth: string;
  request: string;
  success: string;
  note?: string;
  errors: readonly string[];
}

/** The 13 REST routes in the frozen table order (plan §2.2). */
const ENDPOINTS: readonly EndpointDoc[] = [
  {
    method: 'POST',
    path: '/pair',
    auth: 'none (the ONLY unauthenticated route)',
    request: '{"code": "<6 digits>", "deviceName": "<1-64 chars after trim>"}',
    success: '{"deviceId": "dv_...", "deviceKey": "dk_... — plaintext, this response only"}',
    errors: ['malformed', 'invalid_code', 'token_dead'],
  },
  {
    method: 'GET',
    path: '/console',
    auth: 'bearer',
    request: 'none',
    success: 'RemoteConsoleView',
    errors: ['unknown_bearer'],
  },
  {
    method: 'GET',
    path: '/settings',
    auth: 'bearer',
    request: 'none',
    success: 'RemoteSettingsRead',
    note: 'remote:port is read-only this WO — the app_setting row is the operator escape hatch; a setter lands with the UI that needs it',
    errors: ['unknown_bearer'],
  },
  {
    method: 'PUT',
    path: '/settings',
    auth: 'bearer',
    request: '{"locale"?: "tr"|"en", "theme"?: "system"|"light"|"dark"} — at least one key',
    success: 'the post-write pair {locale, theme}',
    errors: ['malformed', 'invalid_value', 'unknown_bearer'],
  },
  {
    method: 'GET',
    path: '/devices',
    auth: 'bearer',
    request: 'none',
    success: '{"devices": DeviceView[]}',
    errors: ['unknown_bearer'],
  },
  {
    method: 'DELETE',
    path: '/devices/{id}',
    auth: 'bearer',
    request: 'none',
    success: '{"revoked": "<id>"}',
    errors: ['unknown_bearer', 'unknown_device'],
  },
  {
    method: 'POST',
    path: '/asks/{requestId}/answer',
    auth: 'bearer',
    request: 'RemoteAskAnswer — {kind: "binary", allow} | {kind: "structured", answered: [{question, answer}]}',
    success: '{"resolved": "<requestId>"}',
    errors: ['malformed', 'unknown_bearer', 'unknown_ask'],
  },
  {
    method: 'POST',
    path: '/drives/{owner}/stop',
    auth: 'bearer',
    request: 'none — {owner} is the owner tag verbatim',
    success: '{"stopped": "<owner>"}',
    errors: ['unknown_bearer', 'unknown_owner'],
  },
  {
    method: 'POST',
    path: '/drives/{owner}/resume',
    auth: 'bearer',
    request: 'none — re-enters the composition root’s shared spawn path with the fills re-applied',
    success: '{"spawned": "<owner>"}',
    errors: ['unknown_bearer', 'no_retained_drive', 'drive_running'],
  },
  {
    method: 'POST',
    path: '/budget/raise-and-rerun',
    auth: 'bearer',
    request: '{"workspaceId": "...", "capUsd": 25} — capUsd > 0',
    success: '{"raised": true, "rerun": boolean}',
    note: 'rerun false = the raise stood (a permanent settings write), no refused drive input was retained, nothing re-spawned — the drive list is truth for what runs',
    errors: ['malformed', 'invalid_value', 'unknown_bearer', 'unknown_workspace'],
  },
  {
    method: 'POST',
    path: '/drafts/{workspaceId}/approve',
    auth: 'bearer',
    request: 'none',
    success: '{"approved": "<workspaceId>"}',
    errors: ['unknown_bearer', 'no_draft', 'draft_unparsable'],
  },
  {
    method: 'POST',
    path: '/drafts/{workspaceId}/reject',
    auth: 'bearer',
    request: 'none',
    success: '{"discarded": "<workspaceId>"}',
    errors: ['unknown_bearer', 'no_draft'],
  },
  {
    method: 'POST',
    path: '/ws-ticket',
    auth: 'bearer',
    request: 'none',
    success: '{"ticket": "wt_...", "expiresAt": "<ISO>"}',
    errors: ['unknown_bearer'],
  },
];

const ERROR_TAXONOMY: ReadonlyArray<[code: string, http: number]> = [
  ['malformed', 400],
  ['invalid_value', 400],
  ['unknown_bearer', 401],
  ['invalid_code', 401],
  ['ticket_invalid', 401],
  ['token_dead', 410],
  ['unknown_route', 404],
  ['unknown_device', 404],
  ['unknown_ask', 404],
  ['unknown_owner', 404],
  ['no_retained_drive', 404],
  ['unknown_workspace', 404],
  ['no_draft', 404],
  ['drive_running', 409],
  ['draft_unparsable', 409],
  ['internal', 500],
];

const modelBlock = <T>(name: string, doc: readonly FieldDoc<T>[]): string[] => [
  `  ${name}:`,
  ...doc.map((f) => `    ${f.name}${f.optional ? '?' : ''}: ${q(f.type)}`),
];

/**
 * Emit the whole contract mirror. PURE and deterministic: two calls return byte-identical
 * strings (pinned by test); `npm run contract` writes the same bytes to
 * contract/endpoints.yaml and the drift test pins file-vs-emitter equality.
 */
export function emitEndpointsYaml(): string {
  const L: string[] = [];
  L.push('# generated by npm run contract — do not edit by hand (WO-0102 drift test pins the bytes)');
  // version / server
  L.push(`version: ${REMOTE_API_VERSION}`);
  L.push('server:');
  L.push(`  defaultPort: ${REMOTE_DEFAULT_PORT}`);
  L.push('  auth: "bearer-device-key"');
  L.push('  transport: "http+ws"');
  L.push('  tls: false — v1 trusts the LAN (ADR-0020; the Tailscale path is the encrypted transport when it comes)');
  // pairing
  L.push('pairing:');
  L.push(`  codeDigits: ${PAIRING_CODE_DIGITS}`);
  L.push(`  ttlSeconds: ${PAIRING_TTL_MS / 1000}`);
  L.push(`  maxAttempts: ${PAIRING_MAX_ATTEMPTS}`);
  L.push('  qrGrammar: "docket-pair://<host>:<port>?v=1&code=<code>"');
  L.push('  oneLiveGrant: true (minting supersedes any prior grant)');
  L.push('  exchangeErrors:');
  L.push('    - code: "invalid_code"');
  L.push('      http: 401');
  L.push('      extra: "attemptsLeft"');
  L.push('    - code: "token_dead"');
  L.push('      http: 410');
  L.push('      reasons: ["expired", "used", "struck", "unknown"]');
  // errors
  L.push('errors:');
  L.push('  diagnosticOnly: "message is diagnostic-only (logs and dev); renderers key on the error code and speak it in their own locale words — the phone never surfaces the English diagnostic"');
  L.push('  taxonomy:');
  for (const [code, http] of ERROR_TAXONOMY) {
    L.push(`    - code: ${q(code)}`);
    L.push(`      http: ${http}`);
  }
  // endpoints
  L.push('endpoints:');
  for (const e of ENDPOINTS) {
    L.push(`  - method: ${q(e.method)}`);
    L.push(`    path: ${q(e.path)}`);
    L.push(`    auth: ${q(e.auth)}`);
    L.push(`    request: ${q(e.request)}`);
    L.push(`    success: ${q(e.success)}`);
    if (e.note !== undefined) L.push(`    note: ${q(e.note)}`);
    L.push(`    errors: [${e.errors.map((c) => q(c)).join(', ')}]`);
  }
  // websocket
  L.push('websocket:');
  L.push('  path: "/ws"');
  L.push('  ticket:');
  L.push('    mint: "POST /ws-ticket"');
  L.push(`    ttlSeconds: ${WS_TICKET_TTL_MS / 1000}`);
  L.push('    singleUse: true');
  L.push('    carriedAs: "query param ticket (browser WebSocket cannot set Authorization headers)"');
  L.push('  envelope:');
  L.push('    - type: "hello"');
  L.push('      fields: "version, tailWindow"');
  L.push('    - type: "tail"');
  L.push('      fields: "owner, events[] (RunnerEvent — the core union, verbatim)"');
  L.push('    - type: "event"');
  L.push('      fields: "owner, event (RunnerEvent)"');
  L.push(`  tailWindow: ${REMOTE_TAIL_WINDOW}`);
  L.push('  tailSemantics: "the last N events per owner replayed on every (re)connect; never full history"');
  L.push('  clientFrames: "none (any frame is ignored — the stream is read-only in v1)"');
  L.push('  pingSeconds: 30 — protocol-level; a failed ping closes the socket');
  L.push('  reconnect: "a designed state on the phone, never an error here"');
  // models
  L.push('models:');
  L.push(...modelBlock('RemoteConsoleView', CONSOLE_DOC));
  L.push(...modelBlock('RemoteDriveCard', DRIVE_DOC));
  L.push(...modelBlock('RemoteAskCard', ASK_DOC));
  L.push(...modelBlock('DeviceView', DEVICE_DOC));
  L.push(...modelBlock('RemoteSettingsRead', SETTINGS_DOC));
  L.push(...modelBlock('PairingGrantView', GRANT_DOC));
  L.push('  RemoteHealthRow:');
  L.push('    kind: "\'quota\' | \'spend\'"');
  L.push('    quota: "{profile, windows: LimitWindow[], status?} — one row per profile that REPORTED windows (presence-derived)"');
  L.push('    spend: "{workspaceId, view: WorkspaceBudgetView} — one row per capped workspace"');
  L.push('  RemoteAskAnswer:');
  L.push('    binary: "{kind: \'binary\', allow: boolean}"');
  L.push('    structured: "{kind: \'structured\', answered: [{question: string, answer: AskAnswer}]}"');
  L.push('  errorBody: \'{"error": "<code>", "message": "<diagnostic-only>"}\'');
  return L.join('\n') + '\n';
}
