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

import type { CostSummary, SessionRef } from './types';
import { PLAN_EXIT_WITHOUT_RESULT, foldSessionEvent, initialSessionState } from './runner';
import type { DriveInput, LiveSessionState, PermissionDecision, RunnerEvent, SessionRunner } from './runner';
import type { SessionStore } from './session-store';
import { parseVerdict } from './verdict';
import { isRiskyPermission } from './risky';
import type { PermissionRule } from './source';

/**
 * Fill the first prompt + track scope server-side, from the decision store. The renderer never parses
 * document text (ADR-0007). Order matters (WO-0023 / P1-1 fix): a drive that carries a `resume` id or a
 * non-empty `prompt` (approve / object / reply / step-resume) is left untouched; otherwise REVIEW before STEP
 * before the pure architect PLAN — the old code matched `role==='architect'` first and clobbered review/step
 * drives with the plan prompt. Pure-ish: reads via the injected store port, no side effects.
 */
export function prepareDriveInput(input: DriveInput, store: SessionStore): DriveInput {
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
 *  to the operator. The classifier is injected so tests can script it; production uses core/risky. */
export function riskyExcludedPolicy(
  isRisky: (tool: string, input: Record<string, unknown>) => boolean,
): PermissionPolicy {
  return {
    onAsk: (req) =>
      isRisky(req.tool, req.input) ? { kind: 'defer' } : { kind: 'resolve', decision: { allow: true } },
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
  runner: SessionRunner;
  store: SessionStore;
  permission: PermissionPolicy;
}

export interface Pipeline {
  /** Drive a session: assemble the prompt, run it, perform the persistence side-effects, and yield every
   *  RunnerEvent to the host. A deferred permission_request is yielded and the drive pauses (the runner holds
   *  the provider) until the host resolves it via `decide`. */
  drive(input: DriveInput): AsyncIterable<RunnerEvent>;
  /** Resolve a deferred permission_request (the operator's answer). Forwards to the runner. */
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** Controlled stop of the current run. Forwards to the runner. */
  interrupt(): Promise<void>;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const drive = async function* (input: DriveInput): AsyncGenerator<RunnerEvent> {
    const di = prepareDriveInput(input, deps.store);
    // WO-0031c: the work order's permission rule (resolved main-side) becomes the drive's policy; when the
    // drive carries none (tests, scripted runners) the injected policy governs. The fence behaves identically
    // under every rule — this chooses the CADENCE (auto-approve vs ask), never the scope.
    const policy = di.permissionRule !== undefined ? policyForRule(di.permissionRule) : deps.permission;
    const stepIdx = input.stepIndex; // a step drive (WO-0017) when set
    const reviewIdx = input.reviewStepIndex; // an architect REVIEW drive (WO-0020) when set
    // WO-0038 incident (2026-08-22): the approval gate is ENFORCED here — not only derived in the
    // UI. An unapproved plan's steps may exist as SPEC (plan.md's fence parses into 'pending' rows
    // before approval — getWorkOrderSteps is deliberately optimistic), so any host that reaches the
    // pipeline (a GUI pane's auto-drive, the CLI's `drive --step`) is refused with an error event
    // BEFORE the runner spawns: no session row, no phantom step_started. Plan/free drives pass.
    if ((stepIdx !== undefined || reviewIdx !== undefined) && !deps.store.planApprovedFor(input.workOrderId)) {
      yield { kind: 'error', message: `drive refused: ${input.workOrderId} plan not approved` };
      return;
    }
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

    const record = (status: SessionRef['status'], cost?: CostSummary, endedAt?: string): void => {
      if (!providerSessionId) return;
      deps.store.recordSession({
        providerSessionId,
        workOrderId: input.workOrderId,
        role: input.role,
        scope: input.scope,
        status,
        cost,
        stepIdx: stepIdx ?? reviewIdx,
        transcript: live.entries,
        // The unanswered asks ride the stopped_asking row (WO-0027 / Bulgu 9): a remounted pane re-seeds
        // its cards from them while the host's runner still holds the resolvers.
        ...(status === 'stopped_asking' ? { asks: live.pendingAsks } : {}),
        startedAt: startedAtIso,
        endedAt,
      });
    };

    try {
      for await (const ev of deps.runner.drive(di)) {
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
            if (stepIdx !== undefined) deps.store.recordStep(input.workOrderId, stepIdx, { status: 'active' });
            yield ev;
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
                await deps.runner.decide(ev.requestId, outcome.decision); // answered internally — not surfaced
              } else {
                yield ev; // askOperator: surface; the host resolves via pipeline.decide (drive pauses here)
              }
            }
            break;
          case 'plan_ready':
            // Persist the proposed plan as PENDING so it survives restart (WO-0020, closes TD-025). Plan
            // APPROVAL is a separate host action (WorkOrderSource.approvePlan), not part of the drive loop.
            deps.store.savePendingPlan(input.workOrderId, ev.planText);
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
              record('idle', synthExit && !carryable ? undefined : ev.cost, lastActivityIso ?? new Date().toISOString());
            }
            if (stepIdx !== undefined) {
              const body = ev.result ?? assistantText;
              const reportBody = body.trim()
                ? body
                : `# Step ${stepIdx} (${input.role})\n\n_(no summary captured — the turn ended without assistant text)_`;
              deps.store.recordStepReport(input.workOrderId, stepIdx, input.role, reportBody);
            }
            if (reviewIdx !== undefined) {
              const text = ev.result ?? assistantText;
              const v = parseVerdict(text);
              const outcome: 'proceed' | 'revise' = v.outcome === 'proceed' ? 'proceed' : 'revise';
              const body = v.outcome === 'unknown'
                ? `${text}\n\n_(the architect did not give a clear VERDICT — surfaced for the operator)_`
                : text;
              deps.store.recordStepVerdict(input.workOrderId, reviewIdx, outcome, body);
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
          default: // tool_use, a runner-emitted error — forward as-is
            yield ev;
            break;
        }
      }
    } catch (e) {
      terminated = true;
      record('idle', undefined, lastActivityIso ?? startedAtIso);
      yield { kind: 'error', message: (e as Error)?.message ?? String(e) };
    } finally {
      // The completion guarantee (WO-0026 / F5): a session that started but never got a terminal record —
      // the stream ended without a turn_complete (an interrupt), or the consumer closed the generator (a
      // window close) — must not stay `running` in the store. Runs on normal end, on throw, AND on the
      // return-injection a consumer abort triggers; the `terminated` flag keeps it idempotent.
      // ended_at = the last activity (süre şişmesi, 2026-08-23): an interrupted drive bills its
      // work span, never the idle wait that preceded the stop.
      if (providerSessionId && !terminated) {
        terminated = true;
        record('idle', undefined, lastActivityIso ?? startedAtIso);
      }
    }
  };

  return {
    drive,
    decide: (requestId, decision) => deps.runner.decide(requestId, decision),
    interrupt: () => deps.runner.interrupt(),
  };
}
