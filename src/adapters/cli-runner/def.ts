// src/adapters/cli-runner/def.ts — the per-vendor DEFINITION type (WO-0105 / Faz B, issue #106).
//
// One adapter, N vendors: the engine (index.ts) owns the PROCESS (spawn, stdin, line-split,
// signals, exit); this type carries every vendor vocabulary item — the binary, the flag
// builder, the stream parser, the error classifier. Modeled on open-design's RuntimeAgentDef
// (docs/research/2026-09-25-multi-cli-provider-architecture.md), narrowed to what Docket's
// SessionRunner port consumes. A vendor name appears ONLY in a def file under this directory
// (ADR-0006's carve-out); the engine and core stay vendor-blind.
//
// ADR-0014's line (the addendum this WO lands): the def's stream MUST be machine-readable
// NDJSON — a plain-stdout vendor is not a target and never gets a def. A CLI exec has no
// permission callback either: decide/pendingAsks do not exist here, and the def's per-role
// SANDBOX arguments stand where the SDK's canUseTool cannot (each vendor's probe documents the
// residual surface before it is wired — Faz C's gate).

import type { ProviderErrorCode, RunnerEvent } from '../../core/runner';
import type { SessionRole } from '../../core/types';
import type { ProviderStatus } from '../../core/app-settings';

/** The vendor-neutral spawn facts the engine hands the def's args builder. */
export interface CliSpawnInput {
  role: SessionRole;
  /** The drive's mode ('plan' | 'direct') — a def may map it to a vendor flag or ignore it. */
  mode: 'plan' | 'direct';
  /** The composed prompt (prompt text only; paths/contents ride inside it as text). */
  prompt: string;
  /** The operator's model preference for the drive, verbatim (undefined = the vendor's own). */
  model?: string;
  /** The vendor's own session/thread id to RESUME (Sürdür), verbatim. */
  resume?: string;
  /** The drive's working directory. */
  cwd: string;
}

/** Mutable parse state the def's parser may keep across lines (e.g. the running thread id). */
export interface CliParseState {
  /** The vendor session id once observed (thread.started et al.) — the resume handle. */
  sessionId?: string;
}

/** One vendor's CLI contract. Everything here is DATA a def file may mint freely. */
export interface CliRunnerDef {
  /** The vendor id — the value a driver route's `vendor` carries (must match the registry). */
  id: string;
  /** The operator-facing name (crosses as DATA, like providerDisplayName). */
  displayName: string;
  /** The binary to spawn; tried on PATH first. */
  bin: string;
  /** Drop-in-compatible alternates tried in order when `bin` resolves to nothing. */
  fallbackBins?: readonly string[];
  /** The flag builder — the ONE place a vendor's argv grammar lives. */
  buildArgs(input: CliSpawnInput): string[];
  /** Write the prompt to stdin instead of argv (the E2BIG-safe default posture). */
  promptViaStdin?: boolean;
  /** Extra env pairs layered into every spawn (the profile env composes over these). */
  spawnEnv?: Record<string, string>;
  /**
   * ONE parsed NDJSON line → events. PURE per line; `state` carries cross-line facts. The
   * engine stamps any event lacking `at`. Terminal events (turn_complete/error) tell the
   * engine the stream closed honestly — a def NEVER fabricates one the vendor did not send.
   */
  parseLine(line: string, state: CliParseState): RunnerEvent[];
  /** Map a raw stderr/exit-message onto the neutral code; undefined = unknown (raw text shows). */
  classifyError?(message: string): ProviderErrorCode | undefined;
  /** The preset model ids the settings picker offers for this vendor. */
  modelOptions?: readonly string[];
  /** The zero-prompt version probe's argv (defaults to ['--version']). */
  versionArgs?: readonly string[];
  /**
   * The declarative AUTH probe (checkCliVendor runs it after the version probe): a cheap,
   * side-effect-free status command whose output the parser classifies. Absent → the version
   * probe alone speaks (present/missing), never a guessed login state.
   */
  authProbe?: {
    args: readonly string[];
    timeoutMs?: number;
    /** Classify the probe's combined stdout+stderr + exit code; undefined falls back to
     *  { ok: true, source: 'handshake' } when the binary ran at all. */
    parse(stdout: string, code: number | null): ProviderStatus | undefined;
  };
}

/** Decode one NDJSON line safely — garbage/blank lines decode undefined, never throw. */
export function decodeJsonLine(line: string): Record<string, unknown> | undefined {
  const t = line.trim();
  if (t === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(t);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
