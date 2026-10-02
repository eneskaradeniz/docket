// The provider definition contract: a CLI is described by pure data, never by engine code.
// Contract: docs/v2/providers.md → "Provider definition (data)".
import type { ProviderMark } from '../../../application/index';
import type { EffortLevel, ProviderCapabilities } from '../../../domain/index';

/**
 * What one run hands to a definition so it can produce argv/env/stdin. The prompt travels
 * through stdin only; argv limits would truncate long work orders.
 */
export interface LaunchInput {
  readonly prompt: string;
  /** Run-scoped directory holding this run's MCP/skills/hooks files; the user's own config is never written. */
  readonly configDir: string;
  readonly resume?: { readonly sessionRef: string };
  /** Already clamped to the model; absent adds nothing to the launch. */
  readonly effort?: EffortLevel;
  /** The run's model id as the route names it, when one is pinned. */
  readonly model?: string;
}

/**
 * Where a provider takes the effort, as data taken from the CLI's own help or protocol schema.
 * `flag`: argv carries the flag and the level; `request-field`: the transport sends the level in
 * the named field of its query options or turn request; `session-option`: the ACP session config
 * option, named by its reserved `category` or by its `configId`, is set after the session exists;
 * `model-suffix`: the level joins the model id after `separator` and never travels separately.
 * A definition without one ignores the effort.
 */
export type EffortArg =
  | { readonly kind: 'flag'; readonly flag: string }
  | { readonly kind: 'request-field'; readonly name: string }
  | { readonly kind: 'session-option'; readonly category: string; readonly configId?: undefined }
  | { readonly kind: 'session-option'; readonly configId: string; readonly category?: undefined }
  | { readonly kind: 'model-suffix'; readonly separator: string };

/** A provider's own names for effort levels; a level without an entry has no provider name. */
export type LevelNames = Partial<Record<EffortLevel, string>>;

export const EFFORT_LEVELS: readonly EffortLevel[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

/**
 * The provider's value for a level. Without a map the level's own name is the provider's; with a
 * map, a level it does not name has no provider value — a guessed name would be refused by the
 * CLI or, worse, accepted as another level.
 */
export function providerLevelOf(levelNames: LevelNames | undefined, effort: EffortLevel | undefined): string | undefined {
  if (effort === undefined) return undefined;
  if (levelNames === undefined) return effort;
  return levelNames[effort];
}

/**
 * The reverse of `providerLevelOf`: the level a value a provider advertises stands for, or
 * `undefined` for a value that names none (it is never offered). Both directions share one rule,
 * so every offered level is also sendable.
 */
export function effortOfProviderLevel(levelNames: LevelNames | undefined, value: string): EffortLevel | undefined {
  if (levelNames === undefined) return EFFORT_LEVELS.find((level) => level === value);
  return EFFORT_LEVELS.find((level) => levelNames[level] === value);
}

/** The argv pair a `flag` effort parameter adds; nothing for any other kind, an absent effort or a level the provider does not name. */
export function effortFlagArgs(
  arg: EffortArg | undefined,
  effort: EffortLevel | undefined,
  levelNames?: LevelNames,
): string[] {
  if (arg?.kind !== 'flag') return [];
  const value = providerLevelOf(levelNames, effort);
  return value === undefined ? [] : [arg.flag, value];
}

/**
 * The model id a run launches with: for `model-suffix` the model plus separator plus the
 * provider's level name; any other kind, an absent effort or an unnamed level leaves the model
 * as it is.
 */
export function effortModelId(
  arg: EffortArg | undefined,
  model: string | undefined,
  effort: EffortLevel | undefined,
  levelNames?: LevelNames,
): string | undefined {
  if (model === undefined || arg?.kind !== 'model-suffix') return model;
  const value = providerLevelOf(levelNames, effort);
  return value === undefined ? model : `${model}${arg.separator}${value}`;
}

export type ProviderTransport = 'sdk' | 'app-server' | 'acp' | 'stream-json';

export type ProviderResumeMode = 'specify' | 'capture' | 'protocol' | 'none';

export interface ProviderAuthProbe {
  readonly args: string[]; // exit 0 = logged in
}

export interface ProviderConfig {
  /** How the run-scoped config dir is passed to this CLI. */
  readonly mechanism: 'env-var' | 'flag';
  readonly name: string;
}

export interface ProviderLaunch {
  readonly args: string[];
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: 'prompt' | 'none';
}

// A cold CLI start (login refresh, model load) can legitimately take a minute, so the wait for
// the first event is generous; a run that has started talking but stays silent through a long
// tool-free stretch is far more likely hung, yet reasoning pauses can last minutes.
export const DEFAULT_FIRST_OUTPUT_TIMEOUT_MS = 120_000;
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 600_000;

export interface ProviderDef {
  readonly id: string;
  readonly displayName: string;
  /** Candidate executable names; discovery takes the first one found. */
  readonly bins: readonly string[];
  readonly versionArgs: readonly string[];
  readonly authProbe?: ProviderAuthProbe;
  /** Scanned (stdout + stderr) for optional flags. */
  readonly helpArgs?: readonly string[];
  /** Flag → capability name; enabled only if the help output lists the flag. */
  readonly optionalFlags?: Readonly<Record<string, string>>;
  readonly transport: ProviderTransport;
  /** stream-json only: which line parser decodes this CLI's output. */
  readonly streamDialect?: string;
  readonly config: ProviderConfig;
  /** The provider's own effort parameter; absent means the effort is ignored for this provider. */
  readonly effortArg?: EffortArg;
  /** The provider's own names for effort levels; absent means its names are the level names. */
  readonly levelNames?: LevelNames;
  readonly buildLaunch: (input: LaunchInput) => ProviderLaunch;
  readonly resume: ProviderResumeMode;
  /** Declared; refined by probes at discovery. */
  readonly capabilities: ProviderCapabilities;
  readonly installHint: { readonly url: string };
  /** The provider's own mark: one SVG path in its viewBox, rendered with `currentColor` under
   *  the fill rule its file declares. The mark identifies the provider only and is copied
   *  unmodified from the file it was taken from; `null` when no such file exists — a mark is
   *  never redrawn. */
  readonly mark: ProviderMark | null;
  /** Milliseconds allowed before a run's first event; 0 disables. Default: DEFAULT_FIRST_OUTPUT_TIMEOUT_MS. */
  readonly firstOutputTimeoutMs?: number;
  /** Milliseconds of silence allowed after output started; 0 disables. Default: DEFAULT_INACTIVITY_TIMEOUT_MS. */
  readonly inactivityTimeoutMs?: number;
}
