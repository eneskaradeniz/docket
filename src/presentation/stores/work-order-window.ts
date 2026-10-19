// stores/work-order-window.ts — the new-work-order dialog's session draft and form standing.
// The title survives a scrim or Esc close for the rest of the session. The repo flow is fixed
// (U-290): every open shows the pinned strip, not a selector. Planner skip decisions stay in the
// draft until create commits them with the work order (architect decision 2026-10-14).
import type { Command } from '../../api/commands';
import type { CommandResult } from '../../api/commands';
import type { Api } from '../../api/api';
import type { ProjectTree, Query } from '../../api/queries';
import type { Actor, EpochMs, GateDef, RepoFlow, StageSlug, WorkOrderEvent } from '../../domain/index';
import { BUILTIN_FLOWS } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey } from './results';

export type WorkOrderFieldValidation = 'title_required' | 'flow_required';

type WorkOrderOpenCommandOutcome =
  | { readonly ok: true; readonly id?: string }
  | { readonly ok: false; readonly code: string };

export const STANDARD_FLOW = 'standard';

export interface FlowOption {
  readonly id: string;
  readonly name: string;
}

/** Planner stage-skip card payload — mirrors docs/v2/ui.md StageSkipProposalCard. */
export interface StageSkipProposalCard {
  readonly stages: readonly string[];
  readonly reason: string;
}

export interface FlowStripTile {
  readonly stageId: string;
  readonly stageName: string;
  readonly roleVersion: number | null;
}

/** Read-only flow strip the dialog shows (pinned flow and role versions, D-1/D-6). */
export interface PinnedFlowView {
  readonly flowId: string;
  readonly flowVersion: number;
  readonly stages: readonly FlowStripTile[];
  /** Human and page-approval gates in the flow definition; null when the library has no match. */
  readonly humanGateCount: number | null;
}

const isHumanGate = (gate: GateDef): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/** Counts exit gates a person must decide, for the compact dialog's one-line summary (U-253). */
export const humanGateCountForFlowId = (flowId: string): number | null => {
  const flow = BUILTIN_FLOWS.find((candidate) => candidate.id === flowId);
  if (flow === undefined) return null;
  let count = 0;
  for (const stage of flow.stages) {
    for (const gate of stage.exit) {
      if (isHumanGate(gate)) count += 1;
    }
  }
  return count;
};

/** Drops a blank id. Does not invent `standard`: a flow the project does not have must not appear
 *  as a choice, or the select and the command would disagree. */
export const flowChoices = (known: readonly FlowOption[]): readonly FlowOption[] =>
  known.filter((flow) => flow.id.trim() !== '');

/** The board query names one flow — the repo's default. That is the only choice the board can offer. */
export const boardFlowChoices = (boardFlow: string | null): readonly FlowOption[] =>
  flowChoices(boardFlow === null || boardFlow.trim() === '' ? [] : [{ id: boardFlow, name: boardFlow }]);

/** The flow id sent on create: `standard` when listed, otherwise the first listed flow. */
export const defaultFlow = (options: readonly FlowOption[]): string => {
  const standard = options.find((flow) => flow.id === STANDARD_FLOW);
  if (standard !== undefined) return standard.id;
  return options[0]?.id ?? '';
};

/** Builds the strip view from the stored repo flow (versions from bindings). */
export const pinnedFlowFromRepoFlow = (flow: RepoFlow): PinnedFlowView => ({
  flowId: flow.flowId,
  flowVersion: flow.version,
  humanGateCount: humanGateCountForFlowId(flow.flowId),
  stages: flow.stages.map((stage) => {
    const binding = flow.bindings.find((candidate) => candidate.stage === stage.id);
    return {
      stageId: stage.id,
      stageName: stage.name,
      roleVersion: binding?.role?.version ?? null,
    };
  }),
});

/** Fallback when only board columns are known: stage names without role versions. */
export const pinnedFlowFromColumns = (
  flowId: string,
  flowVersion: number,
  columns: readonly { readonly stage: string; readonly name: string }[],
): PinnedFlowView => ({
  flowId,
  flowVersion,
  humanGateCount: humanGateCountForFlowId(flowId),
  stages: columns.map((column) => ({
    stageId: column.stage,
    stageName: column.name,
    roleVersion: null,
  })),
});

/** R-133 ledger pair to append atomically with work-order creation when the operator decided. */
export const stageSkipLedgerEvents = (
  at: EpochMs,
  stages: readonly StageSlug[],
  reason: string,
  approved: boolean,
): readonly WorkOrderEvent[] => [
  { type: 'stage_skip_proposed', at, stages, reason },
  { type: 'stage_skip_decided', at, approved },
];

export interface WorkOrderOpenToast {
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export const workOrderOpenToast = (outcome: WorkOrderOpenCommandOutcome): WorkOrderOpenToast => {
  if (outcome.ok) {
    const result: CommandResult = { ok: true, ...(outcome.id === undefined ? {} : { id: outcome.id }) };
    return { result, labelKey: commandResultKey('workOrder.open', result) };
  }
  const result: CommandResult = { ok: false, code: outcome.code };
  return { result, labelKey: commandResultKey('workOrder.open', result) };
};

export const focusTarget = (
  title: string,
  cards: readonly { readonly id: string; readonly title: string }[],
): string | null => {
  const found = cards.find((card) => card.title === title);
  return found === undefined ? null : found.id;
};

interface SessionDraft {
  readonly title: string;
  readonly description: string;
}

let draft: SessionDraft = { title: '', description: '' };

export const workOrderDraft = {
  read: (): SessionDraft => draft,
  remember: (title: string, description: string): void => {
    draft = {
      title: title.trim() === '' ? '' : title,
      description: description.trim() === '' ? '' : description,
    };
  },
  clear: (): void => {
    draft = { title: '', description: '' };
  },
};

export type StageSkipDraftDecision = 'approved' | 'rejected' | null;

export interface WorkOrderFormState {
  readonly title: string;
  readonly description: string;
  readonly flow: string;
  readonly fieldError: WorkOrderFieldValidation | null;
  readonly failure: string | null;
  readonly submitting: boolean;
  /** Set when the operator answers Atla / Atlama on a planner proposal (U-291). */
  readonly skipDecision: StageSkipDraftDecision;
  /** Stages marked skipped in the strip after approval (draft only until create). */
  readonly skippedStageIds: readonly string[];
}

export const openedWorkOrderForm = (kept: SessionDraft, options: readonly FlowOption[]): WorkOrderFormState => ({
  title: kept.title,
  description: kept.description,
  flow: defaultFlow(options),
  fieldError: null,
  failure: null,
  submitting: false,
  skipDecision: null,
  skippedStageIds: [],
});

export type WorkOrderFormAction =
  | { readonly type: 'open'; readonly draft: SessionDraft; readonly options: readonly FlowOption[] }
  | { readonly type: 'title'; readonly value: string }
  | { readonly type: 'description'; readonly value: string }
  | { readonly type: 'invalid'; readonly field: WorkOrderFieldValidation }
  | { readonly type: 'failed'; readonly code: string }
  | { readonly type: 'submitting' }
  | { readonly type: 'submit_done' }
  | { readonly type: 'skip_approve'; readonly stages: readonly string[] }
  | { readonly type: 'skip_reject' }
  | { readonly type: 'created'; readonly options: readonly FlowOption[] };

export const workOrderFormReducer = (state: WorkOrderFormState, action: WorkOrderFormAction): WorkOrderFormState => {
  switch (action.type) {
    case 'open':
      return openedWorkOrderForm(action.draft, action.options);
    case 'title':
      return {
        ...state,
        title: action.value,
        fieldError: state.fieldError === 'title_required' ? null : state.fieldError,
      };
    case 'description':
      return { ...state, description: action.value };
    case 'invalid':
      return { ...state, fieldError: action.field, failure: null, submitting: false };
    case 'failed':
      return { ...state, failure: action.code, fieldError: null, submitting: false };
    case 'submitting':
      return { ...state, submitting: true, failure: null };
    case 'submit_done':
      return { ...state, submitting: false };
    case 'skip_approve':
      return {
        ...state,
        skipDecision: 'approved',
        skippedStageIds: action.stages,
      };
    case 'skip_reject':
      return {
        ...state,
        skipDecision: 'rejected',
        skippedStageIds: [],
      };
    case 'created':
      return openedWorkOrderForm({ title: '', description: '' }, action.options);
  }
};

export interface WorkOrderCreateIntent {
  readonly title: string;
  readonly description: string;
  readonly flow: string;
  readonly skipProposal: StageSkipProposalCard | null;
  readonly skipDecision: StageSkipDraftDecision;
}

export const workOrderCreateIntent = (
  state: WorkOrderFormState,
  flow: string,
  skipProposal: StageSkipProposalCard | null,
): WorkOrderCreateIntent => ({
  title: state.title.trim(),
  description: state.description.trim(),
  flow,
  skipProposal,
  skipDecision: state.skipDecision,
});

/** Fields for `workOrder.open`; an empty description is omitted (U-255, #982). */
export const workOrderOpenFields = (
  title: string,
  description: string,
  flow: string,
): { readonly title: string; readonly flow: string; readonly description?: string } => {
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  return trimmedDescription === ''
    ? { title: trimmedTitle, flow }
    : { title: trimmedTitle, flow, description: trimmedDescription };
};

export type WorkOrderCreateMode = 'open' | 'open_and_start';

export interface WorkOrderWindowCreateRequest {
  readonly title: string;
  readonly description: string;
  readonly flow: string;
  readonly mode: WorkOrderCreateMode;
  readonly skipProposal?: StageSkipProposalCard | null;
  readonly skipDecision?: StageSkipDraftDecision;
}

/** Open outcome; `startFailed` is set when the order opened but the first enqueue did not (U-254). */
export type WorkOrderWindowCreateOutcome =
  | { readonly ok: true; readonly id?: string; readonly startFailed?: string }
  | { readonly ok: false; readonly validation: WorkOrderFieldValidation }
  | { readonly ok: false; readonly code: string };

export interface WorkOrderCreateRunnerDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly onOpened: () => void;
}

/** Issues `workOrder.open` and optionally `workOrder.enqueue` for the compact dialog (U-254, U-255). */
export const runWorkOrderCreate = async (
  deps: WorkOrderCreateRunnerDeps,
  repo: string,
  request: WorkOrderWindowCreateRequest,
): Promise<WorkOrderWindowCreateOutcome> => {
  const fields = workOrderOpenFields(request.title, request.description, request.flow);
  if (fields.title === '') return { ok: false, validation: 'title_required' };
  if (fields.flow.trim() === '') return { ok: false, validation: 'flow_required' };

  const tree: unknown = await deps.api.query({ type: 'project.tree' } satisfies Query);
  const owner = (Array.isArray(tree) ? (tree as ProjectTree) : []).find((item) =>
    item.repos.some((node) => node.repo === repo),
  );
  if (owner === undefined) return { ok: false, code: 'unknown_project' };

  const stageSkip =
    request.skipProposal !== undefined &&
    request.skipProposal !== null &&
    request.skipProposal.stages.length > 0 &&
    request.skipProposal.reason.trim() !== ''
      ? {
          stages: request.skipProposal.stages,
          reason: request.skipProposal.reason.trim(),
          ...(request.skipDecision === 'approved'
            ? { approved: true }
            : request.skipDecision === 'rejected'
              ? { approved: false }
              : {}),
        }
      : undefined;

  const openCommand: Command = {
    type: 'workOrder.open',
    project: owner.project,
    repo,
    title: fields.title,
    flow: fields.flow,
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(stageSkip !== undefined ? { stageSkip } : {}),
  };
  const result = await deps.api.command(deps.actor, openCommand);
  if (!result.ok) return { ok: false, code: result.code };

  deps.onOpened();

  if (request.mode !== 'open_and_start' || result.id === undefined) {
    return { ok: true, id: result.id };
  }

  const enqueue = await deps.api.command(deps.actor, { type: 'workOrder.enqueue', id: result.id });
  if (!enqueue.ok) return { ok: true, id: result.id, startFailed: enqueue.code };
  return { ok: true, id: result.id };
};

export const workOrderCreateToasts = (
  outcome: WorkOrderWindowCreateOutcome,
): readonly WorkOrderOpenToast[] => {
  if (!outcome.ok) {
    if ('validation' in outcome) return [];
    const result: CommandResult = { ok: false, code: outcome.code };
    return [{ result, labelKey: commandResultKey('workOrder.open', result) }];
  }
  const opened: CommandResult = { ok: true, ...(outcome.id === undefined ? {} : { id: outcome.id }) };
  const toasts: WorkOrderOpenToast[] = [{ result: opened, labelKey: commandResultKey('workOrder.open', opened) }];
  if (outcome.startFailed !== undefined) {
    const failed: CommandResult = { ok: false, code: outcome.startFailed };
    toasts.push({ result: failed, labelKey: commandResultKey('workOrder.enqueue', failed) });
  }
  return toasts;
};
