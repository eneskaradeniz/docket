import type { Definitions, FlowPin, RoleDef, StageSlug } from '../../domain/index';

import type { WorkOrderRecord } from '../ports/work-order-repo';

const hasUsablePin = (pin: FlowPin | undefined): pin is FlowPin =>
  pin !== undefined && pin.stages.length > 0;

/** A-325: a dispatcher-started stage run reads the work order pin when present; legacy rows
 *  without one keep resolving from the live repo definitions. */
export const roleForStageRun = (
  record: Pick<WorkOrderRecord, 'flow' | 'pin'>,
  definitions: Definitions,
  stage: StageSlug,
): RoleDef | undefined => {
  const pin = record.pin;
  if (hasUsablePin(pin)) {
    const entry = pin.stages.find((candidate) => candidate.stage.id === stage);
    if (entry !== undefined) return entry.role ?? undefined;
  }

  // Work orders opened before Phase 7 never stored a pin; resolve from the live repo flow.
  const flow = definitions.flows.find((candidate) => candidate.id === record.flow);
  const stageDef = flow?.stages.find((candidate) => candidate.id === stage);
  const roleSlug = stageDef?.role ?? null;
  if (roleSlug === null) return undefined;
  return definitions.roles.find((candidate) => candidate.id === roleSlug);
};
