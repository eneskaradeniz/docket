---
id: WO-0055
title: "Live agent visibility — the runner's agent-task lifecycle as session events, agent tasks on the live surface (transcript rows · running-agent count · nested subagent tools)"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0055 — Live agent visibility

## Objective

The SDK streams a full agent-task lifecycle — `system/task_started`, `task_notification`,
`task_updated` (+ the `parent_tool_use_id` nesting link on assistant/user messages) — and the
runner adapter swallows every one of it in `translate`'s `default: break`
(`src/adapters/runner/index.ts:515`). The operator therefore cannot see a subagent working: its
tool rows arrive flat, indistinguishable from the parent's own calls, and the pane's activity
line says nothing about the delegation. This WO surfaces the lifecycle as ONE core event kind,
renders agent tasks INSIDE the existing chip grammar (transcript rows behind
`Dökümü aç/kapat` — never a second live surface, never a ledger card, ADR-0013), shows the
running-agent count on the activity verb line, and nests the subagent's own tool rows inside
its agent-task block (v1 + nesting, operator-approved scope, 2026-08-30).

## Context

- **Queue line (operator, 2026-08-30):** item 5 of the pre-Antreo queue — "runner'ın ajan yaşam
  döngüsü olayları + canlı yüzeyde ajan task'ları". This order is the line's first in-repo record.
- **Wild evidence already on disk** (`docs/probes/cc-surface/raw/{c2,s1-baseline,s3-two-notes}.log`):
  `task_started.tool_use_id === task_notification.tool_use_id === "call_1d0f6b9426a94ed892581fa5"`
  — the task's `tool_use_id` IS the tool_use call's `callId` (the join key works);
  `task_updated` appears ZERO times across every probe log (the end bookend in practice is
  `task_notification`); a backgrounded `sleep 8` surfaced as a task with
  `task_type: "local_bash"` and NO `subagent_type` — the task stream is not agent-only, a
  discriminator is mandatory.
- **SDK pins (0.3.221, `sdk.d.ts`):** `SDKAssistantMessage`/`SDKUserMessage` carry
  `parent_tool_use_id: string | null` at message level; `SDKUserMessage.tool_use_result` is
  documented as the subagent's final report for the Task tool; `Options.forwardSubagentText`
  defaults to false (subagent TEXT is not forwarded — only its tool_use/tool_result blocks).
- **Probe t1 (Stage 1 step 0) — RAN 2026-08-30 (`raw/t1-task.log`, allow-listed
  `probe-task.mjs`), all three questions resolved:** a real Task subagent carries
  `task_type: "local_agent"` + `subagent_type: "general-purpose"`, and its
  `task_started.tool_use_id` IS the delegation call's `callId`; the subagent's own
  assistant/user messages carry `parent_tool_use_id` === that same id; `tool_use_result` for
  the Task tool is rich but its report text === `task_notification.summary`'s (stays UNREAD).
  Two wild surprises, folded into plan.md's rulings: the delegation tool is named **`Agent`**
  on the wire (labels gain it beside `Task`), and a task can RESTART after its end — the
  parent's `SendMessage` re-opened the same `task_id` with a NEW `tool_use_id`, so the fold's
  replay guard keys on OPEN tasks.
- **Code anchors (verified against the tree):** `RunnerEvent` union + `foldSessionEvent` +
  `seedLiveState` (`src/core/runner.ts:19-89`, `:562-716`, `:541`); `TranscriptLine`
  (`src/core/types.ts:69-82`, shared live + persisted); pipeline per-kind switch with the
  `default:` forward precedent (`src/core/pipeline.ts:478`) and the `record('running')`
  checkpoint on `tool_result` (`:447`); `session.transcript` is schema-free JSON with a
  longer-row-wins merge (`src/adapters/store/index.ts:392`) — new line shapes ride it with NO
  migration; the `wo_event` CHECK (`src/adapters/store/schema.ts:160`) gains NO kind;
  ChatTranscript's group builder + `ToolPair` + pair-by-callId
  (`src/ui/components/session/ChatTranscript.tsx:319-385`, `:119-205`); `usePaneActivity`'s
  precedence chain (`src/ui/components/session/pane-chrome.tsx:60-88`); the CLI is the second
  event consumer (`src/cli/drive.ts:61-96`).
- **Precedents:** the structural `AnyMsg` view ("read only what we name; absent stays absent");
  the pane-state-only feeds (`context_usage`, `limit_windows`) for fold discipline; `ToolPair`'s
  unmatched-call lamp for the running-agent lamp; the unknown-tool raw-name-as-DATA ruling
  (`ChatTranscript.tsx:133-135`) for `description`/`summary` in the detail slot; TD-016 as the
  pinned-surface ledger.

## Scope

In scope:

- Core (test-first, ADR-0006): ONE new `RunnerEvent` kind `agent_task`
  (phase-discriminated `started`/`ended`); the fold branch (duplicate-start no-op, first-end
  wins, unknown-task end dropped, `lastLifeAt` refresh); the derived helper `openAgentTasks`
  (no new `LiveSessionState` field); `TranscriptLine` gains `parentToolUseId?` on the
  assistant/tool_use/tool_result arms + the `agent_task` arm.
- Adapter: `AnyMsg` structural members for the task family; `isAgentTask` discriminator
  (ambient `skip_transcript` and `local_bash` excluded — AGENTS only); the two `system`
  sub-arms (`task_started`, `task_notification`); `parent_tool_use_id` threaded as
  `parentToolUseId` on assistant/user emissions. Consciously UNREAD (TD-016 note): `task_updated`
  (one defensive arm reserved as a named branch point), `task_progress`,
  `background_tasks_changed`, `tool_use_result`.
- Pipeline: the `agent_task` arm — a `record('running')` checkpoint at every edge (the
  döküm-kaybı rule applied to subagent rows) + forward; NO audit row.
- CLI: `formatEvent` arms for both phases (stream); jsonl passes the event verbatim.
- UI: ChatTranscript composite block — the Task tool group adopts its agent task (description
  in the detail slot, running lamp until the end edge), children render indented inside the
  block (clamped while running, click-collapsed when ended), honest orphans degrade to
  top-level rows; `usePaneActivity` gains the running-agents precedence arm (after stale,
  before the tool verb); label families in BOTH bundles; `transcriptLineText` arms.
- E2E: scripted specs (agent block + count line; depth-2 + orphans; archived re-nesting) +
  one seeded session carrying agent rows.
- Docs: ROADMAP M8 line; TD-016's pinned/unread task-surface note; ADR-0013 addendum
  ("agent-task rows are INSIDE the existing chip grammar").

Out of scope (gates):

- The NULL-cost fix (interrupted legs record NULL cost — the queued follow-up from WO-0054's
  $0,00-wall note; operator-approved as its own WO, 2026-08-30).
- `task_progress` usage rollups; a tasks-panel UI; `forwardSubagentText` being enabled.
- Any `task_updated` read beyond the named defensive branch point.
- `wo_event` growth; any `session_usage`/budget change; any change to `costOf`/`applyResultCost`.
- The ADR-0007 carve-out list (WO ids, faz ids) — task ids/subagent types stay DATA, never display.

## Acceptance criteria

1. A drive whose step spawns a Task subagent emits `agent_task` started + ended through the
   runner → pipeline → store; the CLI stream shows `⇄ agent …` / `⇲ agent …`; the persisted
   transcript carries the agent rows and survives interrupt + restart (seed re-derives).
2. The live pane's activity line shows `N ajan sürüyor` while agents run (stale and plan_ready
   still outrank it; it reverts after the last end); ambient/background-shell tasks never count.
3. Behind the chip, the Task block carries the subagent's description in its detail slot, the
   running lamp until the end edge, the end digest after it; the subagent's own tool rows render
   indented INSIDE the block; unmatched parents/children degrade honestly (top-level row; one
   clamped orphan end only when a summary exists).
4. The usage of the four surfaces is one grammar: StepPane/ReviewPane/SessionPane/RoadmapPane
   all render agent rows through the same components; the archived session card re-nests
   identically after reload; the ledger gains no new card.
5. No `wo_event` row, no schema change, no budget/cost change; `npm run check:boundaries` stays
   green (the SDK name stays inside `src/adapters/runner/index.ts`).
6. Unit tests (core test-first), the 86 existing E2E specs, and the three new specs are green.

## Evidence required

- Probe t1 log (`docs/probes/cc-surface/raw/t1-task.log`) pinning `isAgentTask`'s third line,
  the nested `parent_tool_use_id` value, and the `tool_use_result` Task shape — BEFORE the
  adapter code lands.
- Stage 1: the CLI manual scenario (operator verdict); Stage 2: the `npm run dev` manual
  scenario (operator verdict). Each chunk closes on the operator's check (CLAUDE.md gate).

## Stop-and-ask gates

- If probe t1 shows real Task subagents carrying NEITHER `subagent_type` NOR an agent-ish
  `task_type`, the `isAgentTask` third line cannot be written honestly — stop and re-rule.
- If nested messages turn out NOT to carry `parent_tool_use_id`, the nesting scope degrades to
  flat rows — stop and re-scope with the operator before substituting another link.
- If an end arrives with no start in any dogfood run (the `task_updated`-only end), the one
  defensive arm lands — anything more re-opens TD-016's list with the operator.

## Notes

- Design source: the operator-approved session plan (2026-08-30, `.claude/plans/
  s-radaki-kuyruk-5-canl-eager-anchor.md`), rulings D1–D7; branch points are marked in plan.md.
- Stage 1 CLOSED on the operator's approval (2026-08-30, "onaylıyorum devam et") with the CLI
  manual scenario DEFERRED (the WO-0045 precedent) — the deferred check rides Stage 2's
  `npm run dev` scenario, which exercises the same rows live.
- The queue's other approved candidate (NULL cost on interrupted legs) is deliberately NOT here.
