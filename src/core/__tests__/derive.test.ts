import { describe, expect, it } from 'vitest';
import { workOrderById } from '../../adapters/fixtures';
import type { BoardColumn, TrackId, WorkOrder, WorkOrderId } from '../types';
import {
  deriveCardReason,
  deriveEvidence,
  derivePrimaryAction,
  deriveRail,
  deriveTrackMerge,
  sessionForTrack,
  toCardView,
  toDetailView,
  whoseTurn,
} from '../derive';
import { aSession, aTrack, aWorkOrder } from './builders';

const wo = (id: string): WorkOrder => workOrderById.get(id as WorkOrderId)!;

describe('whoseTurn — six fixture states', () => {
  const cases: Array<[string, BoardColumn]> = [
    ['WO-1001', 'your_turn'],
    ['WO-1002', 'your_turn'],
    ['WO-1003', 'your_turn'],
    ['WO-1004', 'your_turn'],
    ['WO-1005', 'external'],
    ['WO-1006', 'running'],
  ];
  for (const [id, expected] of cases) {
    it(`${id} -> ${expected}`, () => {
      expect(whoseTurn(wo(id))).toBe(expected);
    });
  }
});

describe('deriveCardReason — every card states why it is in its column (AC13)', () => {
  it('WO-1001 stopped-asking names the gate', () => {
    expect(deriveCardReason(wo('WO-1001'))).toEqual({ kind: 'stopped_asking', gate: 'tool-permission' });
  });
  it('WO-1002 failed-CI names the failing check', () => {
    expect(deriveCardReason(wo('WO-1002'))).toEqual({ kind: 'ci_failed', checkName: 'build' });
  });
  it('WO-1003 awaiting plan commit', () => expect(deriveCardReason(wo('WO-1003')).kind).toBe('awaiting_plan_commit'));
  it('WO-1004 docs not updated', () => expect(deriveCardReason(wo('WO-1004')).kind).toBe('docs_not_updated'));
  it('WO-1005 ci running (external)', () => expect(deriveCardReason(wo('WO-1005')).kind).toBe('ci_running'));
  it('WO-1006 in progress (running)', () => expect(deriveCardReason(wo('WO-1006')).kind).toBe('in_progress'));
});

describe('named invariant cases (AC10)', () => {
  it('a work order matching no whoseTurn rule falls to your_turn', () => {
    const idle = aWorkOrder({
      stage: 'implementation',
      tracks: [
        aTrack({
          id: 't',
          repo: 'r',
          ci: { kind: 'run', state: 'success', checks: [{ name: 'build', conclusion: 'success' }] },
        }),
      ],
      sessions: [aSession({ role: 'implementer', status: 'idle' })],
    });
    expect(whoseTurn(idle)).toBe('your_turn');
    expect(deriveCardReason(idle)).toEqual({ kind: 'awaiting_next_session' });
  });

  it('an unsatisfied gate yields an absent primary action, never a disabled control', () => {
    const a1 = derivePrimaryAction(wo('WO-1003')); // architect_approval, plan not committed
    expect(a1.kind).toBe('absent');
    if (a1.kind === 'absent') expect(a1.reason).toBe('awaiting_plan_commit');

    const a2 = derivePrimaryAction(wo('WO-1004')); // closure, docs not committed
    expect(a2.kind).toBe('absent');
    if (a2.kind === 'absent') expect(a2.reason).toBe('docs_not_updated');
  });

  it('a track whose dependsOn is open has no merge', () => {
    const w = wo('WO-1005');
    const mobile = w.tracks.find((t) => t.dependsOn.length > 0)!;
    expect(deriveTrackMerge(w, mobile)).toEqual({ kind: 'absent', reason: 'depends_on_open' });
  });

  it('a CI-exempt track is never treated as passing, yet does not block the gate', () => {
    // exempt ci_green is its own status, never 'satisfied'
    const ciGreen = deriveEvidence(wo('WO-1006')).find((e) => e.kind === 'ci_green')!;
    expect(ciGreen.status).toBe('exempt');
    expect(ciGreen.exemption?.reason).toBeTruthy();

    // an exempt track with pr + closed deps CAN merge (not blocked) — AC12
    const exempt = aTrack({
      id: 'e',
      repo: 'r',
      ci: { kind: 'exempt', reason: 'no CI configured' },
      pr: { url: 'https://example/pull/1', headSha: 'deadbee' },
      dependsOn: [],
    });
    const w = aWorkOrder({ tracks: [exempt] });
    expect(deriveTrackMerge(w, exempt)).toEqual({ kind: 'available' });

    // a failed CI run DOES block the same configuration
    const failed = aTrack({
      id: 'f',
      repo: 'r',
      ci: { kind: 'run', state: 'failed', checks: [{ name: 'build', conclusion: 'failure' }] },
      pr: { url: 'https://example/pull/2', headSha: 'feedface' },
      dependsOn: [],
    });
    const w2 = aWorkOrder({ tracks: [failed] });
    expect(deriveTrackMerge(w2, failed)).toEqual({ kind: 'absent', reason: 'ci_not_green' });
  });
});

describe('deriveRail', () => {
  it('locks the current gated stage and names what it requires (AC4)', () => {
    const step1003 = deriveRail(wo('WO-1003')).find((s) => s.stage === 'architect_approval')!;
    expect(step1003.status).toBe('locked');
    expect(step1003.needs).toEqual(['plan_approval']);

    const closure = deriveRail(wo('WO-1004')).find((s) => s.stage === 'closure')!;
    expect(closure.status).toBe('locked');
    expect(closure.needs).toEqual(['closure']);
  });

  it('marks a non-gated current stage current, not locked', () => {
    const impl = deriveRail(wo('WO-1001')).find((s) => s.stage === 'implementation')!;
    expect(impl.status).toBe('current');
    expect(impl.needs).toBeUndefined();
  });
});

describe('deriveEvidence — three-valued (AC12)', () => {
  it('closure evidence is unsatisfied when docs are missing (WO-1004)', () => {
    const e = deriveEvidence(wo('WO-1004')).find((x) => x.kind === 'closure');
    expect(e?.status).toBe('unsatisfied');
  });
  it('ci_green is exempt with a reason on a CI-exempt track (WO-1006)', () => {
    const e = deriveEvidence(wo('WO-1006')).find((x) => x.kind === 'ci_green');
    expect(e?.status).toBe('exempt');
    expect(e?.exemption?.reason).toBeTruthy();
  });
  it('ci_green is satisfied on a green track (WO-1004)', () => {
    const e = deriveEvidence(wo('WO-1004')).find((x) => x.kind === 'ci_green');
    expect(e?.status).toBe('satisfied');
  });
});

describe('sessionForTrack — single home for sessions', () => {
  it('resolves a track session from WorkOrder.sessions (WO-1001)', () => {
    const w = wo('WO-1001');
    const s = sessionForTrack(w, w.tracks[0].id);
    expect(s?.status).toBe('stopped_asking');
  });

  it('returns undefined when no session is scoped to the track', () => {
    const w = aWorkOrder({
      tracks: [aTrack({ id: 'solo', repo: 'r' })],
      sessions: [aSession({ role: 'architect', status: 'idle' })],
    });
    expect(sessionForTrack(w, 'solo' as TrackId)).toBeUndefined();
  });
});

describe('toCardView / toDetailView', () => {
  it('card view carries column + reason (AC13)', () => {
    const card = toCardView(wo('WO-1005'));
    expect(card.column).toBe('external');
    expect(card.reason.kind).toBe('ci_running');
  });

  it('detail view resolves lane sessions + per-track merge actions', () => {
    const detail = toDetailView(wo('WO-1005'));
    const mobile = detail.tracks.find((ln) => ln.track.dependsOn.length > 0)!;
    expect(mobile.mergeAction).toEqual({ kind: 'absent', reason: 'depends_on_open' });
    expect(mobile.session?.status).toBe('none');
  });
});
