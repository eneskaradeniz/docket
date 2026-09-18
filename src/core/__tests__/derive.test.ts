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
  StepView,
  StageStatus,
  TrackId,
  TrackMergeAction,
  WorkOrder,
  WorkOrderId,
} from '../types';
import {
  appbarDriveTier,
  deriveBucket,
  deriveCardAction,
  deriveCardActionRank,
  deriveCardReason,
  deriveEvidence,
  derivePrimaryAction,
  deriveRail,
  deriveStage,
  deriveTrackMerge,
  deriveTrackStage,
  deriveWorkOrderCost,
  limitInEffect,
  nextManuelAction,
  overlayLiveDrive,
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

// 2026-08-24 (operator, live run): a STOPPED session row is its own reason — the drive resumes, it
// did not end. Without this the card fell to the gate reasons and said "Plan onayı bekleniyor"
// over a plan that does not exist.
describe('deriveCardReason — a stopped session row (2026-08-24)', () => {
  const stopped = aWorkOrder({
    stage: 'architect_approval',
    gateInputs: { planApproved: false },
    sessions: [aSession({ role: 'architect', status: 'stopped' })],
  });

  it('the card says the session was stopped, not that a plan awaits approval', () => {
    expect(deriveCardReason(stopped)).toEqual({ kind: 'session_stopped' });
  });

  it('a RUNNING session still outranks the old stop (in_progress wins)', () => {
    const mixed = aWorkOrder({ ...stopped, sessions: [...stopped.sessions, aSession({ role: 'implementer', status: 'running' })] });
    expect(deriveCardReason(mixed).kind).toBe('in_progress');
  });
});

describe('deriveCardReason — freshly written work order (WO-0015)', () => {
  it('a just-written WO (stage written, no sessions) → just_written', () => {
    const w = aWorkOrder({ stage: 'written', sessions: [], gateInputs: { planApproved: false } });
    expect(deriveCardReason(w)).toEqual({ kind: 'just_written' });
  });

  it('a just-written WO derives the request_plan action (▸ Plan iste)', () => {
    const w = aWorkOrder({ stage: 'written', sessions: [], gateInputs: { planApproved: false } });
    expect(deriveCardAction(w)).toEqual({ kind: 'link', intent: 'request_plan' });
  });
});

describe('closable card signal (WO-0031e tur-3)', () => {
  // `closeable` is the canClose predicate over the step rows, derived by the adapter at hydrate
  // (the stage/cost precedent — never stored). Core only ever reads the flag.
  it('a closable WO exposes closable on the card and the closure action (▸ Kapatılabilir)', () => {
    const w = aWorkOrder({ closeable: true, sessions: [] });
    expect(toCardView(w).closable).toBe(true);
    expect(deriveCardAction(w)).toEqual({ kind: 'closure', intent: 'close' });
  });

  it('without the flag the card is not closable and the action is unchanged', () => {
    const w = aWorkOrder({ stage: 'written', sessions: [], gateInputs: { planApproved: false } });
    expect(toCardView(w).closable).toBe(false);
    expect(deriveCardAction(w)).toEqual({ kind: 'link', intent: 'request_plan' });
  });

  it('a working state outranks closable — no inline action while CI runs', () => {
    const w = { ...wo('WO-1005'), closeable: true };
    expect(deriveCardReason(w).kind).toBe('ci_running');
    expect(deriveCardAction(w)).toBeUndefined();
    expect(toCardView(w).closable).toBe(true);
  });

  it('a stopped_asking session outranks closable — the permission action wins', () => {
    const w = aWorkOrder({
      closeable: true,
      sessions: [aSession({ role: 'implementer', status: 'stopped_asking', stopAndAsk: { question: 'devam mı?', gate: 'g' } })],
    });
    expect(deriveCardAction(w)).toEqual({ kind: 'permission', intent: 'resume' });
  });

  // Pre-merge (operator tour of PR #37): the real archive showed CLOSED cards claiming
  // ▸ Kapatılabilir + "Sonraki oturum bekleniyor" — both impossible states for a closed WO.
  it('a CLOSED work order is never closable — the archive card carries no closure action', () => {
    const w = aWorkOrder({ closeable: true, stage: 'closed', sessions: [] });
    expect(toCardView(w).closable).toBe(false);
    expect(deriveCardAction(w)).toBeUndefined();
  });

  it('a CLOSED work order reason is the done line — never "Sonraki oturum bekleniyor"', () => {
    expect(deriveCardReason(aWorkOrder({ stage: 'closed', sessions: [] }))).toEqual({ kind: 'closed' });
  });
});

// base-mobile trial (2026-08-21): the plan drive ran its whole course in the board's "Sıra sende"
// bucket — whoseTurn checked unsatisfied gates BEFORE the running session, and during the plan drive
// the gate is unsatisfied BECAUSE the session is still working toward it. A running session is the
// actor on the WO; the operator's turn over a gated stage resumes when the session ends or stops to ask.
describe('a running session outranks unsatisfied gates (base-mobile trial)', () => {
  const planDrive = aWorkOrder({
    stage: 'architect_approval',
    sessions: [aSession({ role: 'architect', status: 'running' })],
    gateInputs: { planApproved: false },
  });

  it('whoseTurn: the plan drive is running, not your_turn', () => {
    expect(whoseTurn(planDrive)).toBe('running');
  });

  it('the card lands in the working bucket and says in_progress, not awaiting_plan_commit', () => {
    expect(toCardView(planDrive).bucket).toBe('working');
    expect(deriveCardReason(planDrive).kind).toBe('in_progress');
  });

  it('a working card carries no inline action', () => {
    expect(deriveCardAction(planDrive)).toBeUndefined();
  });

  it('a stopped_asking session still outranks the gate (the ask is the operator\'s)', () => {
    const w = aWorkOrder({
      stage: 'architect_approval',
      sessions: [aSession({ role: 'architect', status: 'stopped_asking', stopAndAsk: { question: 'devam mı?', gate: 'g' } })],
      gateInputs: { planApproved: false },
    });
    expect(whoseTurn(w)).toBe('your_turn');
    expect(deriveCardReason(w).kind).toBe('stopped_asking');
  });

  it('a finished plan drive returns to the operator — the gate speaks again', () => {
    const w = aWorkOrder({
      stage: 'architect_approval',
      sessions: [aSession({ role: 'architect', status: 'idle' })],
      gateInputs: { planApproved: false },
    });
    expect(whoseTurn(w)).toBe('your_turn');
    expect(deriveCardReason(w).kind).toBe('awaiting_plan_commit');
  });
});

// base-mobile trial (2026-08-22): the board derives from store rows, and the session row is written
// only when the provider's first event arrives — so the boot window (and any rows-lag moment, e.g.
// after an answered ask) left the card in "Sıra sende" while work was in flight. The app's drive
// memory overlays the card view; these pin the overlay's exact contract.
describe('overlayLiveDrive — the board is live from the click (base-mobile trial)', () => {
  const fresh = aWorkOrder({ stage: 'written', sessions: [], gateInputs: { planApproved: false } });
  const view = toCardView(fresh); // up bucket, ▸ Plan iste

  it('no live fact → the view passes through untouched (same identity)', () => {
    expect(overlayLiveDrive(view, undefined)).toBe(view);
  });

  it('the boot window (running, booting, fold idle) → the card works from the click', () => {
    const v = overlayLiveDrive(view, { running: true, booting: true, status: 'idle' });
    expect(v.bucket).toBe('working');
    expect(v.column).toBe('running');
    expect(v.reason).toEqual({ kind: 'in_progress' });
    expect(v.action).toBeUndefined();
    expect(v.actionRank).toBe(4); // deriveCardActionRank(undefined) — never a stale rows rank
  });

  it('a rows-lag mid-drive (fold running) overlays the same way', () => {
    const v = overlayLiveDrive(view, { running: true, booting: false, status: 'running' });
    expect(v.bucket).toBe('working');
    expect(v.reason).toEqual({ kind: 'in_progress' });
  });

  it('held asks / proposed plan / fold-end / error → no-op (the rows own those moments)', () => {
    for (const status of ['stopped_asking', 'plan_ready', 'done', 'error'] as const) {
      expect(overlayLiveDrive(view, { running: true, booting: false, status })).toBe(view);
    }
  });

  it('a drive that ended (running false) never overlays, whatever the fold says', () => {
    for (const status of ['idle', 'running', 'done'] as const) {
      expect(overlayLiveDrive(view, { running: false, booting: false, status })).toBe(view);
    }
  });

  it('a closed archive card is never overlaid — closed is terminal', () => {
    const closed = toCardView(aWorkOrder({ stage: 'closed', sessions: [] }));
    expect(closed.bucket).toBe('closed');
    expect(overlayLiveDrive(closed, { running: true, booting: true, status: 'idle' })).toBe(closed);
  });

  it('the overlay carries every row fact through (id/title/cost/duration/sessionCount)', () => {
    const w = aWorkOrder({
      stage: 'architect_approval',
      sessions: [
        aSession({
          role: 'architect',
          status: 'idle',
          cost: { tokensIn: 1, tokensOut: 2, usd: 0.5 },
          startedAt: '2026-08-21T10:00:00Z',
          endedAt: '2026-08-21T10:01:00Z',
        }),
      ],
      gateInputs: { planApproved: false },
      cost: { tokensIn: 1, tokensOut: 2, usd: 0.5 },
    });
    const base = toCardView(w);
    const v = overlayLiveDrive(base, { running: true, booting: true, status: 'idle' });
    expect(v.id).toBe(base.id);
    expect(v.title).toBe(base.title);
    expect(v.cost).toBe(base.cost);
    expect(v.durationMs).toBe(base.durationMs);
    expect(v.sessionCount).toBe(base.sessionCount);
  });

  it('a live session outranks external CI — in_progress, not ci_running (a decision, not an accident)', () => {
    const base = toCardView(wo('WO-1005')); // CI running → external column, working bucket
    expect(base.reason.kind).toBe('ci_running');
    const v = overlayLiveDrive(base, { running: true, booting: false, status: 'running' });
    expect(v.column).toBe('running');
    expect(v.reason).toEqual({ kind: 'in_progress' });
  });
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

describe("whoseTurn — a fresh track's seeded CI is not 'external' (WO-0027 / TD-024)", () => {
  it('no PR + no sessions → your_turn even though the seeded ci claims running', () => {
    const wo = aWorkOrder({ tracks: [aTrack({ id: 't1', repo: 'app', ci: { kind: 'run', state: 'running', checks: [] } })], sessions: [] });
    expect(whoseTurn(wo)).toBe('your_turn');
  });
  it('a real PR with running CI stays external', () => {
    const wo = aWorkOrder({
      tracks: [aTrack({ id: 't1', repo: 'app', ci: { kind: 'run', state: 'running', checks: [] }, pr: { url: 'https://x', headSha: 's' } })],
      sessions: [],
    });
    expect(whoseTurn(wo)).toBe('external');
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

  it('no sessions and plan not approved → written (just authored, WO-0015)', () => {
    expect(deriveStage(aWorkOrder({ gateInputs: { planApproved: false }, sessions: [] }))).toBe('written');
  });

  it('plan not approved but a session exists → architect_approval', () => {
    expect(
      deriveStage(aWorkOrder({ gateInputs: { planApproved: false }, sessions: [aSession({ role: 'architect', status: 'idle' })] })),
    ).toBe('architect_approval');
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

// WO-0031f T3 / AC7 — the card Süre is the session-sum (the same arithmetic the strip and the audit
// total speak), so the card, the strip and the Toplam row can never disagree. Drawn only when > 0.
describe('toCardView durationMs — card Süre is the finished-session sum (WO-0031f T3 / AC7)', () => {
  const T = (h: number, min = 0): string =>
    `2026-08-18T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`;
  const cardOf = (sessions: SessionRef[]): number =>
    toCardView(aWorkOrder({ sessions: sessions as SessionRef[] })).durationMs;

  it('zero sessions → 0', () => {
    expect(cardOf([])).toBe(0);
  });

  it('a live-only session (startedAt, no endedAt) counts as 0, never NaN', () => {
    expect(cardOf([aSession({ role: 'implementer', startedAt: T(9) })])).toBe(0);
  });

  it('sessions without any dates count as 0, never NaN', () => {
    expect(cardOf([aSession({ role: 'implementer' }), aSession({ role: 'architect' })])).toBe(0);
  });

  it('multiple finished sessions → sums (6min + 1min = 7min)', () => {
    expect(
      cardOf([
        aSession({ role: 'implementer', startedAt: T(9), endedAt: T(9, 6) }),
        aSession({ role: 'architect', startedAt: T(10), endedAt: T(10, 1) }),
      ]),
    ).toBe(7 * 60_000);
  });

  it('counts all roles — the strip and the audit total count them all', () => {
    expect(
      cardOf(
        (['implementer', 'architect', 'verifier'] as const).map((role) =>
          aSession({ role, startedAt: T(9), endedAt: T(9, 1) }),
        ),
      ),
    ).toBe(3 * 60_000);
  });

  it('a negative span (ended before started) clamps to 0, never negative', () => {
    expect(cardOf([aSession({ role: 'implementer', startedAt: T(9, 6), endedAt: T(9) })])).toBe(0);
  });

  // Contract loop — the fixtures carry no session dates, so every fixture card draws no Süre (the
  // "drawn only when > 0" rule); the loop also pins never-NaN across all six states.
  it('every fixture card (no dated sessions) → 0', () => {
    for (const w of workOrders) {
      expect(toCardView(w).durationMs).toBe(0);
    }
  });
});

describe('deriveBucket + card action — board buckets (WO-0013)', () => {
  describe('deriveBucket', () => {
    it('closed stage → closed', () => {
      expect(deriveBucket({ column: 'your_turn', stage: 'closed' })).toBe('closed');
      expect(deriveBucket({ column: 'running', stage: 'closed' })).toBe('closed');
    });
    it('running/external column → working (external work folds into working)', () => {
      expect(deriveBucket({ column: 'running', stage: 'implementation' })).toBe('working');
      expect(deriveBucket({ column: 'external', stage: 'implementation' })).toBe('working');
    });
    it('your_turn, not closed → up', () => {
      expect(deriveBucket({ column: 'your_turn', stage: 'implementation' })).toBe('up');
      expect(deriveBucket({ column: 'your_turn', stage: 'architect_approval' })).toBe('up');
    });
  });

  describe('deriveCardAction', () => {
    it('stopped-asking session → permission', () => {
      expect(deriveCardAction(wo('WO-1001'))).toEqual({ kind: 'permission', intent: 'resume' });
    });
    it('a running session → undefined (working — no inline action)', () => {
      expect(deriveCardAction(wo('WO-1006'))).toBeUndefined();
    });
    it('ci running (external) → undefined', () => {
      expect(deriveCardAction(wo('WO-1005'))).toBeUndefined();
    });
    it('an unsatisfied gate (absent primary) → undefined', () => {
      expect(deriveCardAction(wo('WO-1003'))).toBeUndefined();
    });
    it('ci failed at implementation → link/resume', () => {
      expect(deriveCardAction(wo('WO-1002'))).toEqual({ kind: 'link', intent: 'resume' });
    });
    it('plan_ready (available primary) → plan/approve_plan', () => {
      expect(deriveCardAction(aWorkOrder({ stage: 'plan_ready' }))).toEqual({ kind: 'plan', intent: 'approve_plan' });
    });
    it('closure with docs satisfied → closure/close', () => {
      const w = aWorkOrder({
        stage: 'closure',
        gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true }, closureDocsSha: 'abc' },
      });
      expect(deriveCardAction(w)).toEqual({ kind: 'closure', intent: 'close' });
    });
  });

  it('deriveCardActionRank — permission < plan < closure < link < none', () => {
    const perm = deriveCardActionRank({ kind: 'permission', intent: 'resume' });
    const plan = deriveCardActionRank({ kind: 'plan', intent: 'approve_plan' });
    const closure = deriveCardActionRank({ kind: 'closure', intent: 'close' });
    const link = deriveCardActionRank({ kind: 'link', intent: 'resume' });
    const none = deriveCardActionRank(undefined);
    expect(perm).toBeLessThan(plan);
    expect(plan).toBeLessThan(closure);
    expect(closure).toBeLessThan(link);
    expect(link).toBeLessThan(none);
  });

  it('toCardView carries bucket + action + role on the fixtures', () => {
    const c1001 = toCardView(wo('WO-1001'));
    expect(c1001.bucket).toBe('up');
    expect(c1001.action).toEqual({ kind: 'permission', intent: 'resume' });
    expect(c1001.role).toBe('implementer');
    const c1006 = toCardView(wo('WO-1006'));
    expect(c1006.bucket).toBe('working');
    expect(c1006.action).toBeUndefined();
    expect(c1006.role).toBe('implementer');
  });
});

describe('nextManuelAction — what the manuel card offers (WO-0045)', () => {
  const step = (idx: number, status: 'pending' | 'active' | 'done' | 'blocked', verdict?: 'proceed' | 'revise'): StepView =>
    ({ idx, role: 'implementer', aim: `adım ${idx}`, scope: { kind: 'all' }, status, ...(verdict ? { verdict } : {}) });
  it('a done-without-verdict step offers its REVIEW first — the denetim leg precedes', () => {
    expect(nextManuelAction([step(1, 'done'), step(2, 'pending')])).toEqual({ kind: 'review', idx: 1 });
  });
  it('all reviewed → the first PENDING step', () => {
    expect(nextManuelAction([step(1, 'done', 'proceed'), step(2, 'pending'), step(3, 'pending')])).toEqual({ kind: 'step', idx: 2 });
  });
  it('an ACTIVE step owns the flow — no card, even with a later pending step (Sürdür lives in DriveControls)', () => {
    expect(nextManuelAction([step(1, 'done', 'proceed'), step(2, 'active')])).toBeUndefined();
    expect(nextManuelAction([step(1, 'active'), step(2, 'pending')])).toBeUndefined();
  });
  it('nothing left to offer → undefined', () => {
    expect(nextManuelAction([step(1, 'done', 'revise')])).toBeUndefined();
    expect(nextManuelAction([])).toBeUndefined();
  });
});

// WO-0053 (verifier's closure gap): the board reason's limit arm — precedence pinned in core,
// the way ADR-0006 demands (the e2e saw the line; the RULE lived untested).
describe('deriveCardReason — the limit_stopped arm (WO-0053)', () => {
  const stamped = aWorkOrder({
    sessions: [aSession({ role: 'implementer', status: 'idle', providerSessionId: 's-l', limitResetAt: '2026-08-29T14:32:00.000Z' })],
  });
  it('a stamped row yields the limit reason with its clock', () => {
    expect(deriveCardReason(stamped)).toEqual({ kind: 'limit_stopped', resetAt: '2026-08-29T14:32:00.000Z' });
  });
  it('a STOPPED row still outranks — the operator’s Durdur is the last real event (the seed boundary’s rule)', () => {
    const both = aWorkOrder({
      sessions: [
        aSession({ role: 'implementer', status: 'stopped', providerSessionId: 's-x', limitResetAt: '2026-08-29T14:32:00.000Z' }),
      ],
    });
    expect(deriveCardReason(both)).toEqual({ kind: 'session_stopped' });
  });
  it('a RUNNING session outranks too — it is working, not waiting on a clock', () => {
    const both = aWorkOrder({
      sessions: [
        aSession({ role: 'implementer', status: 'running', providerSessionId: 's-r', limitResetAt: '2026-08-29T14:32:00.000Z' }),
      ],
    });
    expect(deriveCardReason(both)).toEqual({ kind: 'in_progress' });
  });
  it('a cleared stamp reverts to the ordinary reasons (the clean leg’s honest revert)', () => {
    const clean = aWorkOrder({
      sessions: [aSession({ role: 'implementer', status: 'idle', providerSessionId: 's-c' })],
    });
    expect(deriveCardReason(clean)).toEqual({ kind: 'awaiting_next_session' }); // no limit arm fires
  });
});

// WO-0060: the appbar chip's two core facts. `limitInEffect` scans the ACCOUNT's session rows (the
// provider limit is an account fact, not a WO fact); only stamps that PARSE and are strictly future
// count — a past stamp is already healed, a garbage stamp is not a claim. `appbarDriveTier` is the
// LOCKED ladder (red > amber > green > none) as one core rule, the way deriveTurnState owns the
// header band's.
describe('limitInEffect (WO-0060)', () => {
  const NOW = Date.parse('2026-08-31T12:00:00.000Z');
  const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
  const row = (limitResetAt?: string) => [aSession({ role: 'implementer', status: 'idle', providerSessionId: 's-1', ...(limitResetAt !== undefined ? { limitResetAt } : {}) })];

  it('no rows, no live stamp → undefined', () => {
    expect(limitInEffect([], undefined, NOW)).toBeUndefined();
  });
  it('a single future row → that stamp', () => {
    expect(limitInEffect(row(at(60_000)), undefined, NOW)).toBe(at(60_000));
  });
  it('only past rows → undefined (self-healing — a crossed clock is not a limit)', () => {
    expect(limitInEffect(row(at(-60_000)), undefined, NOW)).toBeUndefined();
  });
  it('several future rows → the max', () => {
    expect(limitInEffect(row(at(60_000)).concat(row(at(300_000))), undefined, NOW)).toBe(at(300_000));
  });
  it('past + future mix → the future one', () => {
    expect(limitInEffect(row(at(-60_000)).concat(row(at(120_000))), undefined, NOW)).toBe(at(120_000));
  });
  it('live + rows → the max (a live EARLIER stamp must not mask a later row stamp)', () => {
    expect(limitInEffect(row(at(600_000)), at(60_000), NOW)).toBe(at(600_000));
    expect(limitInEffect(row(at(60_000)), at(600_000), NOW)).toBe(at(600_000));
  });
  it('live alone, zero rows → live (the ✦ draft arm — a draft has no WO sessions)', () => {
    expect(limitInEffect([], at(60_000), NOW)).toBe(at(60_000));
  });
  it('an unparseable stamp mixed with a real one → ignored, the real future stamp wins', () => {
    expect(limitInEffect(row('not-a-date').concat(row(at(60_000))), undefined, NOW)).toBe(at(60_000));
  });
  it('an unparseable stamp alone → undefined (garbage is not a claim)', () => {
    expect(limitInEffect(row('not-a-date'), undefined, NOW)).toBeUndefined();
  });
  it('nowMs === stamp → undefined (strictly future — the boundary is already healed)', () => {
    expect(limitInEffect(row(at(0)), undefined, NOW)).toBeUndefined();
  });
  it('empty-string and absent stamps are skipped', () => {
    expect(limitInEffect(row(''), undefined, NOW)).toBeUndefined();
    expect(limitInEffect([aSession({ role: 'implementer', status: 'idle', providerSessionId: 's-2' })], '', NOW)).toBeUndefined();
  });
});

describe('appbarDriveTier (WO-0060)', () => {
  const NOW = Date.parse('2026-08-31T12:00:00.000Z');
  const future = new Date(NOW + 300_000).toISOString();
  const past = new Date(NOW - 300_000).toISOString();

  it('the ladder: a waiting limit outranks warn, warn outranks running', () => {
    expect(appbarDriveTier({ running: true, limitResetAt: future, warn: true }, NOW)).toBe('limit');
    expect(appbarDriveTier({ running: false, limitResetAt: future, warn: false }, NOW)).toBe('limit');
    expect(appbarDriveTier({ running: true, warn: true }, NOW)).toBe('warn');
    expect(appbarDriveTier({ running: true, warn: false }, NOW)).toBe('running');
    expect(appbarDriveTier({ running: false, warn: false }, NOW)).toBe('none');
  });
  it('the hand-over: a crossed stamp + a running drive → running (the limit no longer claims)', () => {
    expect(appbarDriveTier({ running: true, limitResetAt: past, warn: false }, NOW)).toBe('running');
  });
  it('a warn signal without a running drive → none (amber rides the live fold; no fold, no amber)', () => {
    expect(appbarDriveTier({ running: false, warn: true }, NOW)).toBe('none');
  });
});
