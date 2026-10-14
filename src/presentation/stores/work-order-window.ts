// stores/work-order-window.ts — the new-work-order dialog's session draft and form standing.
// The title survives a scrim or Esc close for the rest of the session. The repo flow is fixed
// (U-290): every open shows the pinned strip, not a selector. Planner skip decisions stay in the
// draft until create commits them with the work order (architect decision 2026-10-14).
import type { EpochMs, RepoFlow, StageSlug, WorkOrderEvent } from '../../domain/index';
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import type { CreateOutcome, CreateValidation } from './board';
import { commandResultKey } from './results';

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
}

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

export const workOrderOpenToast = (
  outcome: Exclude<CreateOutcome, { readonly validation: CreateValidation }>,
): WorkOrderOpenToast => {
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
  readonly fieldError: CreateValidation | null;
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
  | { readonly type: 'invalid'; readonly field: CreateValidation }
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
