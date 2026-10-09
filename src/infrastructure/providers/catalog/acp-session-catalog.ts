// The ACP-session route live model list (P-29 section 3): one Agent Client Protocol session in a
// scratch working directory — initialize, session/new, read the models the answer reports, close
// the session. No turn is ever started and session/prompt is never sent, so a listing spends no
// quota. Two answer shapes are read, both framed by the protocol's config-option mechanism: a
// `models.availableModels` list (the provider's own extension over the session answer) and the
// select option of reserved category `model`; a bracketed variant suffix in an id is part of the
// id — it is the value the session expects and is never split. Thought levels come from the
// option of reserved category `thought_level` (or `thinking`, the name one provider uses for the
// same selector) when the provider reports one. A model's window rides whatever channel reports
// it (A-63): the session row's own `_meta.contextLimit`, the initialize row's
// `_meta.totalContextTokens`, or — for the one provider whose ids carry it — the `context=`
// parameter inside the bracketed suffix.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccountRecord } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS } from '../defs/builtin-provider-defs';
import { effortOfProviderLevel, type EffortArg, type LevelNames } from '../defs/provider-def';
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
  type NotLoggedInRule,
} from '../transports/acp/index';
import type { CatalogError } from './model-catalog';

/** One provider's ACP-mode launch — the same subcommand the provider's own definition runs. */
export interface AcpSessionLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** A cold start of this CLI can take several seconds, so no caller's ceiling may sit below it. */
  readonly minTimeoutMs?: number;
  /** The model select exists only once the user configured an inference provider, so a session
   * without one is an empty list, not a malformed answer. */
  readonly modelOptionOptional?: true;
  /** The refusal a logged-out session answers, pinned here for a CLI whose login is probed
   * nowhere else: discovery reads no login state for it, so only this catalog path maps the
   * refusal to the not-logged-in answer. */
  readonly notLoggedIn?: NotLoggedInRule;
  /** The provider reports each model's window inside the id itself — a bracketed `context=`
   * parameter — so the listing reads it out of the ids it keeps whole. */
  readonly contextFromModelId?: true;
}

/** The ACP-mode launch of each provider whose live list rides a session, stated here because the
 * catalog receives an account, not a definition. Production rows only (P-47a): a table-driven
 * option no real provider exercises is driven through the `launches` factory option with a test
 * table, never through a fixture row here. */
export const ACP_SESSION_LAUNCHES: Readonly<Record<string, AcpSessionLaunch>> = {
  cursor: { command: 'cursor-agent', args: ['acp'], contextFromModelId: true },
  // The documented switch keeps the listing from reading the user's own global instruction and
  // skill files, the same isolation the provider's run launch pins.
  opencode: { command: 'opencode', args: ['acp'], env: { OPENCODE_DISABLE_CLAUDE_CODE: '1' } },
};

/** The refusal a logged-out session answers, as the provider's own definition declares it — the
 * one place that text lives. */
const notLoggedInRuleOf = (provider: string) =>
  BUILTIN_PROVIDER_DEFS.find((def) => def.id === provider)?.authProbe?.acpSession?.notLoggedIn;

/** The effort parameter of the provider's own definition — the one place that declares it. */
const effortArgOf = (provider: string): EffortArg | undefined =>
  BUILTIN_PROVIDER_DEFS.find((def) => def.id === provider)?.effortArg;

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
  /** The launch table to read (P-47a); the default is the built-in one. A production table never
   * carries a fixture row, so the options no built-in row exercises today are driven by tests
   * passing a test table here. */
  readonly launches?: Readonly<Record<string, AcpSessionLaunch>>;
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

/** A window a session's own answer states: only a positive integer is one — a negative,
 * fractional, zero or string value is absent, the same rule the merge applies. */
const windowOfTokens = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

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

/** A provider whose levels ride the model id lists each model plain and once per level. A row
 * whose id is `<listed row><separator><level name>` folds into that listed row, which then offers
 * the levels its variants stood for. A suffixed id with no plain row listed stays whole: it is
 * then the only id the session accepts for that model, and splitting it would invent one. */
const foldSuffixedModels = (
  rows: readonly LiveModel[],
  separator: string,
  levelNames: LevelNames | undefined,
): readonly LiveModel[] => {
  const listed = new Set(rows.map((row) => row.id));
  const levelsOf = new Map<string, EffortLevel[]>();
  const kept: LiveModel[] = [];
  for (const row of rows) {
    const cut = row.id.lastIndexOf(separator);
    const base = cut > 0 ? row.id.slice(0, cut) : undefined;
    const level = cut > 0 ? effortOfProviderLevel(levelNames, row.id.slice(cut + separator.length)) : undefined;
    if (base === undefined || level === undefined || !listed.has(base)) {
      kept.push(row);
      continue;
    }
    const levels = levelsOf.get(base) ?? [];
    if (!levels.includes(level)) levels.push(level);
    levelsOf.set(base, levels);
  }
  return kept.map((row) => {
    const levels = levelsOf.get(row.id);
    return levels === undefined ? row : { ...row, efforts: levels };
  });
};

/** The window a parameterized model id embeds — the one observed provider's own grammar: a
 * bracketed parameter group whose `context` entry is `<digits>k` or `<digits>m`, the two
 * magnitudes its ids use. The id is never rewritten; the session expects it back verbatim. A
 * value that names no magnitude leaves the row without a window. */
const contextWindowOfId = (id: string): number | undefined => {
  const match = /(?:^|[[,])context=(\d+)([km])(?=[[,\]])/.exec(id);
  if (match === null) return undefined;
  return Number(match[1]) * (match[2] === 'k' ? 1_000 : 1_000_000);
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
  effortArg: EffortArg | undefined,
  contextFromModelId: boolean,
): ParsedSession | undefined => {
  if (!isRecord(result)) return undefined;
  const rows: LiveModel[] = [];
  const seen = new Set<string>();

  // The provider's own extension: a models object with the ids the session accepts, parameterized
  // ids bracketed exactly as the provider expects them back. A row may state its own window in
  // `_meta` (A-63); the id's embedded parameter answers only when the row itself is silent.
  const models = isRecord(result['models']) ? result['models']['availableModels'] : undefined;
  if (Array.isArray(models)) {
    for (const raw of models) {
      if (!isRecord(raw)) continue;
      const id = raw['modelId'];
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
      seen.add(id);
      const name = raw['name'];
      const meta = isRecord(raw['_meta']) ? raw['_meta'] : undefined;
      const window = (meta === undefined ? undefined : windowOfTokens(meta['contextLimit'])) ??
        (contextFromModelId ? contextWindowOfId(id) : undefined);
      rows.push({
        id,
        ...(typeof name === 'string' && name !== '' ? { displayName: name } : {}),
        ...(window === undefined ? {} : { contextWindow: window }),
      });
    }
  }

  let modelOptionSeen = false;
  let efforts: readonly EffortLevel[] | undefined;
  const configOptions = result['configOptions'];
  if (Array.isArray(configOptions)) {
    for (const raw of configOptions) {
      if (!isRecord(raw)) continue;
      // A provider that names no category for its selects is found by the ids its documentation
      // gives them.
      const category = raw['category'] ?? (raw['id'] === 'model' ? 'model' : raw['id'] === 'effort' ? 'thought_level' : undefined);
      if (category !== 'model' && category !== 'thought_level' && category !== 'thinking') continue;
      const options = raw['options'];
      if (!Array.isArray(options)) continue;
      if (category === 'thought_level' || category === 'thinking') {
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
        // The select repeats the ids the models object already listed, so the same embedded
        // window applies where the provider reports it in the id.
        const window = contextFromModelId ? contextWindowOfId(entry.value) : undefined;
        rows.push({
          id: entry.value,
          ...(entry.name === undefined ? {} : { displayName: entry.name }),
          ...(window === undefined ? {} : { contextWindow: window }),
        });
      }
    }
  }

  if (!Array.isArray(models) && !modelOptionSeen && !(modelOptionOptional && isRecord(result))) return undefined;
  const folded = effortArg?.kind === 'model-suffix' ? foldSuffixedModels(rows, effortArg.separator, levelNames) : rows;
  return { models: folded, ...(efforts === undefined ? {} : { efforts }) };
};

/** A provider that lists its models in the initialize answer itself (`_meta.modelState`), before
 * any session and so without a login: each row carries the levels of its own model and the window
 * its own `_meta.totalContextTokens` states (A-63), and the row named by `currentModelId` is the
 * default. Undefined when the answer has no such list. */
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
    const window = rowMeta === undefined ? undefined : windowOfTokens(rowMeta['totalContextTokens']);
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
      ...(window === undefined ? {} : { contextWindow: window }),
      ...(id === current ? { isDefault: true as const } : {}),
    });
  }
  return rows;
};

export async function listAcpSessionModels(
  account: AccountRecord,
  config: AcpSessionCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const launch = (config.launches ?? ACP_SESSION_LAUNCHES)[account.provider];
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
      // state, not a transport failure. The launch entry's rule wins — it exists for a CLI whose
      // discovery probes no login — and otherwise the provider's own definition declares the
      // refusal, the same rule its discovery probe reads.
      const rule = launch.notLoggedIn ?? notLoggedInRuleOf(account.provider);
      if (rule !== undefined && loginStateOfSessionError(created.error, rule) === false) {
        return err({ code: 'not_logged_in', message: 'the provider has no login on this machine' });
      }
      return err(toCatalogError(created.error));
    }
    const parsed = parseSessionAnswer(
      created.value,
      config.levelNames,
      launch.modelOptionOptional === true,
      effortArgOf(account.provider),
      launch.contextFromModelId === true,
    );
    if (parsed === undefined) {
      return err({ code: 'malformed', message: 'the session answer carries no model list' });
    }

    await closeAcpSession(connection, initialized.value, created.value);
    return ok(parsed.models.map((row) => ({ ...(parsed.efforts === undefined ? {} : { efforts: parsed.efforts }), ...row })));
  } finally {
    connection.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
