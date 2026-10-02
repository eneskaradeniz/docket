// The capability record contract and its pure derivations. Contract: docs/v2/provider-capabilities.md
// sections 1–2 and 14. The registry data itself is infrastructure — provider names may not appear in
// the domain — so every function here takes its input as a parameter and knows no provider id.
import type { AuthMode } from '../quota/index';
import type { Billing } from '../shared/index';
import type { ProviderCapabilities } from './capabilities';

export type Tier = 'strong' | 'balanced' | 'fast';

// Re-exported so the capability contract keeps naming it while the limit policy reads it from
// shared (the module map lets quota import only shared).
export type { Billing };

/**
 * Effort levels in ascending order. `'none'` is the provider's thinking-off setting — the lowest
 * step, not the absence of the list — and `'ultra'` is the deepest step reported today.
 */
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

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

export interface ProviderRecord {
  readonly providerId: string;
  /** Manual flag: the definition exists but nothing is verified; it overrides every gate. */
  readonly planned?: true;
  readonly gates: Readonly<Partial<Record<GateId, Evidence>>>;
  /** Recorded operator-gate run ids on the real CLI; without one, `full` is unreachable. */
  readonly operatorRuns?: readonly string[];
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
// `experimental`.
export function supportLevel(record: ProviderRecord): SupportLevel {
  if (record.planned === true) return 'planned';
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
