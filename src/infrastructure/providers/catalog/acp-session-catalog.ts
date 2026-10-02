// The ACP-session route live model list (P-29 section 3): one Agent Client Protocol session in a
// scratch working directory — initialize, session/new, read the models the answer reports, close
// the session. No turn is ever started and session/prompt is never sent, so a listing spends no
// quota. Two answer shapes are read, both framed by the protocol's config-option mechanism: a
// `models.availableModels` list (the provider's own extension over the session answer) and the
// select option of reserved category `model`; a bracketed variant suffix in an id is part of the
// id — it is the value the session expects and is never split. Thought levels come from the
// option of reserved category `thought_level` when the provider reports one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccountRecord } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS } from '../defs/builtin-provider-defs';
import { effortOfProviderLevel, type LevelNames } from '../defs/provider-def';
import { buildChildEnv } from '../launch/index';
import {
  ACP_INITIALIZE_PARAMS,
  ACP_PROTOCOL_VERSION,
  closeAcpSession,
  isRecord,
  loginStateOfSessionError,
  openAcpConnection,
  type AcpConnectionError,
  type AcpSpawn,
} from '../transports/acp/index';
import type { CatalogError } from './model-catalog';

/** The ACP-mode launch of each provider whose live list rides a session — the same subcommand the
 * provider's own definition runs, stated here because the catalog receives an account, not a
 * definition. */
const ACP_SESSION_LAUNCHES: Readonly<
  Record<
    string,
    {
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      /** A cold start of this CLI can take several seconds, so no caller's ceiling may sit below it. */
      readonly minTimeoutMs?: number;
      /** The model select exists only once the user configured an inference provider, so a session
       * without one is an empty list, not a malformed answer. */
      readonly modelOptionOptional?: true;
    }
  >
> = {
  cursor: { command: 'cursor-agent', args: ['acp'] },
  // The documented switch keeps the listing from reading the user's own global instruction and
  // skill files, the same isolation the provider's run launch pins.
  opencode: { command: 'opencode', args: ['acp'], env: { OPENCODE_DISABLE_CLAUDE_CODE: '1' } },
  // The CLI reads its own home; no run-scoped redirection exists for it.
  hermes: { command: 'hermes', args: ['acp'] },
  // `--no-leader` keeps the listing off the shared leader socket; the model list comes from the
  // initialize answer, so no session is ever opened for it.
  'grok-build': { command: 'grok', args: ['agent', '--no-leader', 'stdio'], env: { GROK_TELEMETRY_ENABLED: '0' } },
  // Telemetry is on by default and the flag is documented for this subcommand.
  atomcode: { command: 'atomcode', args: ['acp', '--no-telemetry'], modelOptionOptional: true },
  // The switches are unverified (see the definition) but harmless; the cold start needs a longer wait.
  kilo: {
    command: 'kilo',
    args: ['acp'],
    env: { KILO_DISABLE_CLAUDE_CODE: '1', KILO_DISABLE_CLAUDE_CODE_SKILLS: '1' },
    minTimeoutMs: 30_000,
  },
};

/** The refusal a logged-out session answers, as the provider's own definition declares it — the
 * one place that text lives. */
const notLoggedInRuleOf = (provider: string) =>
  BUILTIN_PROVIDER_DEFS.find((def) => def.id === provider)?.authProbe?.acpSession?.notLoggedIn;

export interface AcpSessionCatalogConfig {
  /** Overrides the provider's launch command and ACP arguments (tests point it at a fixture). */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly spawn?: AcpSpawn;
  /** The allowlisted environment a run of the same provider builds from: the machine login lives
   * in it (its home), ambient credentials do not. */
  readonly baseEnv: Readonly<Record<string, string>>;
  /** The provider's own names for levels (its definition's `levelNames`); the advertised levels
   * are read back through them. */
  readonly levelNames?: LevelNames;
  /** Ceiling per request; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
}

/** Nothing here relays the agent's own error text: it could quote values the child saw. */
const toCatalogError = (error: AcpConnectionError): CatalogError => {
  if (error.code === 'not_installed') return { code: 'not_installed', message: error.message };
  if (error.code === 'timeout') return { code: 'timeout', message: error.message };
  if (error.code === 'protocol') return { code: 'unsupported', message: 'the agent refused the session request' };
  return { code: 'spawn_failed', message: 'the agent connection closed before the model list arrived' };
};

interface ConfigOptionEntry {
  readonly value: string;
  readonly name?: string;
}

/** One select entry of a config option: a plain value, or the values a group wraps (the protocol
 * forbids mixing values and groups in one array, so both shapes are read). */
const configOptionEntries = (options: readonly unknown[]): readonly ConfigOptionEntry[] => {
  const entries: ConfigOptionEntry[] = [];
  for (const raw of options) {
    if (!isRecord(raw)) continue;
    const value = raw['value'];
    if (typeof value === 'string') {
      const name = raw['name'];
      entries.push({ value, ...(typeof name === 'string' && name !== '' ? { name } : {}) });
      continue;
    }
    const nested = raw['options'];
    if (Array.isArray(nested)) entries.push(...configOptionEntries(nested));
  }
  return entries;
};

interface ParsedSession {
  readonly models: readonly LiveModel[];
  readonly efforts?: readonly EffortLevel[];
}

/** The session/new answer reduced to live models and the thought levels the session offers.
 * Undefined means the answer carries no shape the listing knows — a protocol answer no observed
 * agent gives, which is an error rather than an empty list. */
const parseSessionAnswer = (
  result: unknown,
  levelNames: LevelNames | undefined,
  modelOptionOptional: boolean,
): ParsedSession | undefined => {
  if (!isRecord(result)) return undefined;
  const rows: LiveModel[] = [];
  const seen = new Set<string>();

  // The provider's own extension: a models object with the ids the session accepts, parameterized
  // ids bracketed exactly as the provider expects them back.
  const models = isRecord(result['models']) ? result['models']['availableModels'] : undefined;
  if (Array.isArray(models)) {
    for (const raw of models) {
      if (!isRecord(raw)) continue;
      const id = raw['modelId'];
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
      seen.add(id);
      const name = raw['name'];
      rows.push({ id, ...(typeof name === 'string' && name !== '' ? { displayName: name } : {}) });
    }
  }

  let modelOptionSeen = false;
  let efforts: readonly EffortLevel[] | undefined;
  const configOptions = result['configOptions'];
  if (Array.isArray(configOptions)) {
    for (const raw of configOptions) {
      if (!isRecord(raw)) continue;
      const category = raw['category'];
      if (category !== 'model' && category !== 'thought_level') continue;
      const options = raw['options'];
      if (!Array.isArray(options)) continue;
      if (category === 'thought_level') {
        // The session-level selector names the levels the provider offers in its own words; a
        // value that stands for no level Docket knows (a "default" among them) is dropped rather
        // than passed through.
        const kept = configOptionEntries(options)
          .map((entry) => effortOfProviderLevel(levelNames, entry.value))
          .filter((level): level is EffortLevel => level !== undefined);
        efforts = kept.length === 0 ? undefined : kept;
        continue;
      }
      modelOptionSeen = true;
      for (const entry of configOptionEntries(options)) {
        if (entry.value === '' || seen.has(entry.value)) continue;
        seen.add(entry.value);
        rows.push({ id: entry.value, ...(entry.name === undefined ? {} : { displayName: entry.name }) });
      }
    }
  }

  if (!Array.isArray(models) && !modelOptionSeen && !(modelOptionOptional && isRecord(result))) return undefined;
  return { models: rows, ...(efforts === undefined ? {} : { efforts }) };
};

/** A provider that lists its models in the initialize answer itself (`_meta.modelState`), before
 * any session and so without a login: each row carries the levels of its own model, and the row
 * named by `currentModelId` is the default. Undefined when the answer has no such list. */
const parseInitializeModels = (initialized: unknown, levelNames: LevelNames | undefined): readonly LiveModel[] | undefined => {
  if (!isRecord(initialized)) return undefined;
  const meta = initialized['_meta'];
  const state = isRecord(meta) ? meta['modelState'] : undefined;
  const available = isRecord(state) ? state['availableModels'] : undefined;
  if (!Array.isArray(available)) return undefined;
  const current = isRecord(state) ? state['currentModelId'] : undefined;
  const rows: LiveModel[] = [];
  const seen = new Set<string>();
  for (const raw of available) {
    if (!isRecord(raw)) continue;
    const id = raw['modelId'];
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = raw['name'];
    const rowMeta = isRecord(raw['_meta']) ? raw['_meta'] : undefined;
    const advertised = rowMeta !== undefined && Array.isArray(rowMeta['reasoningEfforts']) ? rowMeta['reasoningEfforts'] : [];
    const efforts: EffortLevel[] = [];
    for (const entry of advertised) {
      const value = isRecord(entry) ? entry['value'] : undefined;
      const level = typeof value === 'string' ? effortOfProviderLevel(levelNames, value) : undefined;
      if (level !== undefined && !efforts.includes(level)) efforts.push(level);
    }
    rows.push({
      id,
      ...(typeof name === 'string' && name !== '' ? { displayName: name } : {}),
      ...(efforts.length === 0 ? {} : { efforts }),
      ...(id === current ? { isDefault: true as const } : {}),
    });
  }
  return rows;
};

export async function listAcpSessionModels(
  account: AccountRecord,
  config: AcpSessionCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const launch = ACP_SESSION_LAUNCHES[account.provider];
  if (launch === undefined) {
    return err({ code: 'unsupported', message: 'the provider has no ACP session model list' });
  }
  // The session's working directory is a scratch tree: a listing must never seed a real repo's
  // context, and the models the answer lists do not depend on the directory's contents.
  const scratch = mkdtempSync(join(tmpdir(), 'docket-acp-session-'));
  const opened = openAcpConnection({
    command: config.command ?? launch.command,
    args: config.args ?? launch.args,
    env: buildChildEnv(account.provider, config.baseEnv, launch.env ?? {}),
    ...(config.spawn === undefined ? {} : { spawn: config.spawn }),
    ...(config.timeoutMs === undefined && launch.minTimeoutMs === undefined
      ? {}
      : { timeoutMs: Math.max(config.timeoutMs ?? 0, launch.minTimeoutMs ?? 0) }),
  });
  if (!opened.ok) {
    rmSync(scratch, { recursive: true, force: true });
    return err(toCatalogError(opened.error));
  }
  const connection = opened.value;
  try {
    const initialized = await connection.request('initialize', ACP_INITIALIZE_PARAMS);
    if (!initialized.ok) return err(toCatalogError(initialized.error));
    const agent = isRecord(initialized.value) ? initialized.value : undefined;
    if (agent?.['protocolVersion'] !== ACP_PROTOCOL_VERSION) {
      return err({ code: 'unsupported', message: 'the agent speaks a different Agent Client Protocol version' });
    }

    // A list given at initialize is complete without a login; asking for a session would only
    // end in the login refusal.
    const initializeModels = parseInitializeModels(initialized.value, config.levelNames);
    if (initializeModels !== undefined) return ok(initializeModels);

    const created = await connection.request('session/new', { cwd: scratch, mcpServers: [] });
    if (!created.ok) {
      // A logged-out CLI refuses the session: the list is empty and the caller shows the login
      // state, not a transport failure.
      const rule = notLoggedInRuleOf(account.provider);
      if (rule !== undefined && loginStateOfSessionError(created.error, rule) === false) {
        return err({ code: 'not_logged_in', message: 'the provider has no login on this machine' });
      }
      return err(toCatalogError(created.error));
    }
    const parsed = parseSessionAnswer(created.value, config.levelNames, launch.modelOptionOptional === true);
    if (parsed === undefined) {
      return err({ code: 'malformed', message: 'the session answer carries no model list' });
    }

    await closeAcpSession(connection, initialized.value, created.value);
    return ok(parsed.models.map((row) => ({ ...row, ...(parsed.efforts === undefined ? {} : { efforts: parsed.efforts }) })));
  } finally {
    connection.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
