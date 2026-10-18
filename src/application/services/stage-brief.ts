// stage-brief.ts — the Docket layers of a run (flow + stage + role), plus the one fact only the
// application knows: the planner's own plan file. Composition, handoff and the definitions digest
// all build the brief here, so the three can never disagree about it.
import type { FlowDef, RoleDef, StageDef } from '../../domain/index';
import { stageBrief } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import type { WorkOrderRecord } from '../ports/work-order-repo';

/** The built-in planner role; an edited planner keeps its slug, so the slug names the plan stage. */
const PLANNER_ROLE = 'planner';
const DEFAULT_DOCS_ROOT = 'docs';

/** A-423: `<docs root>/plans/ie-<number>.md`. The number is the A-29 display number the operator
 *  reads as the work order code; the prefix is fixed lowercase ASCII, so the path never depends on
 *  the interface language. A work order's plan never shares a path with another's. */
export const planFilePath = (number: number, docsRoot: string | undefined): string => {
  const trimmed = (docsRoot ?? '').replace(/\/+$/, '');
  const root = trimmed === '' ? DEFAULT_DOCS_ROOT : trimmed;
  return `${root}/plans/ie-${String(number).padStart(4, '0')}.md`;
};

/** `stageBrief` plus, for a planner stage, the line naming this work order's plan file. A work
 *  order whose number cannot be read gets the plain brief: a path is never invented. */
export async function stageBriefOf(
  deps: Pick<AppDeps, 'workOrders'>,
  input: {
    readonly flow: FlowDef;
    readonly stage: StageDef;
    readonly role: RoleDef | null;
    readonly record: Pick<WorkOrderRecord, 'id' | 'title'>;
    readonly docsRoot: string | undefined;
  },
): Promise<string> {
  const brief = stageBrief(input.flow, input.stage, input.role, { id: input.record.id, title: input.record.title });
  if (input.role?.id !== PLANNER_ROLE) return brief;
  const number = await deps.workOrders.number(input.record.id);
  if (number === undefined) return brief;
  const path = planFilePath(number, input.docsRoot);
  return `${brief}\nPlan file: ${path} — write the plan to exactly this file (create its folder if absent); never edit or overwrite another work order's plan file.`;
}
