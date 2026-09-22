// src/core/pipeline.ts — the host-agnostic session-drive orchestration (WO-0023).
//
// The drive loop — assemble the first prompt, run the session, capture reports/verdicts, persist live state —
// used to live inline in electron/main.ts, tangled with IPC, untested. That is why the P1-1 review-corrupts-
// plan.md bug shipped. This module is the same loop, lifted into core over injected ports, so it is testable
// with a FakeRunner + FakeStore (ADR-0006 line 30: "the product's rules are testable without … an agent").
//
// Two hosts inject adapters + a permission policy: the Electron main process (askOperatorPolicy — surfaces a
// permission_request and awaits the operator's decide) and, later, a CLI (autoAllow/declarative — WO-0024).
// Plan approval stays a host concern (it already lived outside the drive loop, in WorkOrderSource.approvePlan).
//
// The host contributes only `cwd` (the renderer cannot know filesystem paths) + the permission policy. Every
// RunnerEvent the runner yields is re-yielded to the host so the existing UI fold (foldSessionEvent) is
// unchanged; the persistence side-effects ride alongside, exactly as main.ts used to do.

import type { CostSummary, SessionRef, SteerNote, TurnUsage } from './types';
import { ASK_TOOL } from './askq';
import { PLAN_EXIT_WITHOUT_RESULT, driveOwnerTag, foldSessionEvent, initialSessionState, isDraftDrive } from './runner';
import type { DraftDriveInput, DriveInput, LiveSessionState, PermissionDecision, RunnerEvent, SessionRunner, WoDriveInput } from './runner';
import type { SessionOwner, SessionStore } from './session-store';
import type { DraftSourceSummary } from './roadmap-draft';
import { parseVerdict } from './verdict';
import { isRiskyPermission } from './risky';
import type { PermissionRule } from './source';

/**
 * Fill the first prompt + track scope server-side, from the decision store. The renderer never parses
 * document text (ADR-0007). The DRAFT arm runs first and fills a missing prompt even on a resume (the
 * unreadable draft's no-note Sürdür; a note or any non-empty prompt is untouched) — a draft would
 * otherwise fall into `architectPromptFor` with no WO. The WO arms keep the WO-0023 / P1-1 order: a drive
 * that carries a `resume` id or a non-empty `prompt` (approve / object / reply / step-resume) is left
 * untouched; otherwise REVIEW before STEP before the pure architect PLAN — the old code matched
 * `role==='architect'` first and clobbered review/step drives with the plan prompt. Pure-ish: reads via
 * the injected store port, no side effects.
 */
export function prepareDriveInput(input: DriveInput, store: SessionStore): DriveInput {
  // WO-0050 / D5: ONE mechanism — the store contributes the workspace facts, core's
  // roadmapDraftPrompt builds the text (paths, never contents). WO-0051 / D5: the keşif
  // opt-in rides along as the fourth arg (undefined = the ordinary deterministic prompt).
  // Dogfood 2026-08-29 (the unreadable draft's Sürdür): a draft resume with NO prompt of its
  // own is filled too — the architect's standing draft instruction IS the continue message
  // (the operator invents no words); an İtiraz note or any non-empty prompt is left untouched.
  if (isDraftDrive(input)) {
    if (input.prompt) return { ...input };
    const p = store.roadmapDraftPromptFor(input.workspaceId, input.goalNote, input.docPaths, input.freeExplore === true ? true : undefined);
    return p ? { ...input, prompt: p } : { ...input };
  }
  if (input.resume || input.prompt) return { ...input };
  const out: DriveInput = { ...input };
  if (input.reviewStepIndex !== undefined) {
    const p = store.stepReviewPromptFor(input.workOrderId, input.reviewStepIndex);
    if (p) out.prompt = p;
  } else if (input.stepIndex !== undefined) {
    const assembled = store.stepPromptFor(input.workOrderId, input.stepIndex);
    if (assembled) {
      out.prompt = assembled.prompt;
      if (assembled.scope) out.scope = assembled.scope;
    }
  } else if (input.role === 'architect') {
    const p = store.architectPromptFor(input.workOrderId);
    if (p) out.prompt = p;
  }
  return out;
}

// ===== Permission policy — how the pipeline answers a fence 'ask' (the stop-and-ask survivors) =====
//
// The fence (fenceDecision, in runner.ts) filters tool calls at the adapter: allow / deny silently, or 'ask'.
// Only an 'ask' becomes a permission_request event that reaches the pipeline. The policy decides what happens
// next: resolve it immediately (auto-allow / declarative — headless) or defer to the host (the operator, via
// pipeline.decide). This closes the F12 "no headless policy" gap and is what lets the CLI drive unattended.

export type AskOutcome =
  | { kind: 'defer' } // surface the permission_request to the host; it resolves via pipeline.decide
  | { kind: 'resolve'; decision: PermissionDecision }; // answer now; the event is not surfaced

export interface PermissionPolicy {
  onAsk(req: { requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string }): AskOutcome;
}

/** Allow every ask — for tests and, later, a trusted CLI run (the agent is fully privileged; the fence is a
 *  tripwire, not a security boundary — see the dogfood audit F1/F2). */
export function autoAllowPolicy(): PermissionPolicy {
  return { onAsk: () => ({ kind: 'resolve', decision: { allow: true } }) };
}

/** Defer every ask to the host (the Electron GUI surfaces a card; the operator decides). The host then calls
 *  pipeline.decide(requestId, decision), which resolves the runner's held callback. */
export function askOperatorPolicy(): PermissionPolicy {
  return { onAsk: () => ({ kind: 'defer' }) };
}

/** "Riskli hariç" (WO-0031c): auto-approve every in-scope ask EXCEPT the risky set — those still surface
 *  to the operator. The classifier is injected so tests can script it; production uses core/risky.
 *  WO-0085: the ask tool is the OPERATOR'S VOICE — a question is not a mutation, so it is never in
 *  the auto-approve scope; it defers under every rule (the review's finding: risky_excluded resolved
 *  it with a bare allow and the model answered itself). */
export function riskyExcludedPolicy(
  isRisky: (tool: string, input: Record<string, unknown>) => boolean,
): PermissionPolicy {
  return {
    onAsk: (req) =>
      req.tool === ASK_TOOL
        ? { kind: 'defer' }
        : isRisky(req.tool, req.input)
          ? { kind: 'defer' }
          : { kind: 'resolve', decision: { allow: true } },
  };
}

/** The per-work-order rule → policy mapping (WO-0031c). The GUI resolves the rule main-side and carries it
 *  on the DriveInput; this is the single place a rule becomes behavior. */
export function policyForRule(
  rule: PermissionRule,
  isRisky: (tool: string, input: Record<string, unknown>) => boolean = isRiskyPermission,
): PermissionPolicy {
  switch (rule) {
    case 'ask_every':
      return askOperatorPolicy();
    case 'full_auto':
      return autoAllowPolicy();
    case 'risky_excluded':
      return riskyExcludedPolicy(isRisky);
  }
}

// ===== The pipeline =====

export interface PipelineDeps {
  /** The single-drive runner — the default transport when no factory is injected (tests, hosts
   *  that never drive two owners at once). Every drive shares it, exactly the pre-WO-0088 shape.
   *  Required UNLESS a `runners` factory is injected (createPipeline refuses both absent). */
  runner?: SessionRunner;
  /** WO-0088: ONE runner PER DRIVE — the parallel spine's factory. The adapter's per-instance
   *  singleton state means N instances = N concurrent drives; the port (SessionRunner) is
   *  unchanged (ADR-0014 holds). Absent → every drive shares `runner`. */
  runners?: (owner: SessionOwner) => SessionRunner;
  store: SessionStore;
  permission: PermissionPolicy;
}

export interface Pipeline {
  /** Drive a session: assemble the prompt, run it, perform the persistence side-effects, and yield every
   *  RunnerEvent to the host. A deferred permission_request is yielded and the drive pauses (the runner holds
   *  the provider) until the host resolves it via `decide`. */
  drive(input: DriveInput): AsyncIterable<RunnerEvent>;
  /** Resolve a deferred permission_request (the operator's answer). requestId is globally unique,
   *  so it routes itself: forwarded to every LIVE runner — the one holding the id answers, the
   *  others no-op (the adapter's unknown-id contract). */
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** Controlled stop of ONE drive (WO-0088): the owner tag names it (driveOwnerTag); the other
   *  live drives are untouched. Unknown/no-longer-live tags no-op. */
  interrupt(owner: string): Promise<void>;
  /** Queue an operator steering note into ONE running drive (WO-0045) — injected once at the next
   *  agent-turn boundary; NEVER an interrupt. Resolves the minted noteId, or undefined when no
   *  drive is live under `owner` / the runner refuses. The note enters the mirror BEFORE the
   *  transport call (a Durdur in the gap must not lose it) and leaves it if the runner refuses. */
  steer(owner: string, note: string): Promise<string | undefined>;
  /** Pull a queued note back before delivery (WO-0045), from ONE drive. Best-effort (probe s5/s5b):
   *  false = the note already left the SDK's cancel window and WILL run. */
  retractSteer(owner: string, noteId: string): Promise<boolean>;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  if (!deps.runner && !deps.runners) {
    throw new Error('createPipeline: inject a runner (the single-drive shape) or a runners factory (the parallel spine) — never neither');
  }
  const runnerFor = (owner: SessionOwner): SessionRunner =>
    deps.runners ? deps.runners(owner) : (deps.runner as SessionRunner); // the guard above pins the cast
  // WO-0088: the KEYED steer surface + the live runners — one entry per owner tag, set when a drive
  // passes its gates, cleared in ITS finally (guarded: a finished drive never tears a successor or a
  // sibling down). `steer`/`retractSteer`/`interrupt` below are the only entry points; they no-op
  // (undefined/false) when nothing runs under the addressed tag. The runner's own stream carries the
  // lifecycle events (steer_queued/delivered/retracted).
  const actives = new Map<string, { woId: import('./types').WorkOrderId; add: (n: SteerNote) => void; drop: (noteId: string) => void; checkpoint: () => void }>();
  const liveRunners = new Map<string, SessionRunner>();
  let noteSeq = 0;
  const noteDetail = (text: string): string => `not: ${text.slice(0, 48)}`;
  // WO-0045 (reviewer finding 5): ids outlive the process — a carried note's id sits in a session
  // row, and a bare counter would re-mint the SAME id after a restart (duplicate mirror ids: React
  // keys collide, dropNote drops both, retract targets the wrong uuid). Time + counter + random.
  const mintNoteId = (): string =>
    `steer-${Date.now().toString(36)}-${(++noteSeq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const drive = async function* (input: DriveInput): AsyncGenerator<RunnerEvent> {
    const di = prepareDriveInput(input, deps.store);
    // WO-0031c: the work order's permission rule (resolved main-side) becomes the drive's policy; when the
    // drive carries none (tests, scripted runners) the injected policy governs. The fence behaves identically
    // under every rule — this chooses the CADENCE (auto-approve vs ask), never the scope.
    const policy = di.permissionRule !== undefined ? policyForRule(di.permissionRule) : deps.permission;
    const stepIdx = input.stepIndex; // a step drive (WO-0017) when set
    const reviewIdx = input.reviewStepIndex; // an architect REVIEW drive (WO-0020) when set
    // WO-0050: the two arms of the drive union, narrowed once — mutually exclusive by the same
    // guard. The WO side-effects below gate on `woInput`; the draft's land on `draftInput`.
    const draftInput: DraftDriveInput | undefined = isDraftDrive(input) ? input : undefined;
    const woInput: WoDriveInput | undefined = isDraftDrive(input) ? undefined : input;
    const owner: SessionOwner = isDraftDrive(input)
      ? { kind: 'draft', workspaceId: input.workspaceId }
      : { kind: 'wo', workOrderId: input.workOrderId };
    // WO-0088: THIS drive's own runner instance + its owner tag. The factory (when the host
    // injected one) mints a fresh transport per drive — the adapter's per-instance singleton
    // state then holds exactly one drive per instance; the tag keys the control surface below.
    // Registration happens after the gates (a refused drive owns nothing) but before the stream.
    const tag = driveOwnerTag(input);
    const driveRunner: SessionRunner = runnerFor(owner);
    // WO-0047: the workspace BUDGET gate — the FIRST gate, and the only one that sees EVERY drive
    // (plan, step, review, resume, draft alike: each spawns a runner that bills; the plan/flow gates
    // below scope to step/review). Read at SPAWN time only — a drive already running when the cap is
    // crossed is never touched (the order's stance: the refusal applies to the NEXT drive). The
    // refusal carries its facts so every host composes the same sentence; raising the cap is a
    // settings action — no force flag exists anywhere. WO-0050 / D4: the draft reads the SAME gate
    // keyed directly by its workspace — the widened month sum includes its own spend.
    const budgetBlock = isDraftDrive(input)
      ? deps.store.budgetBlockForDraft(input.workspaceId)
      : deps.store.budgetBlockFor(input.workOrderId);
    if (budgetBlock) {
      const subject = isDraftDrive(input) ? 'roadmap draft' : input.workOrderId;
      yield {
        kind: 'error',
        message: `drive refused: ${subject} budget cap met (${budgetBlock.observedUsd.toFixed(2)} of ${budgetBlock.capUsd.toFixed(2)} USD this month)`,
        refusal: budgetBlock,
      };
      return;
    }
    // WO-0050 / D5: a draft whose prompt did not assemble (the workspace did not resolve) is
    // refused BEFORE the runner spawns — no empty-prompt provider run. The plan-gate refusal shape.
    if (draftInput && !di.prompt) {
      yield { kind: 'error', message: 'draft refused: no prompt assembled (workspace not found)' };
      return;
    }
    // WO-0050 / D6: a FRESH draft supersedes — the pending row clears once its gates passed, before
    // the runner spawns (operator ruling 2026-08-27: re-opening ✦ already decided the old proposal
    // is dead). An İtiraz resume (the objection rides `resume`) never clears.
    if (draftInput && !draftInput.resume) deps.store.clearRoadmapDraft(draftInput.workspaceId);
    // WO-0038 incident (2026-08-22): the approval gate is ENFORCED here — not only derived in the
    // UI. An unapproved plan's steps may exist as SPEC (plan.md's fence parses into 'pending' rows
    // before approval — getWorkOrderSteps is deliberately optimistic), so any host that reaches the
    // pipeline (a GUI pane's auto-drive, the CLI's `drive --step`) is refused with an error event
    // BEFORE the runner spawns: no session row, no phantom step_started. Plan/free drives pass.
    if (woInput && (stepIdx !== undefined || reviewIdx !== undefined) && !deps.store.planApprovedFor(woInput.workOrderId)) {
      yield { kind: 'error', message: `drive refused: ${woInput.workOrderId} plan not approved` };
      return;
    }
    // WO-0045 flow mode: in 'manual' NO drive starts itself. An `origin:'auto'` spawn (a pane's mount
    // auto-drive, the verdict effect's next step) is refused here — the same refusal shape as the plan
    // gate, so any host that forgets the mode check is still refused. An operator click (origin absent)
    // always passes; the mode is read at SPAWN time, so a chip switch never touches the running drive
    // (operator ruling 2026-08-26: switching takes effect at the next boundary).
    if (
      woInput
      && (stepIdx !== undefined || reviewIdx !== undefined)
      && input.origin === 'auto'
      && deps.store.flowModeFor(woInput.workOrderId) === 'manual'
    ) {
      yield { kind: 'error', message: `drive refused: ${woInput.workOrderId} flow mode manual` };
      return;
    }
    // WO-0045 Sürdür carry (D5): a resume with no prompt of its own delivers the FIRST queued note
    // through the prompt channel (it never enters the SDK queue — no double application); every other
    // pending note re-queues into the new drive after `started` — including on a resume that carries
    // an explicit prompt (the ask answer): the notes then apply at the boundary after that turn,
    // mirroring the "queued during a pending ask" case. An approve-resume never carries (the operator
    // just ruled on the plan; stale notes are not theirs to answer). WO-0050: owner-keyed — a draft's
    // row carries no notes (steer is WO-only, D15), so its carry is [] by truth.
    const carry = input.resume && !input.approve ? deps.store.pendingNotesFor(owner, input.resume) : [];
    if (carry[0] && !di.prompt) {
      di.prompt = `Operator note: ${carry[0].text}`;
      di.deliveringNote = carry[0];
    }
    const requeue = di.deliveringNote ? carry.slice(1) : carry;
    let providerSessionId: string | undefined;
    let assistantText = ''; // fallback body for the report/verdict when the SDK's `result` is absent
    // The same fold the panes run (WO-0026/F6): accumulating the live state here lets every record() call
    // checkpoint the transcript into the session row, so a resumed pane can seed from it instead of blanking.
    let live: LiveSessionState = initialSessionState;
    let terminated = false; // a terminal record already happened — the finally must not double-record
    let startedAtIso: string | undefined; // preserved across every record of the drive (İstek 7)
    // 2026-08-23 süre şişmesi (WO-0001 pilot): a drive can HANG after its real work — the plan-mode
    // stream awaits an in-session approval Docket never gives, so the generator stays open until the
    // operator stops it (4dk of work displayed as 34dk). ended_at is therefore the LAST ACTIVITY
    // moment, refreshed by every event; the terminal/cleanup records stamp THAT, never `new Date()`
    // at the (possibly much later) close. Honest undercount: a tool interrupted mid-run bills until
    // its last logged event — the old overcount (idle wait billed as work) was the worse lie.
    let lastActivityIso: string | undefined;
    // WO-0045: the steer MIRROR — the drive's pending notes, the row's latest-wins truth. The fold's
    // own pendingNotes is the UI projection; THIS list is what record() persists (re-queued notes
    // emit no event, so only the mirror knows them). Initialized to the re-queue carry (the first
    // note left through the prompt channel and is never mirrored here).
    let mirrorNotes: SteerNote[] = [...requeue];
    const dropNote = (noteId: string): void => {
      mirrorNotes = mirrorNotes.filter((n) => n.id !== noteId);
    };
    // Functions only — reassignments of mirrorNotes above stay visible through these closures.
    const checkpoint = (): void => record('running');
    // WO-0088: the live transport registers HERE (after the gates — a refused drive owns nothing)
    // and un-registers in the finally, guarded to its own registration.
    liveRunners.set(tag, driveRunner);
    // D15: the steer surface is WO-only — a draft never mounts it (steer/retractSteer no-op for
    // the drive's lifetime; İtiraz is the draft's note path).
    const surface = woInput
      ? {
          woId: woInput.workOrderId,
          add: (n: SteerNote): void => {
            mirrorNotes = [...mirrorNotes, n];
          },
          drop: dropNote,
          checkpoint,
        }
      : undefined;
    if (surface) actives.set(tag, surface);

    // WO-0052: the last observed rich usage detail — updated at every turn_usage, checkpointed on
    // every record (defined OVERWRITES, undefined KEEPS the prior row's values — the pendingNotes
    // rule; a leg that observed nothing leaves the prior leg's figures standing).
    let lastUsage: TurnUsage | undefined;
    // WO-0053: the limit stamp's ROUTING TABLE (the architect's finding 1 — a real limit death
    // arrives as a result message, so the stamp rides the turn_complete terminal record, NOT the
    // finally's; and the pipeline cannot derive "was stamped" from the fold, so the routing is a
    // fixed table, not a derivation):
    //   turn_complete terminal  → `live.lastLimit?.resetAt ?? null` (set on a limit death, CLEAR on
    //                             a clean leg — a stale stamp is a lie, D3)
    //   catch/finally error     → set on a limit throw; a non-limit throw KEEPS a prior stamp
    //                             (undefined); a stamp-LESS limit throw CLEARS (null — the
    //                             provider disproved the old clock; review finding 4)
    //   interrupted             → undefined (keep — an abort is not a clean leg)
    //   ordinary records        → undefined (keep)
    const limitStampForErrorClose = (s: typeof live): string | null | undefined =>
      s.lastErrorCode === 'rate_limited' && s.lastLimit === undefined ? null : s.lastLimit?.resetAt;
    const record = (status: SessionRef['status'], cost?: CostSummary, endedAt?: string, limitResetAt?: string | null): void => {
      if (!providerSessionId) return;
      deps.store.recordSession({
        providerSessionId,
        owner,
        role: input.role,
        scope: input.scope,
        status,
        cost,
        stepIdx: stepIdx ?? reviewIdx,
        transcript: live.entries,
        // The unanswered asks ride the stopped_asking row (WO-0027 / Bulgu 9): a remounted pane re-seeds
        // its cards from them while the host's runner still holds the resolvers.
        ...(status === 'stopped_asking' ? { asks: live.pendingAsks } : {}),
        pendingNotes: mirrorNotes,
        startedAt: startedAtIso,
        endedAt,
        // WO-0052: the LATEST context reading + the last observed usage checkpoint with every record —
        // the honest-absent rule holds: no reading observed → undefined → the store keeps the prior.
        ...(live.context ? { ctx: { usedTokens: live.context.usedTokens, maxTokens: live.context.maxTokens } } : {}),
        ...(lastUsage ? { finalUsage: lastUsage } : {}),
        ...(limitResetAt !== undefined ? { limitResetAt } : {}),
      });
    };

    try {
      for await (const ev of driveRunner.drive(di)) {
        live = foldSessionEvent(live, ev);
        lastActivityIso = new Date().toISOString();
        switch (ev.kind) {
          case 'assistant_text':
            if (ev.text) assistantText += ev.text;
            yield ev;
            break;
          case 'started':
            providerSessionId = ev.sessionId;
            startedAtIso = new Date().toISOString();
            record('running');
            if (woInput && stepIdx !== undefined) deps.store.recordStep(woInput.workOrderId, stepIdx, { status: 'active' });
            yield ev;
            // WO-0045 D5: the re-queue carry enters the SDK queue now — after the session opened, so
            // the notes queue for a BOUNDARY (pushed with the seed they would merge into the first
            // turn, probe s2). Silent (emit:false): the UI fold seeded them from the row already.
            for (const n of requeue) {
              await driveRunner.steer?.(n.text, { noteId: n.id, emit: false });
            }
            break;
          case 'permission_request':
            record('stopped_asking'); // asks included (post-fold: contains this one)
            {
              const outcome = policy.onAsk({
                requestId: ev.requestId,
                tool: ev.tool,
                input: ev.input,
                title: ev.title,
                reason: ev.reason,
              });
              if (outcome.kind === 'resolve') {
                await driveRunner.decide(ev.requestId, outcome.decision); // answered internally — not surfaced
              } else {
                yield ev; // askOperator: surface; the host resolves via pipeline.decide (drive pauses here)
              }
            }
            break;
          case 'plan_ready':
            // Persist the proposed plan as PENDING so it survives restart (WO-0020, closes TD-025). Plan
            // APPROVAL is a separate host action (WorkOrderSource.approvePlan), not part of the drive loop.
            // WO-0050 / D6: a draft's `plan_ready` is the PROPOSAL — it lands in the workspace's pending
            // roadmap_draft row (md + this provider session id, İtiraz's resume handle) instead.
            // WO-0051 / D2: the composition's COUNTS ride the same write, IFF the input carried
            // them (the dialog always does; the CLI and an İtiraz resume do not — a resume's
            // summary-less write keeps the prior figures, and a counts-less drive writes none
            // rather than fabricating zeros for paths it may still have carried — review f2).
            if (draftInput) {
              const opts: { providerSessionId?: string; sourceSummary?: DraftSourceSummary } = { providerSessionId };
              if (draftInput.docSource !== undefined) {
                opts.sourceSummary = {
                  store: draftInput.docSource.store,
                  external: draftInput.docSource.external,
                  freeExplore: draftInput.freeExplore === true,
                };
              }
              deps.store.saveRoadmapDraft(draftInput.workspaceId, ev.planText, opts);
            } else if (woInput) deps.store.savePendingPlan(woInput.workOrderId, ev.planText);
            yield ev;
            break;
          case 'ask_resolved':
            // The operator answered ONE ask; if none remain, the session is un-blocked — say so in the row.
            if (live.pendingAsks.length === 0) record('running');
            yield ev;
            break;
          case 'interrupted':
            // WO-0039 stabilization (2026-08-23): an intentional interrupt is a terminal, calm
            // close. The session records STOPPED (2026-08-24 — the durable fact every WO-level
            // derivation reads: the board card reason, the phase line, the restart-time Sürdür
            // seed; 'idle' made a stopped drive indistinguishable from an ended one), cost only
            // when the runner observed one, and NO step report / verdict is captured — a stopped
            // step stays 'active' so Sürdür resumes it ("Durduruldu. Rapor kısmi kalır."), never
            // the architect-review-of-a-partial-report path a turn_complete would trigger.
            terminated = true;
            record('stopped', ev.cost, lastActivityIso ?? startedAtIso);
            yield ev;
            break;
          case 'turn_usage':
            // WO-0052: the per-turn usage row — ONE append per OBSERVED result, held intermediates
            // included (the adapter emits them before its hold). `delta` is that result's own spend
            // under the per-leg baseline; a resume leg appends to the SAME session with no
            // double-count. lastUsage feeds the session row's final checkpoint.
            if (providerSessionId) {
              lastUsage = ev.usage ?? lastUsage;
              deps.store.recordTurnUsage(owner, providerSessionId, {
                at: ev.at ?? new Date().toISOString(),
                delta: ev.delta,
                ...(ev.usage ? { usage: ev.usage } : {}),
              });
            }
            yield ev;
            break;
          case 'turn_complete':
            terminated = true;
            // The synthesized plan-exit turn carries the adapter's INCREMENTALLY CAPTURED cost
            // (2026-08-23, maliyet kaybı: the grace abort beats the result message on live plan
            // turns, and a result-only read recorded $0 for real spend). A REAL (>0) cost records;
            // all-zero still records none — the honest no-claim (WO-0026 / TD-030). ended_at =
            // this event's arrival (== lastActivityIso — same tick).
            {
              const synthExit = ev.stopReason === PLAN_EXIT_WITHOUT_RESULT;
              const carryable = synthExit && (ev.cost.usd > 0 || ev.cost.tokensIn > 0 || ev.cost.tokensOut > 0);
              // WO-0053: the turn terminal is the stamp's HOME (a limit death's error folds first,
              // this record follows; a clean leg clears any stale stamp — the table above).
              record('idle', synthExit && !carryable ? undefined : ev.cost, lastActivityIso ?? new Date().toISOString(), live.lastLimit?.resetAt ?? null);
            }
            if (woInput && stepIdx !== undefined) {
              const body = ev.result ?? assistantText;
              const reportBody = body.trim()
                ? body
                : `# Step ${stepIdx} (${input.role})\n\n_(no summary captured — the turn ended without assistant text)_`;
              deps.store.recordStepReport(woInput.workOrderId, stepIdx, input.role, reportBody);
            }
            if (woInput && reviewIdx !== undefined) {
              const text = ev.result ?? assistantText;
              const v = parseVerdict(text);
              const outcome: 'proceed' | 'revise' = v.outcome === 'proceed' ? 'proceed' : 'revise';
              const body = v.outcome === 'unknown'
                ? `${text}\n\n_(the architect did not give a clear VERDICT — surfaced for the operator)_`
                : text;
              deps.store.recordStepVerdict(woInput.workOrderId, reviewIdx, outcome, body);
            }
            yield ev;
            break;
          case 'tool_result':
            // 2026-08-23 (döküm kaybı): checkpoint the fold at every tool result — the running
            // transcript must live in the ROW, not only in the pane's memory. The incident: a plan
            // drive that never asks and never completes had a single empty 'started' record, so a
            // restart or a later stop left a $-spending session with an empty history.
            record('running');
            yield ev;
            break;
          case 'agent_task':
            // WO-0055: the same döküm-kaybı rule at every agent-task edge — an interrupt mid-task
            // must not lose the transcript since the last tool_result (the subagent's own rows
            // fold between checkpoints). Two writes per task, never a stream: task_progress is
            // unread (plan D3). NO audit row — the wo_event CHECK gains no kind; task churn
            // would spam the audit log (plan D2).
            record('running');
            yield ev;
            break;
          case 'steer_queued':
            // WO-0045: the runner acknowledged the note into its queue. The mirror normally already
            // holds it (pipeline.steer's optimistic add — a Durdur in the call gap must not lose the
            // note); the idempotent add covers a runner acknowledging without a prior steer entry.
            // The audit rode the pipeline.steer call; here the row checkpoint catches up and the host
            // fold counts it.
            if (!mirrorNotes.some((n) => n.id === ev.noteId)) {
              mirrorNotes = [...mirrorNotes, { id: ev.noteId, text: ev.note }];
            }
            record('running');
            yield ev;
            break;
          case 'steer_delivered':
            // The note applied at an agent-turn boundary (command_lifecycle uuid match in the real
            // adapter; the synthetic receipt after `started` for a prompt-channel delivery). Delivery
            // is the one steer mutation that is EVENT-driven — the adapter alone observes it.
            // WO-0050 / D15: WO-only by truth (a draft never queues a note); the guard keeps the
            // audit home honest even for a scripted fake that emits one anyway.
            dropNote(ev.noteId);
            if (woInput) deps.store.recordAuditEvent(woInput.workOrderId, 'steer_delivered', noteDetail(ev.text));
            record('running');
            yield ev;
            break;
          case 'steer_retracted':
            // Mirror + audit at the retractSteer call site; this event updates the host fold's count.
            record('running');
            yield ev;
            break;
          default: // tool_use, a runner-emitted error, the WO-0046/WO-0053/WO-0091 live feeds — forward as-is
            // (context_usage, limit_windows and context_feed_lost are pane state: yielded to the
            // host fold, never a store call — the drive is alive; the row's checkpoints ride the
            // records above.)
            yield ev;
            break;
        }
      }
    } catch (e) {
      terminated = true;
      // WO-0053 (review finding 4): a throw sets the stamp when the fold holds a limit; a
      // NON-limit throw KEEPS a prior stamp (undefined, never null — not a clean leg); a
      // stamp-LESS limit throw CLEARS — the provider just disproved the old clock, and a restart
      // must not re-derive a card promising it.
      record('idle', undefined, lastActivityIso ?? startedAtIso, limitStampForErrorClose(live));
      yield { kind: 'error', message: (e as Error)?.message ?? String(e) };
    } finally {
      // The completion guarantee (WO-0026 / F5): a session that started but never got a terminal record —
      // the stream ended without a turn_complete (an interrupt), or the consumer closed the generator (a
      // window close) — must not stay `running` in the store. Runs on normal end, on throw, AND on the
      // return-injection a consumer abort triggers; the `terminated` flag keeps it idempotent.
      // ended_at = the last activity (süre şişmesi, 2026-08-23): an interrupted drive bills its
      // work span, never the idle wait that preceded the stop.
      // WO-0088: PER-DRIVE — each generator's finally folds only ITS OWN session; a sibling
      // mid-parallel is untouched (the keyed test pins it).
      if (providerSessionId && !terminated) {
        terminated = true;
        record('idle', undefined, lastActivityIso ?? startedAtIso, limitStampForErrorClose(live));
      }
      // The keyed surfaces un-register GUARDED (by identity): a finished drive never tears down
      // its own successor (the serial per-WO rule) or a sibling (the parallel rule).
      if (liveRunners.get(tag) === driveRunner) liveRunners.delete(tag);
      if (surface && actives.get(tag) === surface) actives.delete(tag);
    }
  };

  return {
    drive,
    // WO-0088: the requestId is globally unique — forwarding to every LIVE runner routes it; the
    // runners not holding the id no-op (the adapter's unknown-id contract).
    decide: async (requestId, decision) => {
      for (const r of [...liveRunners.values()]) await r.decide(requestId, decision);
    },
    interrupt: async (owner: string) => {
      await liveRunners.get(owner)?.interrupt();
    },
    steer: async (owner: string, note: string) => {
      const trimmed = note.trim();
      const active = actives.get(owner);
      if (!active || !trimmed) return undefined;
      const { woId, add, drop, checkpoint } = active;
      const noteId = mintNoteId();
      add({ id: noteId, text: trimmed }); // optimistic: a Durdur in the call gap must not lose the note
      const ok = (await liveRunners.get(owner)?.steer?.(trimmed, { noteId, emit: true })) ?? false;
      if (!ok) {
        drop(noteId); // no live transport (or it refused) — un-mirror
        return undefined;
      }
      deps.store.recordAuditEvent(woId, 'steer_queued', noteDetail(trimmed));
      checkpoint(); // a drive parked on an ask records nothing until it resolves — write the note NOW
      return noteId;
    },
    retractSteer: async (owner: string, noteId: string) => {
      const active = actives.get(owner);
      if (!active) return false;
      const { woId, drop } = active;
      const ok = (await liveRunners.get(owner)?.retractSteer?.(noteId)) ?? false;
      if (!ok) return false; // already past the SDK's cancel window — the note WILL run (probe s5/s5b)
      drop(noteId);
      deps.store.recordAuditEvent(woId, 'steer_retracted', `not: ${noteId}`);
      return true;
    },
  };
}
