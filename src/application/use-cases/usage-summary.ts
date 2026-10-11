// use-cases/usage-summary.ts — the usage read model: joins a work order's (or a project's work
// orders') runs with their streamed events, folds each run with the domain fold and hands the
// folded inputs to the pure usage rules. Every decision lives in the domain; this file only reads.
import type {
  EpochMs,
  ProjectSlug,
  Result,
  RunUsageInput,
  UsageSummary,
  WasteFinding,
  WorkOrderId,
} from '../../domain/index';
import { err, findWaste, foldRun, ok, summarizeUsage } from '../../domain/index';

import type { RunRecord } from '../ports/run-repo';
import type { AppDeps } from '../ports/index';

/** Exactly one scope: the union's shape cannot express "both" or "neither" — the api checks that. */
export type UsageScope =
  | { readonly workOrder: WorkOrderId }
  | { readonly project: ProjectSlug };

export interface UsageSummaryRead {
  readonly summary: UsageSummary;
  readonly findings: readonly WasteFinding[];
  /** Runs whose route never sent a usage event, so the reader can say "veri yok" instead of
   *  trusting the zeros. */
  readonly runsWithoutUsage: number;
}

export type UsageSummaryError = { readonly code: 'not_found' };

/** The runs of the scope, in the store's own order; an unknown identity is a failure, an empty
 *  scope a legitimate zero answer. */
const runsOfScope = async (
  deps: Pick<AppDeps, 'runs' | 'workOrders' | 'projects'>,
  scope: UsageScope,
): Promise<readonly RunRecord[] | UsageSummaryError> => {
  if ('workOrder' in scope) {
    if ((await deps.workOrders.get(scope.workOrder)) === undefined) return { code: 'not_found' };
    return deps.runs.listForWorkOrder(scope.workOrder);
  }
  if ((await deps.projects.get(scope.project)) === undefined) return { code: 'not_found' };
  const collected: RunRecord[] = [];
  for (const order of await deps.workOrders.list({ project: scope.project })) {
    collected.push(...(await deps.runs.listForWorkOrder(order.id)));
  }
  return collected;
};

export async function usageSummary(
  deps: Pick<AppDeps, 'runs' | 'workOrders' | 'projects'>,
  scope: UsageScope & { readonly sinceMs?: EpochMs },
): Promise<Result<UsageSummaryRead, UsageSummaryError>> {
  const scoped = await runsOfScope(deps, scope);
  if ('code' in scoped) return err(scoped);

  const inputs: RunUsageInput[] = [];
  let runsWithoutUsage = 0;
  for (const run of scoped) {
    // sinceMs bounds by run start: strictly older starts are excluded, the boundary instant stays.
    if (scope.sinceMs !== undefined && run.startedAt < scope.sinceMs) continue;
    const events = await deps.runs.events(run.id);
    // The fold reports token sums but not whether the route ever sent a usage event, so the
    // emptiness the view promises is decided on the stream itself.
    if (!events.some((event) => event.type === 'usage')) runsWithoutUsage += 1;
    const folded = foldRun(events);
    inputs.push({
      runId: run.id,
      stage: run.stage,
      attempt: run.attempt,
      role: run.role,
      inputTokens: folded.inputTokens,
      outputTokens: folded.outputTokens,
      cachedInputTokens: folded.cachedInputTokens,
      // An absent cost is unknown, never zero; only a carried value reaches the domain rules.
      ...(folded.costUsd === undefined ? {} : { costUsd: folded.costUsd, ...(folded.costKind === undefined ? {} : { costKind: folded.costKind }) }),
    });
  }
  const summary = summarizeUsage(inputs);
  return ok({ summary, findings: findWaste(summary), runsWithoutUsage });
}
