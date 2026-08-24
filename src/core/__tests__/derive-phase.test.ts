import { describe, expect, it } from 'vitest';
import { derivePhase } from '../derive';
import type { SessionRef, StageId, StepStatus } from '../types';

// A minimal step view slice (idx/status/verdict) — what derivePhase consumes.
const sv = (idx: number, status: StepStatus, verdict?: 'proceed' | 'revise') => ({ idx, status, verdict });
const stoppedRow = { role: 'architect', status: 'stopped', transcript: [] } as SessionRef;
const phase = (stage: StageId, steps: ReturnType<typeof sv>[] = [], hasPlan = false, sessions: SessionRef[] = []) =>
  derivePhase({ stage, sessions }, steps, hasPlan);

describe('derivePhase (WO-0021)', () => {
  it('written → just_written', () => {
    expect(phase('written')).toEqual({ kind: 'just_written' });
  });

  it('architect_approval + no pending plan → planning', () => {
    expect(phase('architect_approval', [], false)).toEqual({ kind: 'planning' });
  });

  // 2026-08-24 (operator, live run): the phase's voice follows the ROWS — a stopped proposal
  // session is not "düşünüyor"; the line says the proposal sits stopped (restart-safe: rows, not
  // the renderer fold).
  it('architect_approval + no plan + a STOPPED session row → plan_stopped (2026-08-24)', () => {
    expect(phase('architect_approval', [], false, [stoppedRow])).toEqual({ kind: 'plan_stopped' });
  });

  it('a plan on the table outranks the stopped row (plan_ready wins)', () => {
    expect(phase('architect_approval', [], true, [stoppedRow])).toEqual({ kind: 'plan_ready' });
  });

  it('architect_approval + pending plan → plan_ready (TD-025 restart recovery)', () => {
    expect(phase('architect_approval', [], true)).toEqual({ kind: 'plan_ready' });
  });

  it('implementation with no steps → implementing 0/0 (free-form fallback)', () => {
    expect(phase('implementation', [])).toEqual({ kind: 'implementing', done: 0, total: 0 });
  });

  it('implementation [pending, active, done-proceed] → implementing 1/3', () => {
    const steps = [sv(1, 'pending'), sv(2, 'active'), sv(3, 'done', 'proceed')];
    expect(phase('implementation', steps)).toEqual({ kind: 'implementing', done: 1, total: 3 });
  });

  it('a done step with no verdict → reviewing {stepIdx} (the WO-0020 review trigger)', () => {
    expect(phase('implementation', [sv(2, 'done')])).toEqual({ kind: 'reviewing', stepIdx: 2 });
  });

  it('a done step with a revise verdict → implementing (NOT its own phase; the VerdictCard carries it)', () => {
    expect(phase('implementation', [sv(1, 'done', 'revise')])).toEqual({ kind: 'implementing', done: 1, total: 1 });
  });

  it('closure → closing', () => {
    expect(phase('closure')).toEqual({ kind: 'closing' });
  });

  it('closed → done', () => {
    expect(phase('closed')).toEqual({ kind: 'done' });
  });
});
