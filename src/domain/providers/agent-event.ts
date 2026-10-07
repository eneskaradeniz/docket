// The common event stream every transport folds its raw output into. Contract: docs/v2/domain.md section 11.
import type { LimitHit, Meter } from '../quota/index';
import type { EpochMs } from '../shared/index';

/**
 * Where a run's cost number comes from. `credits`: the provider meters usage in its own credit
 * unit — the amount is a number of credits, carried in the provider's smallest unit (O-7).
 */
export type CostKind = 'reported' | 'computed' | 'equivalent' | 'credits';

export type AgentEvent =
  | { readonly type: 'session_started'; readonly at: EpochMs; readonly sessionRef: string }
  | { readonly type: 'text'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'thinking'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'tool_call'; readonly at: EpochMs; readonly id: string; readonly name: string; readonly target?: string }
  | { readonly type: 'tool_result'; readonly at: EpochMs; readonly id: string; readonly ok: boolean }
  | { readonly type: 'permission_ask'; readonly at: EpochMs; readonly id: string; readonly tool: string; readonly target?: string; readonly options: readonly string[] }
  | { readonly type: 'permission_answered'; readonly at: EpochMs; readonly id: string; readonly decision: 'allow' | 'deny' }
  | { readonly type: 'usage'; readonly at: EpochMs; readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number; readonly reasoningTokens?: number; readonly costUsd?: number; readonly costKind?: CostKind }
  | { readonly type: 'quota_signal'; readonly at: EpochMs; readonly meter: Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string } }
  | { readonly type: 'limit_hit'; readonly at: EpochMs; readonly hit: Omit<LimitHit, 'accountId' | 'at'> }
  | { readonly type: 'error'; readonly at: EpochMs; readonly class: 'auth' | 'network' | 'crash' | 'protocol' | 'timeout' | 'unknown'; readonly reason?: 'first_output_timeout' | 'inactivity_timeout'; readonly message: string }
  | { readonly type: 'finished'; readonly at: EpochMs; readonly reason: 'completed' | 'failed' | 'cancelled' | 'limit' }
  | { readonly type: 'raw'; readonly at: EpochMs; readonly line: string };
