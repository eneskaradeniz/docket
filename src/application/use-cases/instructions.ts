// use-cases/instructions.ts — the effective-instructions service (P-37): every run's prompt, the
// Docket layers plus the instruction files the chosen provider does not read natively.
// Contract: docs/v2/application.md → "Instructions, checkpoints, handoff (#581)" (A-53 … A-56).
import type {
  AccountRoute,
  InstructionPlan,
  RepoSlug,
  Result,
  RoleSlug,
  StageSlug,
  WorkOrderId,
} from '../../domain/index';
import {
  applyRoleOverrides,
  DEFAULT_INSTRUCTION_BUDGET_CHARS,
  err,
  ok,
  planInstructions,
  renderInstructionBlock,
  stageBrief,
} from '../../domain/index';

import type { AppDeps } from '../ports/index';

export interface RunPrompt {
  readonly prompt: string;
  readonly plan: InstructionPlan;
}

export type PromptError = 'unknown_account' | 'definitions_invalid' | 'not_found';

/** The single prompt entry point. The use case loads the work order record itself: the flow comes
 *  from `record.flow` — the value the dispatcher and the gates resolve against — and the title from
 *  the same record, so no caller can supply a second, disagreeing copy of either. */
export async function composeRunPrompt(
  deps: Pick<AppDeps, 'definitions' | 'workOrders' | 'accounts' | 'capabilities' | 'instructionFiles'>,
  input: {
    readonly repo: RepoSlug;
    readonly workOrderId: WorkOrderId;
    readonly cwd: string;
    readonly stage: StageSlug;
    readonly role: RoleSlug;
    readonly route: AccountRoute;
  },
): Promise<Result<RunPrompt, PromptError>> {
  const record = await deps.workOrders.get(input.workOrderId);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(input.repo);
  if (!loaded.ok) return err('definitions_invalid');

  const account = await deps.accounts.get(input.route.accountId);
  if (account === undefined) return err('unknown_account');

  // The flow, stage and role resolve from the current definitions exactly as every other use case
  // resolves them; a definition that no longer carries one of them is the work order's resolution
  // failing, which is `not_found` on the gates' precedent (a run can no longer be prompted).
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  const stage = flow?.stages.find((candidate) => candidate.id === input.stage);
  const baseRole = loaded.value.roles.find((candidate) => candidate.id === input.role);
  if (flow === undefined || stage === undefined || baseRole === undefined) return err('not_found');
  const role = applyRoleOverrides(baseRole, loaded.value.repo?.roleOverrides ?? []);

  // Docket layers first — byte-identical for every provider given the same definitions (A-53); the
  // brief already embeds the role instructions, so they are never appended a second time.
  const brief = stageBrief(flow, stage, role, { id: record.id, title: record.title });

  // The instruction block: candidates from the registry union, present files read as data through
  // the port, the provider's native set never inlined (A-54), the budget fixed (A-55).
  const candidates = deps.capabilities.instructionFileNames();
  const present = await deps.instructionFiles.read(input.cwd, candidates);
  const plan = planInstructions(deps.capabilities.nativeInstructionFiles(account.provider), present, {
    maxChars: DEFAULT_INSTRUCTION_BUDGET_CHARS,
  });

  const block = renderInstructionBlock(plan);
  return ok({ prompt: block === '' ? brief : `${brief}\n\n${block}`, plan });
}
