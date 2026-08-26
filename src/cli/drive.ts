// src/cli/drive.ts — the reusable, testable core of the `drive` command (WO-0024).
//
// No process.argv / process.stdout here — main wires I/O; tests inject `onEvent` + a fake pipeline. This is a
// thin layer over the host-agnostic pipeline (src/core/pipeline.ts): build a DriveInput, drive it, format
// events. The drive KIND (plan / step / review / free-form) mirrors the shapes the GUI panes send
// (SessionPane/StepPane/ReviewPane): `prompt: ''` lets prepareDriveInput assemble server-side; a non-empty
// free-form prompt is preserved.
import type { WorkOrderSource } from '../core/source';
import type { Pipeline } from '../core/pipeline';
import type { CostSummary, SessionRole, WorkOrderId } from '../core/types';
import type { DriveInput, RunnerEvent } from '../core/runner';

export type DriveFormat = 'stream' | 'jsonl' | 'quiet';

export interface DriveOptions {
  cwd: string;
  plan?: boolean;
  step?: number;
  review?: number;
  prompt?: string;
  role?: SessionRole;
  resume?: string;
}

export interface DriveSummary {
  planText?: string;
  cost?: CostSummary;
  error?: string;
}

/** Build the DriveInput for the chosen drive kind. For `--step N` the role/scope come from the plan's step spec
 *  (read via the store port). */
export async function buildDriveInput(
  workOrderId: WorkOrderId,
  opts: DriveOptions,
  store: WorkOrderSource,
): Promise<DriveInput> {
  const base: DriveInput = { role: 'implementer', workOrderId, mode: 'direct', prompt: '', cwd: opts.cwd };
  if (opts.resume) base.resume = opts.resume;
  if (opts.review !== undefined) {
    return { ...base, role: 'architect', mode: 'direct', reviewStepIndex: opts.review };
  }
  if (opts.step !== undefined) {
    const steps = await store.getWorkOrderSteps(workOrderId);
    const s = steps.find((x) => x.idx === opts.step);
    return { ...base, role: s?.role ?? 'implementer', mode: 'direct', stepIndex: opts.step, scope: s?.scopeTrackId };
  }
  if (opts.plan) {
    return { ...base, role: 'architect', mode: 'plan' };
  }
  // free-form: a non-empty prompt makes prepareDriveInput skip server-side assembly.
  return { ...base, role: opts.role ?? 'implementer', mode: 'direct', prompt: opts.prompt ?? '' };
}

/** Drive one session via the pipeline, forwarding each event to `onEvent`. Returns the captured plan text (if a
 *  plan_ready fired), the last turn_complete cost, and any terminal error. Policy-agnostic: with autoAllow the
 *  pipeline resolves permission asks internally (onEvent never sees them); with ask, the host resolves them. */
export async function runDrive(
  input: DriveInput,
  pipeline: Pipeline,
  onEvent: (ev: RunnerEvent) => void,
): Promise<DriveSummary> {
  const summary: DriveSummary = {};
  try {
    for await (const ev of pipeline.drive(input)) {
      onEvent(ev);
      if (ev.kind === 'plan_ready') summary.planText = ev.planText;
      else if (ev.kind === 'turn_complete') summary.cost = ev.cost;
      else if (ev.kind === 'error') summary.error = ev.message;
    }
  } catch (e) {
    summary.error = (e as Error)?.message ?? String(e);
  }
  return summary;
}

/** Pure event → line formatter. `jsonl` for assertions; `stream` a human one-liner; `quiet` nothing. */
export function formatEvent(ev: RunnerEvent, format: DriveFormat): string | undefined {
  if (format === 'quiet') return undefined;
  if (format === 'jsonl') return JSON.stringify(ev);
  switch (ev.kind) {
    case 'started': return `▶ session ${ev.sessionId}`;
    case 'assistant_text': return ev.text;
    case 'tool_use': return `🔧 ${ev.tool}`;
    case 'tool_result': return `  ← ${ev.summary}`;
    case 'permission_request': return `⛔ ask ${ev.tool}`;
    case 'plan_ready': return `📋 plan ready (${ev.planText.length} chars)`;
    case 'context_usage': return `◍ ctx ${ev.percentage}% (${ev.usedTokens}/${ev.maxTokens})`;
    case 'turn_complete': return `✓ done`;
    case 'error': return `✗ ${ev.message}`;
    default: return undefined;
  }
}
