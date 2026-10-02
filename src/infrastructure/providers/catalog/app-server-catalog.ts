// The app-server route live model list (P-29 section 3): the provider's own control surface —
// one app-server connection, the initialize handshake, then model/list paged until the server
// answers a null cursor. No thread is started and no turn or prompt is ever sent, so a listing
// spends no quota; the connection is closed whether the answer arrives or not. Method names and
// payload shapes follow the app-server protocol's own model/list documentation; the effort sets
// differ per model and are filtered to the levels the domain knows, never passed through.
import type { AccountRecord } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { isRecord } from '../transports/app-server/index';
import {
  INITIALIZE_PARAMS,
  openAppServerConnection,
  type AppServerConnectionError,
  type AppServerSpawn,
} from '../transports/app-server/index';
import { KNOWN_EFFORT_LEVELS } from './claude-catalog';
import type { CatalogError } from './model-catalog';

/** A guard against a server that paginates forever; a live-authoritative list must not be
 * silently truncated, so the cap fails the call instead of cutting it. */
const MAX_PAGES = 10;

/** The app-server launch of each provider whose live list rides this surface — the same
 * subcommand the provider's own definition runs, stated here because the catalog receives an
 * account, not a definition. */
const APP_SERVER_LAUNCHES: Readonly<Record<string, { readonly command: string; readonly args: readonly string[] }>> = {
  codex: { command: 'codex', args: ['app-server'] },
};

export interface AppServerCatalogConfig {
  /** Overrides the provider's launch command (tests point it at a fixture). */
  readonly command?: string;
  readonly spawn?: AppServerSpawn;
  /** Ceiling per request; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
}

/** Nothing here relays the server's own error text: it could quote values the child saw. */
const toCatalogError = (error: AppServerConnectionError): CatalogError => {
  if (error.code === 'not_installed') return { code: 'not_installed', message: error.message };
  if (error.code === 'timeout') return { code: 'timeout', message: error.message };
  if (error.code === 'protocol') return { code: 'unsupported', message: 'the app-server refused the model-list request' };
  return { code: 'spawn_failed', message: 'the app-server connection closed before the model list arrived' };
};

interface ModelPage {
  readonly rows: readonly LiveModel[];
  readonly nextCursor: string | null;
}

/** One model/list answer page: `data` rows map to live models — the id verbatim, the display
 * name when given, the efforts the row itself advertises filtered to the known levels — and
 * `nextCursor` drives the next request, null ending the listing. Anything else is a page the
 * protocol does not describe. */
const pageOf = (result: unknown): ModelPage | undefined => {
  if (!isRecord(result) || !Array.isArray(result['data'])) return undefined;
  const cursor = result['nextCursor'];
  if (cursor !== null && typeof cursor !== 'string') return undefined;
  const rows: LiveModel[] = [];
  for (const entry of result['data']) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    if (typeof id !== 'string' || id === '') continue;
    const displayName = entry['displayName'];
    const advertised = entry['supportedReasoningEfforts'];
    const efforts = (Array.isArray(advertised) ? advertised : []).filter(
      (level): level is EffortLevel =>
        typeof level === 'string' && (KNOWN_EFFORT_LEVELS as readonly string[]).includes(level),
    );
    rows.push({
      id,
      ...(typeof displayName === 'string' && displayName !== '' ? { displayName } : {}),
      ...(efforts.length === 0 ? {} : { efforts }),
    });
  }
  return { rows, nextCursor: cursor };
};

export async function listAppServerRouteModels(
  account: AccountRecord,
  config: AppServerCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const launch = APP_SERVER_LAUNCHES[account.provider];
  if (launch === undefined) {
    return err({ code: 'unsupported', message: 'the provider has no app-server model list' });
  }
  const opened = openAppServerConnection({
    command: config.command ?? launch.command,
    args: launch.args,
    ...(config.spawn === undefined ? {} : { spawn: config.spawn }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  if (!opened.ok) return err(toCatalogError(opened.error));
  const connection = opened.value;
  try {
    const handshake = await connection.request('initialize', INITIALIZE_PARAMS);
    if (!handshake.ok) return err(toCatalogError(handshake.error));
    const models: LiveModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await connection.request('model/list', cursor === undefined ? undefined : { cursor });
      if (!answer.ok) return err(toCatalogError(answer.error));
      const parsed = pageOf(answer.value);
      if (parsed === undefined) {
        return err({ code: 'malformed', message: 'the model-list answer does not carry a model page' });
      }
      for (const row of parsed.rows) {
        if (!models.some((seen) => seen.id === row.id)) models.push(row);
      }
      if (parsed.nextCursor === null) return ok(models);
      cursor = parsed.nextCursor;
    }
    return err({ code: 'malformed', message: 'the model list never finished paginating' });
  } finally {
    connection.close();
  }
}
