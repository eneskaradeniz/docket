import { describe, expect, it } from 'vitest';
import { derivePhase, deriveTurnState } from '../derive';
import type { LiveSessionStatus } from '../runner';
import type { StageId } from '../types';

// WO-0031c — the substrip turn line, the glow wash and the rail lamp all read ONE classifier.
// Inputs mirror what the WorkOrderDetail controller holds: the derived phase, the active drive's
// fold status (idle when no drive ran in this app session), whether the runner holds unanswered
// asks, the wind-down flag (interrupt sent, session still open) and the post-stop memory
// (wind-down completed, Sürdür not yet clicked — controller-owned, cleared on resume).
const phase = (stage: StageId) => derivePhase({ stage }, [], false);

const turn = (liveStatus: LiveSessionStatus, over: { asks?: boolean; stopping?: boolean; stopped?: boolean; stage?: StageId } = {}) =>
  deriveTurnState({
    phase: phase(over.stage ?? 'implementation'),
    liveStatus,
    hasPendingAsks: over.asks ?? false,
    ...(over.stopping !== undefined ? { stopping: over.stopping } : {}),
    ...(over.stopped !== undefined ? { stopped: over.stopped } : {}),
  });

describe('deriveTurnState (WO-0031c)', () => {
  it('a drive error outranks everything → retry (the red card + Yeniden dene)', () => {
    expect(turn('error', { asks: true })).toBe('retry');
  });

  it('pending asks → yours (the amber moment: Sıra sende)', () => {
    expect(turn('stopped_asking')).toBe('yours');
    expect(turn('running', { asks: true })).toBe('yours'); // fold not yet flipped, asks already held
  });

  it('a proposed plan → yours (plan approval is the operator decision moment)', () => {
    expect(turn('plan_ready')).toBe('yours');
  });

  it('running stays running, including the wind-down (Durduruluyor… still spends)', () => {
    expect(turn('running')).toBe('running');
    expect(turn('running', { stopping: true })).toBe('running');
  });

  it('a completed wind-down awaiting Sürdür → stopped', () => {
    expect(turn('idle', { stopped: true })).toBe('stopped');
  });

  it('closed/done → yours (the rail renders nothing there; the strip carries the archive state)', () => {
    expect(turn('idle', { stage: 'closed' })).toBe('yours');
  });

  it('idle with nothing pending → yours (default: an unmatched work order is on the operator)', () => {
    expect(turn('idle')).toBe('yours');
    expect(turn('done')).toBe('yours');
  });
});
