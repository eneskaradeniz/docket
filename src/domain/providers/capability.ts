// The capability record contract and its pure derivations. Contract: docs/v2/provider-capabilities.md
// sections 1–2 and 14. The registry data itself is infrastructure — provider names may not appear in
// the domain — so every function here takes its input as a parameter and knows no provider id.
import type { CapabilityDef, CapabilityKind } from '../definitions/index';
import type { AuthMode } from '../quota/index';
import type { Billing, CapabilitySlug, EffortLevel, Tier } from '../shared/index';
import type { ProviderCapabilities } from './capabilities';

// Re-exported so the capability contract keeps naming it while the limit policy reads it from
// shared (the module map lets quota import only shared).
export type { Billing, Tier };

// Re-exported so the capability contract keeps naming it; the scale itself lives in shared.
export type { EffortLevel };

export type Thinking =
  | { readonly kind: 'none' }
  | { readonly kind: 'levels'; readonly levels: readonly EffortLevel[] };

export type SupportLevel = 'planned' | 'experimental' | 'isolated' | 'full';

/** Cost visibility of a route — the same union as `ProviderCapabilities.costReport`, `'none'` included. */
export type CostKind = ProviderCapabilities['costReport'];

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';

export type Evidence =
  | { readonly kind: 'test'; readonly name: string }
  | { readonly kind: 'operator_run'; readonly id: string }
  | { readonly kind: 'waived'; readonly reason: string };

/** P-66: how a provider's headless runs reach the operator for permission — the transport's own
 *  ask surface (`native`), the Docket tools' bridge (`bridge`), or never because the run is
 *  sandboxed (`none`). */
export type PermissionChannel = 'native' | 'bridge' | 'none';

export interface ProviderRecord {
  readonly providerId: string;
  /** Manual flag: the definition exists but nothing is verified; it overrides every gate. */
  readonly planned?: true;
  /** P-66: the provider's truthful permission channel; a provider that cannot ask and runs
   *  sandboxed records `none`, never a silent absence. */
  readonly permissionChannel: PermissionChannel;
  /** P-66: the sentence the no-permission-channel setup warning carries; present exactly when
   *  `permissionChannel` is `bridge`, because only a bridge can lose its only ask path. */
  readonly bridgeHow?: string;
  readonly gates: Readonly<Partial<Record<GateId, Evidence>>>;
  /** Evidence that a run keeps the CLI from reading the user's configuration of other tools; a
   * provider without it is capped at `experimental`. */
  readonly isolation?: Evidence;
  /** Recorded operator-gate run ids on the real CLI; without one, `full` is unreachable. */
  readonly operatorRuns?: readonly string[];
  /** Whether the provider's transport takes a steering note mid-run (P-61); absent = unknown. */
  readonly steering?: 'steerable' | 'not_steerable';
}

export interface ModelRecord {
  readonly id: string;
  readonly family: string;
  readonly tier: Tier;
  readonly thinking: Thinking;
  readonly contextWindow?: number;
  readonly retired?: true;
  /** Absent means `unknown` — never assumed free. */
  readonly billing?: Billing;
}

export interface RouteKindRecord {
  readonly id: string;
  readonly providerId: string;
  readonly authMode: AuthMode;
  readonly endpointHost?: string;
  readonly identity: 'machine_login' | 'identity_dir' | 'secret';
  readonly tierModels?: Readonly<Record<Tier, string>>;
  readonly costKind: CostKind;
  /** `provider_query`: the quota is polled through the provider's own query call (its app-server
   * control surface), not an SDK usage leg, pushed events or an HTTP monitor. */
  readonly quotaProbe: 'sdk_usage' | 'rate_limit_events' | 'http_monitor' | 'provider_query' | 'none';
  readonly modelSource: 'sdk' | 'app-server' | 'acp-session' | 'cli-command' | 'api' | 'static';
  /** The live list is plan-scoped: on a successful refresh, bundled models it does not contain
   * are dropped instead of kept. */
  readonly liveIsAuthoritative?: true;
  /** The route's verified billing for live models that report none (P-40): an API-key route
   * meters every model, so its live-only entries default to `metered`, never to `unknown`. */
  readonly defaultBilling?: Billing;
  /** Billing per model family for live-only rows (P-42): an id containing `contains` bills as
   * `billing`. Lists only the families the provider's plan covers on every plan. */
  readonly familyBilling?: readonly { readonly contains: string; readonly billing: Billing }[];
  readonly models: readonly ModelRecord[];
}

export interface CapabilityRegistry {
  readonly providers: readonly ProviderRecord[];
  readonly routeKinds: readonly RouteKindRecord[];
}

// Nobody writes a level by hand except `planned`; everything else follows the gates. `full` needs
// every gate (G5 may be waived), the scripted end-to-end scenario as G6 test evidence, and at
// least one recorded operator run. `isolated` needs the gates that make a run inspectable
// (discovery, mapping, usage, scenario) but not the permission wait. Anything less is
// `experimental`, and so is a provider with no isolation evidence: a CLI that may read the user's
// other tools' instructions and skills cannot be trusted with a run that claims to be inspectable.
export function supportLevel(record: ProviderRecord): SupportLevel {
  if (record.planned === true) return 'planned';
  if (record.isolation === undefined) return 'experimental';
  const passed = (gate: GateId): boolean => record.gates[gate] !== undefined;
  const scenarioIsTestEvidence = record.gates.G6?.kind === 'test';
  const operatorRunRecorded = record.operatorRuns !== undefined && record.operatorRuns.length > 0;
  if (
    passed('G1') &&
    passed('G2') &&
    passed('G3') &&
    passed('G4') &&
    passed('G5') &&
    passed('G6') &&
    scenarioIsTestEvidence &&
    operatorRunRecorded
  ) {
    return 'full';
  }
  if (passed('G1') && passed('G2') && passed('G4') && passed('G6')) return 'isolated';
  return 'experimental';
}

export function thinkingOptions(model: ModelRecord): readonly EffortLevel[] {
  return model.thinking.kind === 'levels' ? model.thinking.levels : [];
}

// ---- Capability translation (P-57, P-59) -------------------------------------------------------
// The support table is data (infrastructure registry); everything below takes it as a parameter.

export type TranslationSupport = 'native' | 'degraded' | 'unsupported' | 'unverified';

export interface TranslationRow {
  readonly provider: string;
  readonly kind: CapabilityKind;
  readonly support: TranslationSupport;
  readonly how: string;
  readonly degradesTo?: CapabilityKind | 'prompt_text';
  /** R-149: the source kinds this row delivers (today only a plugin row carries it); absent = every
   *  source kind, so behaviour stays unchanged for rows that do not care. */
  readonly sourceKinds?: readonly string[];
}

/** P-57: the table's row for (provider, kind); a missing row reads `unverified`, never `native`.
 *  R-149: a row that declares `sourceKinds` answers `unsupported` for a source kind it does not
 *  list — no `degradesTo`, and the `how` names the kind — because a run never installs or edits
 *  the user's plugin state (P-44), so a source kind needing such an install is not deliverable. */
export function supportFor(
  table: readonly TranslationRow[],
  provider: string,
  kind: CapabilityKind,
  sourceKind?: string,
): TranslationRow {
  const row =
    table.find((row) => row.provider === provider && row.kind === kind) ?? {
      provider,
      kind,
      support: 'unverified' as const,
      how: 'no support row recorded; unverified until a live probe',
    };
  if (row.sourceKinds === undefined || sourceKind === undefined || row.sourceKinds.includes(sourceKind)) {
    return row;
  }
  const { degradesTo: _lesser, ...rest } = row;
  return { ...rest, support: 'unsupported', how: `${row.how} — source kind ${sourceKind} is not delivered` };
}

/** P-66: the channel table's row — data, like the translation table, so the domain knows no
 *  provider id. */
export interface ChannelRow {
  readonly provider: string;
  readonly channel: PermissionChannel;
  /** The sentence the bridge warning carries; absent on native and none rows. */
  readonly how?: string;
}

export type SetupWarning =
  | {
      readonly stage: string;
      readonly capability: CapabilitySlug;
      readonly provider: string;
      readonly support: 'degraded' | 'unsupported' | 'unverified';
      readonly how: string;
    }
  | {
      readonly stage: string;
      readonly provider: string;
      readonly kind: 'no_permission_channel';
      readonly how: string;
    };

/** P-57/P-66: one warning per (stage, capability) whose support is not `native`, plus the stage's
 *  channel warning, in stage order — the channel warning first, because a stage that cannot ask
 *  at all is the wider problem than any single capability. */
export function setupWarnings(
  stages: readonly {
    readonly stage: string;
    readonly provider: string;
    readonly capabilities: readonly CapabilityDef[];
    /** P-66: whether the stage's role carries the Docket tools; absent (unknown) never warns. */
    readonly docketTools?: boolean;
  }[],
  table: readonly TranslationRow[],
  channels: readonly ChannelRow[],
): readonly SetupWarning[] {
  const warnings: SetupWarning[] = [];
  for (const { stage, provider, capabilities, docketTools } of stages) {
    const channel = channels.find((row) => row.provider === provider);
    // Only a bridge can lose its only ask path: the Docket tools carry it. A native ask rides the
    // transport's own callback, a sandboxed run never asks, and a row without its sentence or a
    // role whose tools are unknown is an absent input — none of them warns.
    if (channel?.channel === 'bridge' && docketTools === false && channel.how !== undefined) {
      warnings.push({ stage, provider, kind: 'no_permission_channel', how: channel.how });
    }
    for (const capability of capabilities) {
      const row = supportFor(table, provider, capability.kind, sourceKindOf(capability));
      if (row.support === 'native') continue;
      warnings.push({ stage, capability: capability.id, provider, support: row.support, how: row.how });
    }
  }
  return warnings;
}

/** The run-record entry of a capability dropped from a run (`omitted_capability`). */
export interface OmittedCapability {
  readonly capability: CapabilitySlug;
  readonly provider: string;
  readonly reason: 'unsupported';
}

export interface CapabilityTranslation {
  /** Capabilities the launch layer writes as run-scoped files/flags. */
  readonly run: readonly CapabilityDef[];
  /** Instruction text carrying the degraded capabilities; empty when none. */
  readonly inline: string;
  readonly omitted: readonly OmittedCapability[];
}

const inlineLine = (capability: CapabilityDef): string => {
  switch (capability.kind) {
    case 'command':
      return `- Command "${capability.name}" (fill the {{placeholders}} from the task): ${capability.template}`;
    case 'skill':
    case 'context':
      return `- ${capability.kind === 'skill' ? 'Skill' : 'Context'} "${capability.name}": read and follow ${capability.path}`;
    default:
      return `- ${capability.kind} "${capability.name}"`;
  }
};

/** The source kind a support lookup is keyed by (R-149): a plugin's own source kind, nothing for
 *  every other capability kind. */
const sourceKindOf = (capability: CapabilityDef): string | undefined =>
  capability.kind === 'plugin' ? capability.source.kind : undefined;

/** P-59: splits a stage's capabilities by the provider's support. `native` and `unverified` go to
 *  the run (unverified is attempted, and shown as such by `setupWarnings`); `unsupported` is
 *  omitted and reported; `degraded` is inlined as text. A command is a prompt template the agent
 *  fills from the task (R-141 addendum), so it is always inlined as instruction text — never
 *  handed to a provider as a native command. */
export function translateCapabilities(
  provider: string,
  capabilities: readonly CapabilityDef[],
  table: readonly TranslationRow[],
): CapabilityTranslation {
  const run: CapabilityDef[] = [];
  const inlined: CapabilityDef[] = [];
  const omitted: OmittedCapability[] = [];
  for (const capability of capabilities) {
    const { support } = supportFor(table, provider, capability.kind, sourceKindOf(capability));
    if (capability.kind === 'command' || support === 'degraded') inlined.push(capability);
    else if (support === 'unsupported') omitted.push({ capability: capability.id, provider, reason: 'unsupported' });
    else run.push(capability);
  }
  const inline = inlined.length === 0 ? '' : ['Capabilities provided as instructions:', ...inlined.map(inlineLine)].join('\n');
  return { run, inline, omitted };
}

// ---- Machine import (P-60) ---------------------------------------------------------------------
// Read-only scan of each provider's own user-level config; secret values never leave the scanner.

export interface MachineCandidate {
  readonly provider: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly sourcePath: string;
  readonly secretNames: readonly string[];
}

const MACHINE_KEY_SEP = '\u001e';

/** Stable import key for a machine candidate; the four fields are enough to find it again on a rescan. */
export function machineCandidateKey(candidate: MachineCandidate): string {
  return [candidate.provider, candidate.kind, candidate.name, candidate.sourcePath].join(MACHINE_KEY_SEP);
}

export function machineCandidateFromKey(key: string): MachineCandidate | undefined {
  const parts = key.split(MACHINE_KEY_SEP);
  if (parts.length !== 4) return undefined;
  const [provider, kind, name, sourcePath] = parts;
  if (provider === '' || name === '' || sourcePath === '') return undefined;
  if (
    kind !== 'mcp' &&
    kind !== 'skill' &&
    kind !== 'hook' &&
    kind !== 'context' &&
    kind !== 'plugin' &&
    kind !== 'command'
  ) {
    return undefined;
  }
  return { provider, kind, name, sourcePath, secretNames: [] };
}

/** R-66 stands for machine import too: hooks are listed but never importable. */
export function machineCandidateImportable(candidate: MachineCandidate): boolean {
  return candidate.kind !== 'hook';
}
