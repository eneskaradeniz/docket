// The cli-command route live model list (P-29 section 3, source 'cli-command'): the provider's
// own model-listing subcommand — a plain command run, never a print-mode prompt, so no agent turn
// starts and no quota is spent. The recorded answer of the CLI's `models` subcommand (1.2.14) is
// tab-separated rows of model id and display name with no header and progress noise on stderr;
// extra columns are ignored, and the display name's trailing parenthesised word names the row's
// effort variant where it names a level at all. Only the spawn function is injected; every
// failure is a Result, never a throw, and no error message quotes the output — it could carry
// values the child saw.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { AccountRecord } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { KNOWN_EFFORT_LEVELS } from './claude-catalog';
import type { CatalogError } from './model-catalog';

const DEFAULT_TIMEOUT_MS = 15_000;

/** The models command of each provider whose live list rides its CLI — the subcommand the CLI's
 * own `--help` advertises ("models  List available models"), stated here because the catalog
 * receives an account, not a definition. */
const CLI_MODEL_COMMANDS: Readonly<Record<string, { readonly command: string; readonly args: readonly string[] }>> = {
  agy: { command: 'agy', args: ['models'] },
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
  /** Ceiling for the whole call; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
}

const isEffortLevel = (word: string): word is EffortLevel =>
  (KNOWN_EFFORT_LEVELS as readonly string[]).includes(word);

/** The trailing parenthesised word of a display name, when it names a level Docket knows: the
 * rows that carry an effort variant state exactly that one level ("(High)", "(Medium)", "(Low)");
 * a word that is not a level ("(Thinking)") states none. */
const effortOf = (displayName: string): EffortLevel | undefined => {
  const match = /\(([^()]*)\)[ \t]*$/.exec(displayName);
  const word = match?.[1]?.trim().toLowerCase();
  return word !== undefined && word !== '' && isEffortLevel(word) ? word : undefined;
};

/**
 * The recorded output shape: one row per line, model id TAB display name, no header. Extra
 * columns are ignored; a row without a display name stays a row; a duplicate id is listed once.
 * An output with no rows, or a line that is not an id and a name (prose, or an empty first
 * field), is a shape problem the diagnostic names without quoting the output.
 */
export function parseCliModelsOutput(text: string): Result<readonly LiveModel[], CatalogError> {
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
    const effort = effortOf(displayName);
    rows.push({
      id,
      ...(displayName === '' ? {} : { displayName }),
      ...(effort === undefined ? {} : { efforts: [effort] }),
    });
  }
  if (rows.length === 0) return err({ code: 'malformed', message: 'the models output carries no model rows' });
  return ok(rows);
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
  return parseCliModelsOutput(outcome.stdout);
}
