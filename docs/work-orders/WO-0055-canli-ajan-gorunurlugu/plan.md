# WO-0055 plan — live agent visibility

Provenance: the operator-approved session plan (2026-08-30, `.claude/plans/
s-radaki-kuyruk-5-canl-eager-anchor.md`); scope locked at the planning round — v1 + nesting,
2 stages. SDK pins verified against `@anthropic-ai/claude-agent-sdk` 0.3.221 `sdk.d.ts`; wild
task-message evidence from `docs/probes/cc-surface/raw/{c2,s1-baseline,s3-two-notes}.log`.
**Probe t1 RAN (2026-08-30, `raw/t1-task.log`, allow-listed `probe-task.mjs`) and resolved every
branch point**: a real Task subagent carries `task_type: "local_agent"` + `subagent_type:
"general-purpose"`; `task_started.tool_use_id` IS the delegation call's id; the subagent's own
assistant/user messages carry `parent_tool_use_id` === that same id; `tool_use_result` for the
Task tool is rich (status/prompt/agentId/content/tokens) but its text ===
`task_notification.summary`'s — it stays UNREAD. Two wild surprises folded into the rulings
below: the SDK delegation tool is named **`Agent`** (not `Task`) on the wire, and a task can
RESTART after its end — the parent's `SendMessage` re-opened the SAME `task_id` with a NEW
`tool_use_id` (t1 lines 221–226), so the fold's replay guard keys on OPEN tasks, not on
"ever started".

## Design rulings

- **D1 — ONE core event kind, phase-discriminated** (`src/core/runner.ts`, the 17th
  `RunnerEvent` member):

  ```ts
  | { kind: 'agent_task'; phase: 'started' | 'ended'; taskId: string; callId?: string;
      description?: string; subagentType?: string;                       // started
      status?: 'completed' | 'failed' | 'stopped'; summary?: string;     // ended
      at?: string }
  ```

  Not two kinds: the lifecycle has observable states beyond two (`task_updated`'s
  `paused`/`is_backgrounded`, progress) a later WO may want; one arm in the pipeline switch,
  one in the fold. Fold rules (pure, append-only; status/cost/asks/notes untouched; `at`
  refreshes `lastLifeAt` — the `context_usage` liveness precedent):
  - started while an OPEN (started, not yet ended) task with the same `taskId` exists → the
    SAME state object (replay never double-opens). A start AFTER an end opens a NEW block —
    probe t1 lines 221–226: the parent's `SendMessage` legitimately re-opened the same
    `task_id` with a new `tool_use_id`.
  - ended closes an OPEN task (first end wins, a duplicate end is a no-op); an end with no
    open task behind it → DROPPED (ambient/replay artifact — no orphan wall).
  - NO new `LiveSessionState` field: running agents derive from entries —

    ```ts
    export function openAgentTasks(entries: TranscriptLine[]): { taskId: string; callId?: string; description?: string }[]
    ```

    which is why `seedLiveState` needs zero change (a restart mid-task re-derives the lamp
    and the count from the persisted rows).

- **D2 — `TranscriptLine`** (`src/core/types.ts:69-82`): `parentToolUseId?: string` on the
  assistant/tool_use/tool_result arms (absent = key omitted, the `callId?` discipline; the
  value is the Task call's callId) + the new arm
  `{ speaker: 'agent_task'; phase: 'started'|'ended'; taskId; callId?; description?;
  subagentType?; status?; summary? }`. Persistence is free — `session.transcript` is
  schema-free JSON, longer-row-wins (`store/index.ts:392`): no migration, no table, `schema.ts`
  UNCHANGED, and an archived card re-nests identically. `wo_event`'s CHECK gains NO kind.

- **D3 — adapter mapping** (`src/adapters/runner/index.ts`): structural `AnyMsg` members
  (`task_id?`, `tool_use_id?`, `description?`, `subagent_type?`, `task_type?`, `prompt?`,
  `skip_transcript?`, `status?`, `summary?`, `parent_tool_use_id?`); the `system` case gains
  two sub-arms — `task_started` + `task_notification` (valid statuses only, never fabricated) —
  both behind:

  ```ts
  function isAgentTask(m: AnyMsg): boolean {
    if (m.skip_transcript === true) return false;   // ambient: ignored entirely
    if (m.task_type === 'local_bash') return false; // wild-verified (probe c2/s1/s3)
    // PINNED by probe t1: a real Task subagent carries task_type 'local_agent' + subagent_type
    return m.subagent_type !== undefined || m.task_type === 'local_agent';
  }
  ```

  **The discriminator guards the START only.** REVISED against the first draft (the scripted
  test caught it): the wild `task_notification` carries NO task_type/subagent_type — bare
  `task_id` + `status` + `summary` (t1 line 121) — so an isAgentTask-guarded end would have
  dropped EVERY real end and left a stuck lamp. The END pairs by `task_id` (with
  `skip_transcript` still honored); the ambient safety lives in the FOLD's no-open-task drop,
  which is pinned at `agent-task.test.ts` (an end whose start was filtered → the SAME state).

  Wild-pinned addition (t1 line 109-110): the SDK delegation tool is named **`Agent`** on the
  wire — the label families gain `Agent` beside `Task` (`Devret` / `Devrediyor`), so the
  composite block's label resolves through `toolLabel` and never falls to the raw-name data
  exception.

  `parent_tool_use_id` (string, non-empty) spreads onto every `assistant_text`/`tool_use`/
  `tool_result` emission as `parentToolUseId`; `null` → omitted. Consciously UNREAD (TD-016
  note): `task_updated` (BRANCH POINT: one defensive terminal-arm IF a notification-less end
  is ever observed — the fold's first-end-wins makes it additive), `task_progress`,
  `background_tasks_changed`, `tool_use_result` (no Task output type in sdk-tools.d.ts; the
  end summary rides `task_notification.summary`; the Task pair's click-open body stays the
  `tool_result` text — the actual report). `forwardSubagentText` stays default-false.
  `costOf`/`applyResultCost`/the interrupt block are untouched; agent events ride the generic
  queue path (`sawToolEvent` stays false — the context cadence is unchanged).

- **D4 — ChatTranscript nesting** (`src/ui/components/session/ChatTranscript.tsx`): `ChatGroup`
  gains `agent?` on the `tool` arm + a standalone `agent` arm + `children?: ChatGroup[]`; the
  pairing logic (pair-by-callId + FIFO fallback + the plan pseudo-result classifiers) moves
  VERBATIM into a helper reused for root and children. Walk rules: parentless rows byte-identical;
  `parentToolUseId` rows join `byCallId.get(parentToolUseId)`'s children (depth ≥2 natural) or
  degrade to top-level unchanged (honest orphan — restart mid-task, cap beheading); started +
  matching callId → the tool group ADOPTS the agent (label stays `Devret`, description fills the
  detail slot — empty today since `summarizeToolInput` reads none of Task's keys); started
  without a match → a standalone `agent` group; ended → `agent.status` + `agent.summary`, lamp
  off; a beheaded end renders ONE clamped row only if a summary exists, else nothing. Post-pass:
  an agent block with a summary and no `result` gets `result = { summary, isError: failed }` —
  the real `tool_result` (the report) always wins the pair. Lamp condition `!result &&
  !agent?.status`; children clamped (`max-h` + overflow) while RUNNING, click-collapsed when
  ended (the live-edge ruling the Stage-2 manual check votes on); indent one gutter step
  (`pl-4`); pulse stays on the flat tail; cap/bottom-pin/ResizeObserver untouched.

- **D5 — activity-line precedence + labels** (`pane-chrome.tsx:60-88`, both label bundles):
  `plan_ready → stale → RUNNING AGENTS → newest unmatched tool verb → Düşünüyor` (silence still
  outranks motion; `Devrediyor` alone is strictly less information; `local_bash` tasks produce
  no agent rows so the count cannot inflate). New keys — `agentRunningLine(n)`
  (tr «N ajan sürüyor» / en «N agent(s) running»), `agentTaskLabel`, `agentTaskDone/Failed/
  Stopped`, `orphanAgentEnd` — plus the two `transcriptLineText` arms. ADR-0007/0012 ruling
  relied on: `description`/`summary` are operator-language CONTENT in the detail slot (the
  unknown-tool raw-name-as-DATA precedent, `ChatTranscript.tsx:133-135`); `taskId`/`callId`/
  `subagentType` are DATA, never rendered; the WO-id/faz-id carve-out list is NOT extended.

- **D6 — pipeline + CLI:** one `agent_task` arm in `pipeline.ts` (beside `tool_result`'s):
  `record('running')` checkpoint at EVERY edge (the döküm-kaybı rule applied to subagent rows —
  an interrupt mid-task must not lose them) + forward. NO audit row. CLI `formatEvent` (English,
  ADR-0007): `⇄ agent <description>` / `⇲ agent <status> — <summary>`; jsonl verbatim; quiet
  undefined.

- **D7 — docs:** order.md (this WO's first in-repo record of the queue line) + this plan;
  ROADMAP M8 line; TD-016 gains the task-message family (read: started/notification +
  `parent_tool_use_id`; consciously unread: updated/progress/background_tasks_changed/
  tool_use_result); ADR-0013 one-paragraph addendum ("agent-task rows are INSIDE the existing
  chip grammar — a composite tool block, not a second live surface, not a pane, not a ledger
  card"). CLAUDE.md unchanged.

## Stage 1 — core + adapter + CLI (test-first)

Step 0: probe t1 (`probe-task.mjs`, one Task-subagent spawn → `raw/t1-task.log`) pins
`isAgentTask`'s third line, the nested `parent_tool_use_id` value, and `tool_use_result`'s Task
shape. Then: core types + fold + `openAgentTasks` (tests FIRST, red) → adapter `AnyMsg` +
translate pins → pipeline arm + CLI → green.

Tests, by behavior:
1. `src/core/__tests__/agent-task.test.ts` (NEW): fold — started appends exactly one row
   (whole-object `toEqual`, absent keys stay absent); duplicate start → same object (`toBe`);
   ended appends status+summary; duplicate end no-op; unknown-task end dropped; ambient-filtered
   start's end dropped; status/cost/asks/notes untouched; `lastLifeAt` refreshed from `at` only.
   `openAgentTasks` — open/paired/two-open-one-ended/stray-end/empty. `seedLiveState` — persisted
   agent rows re-seed verbatim, open task re-derives; agent rows survive a `stopped` row.
2. `pipeline.test.ts`: agent edges checkpoint the transcript at EVERY edge; NO `recordAuditEvent`;
   interrupt right after a start persists the started row.
3. `src/adapters/runner/index.test.ts`: `local_bash` → `[]`; `skip_transcript` → `[]`;
   `subagent_type` start → full event with `callId === tool_use_id` + `at`; missing
   `tool_use_id` → no `callId` key; notification completed/failed/stopped → ended (+ summary
   when present); unknown status → `[]`; `task_updated`/`task_progress`/
   `background_tasks_changed` → `[]`; `parent_tool_use_id` threading (string → key, null → none);
   existing cost pins stay green.
4. `store.test.ts`: agent rows round-trip through `recordSession`/hydrate; shorter later write
   does not drop them.
5. `cli.test.ts`: both `formatEvent` phases; quiet/jsonl passthrough.

Manual scenario (S1, ~3 min, operator): `npm run cli drive <WO> -- --format stream` on a step
whose prompt spawns a subagent — see the order's Evidence section; verdict gates S2.

## Stage 2 — live surface + E2E

`ChatTranscript.tsx` (walker + composite block + visibility rule), `pane-chrome.tsx`
(precedence arm), labels (both bundles + `transcriptLineText`), `e2e/ui.mjs` specs A–C
(agent block + count line; depth-2 + orphan ends; archived re-nesting from a seeded session),
`e2e/seed.ts` seeded agent rows. All 86 existing specs stay green (the walker refactor touches
every transcript render). Manual scenario (S2, ~4 min, `npm run dev`) per the order.

## Risks / branch points

| Risk | Mitigation |
|---|---|
| Task subagent's `task_type`/`subagent_type` unverified | Probe t1 pins the discriminator (stop-and-ask gate if neither is agent-ish) |
| Nested `parent_tool_use_id` value unverified | Same probe; the walker degrades honestly on absent/unmatched |
| `task_updated`-only end (no notification) → stuck lamp | Zero occurrences in every probe log; one defensive arm reserved, first-end-wins makes it safe |
| Report `tool_result` arrives after the end | The pair owns `result`; the post-pass only fills when no tool_result came |
| Cap beheads a parent, children survive | Orphan rules (top-level children; one clamped end row) |
| Walker refactor regresses one of 86 specs | Pairing logic moves verbatim; the suite is the net |
