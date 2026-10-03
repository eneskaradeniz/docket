// Capabilities of an agent CLI. Contract: docs/v2/domain.md section 11.

export type Tri = boolean | 'unknown';

export interface ProviderCapabilities {
  readonly structuredStream: boolean; // machine-readable events (SDK, JSON stream, ACP, app-server)
  readonly permissionAsk: Tri; // can pause and wait for an approve/deny answer
  readonly resume: Tri;
  readonly mcp: Tri;
  readonly hooks: Tri;
  readonly skills: Tri;
  readonly images: Tri;
  readonly quotaReport: 'stream' | 'query' | 'error_only' | 'none';
  // 'credits': the provider meters usage in its own credit unit (O-7); 'none' stays last as the
  // no-cost-visibility sentinel.
  readonly costReport: 'reported' | 'computed' | 'equivalent' | 'credits' | 'none';
}
