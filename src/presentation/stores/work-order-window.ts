// stores/work-order-window.ts — the new-work-order dialog's session draft and the form standing.
// The title survives a scrim or Esc close for the rest of the session; the flow does not, because
// every open picks its default again from the flows the project actually has. An empty title is
// remembered as nothing, so closing never has to ask whether to keep a blank draft.
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import type { CreateOutcome, CreateValidation } from './board';
import { commandResultKey } from './results';

export const STANDARD_FLOW = 'standard';

export interface FlowOption {
  readonly id: string;
  readonly name: string;
}

/** Drops a blank id. Does not invent `standard`: a flow the project does not have must not appear
 *  as a choice, or the select and the command would disagree. */
export const flowChoices = (known: readonly FlowOption[]): readonly FlowOption[] =>
  known.filter((flow) => flow.id.trim() !== '');

/** The board query names one flow — the repo's default. That is the only choice the board can offer. */
export const boardFlowChoices = (boardFlow: string | null): readonly FlowOption[] =>
  flowChoices(boardFlow === null || boardFlow.trim() === '' ? [] : [{ id: boardFlow, name: boardFlow }]);

/** The select's starting value, and the value a fresh open restores. `standard` when the project
 *  lists it; otherwise the first listed flow. An empty list has nothing to select. */
export const defaultFlow = (options: readonly FlowOption[]): string => {
  const standard = options.find((flow) => flow.id === STANDARD_FLOW);
  if (standard !== undefined) return standard.id;
  return options[0]?.id ?? '';
};

export interface WorkOrderOpenToast {
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

/** A command outcome, mapped the way every other intent is: the success or failure key comes
 *  from the command-result table, never from a sentence written at the call site. A validation
 *  refusal never reaches a command, so it is not a toast. */
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

/** The card a successful create should focus, once the board lists a card with that title. */
export const focusTarget = (
  title: string,
  cards: readonly { readonly id: string; readonly title: string }[],
): string | null => {
  const found = cards.find((card) => card.title === title);
  return found === undefined ? null : found.id;
};

/** Session draft. A blank title stores nothing, so the next open starts empty. */
let draft = '';

export const workOrderDraft = {
  read: (): string => draft,
  remember: (title: string): void => {
    draft = title.trim() === '' ? '' : title;
  },
  clear: (): void => {
    draft = '';
  },
};

export interface WorkOrderFormState {
  readonly title: string;
  readonly flow: string;
  readonly fieldError: CreateValidation | null;
  /** A command failure's code; the window maps it through the label bundles. */
  readonly failure: string | null;
}

export const openedWorkOrderForm = (kept: string, options: readonly FlowOption[]): WorkOrderFormState => ({
  title: kept,
  flow: defaultFlow(options),
  fieldError: null,
  failure: null,
});

export type WorkOrderFormAction =
  | { readonly type: 'open'; readonly draft: string; readonly options: readonly FlowOption[] }
  | { readonly type: 'title'; readonly value: string }
  | { readonly type: 'flow'; readonly value: string }
  | { readonly type: 'invalid'; readonly field: CreateValidation }
  | { readonly type: 'failed'; readonly code: string }
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
    case 'flow':
      return {
        ...state,
        flow: action.value,
        fieldError: state.fieldError === 'flow_required' ? null : state.fieldError,
      };
    case 'invalid':
      return { ...state, fieldError: action.field, failure: null };
    case 'failed':
      return { ...state, failure: action.code, fieldError: null };
    case 'created':
      return openedWorkOrderForm('', action.options);
  }
};
