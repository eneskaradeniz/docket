// use-cases/handoff.ts — the handoff pack builder (P-38): the pack a continuation run on another
// provider starts from, assembled from the failed run's stored state, sized for the candidate
// routes and rendered for the continuation. Native resume is never mixed with the pack.
// Contract: docs/v2/application.md → "Instructions, checkpoints, handoff (#581)" (A-61 … A-63).
import type {
  AccountRoute,
  Actor,
  CatalogModel,
  HandoffPack,
  Result,
  RollingNote,
  RunId,
} from '../../domain/index';
import {
  acceptanceCriteria,
  applyRoleOverrides,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_INSTRUCTION_BUDGET_CHARS,
  definitionsDigest,
  deriveTaskState,
  err,
  ok,
  PACK_CHARS_PER_TOKEN,
  planInstructions,
  renderHandoffPrompt,
  sizeHandoffPack,
  stageBrief,
} from '../../domain/index';

import type { AppDeps } from '../ports/index';

export interface HandoffPlan {
  readonly pack: HandoffPack;
  readonly prompt: string;
}

export type HandoffError = 'not_found' | 'no_repo' | 'git_failed' | 'definitions_invalid' | 'unknown_account';

// The executor is the use case's caller, so the audit entry names its component — the same
// convention as the executor's own entries.
const HANDOFF_ACTOR: Actor = { kind: 'system', component: 'run-executor' };

/** The catalog is a refinement, never a gate: a failing read leaves the list empty, so the
 *  candidate contributes no window and the fixed ceilings size the pack (A-63). */
const catalogOrEmpty = async (read: () => Promise<readonly CatalogModel[]>): Promise<readonly CatalogModel[]> => {
  try {
    return await read();
  } catch {
    return [];
  }
};

/** A candidate's known context window: the pinned model's entry, else the provider's default
 *  row; `null` when no channel reported one (the common case — A-63). */
const windowOf = async (
  catalog: Pick<AppDeps, 'modelCatalog'>['modelCatalog'],
  route: AccountRoute,
): Promise<number | null> => {
  const list = await catalogOrEmpty(() => catalog.list(route.accountId));
  const entry =
    route.model !== undefined
      ? list.find((candidate) => candidate.id === route.model)
      : list.find((candidate) => candidate.isDefault === true);
  return entry?.contextWindow ?? null;
};

/** The pack's char budget: the fixed ceilings stand on their own, a known window only tightens
 *  them — `min` over the candidates' known windows × PACK_CHARS_PER_TOKEN; with no known window
 *  the stand-in applies, and it sits above the ceilings (A-63). */
const packBudgetChars = (windows: readonly (number | null)[]): number => {
  const known = windows.filter((window): window is number => window !== null);
  const tokens = known.length > 0 ? Math.min(...known) : DEFAULT_CONTEXT_WINDOW_TOKENS;
  return tokens * PACK_CHARS_PER_TOKEN;
};

export async function buildHandoff(
  deps: Pick<
    AppDeps,
    | 'clock'
    | 'ids'
    | 'log'
    | 'definitions'
    | 'workOrders'
    | 'runs'
    | 'accounts'
    | 'capabilities'
    | 'instructionFiles'
    | 'checkpoints'
    | 'modelCatalog'
  >,
  input: { readonly runId: RunId; readonly cwd: string; readonly candidates: readonly AccountRoute[] },
): Promise<Result<HandoffPlan, HandoffError>> {
  const plan = await assemblePack(deps, input);

  // One audit entry per attempt, success or failure alike: a pack failure leaves this entry as
  // the only write of the refused run (A-64), so the trail records that the handoff was tried.
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: HANDOFF_ACTOR,
    action: 'run.handoff',
    subject: { kind: 'run', id: input.runId },
    detail: { fromRun: input.runId, candidates: input.candidates.length },
  });

  return plan;
}

const assemblePack = async (
  deps: Parameters<typeof buildHandoff>[0],
  input: { readonly runId: RunId; readonly cwd: string; readonly candidates: readonly AccountRoute[] },
): Promise<Result<HandoffPlan, HandoffError>> => {
  const run = await deps.runs.get(input.runId);
  if (run === undefined) return err('not_found');
  const record = await deps.workOrders.get(run.workOrderId);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(record.repo);
  if (!loaded.ok) return err('definitions_invalid');

  // The resolution follows composeRunPrompt's A-53 precedent: a record whose flow, stage or role
  // the current definitions can no longer resolve is `not_found` — a run that can no longer be
  // prompted, so it cannot be handed off either.
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  const stage = flow?.stages.find((candidate) => candidate.id === run.stage);
  const baseRole = loaded.value.roles.find((candidate) => candidate.id === run.role);
  if (flow === undefined || stage === undefined || baseRole === undefined) return err('not_found');
  const role = applyRoleOverrides(baseRole, loaded.value.repo?.roleOverrides ?? []);

  // Item 1 — recomputed from the current definitions, never stored on the run (A-62); the same
  // digest comparison decides `definitionsChanged`, and a run with no recorded rev — or one whose
  // layers cannot be recomputed — counts as unchanged, never as a false change.
  const stagePrompt = stageBrief(flow, stage, role, { id: record.id, title: record.title });
  const repoDef = loaded.value.repo;
  const acceptance = repoDef === undefined ? [] : acceptanceCriteria(stage, repoDef);

  // Item 2 — for the TARGET provider: the first candidate is the route the continuation runs on;
  // the rest only tighten the window. An unknown target provider has no native set, so every
  // present candidate is inlined (A-54: inlining all beats a smaller prompt).
  const target = input.candidates[0];
  const targetAccount = target === undefined ? undefined : await deps.accounts.get(target.accountId);
  if (target !== undefined && targetAccount === undefined) return err('unknown_account');
  const present = await deps.instructionFiles.read(input.cwd, deps.capabilities.instructionFileNames());
  const instructionPlan = planInstructions(
    targetAccount === undefined ? [] : deps.capabilities.nativeInstructionFiles(targetAccount.provider),
    present,
    { maxChars: DEFAULT_INSTRUCTION_BUDGET_CHARS },
  );

  // Item 4 — the diff since the stage base, falling back to the worktree base ref (A-59). The
  // base resolution is the adapter's verdict on the worktree itself: its failure means `cwd` is
  // not a usable git working tree, and a handoff never recreates one.
  const since =
    (await deps.runs.stageBase(input.runId)) ??
    (await asSha(deps.checkpoints.base({ cwd: input.cwd, workOrderId: record.id })));
  if (since === undefined) return err('no_repo');
  const diff = await deps.checkpoints.diffSince({ cwd: input.cwd, since });
  if (!diff.ok) return err('git_failed');

  // Item 3 — deterministic from stored events plus the diff's file list (A-61); the raw
  // transcript and the previous provider's session ref are never read for it.
  const events = await deps.runs.events(input.runId);
  const taskState = deriveTaskState(events, diff.value.files);

  // Item 5 — the rolling note as the executor saved it (A-60); empty when the run never wrote one.
  const summary: RollingNote = (await deps.runs.handoffNote(input.runId)) ?? { text: '', capped: false };

  const windows = await Promise.all(input.candidates.map((route) => windowOf(deps.modelCatalog, route)));
  const pack: HandoffPack = {
    stagePrompt,
    acceptance,
    instructionPlan,
    taskState,
    codeState: { files: diff.value.files, patch: diff.value.patch },
    summary,
    definitionsChanged:
      run.definitionsRev !== undefined && run.definitionsRev !== definitionsDigest(stagePrompt),
  };

  const sized = sizeHandoffPack(pack, { maxChars: packBudgetChars(windows) });
  return ok({ pack: sized, prompt: renderHandoffPrompt(sized) });
};

/** `base` fails flat with `git_failed`; only its success carries a sha, so the failure folds to
 *  `undefined` and the caller reads it as the not-a-working-tree verdict. */
const asSha = async (result: Promise<Result<string, 'git_failed'>>): Promise<string | undefined> => {
  const resolved = await result;
  return resolved.ok ? resolved.value : undefined;
};
