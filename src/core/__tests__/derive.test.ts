import { describe, expect, it } from 'vitest';
import { workOrderById, workOrders } from '../../adapters/fixtures';
import type {
  BoardColumn,
  CardReason,
  CostSummary,
  EvidenceKind,
  EvidenceStatus,
  PrimaryAction,
  SessionRef,
  StageId,
  StageStatus,
  TrackId,
  TrackMergeAction,
  WorkOrder,
  WorkOrderId,
} from '../types';
import {
  deriveCardReason,
  deriveEvidence,
  derivePrimaryAction,
  deriveRail,
  deriveStage,
  deriveTrackMerge,
  deriveTrackStage,
  deriveWorkOrderCost,
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

// AC10 (return-pass): every derivation is asserted across all six fixture states, not just the
// ones whose behaviour discriminates between them. whoseTurn and deriveCardReason are already
// parametrised over the six above; this block closes the gap for the remaining derivations.
describe('six-state coverage — every derivation (AC10)', () => {
  const IDS = ['WO-1001', 'WO-1002', 'WO-1003', 'WO-1004', 'WO-1005', 'WO-1006'] as const;

  describe('derivePrimaryAction — six states', () => {
    const cases: Record<string, PrimaryAction> = {
      'WO-1001': { kind: 'available', intent: 'resume' },
      'WO-1002': { kind: 'available', intent: 'resume' },
      'WO-1003': { kind: 'absent', reason: 'awaiting_plan_commit' },
      'WO-1004': { kind: 'absent', reason: 'docs_not_updated' },
      'WO-1005': { kind: 'available', intent: 'resume' },
      'WO-1006': { kind: 'available', intent: 'resume' },
    };
    it.each(IDS)('%s yields the expected primary action', (id) => {
      expect(derivePrimaryAction(wo(id))).toEqual(cases[id]);
    });
  });

  describe('deriveRail — six states', () => {
    const cases: Record<string, { stage: StageId; status: StageStatus; needs?: EvidenceKind[] }> = {
      'WO-1001': { stage: 'implementation', status: 'current' },
      'WO-1002': { stage: 'implementation', status: 'current' },
      'WO-1003': { stage: 'architect_approval', status: 'locked', needs: ['plan_approval'] },
      'WO-1004': { stage: 'closure', status: 'locked', needs: ['closure'] },
      'WO-1005': { stage: 'implementation', status: 'current' },
      'WO-1006': { stage: 'implementation', status: 'current' },
    };
    it.each(IDS)('%s rail spans all nine stages', (id) => {
      expect(deriveRail(wo(id))).toHaveLength(9);
    });
    it.each(IDS)('%s current/locked stage status + needs', (id) => {
      const c = cases[id];
      const step = deriveRail(wo(id)).find((s) => s.stage === c.stage)!;
      expect(step.status).toBe(c.status);
      expect(step.needs).toEqual(c.needs);
    });
  });

  describe('deriveEvidence — six states (kind × status sequence)', () => {
    type Pair = { kind: EvidenceKind; status: EvidenceStatus };
    const e = (kind: EvidenceKind, status: EvidenceStatus): Pair => ({ kind, status });
    const cases: Record<string, Pair[]> = {
      'WO-1001': [e('plan_approval', 'satisfied'), e('verification', 'unsatisfied'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1002': [e('plan_approval', 'satisfied'), e('verification', 'unsatisfied'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'unsatisfied')],
      'WO-1003': [e('plan_approval', 'unsatisfied'), e('verification', 'unsatisfied'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1004': [e('plan_approval', 'satisfied'), e('verification', 'satisfied'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'satisfied')],
      'WO-1005': [e('plan_approval', 'satisfied'), e('verification', 'unsatisfied'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1006': [e('plan_approval', 'satisfied'), e('verification', 'unsatisfied'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'exempt')],
    };
    it.each(IDS)('%s', (id) => {
      const items = deriveEvidence(wo(id)).map(({ kind, status }) => ({ kind, status }));
      expect(items).toEqual(cases[id]);
    });
  });

  describe('deriveTrackMerge — six states (per track)', () => {
    const tid2 = (s: string) => s as TrackId;
    const cases: Record<string, Array<{ track: TrackId; action: TrackMergeAction }>> = {
      'WO-1001': [{ track: tid2('wo-1001-app'), action: { kind: 'absent', reason: 'pr_not_open' } }],
      'WO-1002': [{ track: tid2('wo-1002-app'), action: { kind: 'absent', reason: 'ci_not_green' } }],
      'WO-1003': [{ track: tid2('wo-1003-app'), action: { kind: 'absent', reason: 'pr_not_open' } }],
      'WO-1004': [{ track: tid2('wo-1004-app'), action: { kind: 'absent', reason: 'already_merged' } }],
      'WO-1005': [
        { track: tid2('wo-1005-api'), action: { kind: 'absent', reason: 'ci_not_green' } },
        { track: tid2('wo-1005-mobile'), action: { kind: 'absent', reason: 'depends_on_open' } },
      ],
      'WO-1006': [{ track: tid2('wo-1006-docs'), action: { kind: 'absent', reason: 'pr_not_open' } }],
    };
    it.each(IDS)('%s per-track merge action', (id) => {
      const w = wo(id);
      const got = w.tracks.map((t) => ({ track: t.id, action: deriveTrackMerge(w, t) }));
      expect(got).toEqual(cases[id]);
    });
  });

  describe('sessionForTrack — six states (per track)', () => {
    const tid2 = (s: string) => s as TrackId;
    const cases: Record<string, Array<{ track: TrackId; status: SessionRef['status'] | undefined }>> = {
      'WO-1001': [{ track: tid2('wo-1001-app'), status: 'stopped_asking' }],
      'WO-1002': [{ track: tid2('wo-1002-app'), status: 'idle' }],
      'WO-1003': [{ track: tid2('wo-1003-app'), status: undefined }],
      'WO-1004': [{ track: tid2('wo-1004-app'), status: undefined }],
      'WO-1005': [
        { track: tid2('wo-1005-api'), status: 'idle' },
        { track: tid2('wo-1005-mobile'), status: 'none' },
      ],
      'WO-1006': [{ track: tid2('wo-1006-docs'), status: 'running' }],
    };
    it.each(IDS)('%s resolves each track session', (id) => {
      const w = wo(id);
      const got = w.tracks.map((t) => ({ track: t.id, status: sessionForTrack(w, t.id)?.status }));
      expect(got).toEqual(cases[id]);
    });
  });

  describe('toCardView / toDetailView — six states', () => {
    const columns: Record<string, BoardColumn> = {
      'WO-1001': 'your_turn',
      'WO-1002': 'your_turn',
      'WO-1003': 'your_turn',
      'WO-1004': 'your_turn',
      'WO-1005': 'external',
      'WO-1006': 'running',
    };
    const reasons: Record<string, CardReason> = {
      'WO-1001': { kind: 'stopped_asking', gate: 'tool-permission' },
      'WO-1002': { kind: 'ci_failed', checkName: 'build' },
      'WO-1003': { kind: 'awaiting_plan_commit' },
      'WO-1004': { kind: 'docs_not_updated' },
      'WO-1005': { kind: 'ci_running' },
      'WO-1006': { kind: 'in_progress' },
    };
    const trackCounts: Record<string, number> = {
      'WO-1001': 1,
      'WO-1002': 1,
      'WO-1003': 1,
      'WO-1004': 1,
      'WO-1005': 2,
      'WO-1006': 1,
    };
    const sessionCounts: Record<string, number> = {
      'WO-1001': 1,
      'WO-1002': 1,
      'WO-1003': 1,
      'WO-1004': 1,
      'WO-1005': 2,
      'WO-1006': 1,
    };
    it.each(IDS)('%s card view (column + reason + trackCount + sessionCount)', (id) => {
      const card = toCardView(wo(id));
      expect(card.column).toBe(columns[id]);
      expect(card.reason).toEqual(reasons[id]);
      expect(card.trackCount).toBe(trackCounts[id]);
      expect(card.sessionCount).toBe(sessionCounts[id]);
    });
    it.each(IDS)('%s detail view (rail + tracks + primary action)', (id) => {
      const detail = toDetailView(wo(id));
      expect(detail.rail).toHaveLength(9);
      expect(detail.tracks).toHaveLength(trackCounts[id]);
      expect(detail.primaryAction).toEqual(derivePrimaryAction(wo(id)));
    });
  });
});

describe('deriveStage — stage derived from observed facts (TD-008 / ADR-0010)', () => {
  // No stage column is stored; the store hydrates `stage` from these facts. The six
  // fixtures are the seed, so the derivation must reproduce each one's stage exactly.
  it('reproduces every fixture work order stage from its observed facts', () => {
    for (const id of ['WO-1001', 'WO-1002', 'WO-1003', 'WO-1004', 'WO-1005', 'WO-1006'] as WorkOrderId[]) {
      const w = workOrderById.get(id)!;
      expect(deriveStage(w)).toBe(w.stage);
    }
  });

  it('plan not approved → architect_approval', () => {
    expect(deriveStage(aWorkOrder({ gateInputs: { planApproved: false } }))).toBe('architect_approval');
  });

  it('plan approved, a track still in flight → implementation', () => {
    expect(
      deriveStage(aWorkOrder({ gateInputs: { planApproved: true }, tracks: [aTrack({ id: 't1', repo: 'app' })] })),
    ).toBe('implementation');
  });

  it('all tracks merged + verified → closure; + closure sha → closed', () => {
    const merged = aTrack({ id: 't1', repo: 'app', merge: { at: 'now' } });
    expect(
      deriveStage(aWorkOrder({ gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true } }, tracks: [merged] })),
    ).toBe('closure');
    expect(
      deriveStage(
        aWorkOrder({ gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true }, closureDocsSha: 'abc' }, tracks: [merged] }),
      ),
    ).toBe('closed');
  });
});

describe('deriveTrackStage — track stage derived from pr/merge/scoped-session (ADR-0010 rule 2)', () => {
  // The store drops the track.stage column; stage is re-derived at hydration. The seven
  // fixture tracks are the contract — every stage must reproduce from its facts.
  it('reproduces every fixture track stage from its facts', () => {
    for (const w of workOrders) {
      for (const t of w.tracks) {
        const hasActive = w.sessions.some((s) => s.scope === t.id && s.status !== 'none');
        expect(deriveTrackStage(t, hasActive)).toBe(t.stage);
      }
    }
  });

  it('merge present → merged (even with a PR)', () => {
    expect(deriveTrackStage({ merge: { at: 'now' } }, true)).toBe('merged');
    expect(deriveTrackStage({ merge: { at: 'now' }, pr: { url: 'u', headSha: 's' } }, true)).toBe('merged');
  });

  it('PR open, no merge → ci', () => {
    expect(deriveTrackStage({ pr: { url: 'u', headSha: 's' } }, true)).toBe('ci');
    expect(deriveTrackStage({ pr: { url: 'u', headSha: 's' } }, false)).toBe('ci');
  });

  it('no PR, no merge: active scoped session → implementation; otherwise not_started', () => {
    expect(deriveTrackStage({}, true)).toBe('implementation');
    expect(deriveTrackStage({}, false)).toBe('not_started');
  });
});

describe('deriveWorkOrderCost — WO cost derived from sessions (ADR-0010 rule 2 / ROADMAP line 62)', () => {
  const c = (tokensIn: number, tokensOut: number, usd: number): CostSummary => ({ tokensIn, tokensOut, usd });

  it('an empty session list → zero', () => {
    expect(deriveWorkOrderCost([])).toEqual(c(0, 0, 0));
  });

  it("a single session → that session's cost", () => {
    expect(deriveWorkOrderCost([{ cost: c(100, 20, 0.42) }])).toEqual(c(100, 20, 0.42));
  });

  it('multiple sessions → sums tokens in/out and usd', () => {
    expect(
      deriveWorkOrderCost([{ cost: c(100, 20, 0.42) }, { cost: c(5, 5, 0.08) }, { cost: c(0, 0, 0) }]),
    ).toEqual(c(105, 25, 0.5));
  });

  it('a session with undefined cost (live row, pre-turn_complete) counts as zero, never NaN', () => {
    const sessions = [{ cost: c(100, 20, 0.42) }, {}, {}] as Array<Pick<SessionRef, 'cost'>>;
    expect(deriveWorkOrderCost(sessions)).toEqual(c(100, 20, 0.42));
  });

  it('counts all roles (implementer + architect + verifier)', () => {
    const sessions = (['implementer', 'architect', 'verifier'] as const).map((role) => ({
      role,
      cost: c(10, 10, 0.25),
    }));
    expect(deriveWorkOrderCost(sessions)).toEqual(c(30, 30, 0.75));
  });

  // Contract test — mirrors deriveStage's "reproduces every fixture stage" above. The six fixtures
  // are the seed, so the derivation must reproduce each one's cost from its sessions exactly.
  it('reproduces every fixture work order cost from its sessions', () => {
    for (const id of ['WO-1001', 'WO-1002', 'WO-1003', 'WO-1004', 'WO-1005', 'WO-1006'] as WorkOrderId[]) {
      const w = workOrderById.get(id)!;
      expect(deriveWorkOrderCost(w.sessions)).toEqual(w.cost);
    }
  });
});
