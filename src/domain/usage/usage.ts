// Rules R-108 … R-113 of docs/v2/domain.md: the pure usage read model. It folds per-run usage into
// a summary and names waste findings with their numbers, so a reader states a rule's finding
// instead of inventing one.
import type { CostKind } from '../providers/index';

export interface RunUsageInput {
  readonly runId: string;
  readonly stage: string;
  readonly attempt: number;
  readonly role: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd?: number;
  readonly costKind?: CostKind;
}

export interface StageUsage {
  readonly stage: string;
  readonly runs: number;
  readonly maxAttempt: number;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd?: number;
}

export interface UsageSummary {
  readonly runs: number;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd?: number;
  readonly byStage: readonly StageUsage[];
  readonly planningShare: number;
  readonly cacheRatio: number;
}

export type WasteKind = 'planning_heavy' | 'retry_loop' | 'low_cache';

export interface WasteFinding {
  readonly rule: string;
  readonly kind: WasteKind;
  readonly stage?: string;
  readonly values: Readonly<Record<string, number>>;
}

// The one place the waste numbers are tuned; the literal types keep a caller from inventing its own.
export const USAGE_THRESHOLDS = {
  planningShare: 0.4,
  planningMinRuns: 5,
  retryAttempts: 3,
  cacheRatio: 0.2,
  cacheMinInputTokens: 50_000,
} as const;

// The built-in flows' stage ids whose tokens count as planning; custom stages are "other" until
// flows carry a stage kind.
export const PLANNING_STAGE_IDS: readonly string[] = ['plan', 'research'];

/** Every finding cites the domain rule that fired. */
const RULE_PLANNING_HEAVY = 'R-112';
const RULE_RETRY_CACHE = 'R-113';

/** The mutable working state of one stage row; every input lands in exactly one. */
interface StageFold {
  readonly stage: string;
  runs: number;
  maxAttempt: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd?: number;
}

export function summarizeUsage(inputs: readonly RunUsageInput[]): UsageSummary {
  const stages = new Map<string, StageFold>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let costUsd: number | undefined = undefined;
  let planningTokens = 0;
  for (const input of inputs) {
    inputTokens += input.inputTokens;
    outputTokens += input.outputTokens;
    cachedInputTokens += input.cachedInputTokens;
    // An absent cost is unknown, not zero: only carried values are summed, on every level.
    if (input.costUsd !== undefined) costUsd = (costUsd ?? 0) + input.costUsd;
    if (PLANNING_STAGE_IDS.includes(input.stage)) planningTokens += input.inputTokens + input.outputTokens;
    let fold = stages.get(input.stage);
    if (!fold) {
      fold = { stage: input.stage, runs: 0, maxAttempt: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      stages.set(input.stage, fold);
    }
    fold.runs += 1;
    fold.maxAttempt = Math.max(fold.maxAttempt, input.attempt);
    fold.inputTokens += input.inputTokens;
    fold.outputTokens += input.outputTokens;
    fold.cachedInputTokens += input.cachedInputTokens;
    if (input.costUsd !== undefined) fold.costUsd = (fold.costUsd ?? 0) + input.costUsd;
  }
  const tokens = inputTokens + outputTokens;
  const byStage: StageUsage[] = [];
  for (const fold of stages.values()) {
    byStage.push({
      stage: fold.stage,
      runs: fold.runs,
      maxAttempt: fold.maxAttempt,
      tokens: fold.inputTokens + fold.outputTokens,
      inputTokens: fold.inputTokens,
      cachedInputTokens: fold.cachedInputTokens,
      ...(fold.costUsd === undefined ? {} : { costUsd: fold.costUsd }),
    });
  }
  return {
    runs: inputs.length,
    tokens,
    inputTokens,
    cachedInputTokens,
    ...(costUsd === undefined ? {} : { costUsd }),
    byStage,
    // A zero denominator means the share is undefined; 0 keeps every ratio a plain finite number.
    planningShare: tokens === 0 ? 0 : planningTokens / tokens,
    cacheRatio: inputTokens === 0 ? 0 : cachedInputTokens / inputTokens,
  };
}

export function findWaste(summary: UsageSummary, thresholds?: typeof USAGE_THRESHOLDS): readonly WasteFinding[] {
  const limits = thresholds ?? USAGE_THRESHOLDS;
  const findings: WasteFinding[] = [];
  if (summary.planningShare >= limits.planningShare && summary.runs >= limits.planningMinRuns) {
    findings.push({
      rule: RULE_PLANNING_HEAVY,
      kind: 'planning_heavy',
      values: { share: summary.planningShare, runs: summary.runs },
    });
  }
  // A filtered copy is sorted, so the summary's own stage order is never touched.
  const retries = summary.byStage
    .filter((stage) => stage.maxAttempt >= limits.retryAttempts)
    .sort((a, b) => (a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0))
    .map((stage) => ({ rule: RULE_RETRY_CACHE, kind: 'retry_loop' as const, stage: stage.stage, values: { attempts: stage.maxAttempt } }));
  findings.push(...retries);
  if (summary.cacheRatio < limits.cacheRatio && summary.inputTokens >= limits.cacheMinInputTokens) {
    findings.push({
      rule: RULE_RETRY_CACHE,
      kind: 'low_cache',
      values: { ratio: summary.cacheRatio, inputTokens: summary.inputTokens },
    });
  }
  return findings;
}
