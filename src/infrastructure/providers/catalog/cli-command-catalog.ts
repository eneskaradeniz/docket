// The cli-command route live model list (P-29 section 3, source 'cli-command'): the provider's
// own model-listing subcommand — a plain command run, never a print-mode prompt, so no agent turn
// starts and no quota is spent. Each provider's recorded answer shape has its own parser: the
// `models` subcommand answer (1.2.14) is tab-separated rows of model id and display name with no
// header and progress noise on stderr — extra columns are ignored, and the display name's
// trailing parenthesised word names the row's effort variant where it names a level at all; the
// `chat --list-models -f json` answer (2.27.0) is one JSON object. Only the spawn function is
// injected; every failure is a Result, never a throw, and no error message quotes the output —
// it could carry values the child saw.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { AccountRecord } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { effortOfProviderLevel, type LevelNames } from '../defs/provider-def';
import type { CatalogError } from './model-catalog';

const DEFAULT_TIMEOUT_MS = 15_000;

/** The models command of each provider whose live list rides its CLI — the subcommand the CLI's
 * own `--help` advertises ("models  List available models"), stated here because the catalog
 * receives an account, not a definition. `format` names the recorded output shape the parser
 * reads; `needsLogin` marks a command that would open a browser login flow when nobody is logged
 * in, so it runs only on the login probe's `true` (P-45). */
const CLI_MODEL_COMMANDS: Readonly<
  Record<
    string,
    { readonly command: string; readonly args: readonly string[]; readonly needsLogin?: true; readonly format: 'tsv' | 'kiro-models-json' }
  >
> = {
  agy: { command: 'agy', args: ['models'], format: 'tsv' },
  // The command goes through the wrapper: on a broken install it fails before printing anything,
  // which is a failed listing like any other, and the registry's empty answer stands.
  kiro: { command: 'kiro-cli', args: ['chat', '--list-models', '-f', 'json'], needsLogin: true, format: 'kiro-models-json' },
};

/** The narrow spawn surface the adapter needs; the real node spawn satisfies it directly. */
export type CliModelSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => ChildProcess;

export interface CliCommandCatalogConfig {
  /** Overrides the provider's launch command (tests point it at a fixture). */
  readonly command?: string;
  readonly spawn?: CliModelSpawn;
  /** The provider's own names for levels (its definition's `levelNames`). */
  readonly levelNames?: LevelNames;
  /** Marks the command as needing a login even where the table does not (a definition the table
   * does not cover yet, a fixture). */
  readonly needsLogin?: true;
  /** The login probe's answer for this account's provider; a command marked `needsLogin` runs only
   * on `true`, so a logged-out CLI never opens a browser or starts a login flow from a listing. */
  readonly loggedIn?: boolean | null;
  /** Ceiling for the whole call; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
}

/** The trailing parenthesised word of a display name, when it names a level Docket knows: the
 * rows that carry an effort variant state exactly that one level ("(High)", "(Medium)", "(Low)");
 * a word that is not a level ("(Thinking)") states none. */
const effortOf = (displayName: string, levelNames: LevelNames | undefined): EffortLevel | undefined => {
  const match = /\(([^()]*)\)[ \t]*$/.exec(displayName);
  const word = match?.[1]?.trim().toLowerCase();
  return word !== undefined && word !== '' ? effortOfProviderLevel(levelNames, word) : undefined;
};

/**
 * The recorded output shape: one row per line, model id TAB display name, no header. Extra
 * columns are ignored; a row without a display name stays a row; a duplicate id is listed once.
 * An output with no rows, or a line that is not an id and a name (prose, or an empty first
 * field), is a shape problem the diagnostic names without quoting the output.
 */
export function parseCliModelsOutput(text: string, levelNames?: LevelNames): Result<readonly LiveModel[], CatalogError> {
  const rows: LiveModel[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') continue;
    const fields = line.split('\t');
    const id = fields[0] ?? '';
    // A model id is one token: a row of prose (spaces inside what should be the id) or a row
    // whose first field is empty is not a table row.
    if (id === '' || id.includes(' ')) {
      return err({ code: 'malformed', message: 'the models output has a row that is not a model id and display name' });
    }
    if (rows.some((seen) => seen.id === id)) continue;
    const displayName = fields[1] ?? '';
    const effort = effortOf(displayName, levelNames);
    rows.push({
      id,
      ...(displayName === '' ? {} : { displayName }),
      ...(effort === undefined ? {} : { efforts: [effort] }),
    });
  }
  if (rows.length === 0) return err({ code: 'malformed', message: 'the models output carries no model rows' });
  return ok(rows);
}

/**
 * The recorded answer shape of `kiro-cli chat --list-models -f json` (CLI 2.27.0): one JSON
 * object with a `models` list and a `default_model` id. Each row's `model_id` is the model id and
 * `model_name` the display name; the row named by `default_model` (an alias row for a router) is
 * the default. `rate_multiplier` is a credit multiplier, not a price, so no billing is read from
 * it; `context_window_tokens` is validated as the recorded shape's companion field but carried
 * nowhere — a live row has no context-window field to hold it. An unparseable answer, a missing
 * or empty list, or a row without a model id is a shape problem the diagnostic names without
 * quoting the output.
 */
export function parseKiroModelsOutput(text: string): Result<readonly LiveModel[], CatalogError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({ code: 'malformed', message: 'the models output is not the recorded JSON shape' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err({ code: 'malformed', message: 'the models output is not the recorded JSON shape' });
  }
  const record = parsed as Record<string, unknown>;
  const models = record['models'];
  if (!Array.isArray(models) || models.length === 0) {
    return err({ code: 'malformed', message: 'the models output carries no model rows' });
  }
  const rows: LiveModel[] = [];
  for (const raw of models) {
    const entry = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const id = entry === null ? undefined : typeof entry['model_id'] === 'string' ? entry['model_id'] : undefined;
    if (id === undefined || id === '') {
      return err({ code: 'malformed', message: 'the models output has a row without a model id' });
    }
    if (rows.some((seen) => seen.id === id)) continue;
    const name = entry === null ? undefined : typeof entry['model_name'] === 'string' ? entry['model_name'] : undefined;
    rows.push({ id, ...(name === undefined || name === '' ? {} : { displayName: name }) });
  }
  if (rows.length === 0) return err({ code: 'malformed', message: 'the models output carries no model rows' });
  const defaultModel = typeof record['default_model'] === 'string' ? record['default_model'] : undefined;
  const defaultRow = defaultModel === undefined ? undefined : rows.find((row) => row.id === defaultModel);
  if (defaultRow === undefined) return ok(rows);
  return ok(rows.map((row) => (row === defaultRow ? { ...row, isDefault: true as const } : row)));
}

interface CommandOutcome {
  readonly exitCode: number | null; // null = killed early or never ran
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  readonly stdout: string;
}

const runModelsCommand = (
  spawn: CliModelSpawn,
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandOutcome> =>
  new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], { timeout: timeoutMs });
    } catch {
      resolve({ exitCode: null, timedOut: false, spawnFailed: true, stdout: '' });
      return;
    }
    let stdout = '';
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, spawnFailed, stdout });
    };
    // The injected spawn is asked to time out too; this timer is the backstop for one that ignores it.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    // A failed spawn (e.g. no such binary) reports 'error' and may never report 'close'.
    child.on('error', () => {
      spawnFailed = true;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });

export async function listCliCommandRouteModels(
  account: AccountRecord,
  config: CliCommandCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const launch = CLI_MODEL_COMMANDS[account.provider];
  if (launch === undefined) {
    return err({ code: 'unsupported', message: 'the provider has no model-listing command' });
  }
  // The catalog treats this error like any failed listing and answers from bundled data.
  if ((launch.needsLogin === true || config.needsLogin === true) && config.loggedIn !== true) {
    return err({ code: 'unsupported', message: 'the models command needs a login and none is confirmed' });
  }
  const outcome = await runModelsCommand(
    config.spawn ?? nodeSpawn,
    config.command ?? launch.command,
    launch.args,
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (outcome.spawnFailed) return err({ code: 'not_installed', message: 'the models command could not be started' });
  // A null exit means the child was killed before finishing — only the timeouts here kill it.
  if (outcome.timedOut || outcome.exitCode === null) {
    return err({ code: 'timeout', message: 'the models command did not answer in time' });
  }
  if (outcome.exitCode !== 0) {
    return err({ code: 'spawn_failed', message: 'the models command failed before printing a model list' });
  }
  return launch.format === 'kiro-models-json'
    ? parseKiroModelsOutput(outcome.stdout)
    : parseCliModelsOutput(outcome.stdout, config.levelNames);
}
