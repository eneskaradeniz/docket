// Rules R-108 … R-118 of docs/v2/domain.md: the pure usage read model. It folds per-run usage into
// a summary and names waste findings with their numbers, so a reader states a rule's finding
// instead of inventing one.
import type { CostKind } from '../providers/index';

/** Cost per kind, in the kind's own unit: USD for every kind but `credits`, which counts the
 *  provider's credit unit. A kind nobody contributed to is absent, never 0 standing in for unknown;
 *  `unspecified` holds a cost whose provider did not say what kind it is. */
export type CostByKind = Readonly<Partial<Record<CostKind | 'unspecified', number>>>;

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
  readonly costByKind?: CostByKind;
}

export interface UsageSummary {
  readonly runs: number;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly costByKind?: CostByKind;
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
  costByKind?: CostByKind;
}

/** Adds one input's cost to a scope's per-kind totals; no cost leaves the totals as they were. */
const addCost = (current: CostByKind | undefined, input: RunUsageInput): CostByKind | undefined => {
  if (input.costUsd === undefined) return current;
  const kind = input.costKind ?? 'unspecified';
  return { ...current, [kind]: (current?.[kind] ?? 0) + input.costUsd };
};

export function summarizeUsage(inputs: readonly RunUsageInput[]): UsageSummary {
  const stages = new Map<string, StageFold>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let costByKind: CostByKind | undefined = undefined;
  let planningTokens = 0;
  for (const input of inputs) {
    inputTokens += input.inputTokens;
    outputTokens += input.outputTokens;
    cachedInputTokens += input.cachedInputTokens;
    costByKind = addCost(costByKind, input);
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
    const stageCost = addCost(fold.costByKind, input);
    if (stageCost !== undefined) fold.costByKind = stageCost;
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
      ...(fold.costByKind === undefined ? {} : { costByKind: fold.costByKind }),
    });
  }
  return {
    runs: inputs.length,
    tokens,
    inputTokens,
    cachedInputTokens,
    ...(costByKind === undefined ? {} : { costByKind }),
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

export type CostDisplay =
  | { readonly kind: 'money'; readonly usd: number; readonly estimate: boolean }
  | { readonly kind: 'tokens'; readonly equivalentUsd?: number }
  | { readonly kind: 'credits'; readonly credits: number }
  | { readonly kind: 'none' };

/** A contribution counts only when it is a real number; a NaN or infinity must not reach a screen. */
const amountOf = (costByKind: CostByKind, kind: CostKind | 'unspecified'): number | undefined => {
  const value = costByKind[kind];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
};

/** What a cost figure may be called on screen. Only `reported`, `computed` and `unspecified` are
 *  money; `equivalent` is a list-price estimate and is never added to them, and `credits` is the
 *  provider's own unit. A route with included billing has no per-run money, so its equivalent is
 *  secondary information next to the tokens. */
export function costDisplay(costByKind: CostByKind, billing: 'pay_per_use' | 'included' | 'unknown'): CostDisplay {
  const reported = amountOf(costByKind, 'reported');
  const computed = amountOf(costByKind, 'computed');
  const unspecified = amountOf(costByKind, 'unspecified');
  const equivalent = amountOf(costByKind, 'equivalent');
  const credits = amountOf(costByKind, 'credits');
  const hasMoney = reported !== undefined || computed !== undefined || unspecified !== undefined;
  const money: CostDisplay = {
    kind: 'money',
    usd: (reported ?? 0) + (computed ?? 0) + (unspecified ?? 0),
    estimate: computed !== undefined || unspecified !== undefined,
  };
  const tokens: CostDisplay = equivalent === undefined ? { kind: 'tokens' } : { kind: 'tokens', equivalentUsd: equivalent };
  if (billing === 'included') {
    if (equivalent !== undefined) return tokens;
    if (hasMoney) return money;
    return credits !== undefined ? { kind: 'credits', credits } : { kind: 'none' };
  }
  if (hasMoney) return money;
  if (credits !== undefined) return { kind: 'credits', credits };
  return equivalent !== undefined ? tokens : { kind: 'none' };
}
