// The Copilot route's live model list (P-29 section 3): the ACP session answer — initialize,
// then session/new, whose reply carries the plan-scoped model list; no prompt turn is ever
// started, so a listing spends no credits. A plan limited to the automatic choice reports that
// choice alone (the recorded run shows three degenerate rows all naming it); the choice's
// selectable forms are its quality settings, which the route kind's tier data names, so the
// automatic token expands to those settings instead of surfacing as a model. Every other value
// the session lists is a model id, kept verbatim.
import type { AccountRecord } from '../../../application/index';
import type { LiveModel, Result, RouteKindRecord, Tier } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { isRecord, openAppServerConnection, type AppServerConnectionError, type AppServerSpawn } from '../transports/app-server/index';
import type { CatalogError } from './model-catalog';

/** The session value that names the automatic choice — not a model id but the router whose
 * selectable forms are its quality settings. */
const AUTOMATIC_CHOICE_ID = 'auto';

/** The tier order the settings are exposed in — the registry's own tier vocabulary, so the
 * expansion adds no ordering of its own. */
const TIER_ORDER: readonly Tier[] = ['strong', 'balanced', 'fast'];

/** The ACP launch of the providers whose live list rides a session answer — the same
 * subcommand the provider's own definition runs, stated here because the catalog receives an
 * account, not a definition. */
const ACP_LAUNCHES: Readonly<Record<string, { readonly command: string; readonly args: readonly string[] }>> = {
  copilot: { command: 'copilot', args: ['--acp', '--stdio'] },
};

/** The handshake values the acp run transport sends; stated here for the same reason as the
 * launch table — the catalog holds no definition to read them from. */
const PROTOCOL_VERSION = 1;
const CLIENT_INFO = { name: 'Docket', version: '2' } as const;

export interface CopilotCatalogConfig {
  /** Overrides the provider's launch command (tests point it at a fixture). */
  readonly command?: string;
  readonly spawn?: AppServerSpawn;
  /** Ceiling per request; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
  /** The directory the session is created in; default: this process's working directory. */
  readonly cwd?: string;
}

/** Nothing here relays the agent's own error text: it could quote values the child saw. */
const toCatalogError = (error: AppServerConnectionError): CatalogError => {
  if (error.code === 'not_installed') return { code: 'not_installed', message: error.message };
  if (error.code === 'timeout') return { code: 'timeout', message: 'the acp request did not answer in time' };
  if (error.code === 'protocol') return { code: 'unsupported', message: 'the agent refused the session request' };
  return { code: 'spawn_failed', message: 'the agent connection closed before the session answer arrived' };
};

/** One id the session answer lists, with the display name it was given, if any. */
interface ModelRow {
  readonly id: string;
  readonly displayName?: string;
}

/** The session/new answer's model rows: the protocol's own channel (the model select option's
 * values) plus the non-standard models field the same answer carries — a CLI variant that
 * fills only one of them still lists, so both are read and deduped by id. */
const rowsOf = (result: unknown): readonly ModelRow[] | undefined => {
  if (!isRecord(result)) return undefined;
  const rows: ModelRow[] = [];
  const push = (id: unknown, displayName: unknown): void => {
    if (typeof id !== 'string' || id === '') return;
    if (rows.some((row) => row.id === id)) return;
    rows.push(typeof displayName === 'string' && displayName !== '' ? { id, displayName } : { id });
  };
  const configOptions = result['configOptions'];
  if (Array.isArray(configOptions)) {
    for (const option of configOptions) {
      if (!isRecord(option) || option['category'] !== 'model' || !Array.isArray(option['options'])) continue;
      for (const choice of option['options']) {
        if (!isRecord(choice)) continue;
        push(choice['value'], choice['name']);
      }
    }
  }
  const models = isRecord(result['models']) ? result['models']['availableModels'] : undefined;
  if (Array.isArray(models)) {
    for (const model of models) {
      if (!isRecord(model)) continue;
      push(model['modelId'], model['name']);
    }
  }
  return rows.length === 0 ? undefined : rows;
};

export async function listCopilotRouteModels(
  account: AccountRecord,
  route: Pick<RouteKindRecord, 'tierModels'>,
  config: CopilotCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const launch = ACP_LAUNCHES[account.provider];
  if (launch === undefined) {
    return err({ code: 'unsupported', message: 'the provider has no acp session model list' });
  }
  // The same JSON-RPC-over-stdio client the app-server leg uses: the wire is identical, only
  // the handshake parameters differ.
  const opened = openAppServerConnection({
    command: config.command ?? launch.command,
    args: launch.args,
    ...(config.spawn === undefined ? {} : { spawn: config.spawn }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  if (!opened.ok) return err(toCatalogError(opened.error));
  const connection = opened.value;
  try {
    const initialised = await connection.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: CLIENT_INFO,
    });
    if (!initialised.ok) return err(toCatalogError(initialised.error));
    const version = isRecord(initialised.value) ? initialised.value['protocolVersion'] : undefined;
    if (version !== PROTOCOL_VERSION) {
      return err({ code: 'unsupported', message: 'the agent speaks a different Agent Client Protocol version' });
    }
    const session = await connection.request('session/new', {
      cwd: config.cwd ?? process.cwd(),
      mcpServers: [],
    });
    if (!session.ok) return err(toCatalogError(session.error));
    const rows = rowsOf(session.value);
    if (rows === undefined) {
      return err({ code: 'malformed', message: 'the session answer carries no model list' });
    }
    const models: LiveModel[] = [];
    for (const row of rows) {
      // The automatic token is expanded below, never listed as itself.
      if (row.id === AUTOMATIC_CHOICE_ID) continue;
      models.push(row.displayName === undefined ? { id: row.id } : { id: row.id, displayName: row.displayName });
    }
    const automatic = rows.find((row) => row.id === AUTOMATIC_CHOICE_ID);
    if (automatic !== undefined) {
      const settings = route.tierModels;
      if (settings === undefined) {
        // A route that names no settings leaves the choice itself — an unknown model.
        models.push(
          automatic.displayName === undefined
            ? { id: automatic.id }
            : { id: automatic.id, displayName: automatic.displayName },
        );
      } else {
        for (const tier of TIER_ORDER) {
          const setting = settings[tier];
          if (setting === undefined || setting === '' || models.some((model) => model.id === setting)) continue;
          // The session named no display name for a setting, so none is invented.
          models.push({ id: setting });
        }
      }
    }
    return ok(models);
  } finally {
    connection.close();
  }
}
