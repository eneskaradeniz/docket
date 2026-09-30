// The provider definition contract: a CLI is described by pure data, never by engine code.
// Contract: docs/v2/providers.md → "Provider definition (data)".
import type { ProviderMark } from '../../../application/index';
import type { ProviderCapabilities } from '../../../domain/index';

/**
 * What one run hands to a definition so it can produce argv/env/stdin. The prompt travels
 * through stdin only; argv limits would truncate long work orders.
 */
export interface LaunchInput {
  readonly prompt: string;
  /** Run-scoped directory holding this run's MCP/skills/hooks files; the user's own config is never written. */
  readonly configDir: string;
  readonly resume?: { readonly sessionRef: string };
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
  readonly buildLaunch: (input: LaunchInput) => ProviderLaunch;
  readonly resume: ProviderResumeMode;
  /** Declared; refined by probes at discovery. */
  readonly capabilities: ProviderCapabilities;
  readonly installHint: { readonly url: string };
  /** The provider's own mark: one SVG path in its viewBox, rendered with `currentColor`. The
   *  mark identifies the provider only and is copied unmodified from the provider's official
   *  file; `null` when no official file exists — a mark is never redrawn. */
  readonly mark: ProviderMark | null;
}
