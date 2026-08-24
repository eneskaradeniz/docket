import { describe, expect, it } from 'vitest';
import { derivePhase, deriveTurnState } from '../derive';
import type { LiveSessionStatus } from '../runner';
import type { StageId } from '../types';

// WO-0031c — the substrip turn line, the glow wash and the rail lamp all read ONE classifier.
// Inputs mirror what the WorkOrderDetail controller holds: the derived phase, the active drive's
// fold status (idle when no drive ran in this app session), whether the runner holds unanswered
// asks, the wind-down flag (interrupt sent, session still open) and the post-stop memory
// (wind-down completed, Sürdür not yet clicked — controller-owned, cleared on resume).
const phase = (stage: StageId) => derivePhase({ stage, sessions: [] }, [], false);

const turn = (
  liveStatus: LiveSessionStatus,
  over: { asks?: boolean; stopping?: boolean; stopped?: boolean; starting?: boolean; stage?: StageId } = {},
) =>
  deriveTurnState({
    phase: phase(over.stage ?? 'implementation'),
    liveStatus,
    hasPendingAsks: over.asks ?? false,
    ...(over.stopping !== undefined ? { stopping: over.stopping } : {}),
    ...(over.stopped !== undefined ? { stopped: over.stopped } : {}),
    ...(over.starting !== undefined ? { starting: over.starting } : {}),
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

  // base-mobile trial (2026-08-21): the boot window — store.start() ran but the provider session has
  // not opened yet (fold still 'idle', no first event). The substrip said "Sıra sende" for the whole
  // subprocess boot right after the operator's click; the turn is running from the click.
  it('starting (drive begun, provider session not yet open) → running', () => {
    expect(turn('idle', { starting: true })).toBe('running');
  });

  it('a boot failure outranks starting → retry', () => {
    expect(turn('error', { starting: true })).toBe('retry');
  });

  it('a completed wind-down awaiting Sürdür → stopped', () => {
    expect(turn('idle', { stopped: true })).toBe('stopped');
  });

  // WO-0039 stabilization (2026-08-23): the fold itself carries the intentional stop (the
  // `interrupted` event) — it must land as stopped even without the controller's memory flag,
  // and a stale-'running' fold can no longer mask the completed wind-down.
  it("the fold's own stopped status (the interrupted event) → stopped, no controller flag needed", () => {
    expect(turn('stopped')).toBe('stopped');
  });

  it('an error still outranks a stopped fold (a real crash after the interrupt is not silenced)', () => {
    expect(turn('error', { stopped: true })).toBe('retry');
  });

  it('a closed work order → done — the calm "Kapandı" line, never a false "Sıra sende" (WO-0031d tur-2)', () => {
    expect(turn('idle', { stage: 'closed' })).toBe('done');
  });

  it('done is terminal — it outranks stale live state on a closed WO', () => {
    expect(turn('running', { stage: 'closed' })).toBe('done');
    expect(turn('error', { stage: 'closed' })).toBe('done');
  });

  it('idle with nothing pending → yours (default: an unmatched work order is on the operator)', () => {
    expect(turn('idle')).toBe('yours');
    expect(turn('done')).toBe('yours'); // a finished DRIVE, not a closed WO — the loop continues
  });
});
