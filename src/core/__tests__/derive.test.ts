import { describe, expect, it } from 'vitest';
import { workOrderById, workOrders } from '../../adapters/fixtures';
import type {
  BoardColumn,
  CardReason,
  CostSummary,
  EvidenceKind,
  EvidenceStatus,
  PrimaryAction,
  RepoId,
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
  extractPointers,
  limitInEffect,
  nextManuelAction,
  overlayLiveDrive,
  sessionForTrack,
  toCardView,
  toDetailView,
  validateTrackDependencies,
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

  it('WO-0091: a stalled drive hands the card to the operator — up bucket, named reason, attention rank, no glyph', () => {
    const v = overlayLiveDrive(view, { running: true, booting: false, status: 'running', stall: { minutes: 12 } });
    expect(v.column).toBe('your_turn');
    expect(v.bucket).toBe('up');
    expect(v.reason).toEqual({ kind: 'stalled', minutes: 12 });
    expect(v.action).toBeUndefined(); // the card itself is the act — open it and decide; the gate never kills
    expect(v.actionRank).toBe(0); // beside the unanswered asks, above everything else
  });

  it('WO-0091: the boot window keeps the working overlay — a spawn is never a stall claim', () => {
    const v = overlayLiveDrive(view, { running: true, booting: true, status: 'idle', stall: { minutes: 12 } });
    expect(v.bucket).toBe('working');
    expect(v.reason).toEqual({ kind: 'in_progress' });
  });

  it('WO-0091: a stalled card in a closed archive is terminal — closed is never overlaid', () => {
    const closed = toCardView(aWorkOrder({ stage: 'closed', sessions: [] }));
    expect(overlayLiveDrive(closed, { running: true, booting: false, status: 'running', stall: { minutes: 12 } })).toBe(closed);
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

    // WO-0089 amends AC12's exempt arm: the exemption now needs a SUBSTITUTE. A CI-exempt track
    // with no local gate is refused (both-exempt is a hole, not a pass); the same track WITH a
    // measured-and-passed local gate merges (the substitute carries it — still not "passing").
    const exemptNoGate = aTrack({
      id: 'e',
      repo: 'r',
      ci: { kind: 'exempt', reason: 'no CI configured' },
      pr: { url: 'https://example/pull/1', headSha: 'deadbee' },
      dependsOn: [],
    });
    const w = aWorkOrder({ tracks: [exemptNoGate] });
    expect(deriveTrackMerge(w, exemptNoGate)).toEqual({ kind: 'absent', reason: 'local_gate_open' });

    const exemptGated = {
      ...exemptNoGate,
      localGate: { kind: 'declared', sha: 'deadbee', at: '2026-09-22T00:00:00Z', results: [{ command: 'npm test', exit: 0, expectExit: 0, tail: '' }] },
    };
    const wGate = aWorkOrder({ tracks: [exemptGated] });
    expect(deriveTrackMerge(wGate, exemptGated)).toEqual({ kind: 'available' });

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
    // WO-0069: every fixture but WO-1004 carries no verifier report — the gate input is undefined,
    // which is the new `unknown` arm ("we could not look"), not a miss. WO-1004's recorded claim
    // keeps its satisfied.
    const cases: Record<string, Pair[]> = {
      'WO-1001': [e('plan_approval', 'satisfied'), e('verification', 'unknown'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1002': [e('plan_approval', 'satisfied'), e('verification', 'unknown'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'unsatisfied')],
      'WO-1003': [e('plan_approval', 'unsatisfied'), e('verification', 'unknown'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1004': [e('plan_approval', 'satisfied'), e('verification', 'satisfied'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'satisfied')],
      'WO-1005': [e('plan_approval', 'satisfied'), e('verification', 'unknown'), e('closure', 'unsatisfied'), e('pr_open', 'satisfied'), e('ci_green', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'unsatisfied')],
      'WO-1006': [e('plan_approval', 'satisfied'), e('verification', 'unknown'), e('closure', 'unsatisfied'), e('pr_open', 'unsatisfied'), e('ci_green', 'exempt'), e('local_gate', 'exempt')],
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

// ===== WO-0069 — the gates observe: the unknown arms + the pointer extractor =====

// ADR-0010's two sentences, pinned per arm: an unknown never passes a gate, and it never renders
// (derives) as a failure — "we could not look" is its own state, not a miss.
describe('WO-0069 — the verification gate carries unknown', () => {
  const evidenceOf = (w: WorkOrder, kind: EvidenceKind): EvidenceStatus =>
    deriveEvidence(w).find((x) => x.kind === kind)!.status;

  it('no recorded verifier report → unknown (nothing was claimed)', () => {
    expect(evidenceOf(aWorkOrder({ gateInputs: { planApproved: true } }), 'verification')).toBe('unknown');
  });

  it('a recorded UNRESOLVABLE claim → unsatisfied (we looked and it missed) — byte-stable', () => {
    const w = aWorkOrder({ gateInputs: { planApproved: true, verifierReport: { resolvablePointers: false } } });
    expect(evidenceOf(w, 'verification')).toBe('unsatisfied');
  });

  it('a recorded RESOLVABLE claim → satisfied — byte-stable', () => {
    const w = aWorkOrder({ gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true } } });
    expect(evidenceOf(w, 'verification')).toBe('satisfied');
  });

  it('an unknown verification keeps the rail locked and naming its need', () => {
    const w = aWorkOrder({ stage: 'verification', gateInputs: { planApproved: true } });
    const step = deriveRail(w).find((s) => s.stage === 'verification')!;
    expect(step.status).toBe('locked');
    expect(step.needs).toEqual(['verification']);
  });

  it('a gate NEVER passes on unknown — deriveStage stays off closure', () => {
    const merged = aTrack({ id: 't1', repo: 'app', merge: { at: 'now' } });
    expect(deriveStage(aWorkOrder({ gateInputs: { planApproved: true }, tracks: [merged] }))).toBe('implementation');
    expect(
      deriveStage(aWorkOrder({ gateInputs: { planApproved: true, verifierReport: { resolvablePointers: false } }, tracks: [merged] })),
    ).toBe('implementation');
  });

  it('the primary action stays absent (verifier_report_missing) on unknown — unknown is not an available gate', () => {
    const w = aWorkOrder({ stage: 'verification', gateInputs: { planApproved: true } });
    expect(derivePrimaryAction(w)).toEqual({ kind: 'absent', reason: 'verifier_report_missing' });
  });
});

describe('WO-0069 — the track CI unknown arm (the degraded-scan hydration)', () => {
  const unknownCi = { kind: 'run' as const, state: 'unknown' as const, checks: [], reason: 'gh: Could not resolve to a Repository' };

  it('ci run-state unknown → ci_green unknown, and unknown is NOT an exemption', () => {
    const w = aWorkOrder({ tracks: [aTrack({ id: 't1', repo: 'app', ci: unknownCi })] });
    const item = deriveEvidence(w).find((x) => x.kind === 'ci_green')!;
    expect(item.status).toBe('unknown');
    expect(item.exemption).toBeUndefined();
  });

  it('a merge never passes on unknown CI — absent with ci_not_green', () => {
    const w = aWorkOrder({ tracks: [aTrack({ id: 't1', repo: 'app', pr: { url: 'u', headSha: 's' }, ci: unknownCi })] });
    expect(deriveTrackMerge(w, w.tracks[0]!)).toEqual({ kind: 'absent', reason: 'ci_not_green' });
  });

  it('unknown is neither a failure (your_turn via ci) nor an active run (external)', () => {
    const w = aWorkOrder({
      tracks: [aTrack({ id: 't1', repo: 'app', pr: { url: 'u', headSha: 's' }, ci: unknownCi })],
    });
    expect(whoseTurn(w)).toBe('your_turn'); // the gate still awaits an answer, not an error
    expect(deriveCardReason(w).kind).toBe('awaiting_next_session'); // never ci_failed
  });
});

// The pure half of the computed verification gate. The STORE resolves what this extracts against
// the WO's repo roots; the shapes pinned here are the contract between the two.
describe('extractPointers — the `path:line` token extractor (WO-0069)', () => {
  it('a plain separated path extracts', () => {
    expect(extractPointers('the mapping lives in src/core/derive.ts:116')).toEqual(['src/core/derive.ts:116']);
  });

  it('a backticked pointer unwraps — the wrap is markup, never part of the token', () => {
    expect(extractPointers('see `src/index.css:12` for the hover tokens')).toEqual(['src/index.css:12']);
  });

  it('a bare code file with a known extension counts, separator or not', () => {
    expect(extractPointers('the ladder lives in derive.ts:99 and notes in README.MD:2')).toEqual(['derive.ts:99', 'README.MD:2']);
  });

  it('multiple pointers preserve document order', () => {
    expect(extractPointers('a.md:1 first, then b/c.yaml:22')).toEqual(['a.md:1', 'b/c.yaml:22']);
  });

  it('duplicates collapse; the first position wins', () => {
    expect(extractPointers('src/a.ts:3 then again src/a.ts:3')).toEqual(['src/a.ts:3']);
  });

  it('URLs never extract, even when they carry :digits; a scheme-less host:port is prose', () => {
    expect(extractPointers('diff at https://github.com/o/r/blob/main/src/a.ts:12 served from localhost:3000')).toEqual([]);
  });

  it('a bare :digits and clock-like words have no path-like prefix — dropped', () => {
    expect(extractPointers('step 3: 42, the window 12:30, and see :7')).toEqual([]);
  });

  it('a path WITHOUT :line is not a pointer (the extractor claims nothing else)', () => {
    expect(extractPointers('the file src/core/derive.ts alone, or derive.ts without a line')).toEqual([]);
  });

  it('a Windows-ish backslash separator is tolerated (decided: yes, pinned)', () => {
    expect(extractPointers('see src\\core\\derive.ts:116')).toEqual(['src\\core\\derive.ts:116']);
  });

  it('a bare word before a colon is prose — Makefile:12 (no extension) rejects', () => {
    expect(extractPointers('Not: 12, Makefile:12, v1.2:3')).toEqual([]);
  });

  it('an absolute pointer extracts verbatim (the store checks it as itself)', () => {
    expect(extractPointers('/usr/local/lib/app.ts:8')).toEqual(['/usr/local/lib/app.ts:8']);
  });

  it('a ./-relative pointer extracts verbatim (the store normalizes the prefix away)', () => {
    expect(extractPointers('created in ./src/a.ts:4')).toEqual(['./src/a.ts:4']);
  });

  it('markdown noise around the pointer does not block it; a :line:column tail trims to :line', () => {
    expect(
      extractPointers('- [x] `docs/work-orders/WO-0069-m3-kuyrugu/order.md:14` — kapatıldı; also derive.ts:116:8'),
    ).toEqual(['docs/work-orders/WO-0069-m3-kuyrugu/order.md:14', 'derive.ts:116']);
  });

  it('an empty body extracts nothing', () => {
    expect(extractPointers('')).toEqual([]);
  });
});

// ===== WO-0071 — the depends_on write-side validator (pure, store runs it before any write) =====
describe('validateTrackDependencies (WO-0071)', () => {
  const rid = (s: string): RepoId => s as RepoId; // the builders.ts idiom (a cast, never a constructor)
  const repos = [rid('app'), rid('api'), rid('web')];

  it('absent input → [] (the pre-WO-0071 behavior byte-for-byte)', () => {
    expect(validateTrackDependencies(undefined, repos)).toEqual([]);
  });

  it('an empty list → []', () => {
    expect(validateTrackDependencies([], repos)).toEqual([]);
  });

  it('valid pairs → []', () => {
    expect(validateTrackDependencies([{ repo: rid('api'), dependsOn: [rid('app'), rid('web')] }], repos)).toEqual([]);
  });

  it('self-dependence is rejected (repo ∈ its own dependsOn)', () => {
    expect(validateTrackDependencies([{ repo: rid('app'), dependsOn: [rid('app')] }], repos)).toHaveLength(1);
    expect(validateTrackDependencies([{ repo: rid('app'), dependsOn: [rid('app')] }], repos)[0]).toContain('cannot depend on itself');
  });

  it('a dependsOn target outside the WO trackRepos is rejected', () => {
    const problems = validateTrackDependencies([{ repo: rid('api'), dependsOn: [rid('docs')] }], repos);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'docs'");
    expect(problems[0]).toContain("not one of this work order's tracks");
  });

  it('an entry naming a repo the WO does not track is rejected', () => {
    const problems = validateTrackDependencies([{ repo: rid('docs'), dependsOn: [rid('app')] }], repos);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'docs'");
  });

  it('a duplicate pair is rejected', () => {
    const input = [
      { repo: rid('api'), dependsOn: [rid('app')] },
      { repo: rid('api'), dependsOn: [rid('app')] },
    ];
    const problems = validateTrackDependencies(input, repos);
    expect(problems).toEqual([expect.stringContaining("duplicate dependency: 'api' -> 'app'")]);
  });

  it('every problem is reported — the store throws only the first', () => {
    const problems = validateTrackDependencies([{ repo: rid('app'), dependsOn: [rid('app'), rid('app'), rid('nope')] }], repos);
    // app→app = self; the repeat = self AGAIN + the duplicate pair; app→nope = unknown. 4 messages.
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('cannot depend on itself');
    expect(problems[2]).toContain('duplicate dependency');
    expect(problems[3]).toContain("'nope'");
  });
});

// ===== WO-0089 — the local gate: a CI exemption needs a substitute, not a hole =====
//
// Docket runs the workspace's declared gate commands ITSELF and records what it measured. The
// exempt-needs-substitute rule: a CI-exempt track must satisfy local_gate; both-exempt (CI
// exempt AND nothing declared) is a refusal state, not a pass. Unknown never passes (the Ci
// precedent): not-run and could-not-run are one non-passing state, distinct from measured-fail.
describe('the local gate (WO-0089)', () => {
  type LocalGate = import('../types').LocalGate;
  const gate = (results: Array<{ command: string; exit: number | null; expectExit?: number }>): LocalGate => ({
    kind: 'declared',
    sha: 'deadbee',
    at: '2026-09-22T00:00:00Z',
    results: results.map((r) => ({ tail: '', expectExit: 0, ...r, ...(r.expectExit !== undefined ? {} : {}) }) as import('../types').GateCommandResult),
  });
  const exemptTrack = (localGate?: LocalGate) =>
    aTrack({
      id: 'e',
      repo: 'r',
      ci: { kind: 'exempt', reason: 'no CI configured' },
      pr: { url: 'https://example/pull/1', headSha: 'deadbee' },
      dependsOn: [],
      ...(localGate !== undefined ? { localGate } : {}),
    });
  const mergedExempt = (localGate?: LocalGate) =>
    aWorkOrder({
      tracks: [
        {
          ...exemptTrack(localGate),
          merge: { at: '2026-09-22T01:00:00Z' },
        },
      ],
      gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true }, closureDocsSha: 'closure-sha' },
    });

  it('acceptance 1 — an exempt track with the substitute unsatisfied cannot reach the verification gate (stage stays implementation)', () => {
    expect(deriveStage(mergedExempt(gate([{ command: 'npm test', exit: 1 }])))).toBe('implementation');
  });

  it('acceptance 1 — not-run is the same refusal (unknown never passes)', () => {
    expect(deriveStage(mergedExempt({ kind: 'pending' }))).toBe('implementation');
  });

  it('acceptance 1 — both-exempt (nothing declared) is a refusal state, not a pass', () => {
    expect(deriveStage(mergedExempt(undefined))).toBe('implementation');
    expect(deriveStage(mergedExempt({ kind: 'invalid', reason: 'gate.commands: empty' }))).toBe('implementation');
  });

  it('acceptance 1 — with the substitute measured-and-passed the WO advances (closed)', () => {
    expect(deriveStage(mergedExempt(gate([{ command: 'npm test', exit: 0 }])))).toBe('closed');
  });

  it('acceptance 1 — could-not-run (exit null) never passes even when no command failed', () => {
    expect(deriveStage(mergedExempt(gate([{ command: 'npm test', exit: 0 }, { command: 'npm run build', exit: null }])))).toBe('implementation');
  });

  it('the exempt merge needs the substitute — deriveTrackMerge refuses without it (the rule this WO exists for)', () => {
    const w = aWorkOrder({ tracks: [exemptTrack()] });
    expect(deriveTrackMerge(w, w.tracks[0]!)).toEqual({ kind: 'absent', reason: 'local_gate_open' });
    const failed = aWorkOrder({ tracks: [exemptTrack(gate([{ command: 'npm test', exit: 1 }]))] });
    expect(deriveTrackMerge(failed, failed.tracks[0]!)).toEqual({ kind: 'absent', reason: 'local_gate_open' });
    const passed = aWorkOrder({ tracks: [exemptTrack(gate([{ command: 'npm test', exit: 0 }]))] });
    expect(deriveTrackMerge(passed, passed.tracks[0]!)).toEqual({ kind: 'available' });
  });

  it('acceptance 2 — a measured non-zero exit is unsatisfied (measured-and-failed), distinct from not-run (unknown); neither passes', () => {
    const failed = deriveEvidence(aWorkOrder({ tracks: [exemptTrack(gate([{ command: 'npm test', exit: 1 }]))] })).find((e) => e.kind === 'local_gate')!;
    expect(failed.status).toBe('unsatisfied');
    const pending = deriveEvidence(aWorkOrder({ tracks: [exemptTrack({ kind: 'pending' })] })).find((e) => e.kind === 'local_gate')!;
    expect(pending.status).toBe('unknown');
    const couldNotRun = deriveEvidence(aWorkOrder({ tracks: [exemptTrack(gate([{ command: 'npm test', exit: null }]))] })).find((e) => e.kind === 'local_gate')!;
    expect(couldNotRun.status).toBe('unknown');
  });

  it('a non-zero expect_exit is satisfied by its own expected exit (the declaration, not zero, is the contract)', () => {
    const w = aWorkOrder({
      tracks: [exemptTrack(gate([{ command: 'grep -r TODO src', exit: 1, expectExit: 1 }]))],
    });
    expect(deriveEvidence(w).find((e) => e.kind === 'local_gate')!.status).toBe('satisfied');
    expect(deriveTrackMerge(w, w.tracks[0]!)).toEqual({ kind: 'available' });
  });

  it('the local_gate item sits BESIDE ci_green on an exempt track — the undeclared face is exempt, with a reason-shaped absence', () => {
    const items = deriveEvidence(aWorkOrder({ tracks: [exemptTrack()] })).filter((e) => e.scope !== undefined);
    expect(items.map((e) => e.kind)).toEqual(['pr_open', 'ci_green', 'local_gate']);
    expect(items[2]).toEqual({ kind: 'local_gate', status: 'exempt', scope: items[2]!.scope });
  });

  it('a declared gate shows beside ci_green on a CI-RUN track too — and a FAILED gate there does not block the merge (CI keeps its mechanical evidence)', () => {
    const track = aTrack({
      id: 'c',
      repo: 'r',
      ci: { kind: 'run', state: 'success', checks: [{ name: 'build', conclusion: 'success' }] },
      pr: { url: 'https://example/pull/3', headSha: 'feedface' },
      dependsOn: [],
      localGate: gate([{ command: 'npm test', exit: 1 }]),
    });
    const w = aWorkOrder({ tracks: [track] });
    const items = deriveEvidence(w).filter((e) => e.scope !== undefined);
    expect(items.map((e) => e.kind)).toEqual(['pr_open', 'ci_green', 'local_gate']);
    expect(items[2]!.status).toBe('unsatisfied');
    expect(deriveTrackMerge(w, track)).toEqual({ kind: 'available' }); // CI is the mechanical evidence here
    expect(deriveStage({ ...w, gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true }, closureDocsSha: 's' } })).toBe('implementation'); // not merged — unchanged by the gate
  });

  it('acceptance 5 — a workspace declaring nothing behaves exactly as today: no local_gate item on a CI-run track, the merge follows CI alone', () => {
    const track = aTrack({
      id: 'n',
      repo: 'r',
      ci: { kind: 'run', state: 'success', checks: [] },
      pr: { url: 'https://example/pull/4', headSha: 'cafef00d' },
      dependsOn: [],
    });
    const w = aWorkOrder({ tracks: [track] });
    const items = deriveEvidence(w).filter((e) => e.scope !== undefined);
    expect(items.map((e) => e.kind)).toEqual(['pr_open', 'ci_green']); // byte-identical to the pre-WO-0089 shape
    expect(deriveTrackMerge(w, track)).toEqual({ kind: 'available' });
  });

  it('an invalid declaration is unknown on the evidence row — never exempt, never a pass', () => {
    const items = deriveEvidence(aWorkOrder({ tracks: [exemptTrack({ kind: 'invalid', reason: 'gate.commands: empty' })] }));
    const lg = items.find((e) => e.kind === 'local_gate')!;
    expect(lg.status).toBe('unknown');
  });
});
