// The API-key route live model list (P-29 section 3): the provider's documented model-list
// endpoint — one GET per page, cursor-paginated, the key riding only its documented request
// header and never a result, a record or an event. Endpoint path, headers, query parameters and
// response fields follow the provider's published API documentation for listing models. Fetch
// and the timeout are injected; every failure is a Result, never a throw.
import type { AccountRecord, SecretVault } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

const DEFAULT_TIMEOUT_MS = 15_000;
/** The documented maximum of the endpoint's own page-size parameter: the fewest round-trips. */
const PAGE_SIZE = 1000;
/** A guard against an endpoint that paginates forever; a live-authoritative list must not be
 * silently truncated, so the cap fails the call instead of cutting it. */
const MAX_PAGES = 10;

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const MODELS_PATH = '/v1/models';
const API_KEY_HEADER = 'x-api-key';
const VERSION_HEADER = 'anthropic-version';
const VERSION_VALUE = '2023-06-01';

export type ApiModelListError = {
  readonly code: 'unsupported' | 'not_logged_in' | 'timeout' | 'endpoint_error' | 'malformed';
  readonly message: string;
};

export interface ApiModelListConfig {
  readonly secrets: Pick<SecretVault, 'get'>;
  /** Default: the global fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Origin of the documented model-list endpoint; default: the provider's documented host. */
  readonly baseUrl?: string;
  /** Ceiling per page; the default leaves a slow endpoint well over a control round-trip. */
  readonly timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The documented effort capability block names its levels by key; canonical ascending order
 * keeps the mapped list deterministic whatever order the endpoint's JSON parser hands back. */
const EFFORT_KEYS: readonly { readonly level: EffortLevel; readonly key: string }[] = [
  { level: 'low', key: 'low' },
  { level: 'medium', key: 'medium' },
  { level: 'high', key: 'high' },
  { level: 'xhigh', key: 'xhigh' },
  { level: 'max', key: 'max' },
];

const toLiveModel = (row: Record<string, unknown>): LiveModel | undefined => {
  const id = row['id'];
  if (typeof id !== 'string' || id === '') return undefined;
  const displayName = row['display_name'];
  const capabilities = row['capabilities'];
  const effort = isRecord(capabilities) ? capabilities['effort'] : undefined;
  const efforts =
    isRecord(effort) && effort['supported'] === true
      ? EFFORT_KEYS.filter(({ key }) => {
          const level = effort[key];
          return isRecord(level) && level['supported'] === true;
        }).map(({ level }) => level)
      : undefined;
  return {
    id,
    ...(typeof displayName === 'string' && displayName !== '' ? { displayName } : {}),
    ...(efforts === undefined || efforts.length === 0 ? {} : { efforts }),
  };
};

interface ParsedPage {
  readonly models: readonly LiveModel[];
  readonly hasMore: boolean;
  readonly lastId: string | undefined;
}

/** One documented answer page: `data` rows map to live models, `has_more` and `last_id` drive
 * the next request. Anything else is a page the contract does not describe. */
const parsePage = (payload: unknown): ParsedPage | undefined => {
  if (!isRecord(payload) || !Array.isArray(payload['data'])) return undefined;
  const models: LiveModel[] = [];
  for (const entry of payload['data']) {
    if (!isRecord(entry)) continue;
    const model = toLiveModel(entry);
    if (model !== undefined && !models.some((seen) => seen.id === model.id)) models.push(model);
  }
  const lastId = payload['last_id'];
  return {
    models,
    hasMore: payload['has_more'] === true,
    lastId: typeof lastId === 'string' && lastId !== '' ? lastId : undefined,
  };
};

export async function listApiKeyRouteModels(
  account: AccountRecord,
  config: ApiModelListConfig,
): Promise<Result<readonly LiveModel[], ApiModelListError>> {
  // The key comes only from the vault through the account's secretRef and reaches only the
  // request header; a missing key fails before any request is made.
  const secretRef = account.secretRef;
  const apiKey = secretRef === undefined ? undefined : await config.secrets.get(secretRef);
  if (apiKey === undefined || apiKey === '') {
    return err({ code: 'not_logged_in', message: 'the account has no api key in the vault' });
  }

  let base: URL;
  try {
    base = new URL(config.baseUrl ?? DEFAULT_BASE_URL);
  } catch {
    return err({ code: 'unsupported', message: 'the model-list endpoint base is not a valid URL' });
  }

  const runFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const collected: LiveModel[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(MODELS_PATH, base);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (afterId !== undefined) url.searchParams.set('after_id', afterId);

    let response: Response;
    try {
      // A redirect is refused: following one could hand the key's header to a different origin.
      response = await runFetch(url, {
        method: 'GET',
        headers: { [API_KEY_HEADER]: apiKey, [VERSION_HEADER]: VERSION_VALUE },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return err(
        timedOut
          ? { code: 'timeout', message: 'the model-list endpoint did not answer in time' }
          : { code: 'endpoint_error', message: 'the model-list endpoint could not be reached' },
      );
    }
    if (!response.ok) {
      // The status number names the failure; the body is never relayed — it could echo the key.
      return err(
        response.status === 401 || response.status === 403
          ? { code: 'not_logged_in', message: 'the model-list endpoint rejected the account key' }
          : { code: 'endpoint_error', message: `the model-list endpoint answered ${response.status}` },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err({ code: 'malformed', message: 'the model-list answer is not JSON' });
    }
    const parsed = parsePage(payload);
    if (parsed === undefined) {
      return err({ code: 'malformed', message: 'the model-list answer does not carry a model page' });
    }
    for (const model of parsed.models) {
      if (!collected.some((seen) => seen.id === model.id)) collected.push(model);
    }
    if (!parsed.hasMore) return ok(collected);
    if (parsed.lastId === undefined) {
      return err({ code: 'malformed', message: 'the model-list answer promises more pages but names no cursor' });
    }
    afterId = parsed.lastId;
  }
  return err({ code: 'malformed', message: 'the model-list endpoint never finished paginating' });
}
