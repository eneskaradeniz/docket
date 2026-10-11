// stores/work-order-window.ts — the new-work-order dialog's session draft and the form standing.
// The title survives a scrim or Esc close for the rest of the session; the flow does not, because
// every open restores `standard`. An empty title is remembered as nothing, so closing never has
// to ask whether to keep a blank draft.
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import type { CreateOutcome, CreateValidation } from './board';
import { commandResultKey } from './results';

export const STANDARD_FLOW = 'standard';

export interface FlowOption {
  readonly id: string;
  readonly name: string;
}

const STANDARD_OPTION: FlowOption = { id: STANDARD_FLOW, name: STANDARD_FLOW };

/** The Akış select: `standard` first, then every other flow the caller knows the project has. */
export const flowChoices = (known: readonly FlowOption[]): readonly FlowOption[] => {
  const rest = known.filter((flow) => flow.id !== STANDARD_FLOW && flow.id.trim() !== '');
  const named = known.find((flow) => flow.id === STANDARD_FLOW);
  return [named ?? STANDARD_OPTION, ...rest];
};

/** The board query names one flow — the repo's default. It joins `standard` when it is another. */
export const boardFlowChoices = (boardFlow: string | null): readonly FlowOption[] =>
  flowChoices(boardFlow === null || boardFlow.trim() === '' ? [] : [{ id: boardFlow, name: boardFlow }]);

/** The flow id the open command should carry. The select stands on `standard`, but a repo whose
 *  only enabled flow is another id cannot open that literal, so the command uses the flow the
 *  board already loaded. An explicit other choice is sent as chosen. */
export const flowToOpen = (selected: string, known: readonly FlowOption[]): string => {
  const others = known.filter((flow) => flow.id !== STANDARD_FLOW);
  if (selected === STANDARD_FLOW && others.length === 1) {
    const only = others[0];
    if (only !== undefined) return only.id;
  }
  return selected;
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

export const openedWorkOrderForm = (kept: string): WorkOrderFormState => ({
  title: kept,
  flow: STANDARD_FLOW,
  fieldError: null,
  failure: null,
});

export type WorkOrderFormAction =
  | { readonly type: 'open'; readonly draft: string }
  | { readonly type: 'title'; readonly value: string }
  | { readonly type: 'flow'; readonly value: string }
  | { readonly type: 'invalid'; readonly field: CreateValidation }
  | { readonly type: 'failed'; readonly code: string }
  | { readonly type: 'created' };

export const workOrderFormReducer = (state: WorkOrderFormState, action: WorkOrderFormAction): WorkOrderFormState => {
  switch (action.type) {
    case 'open':
      return openedWorkOrderForm(action.draft);
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
      return openedWorkOrderForm('');
  }
};
