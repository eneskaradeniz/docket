// src/core/health.ts — the dependencies' first-class state (WO-0066, ADR-0010 «Health is a
// first-class, visible state»). Three tools — git, the forge, the agent identity — each one
// `DependencyHealth` row: ok (optionally with the tool's version), or degraded WITH the reason
// (the shaped unknown — never a guess). The composition root composes the checks (it owns the
// forge adapter and the provider check); the renderer reads them through the bridge group.

export type HealthTool = 'git' | 'forge' | 'agent';

export interface DependencyHealth {
  tool: HealthTool;
  /** ok, or degraded WITH the reason (the stderr line / the check's own message — displayable
   *  verbatim, the WO-0065 timeline precedent). */
  state: 'ok' | { degraded: string };
  /** The tool's own version stamp when its check yields one (git does; forge/agent stay absent
   *  in v1 — absence is absence, never a fetch). */
  version?: string;
}

export interface SystemHealth {
  checks: DependencyHealth[]; // one per tool, in the git · forge · agent order
  at: string; // ISO — the «son bakış» stamp (ADR-0010: a screen that cannot say when it last looked)
}

/** The composition-root-wired watch (the ForgeWatch pattern): one look at all three. The look
 *  NEVER throws and never bricks: a FAILED look resolves `undefined` — the caller renders
 *  nothing and keeps its last observation; the gate blocks on observed degradation only. */
export interface SystemHealthWatch {
  systemHealth(): Promise<SystemHealth | undefined>;
}
