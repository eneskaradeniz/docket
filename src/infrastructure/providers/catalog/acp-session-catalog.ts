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
import { buildChildEnv } from '../launch/index';
import {
  ACP_INITIALIZE_PARAMS,
  ACP_PROTOCOL_VERSION,
  isRecord,
  openAcpConnection,
  type AcpConnectionError,
  type AcpSpawn,
} from '../transports/acp/index';
import { KNOWN_EFFORT_LEVELS } from './claude-catalog';
import type { CatalogError } from './model-catalog';

/** The ACP-mode launch of each provider whose live list rides a session — the same subcommand the
 * provider's own definition runs, stated here because the catalog receives an account, not a
 * definition. */
const ACP_SESSION_LAUNCHES: Readonly<
  Record<string, { readonly command: string; readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> }>
> = {
  cursor: { command: 'cursor-agent', args: ['acp'] },
  // The documented switch keeps the listing from reading the user's own global instruction and
  // skill files, the same isolation the provider's run launch pins.
  opencode: { command: 'opencode', args: ['acp'], env: { OPENCODE_DISABLE_CLAUDE_CODE: '1' } },
};

export interface AcpSessionCatalogConfig {
  /** Overrides the provider's launch command and ACP arguments (tests point it at a fixture). */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly spawn?: AcpSpawn;
  /** The allowlisted environment a run of the same provider builds from: the machine login lives
   * in it (its home), ambient credentials do not. */
  readonly baseEnv: Readonly<Record<string, string>>;
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
const parseSessionAnswer = (result: unknown): ParsedSession | undefined => {
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
        // The session-level selector names the levels the provider offers; a level the domain
        // does not know (a "default" among them) is dropped rather than passed through.
        const kept = configOptionEntries(options)
          .map((entry) => entry.value)
          .filter((level): level is EffortLevel => (KNOWN_EFFORT_LEVELS as readonly string[]).includes(level));
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

  if (!Array.isArray(models) && !modelOptionSeen) return undefined;
  return { models: rows, ...(efforts === undefined ? {} : { efforts }) };
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
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
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

    const created = await connection.request('session/new', { cwd: scratch, mcpServers: [] });
    if (!created.ok) return err(toCatalogError(created.error));
    const parsed = parseSessionAnswer(created.value);
    if (parsed === undefined) {
      return err({ code: 'malformed', message: 'the session answer carries no model list' });
    }

    // The protocol lets only an agent that advertises sessionCapabilities.close be asked to close
    // a session; the process group dies right after either way, so a refusal is not an error.
    const capabilities = isRecord(agent['agentCapabilities']) ? agent['agentCapabilities'] : undefined;
    const sessionCapabilities =
      capabilities !== undefined && isRecord(capabilities['sessionCapabilities']) ? capabilities['sessionCapabilities'] : undefined;
    const sessionId = isRecord(created.value) && typeof created.value['sessionId'] === 'string' ? created.value['sessionId'] : undefined;
    if (sessionCapabilities !== undefined && 'close' in sessionCapabilities && sessionId !== undefined) {
      await connection.request('session/close', { sessionId });
    }
    return ok(parsed.models.map((row) => ({ ...row, ...(parsed.efforts === undefined ? {} : { efforts: parsed.efforts }) })));
  } finally {
    connection.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
