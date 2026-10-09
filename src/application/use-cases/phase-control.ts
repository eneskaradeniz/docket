// Pause and resume of an unattended phase (docs/v2/application.md A-110, A-116). Pausing only stops
// NEW starts (advancePhases skips a paused record); a running run and queued items are never touched.
import type { Actor, PhaseSlug, ProjectSlug, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';

export type PausePhaseError = 'not_running';
export type ResumePhaseError = 'not_paused';

type PhaseControlDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'phaseAutoRuns'>;
type PhaseControlInput = { readonly project: ProjectSlug; readonly phase: PhaseSlug; readonly actor: Actor };

export async function pausePhase(deps: PhaseControlDeps, input: PhaseControlInput): Promise<Result<void, PausePhaseError>> {
  const record = await deps.phaseAutoRuns.get(input.project, input.phase);
  if (record === undefined || record.state !== 'running') return err('not_running');
  await deps.phaseAutoRuns.put({ ...record, state: 'paused' });
  await audit(deps, input, 'phase.paused');
  return ok(undefined);
}

export async function resumePhase(deps: PhaseControlDeps, input: PhaseControlInput): Promise<Result<void, ResumePhaseError>> {
  const record = await deps.phaseAutoRuns.get(input.project, input.phase);
  if (record === undefined || record.state !== 'paused') return err('not_paused');
  await deps.phaseAutoRuns.put({ ...record, state: 'running' });
  await audit(deps, input, 'phase.resumed');
  return ok(undefined);
}

// Project and phase only, never titles or values (A-116).
const audit = async (deps: PhaseControlDeps, input: PhaseControlInput, action: 'phase.paused' | 'phase.resumed'): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action,
    subject: { kind: 'project', id: input.project },
    detail: { project: input.project, phase: input.phase },
  });
};
