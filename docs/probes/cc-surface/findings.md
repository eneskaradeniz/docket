# WO-0001 — Claude Code programmatic surface probe: findings

## İçindekiler

- [Measured versions](#measured-versions)
- [Q0 — CLI or SDK?](#q0--cli-or-sdk)
  - [What was measured](#what-was-measured)
  - [Recommendation (for the ruling)](#recommendation-for-the-ruling)
- [Q1 — Stream schema](#q1--stream-schema)
- [Q2 — Plan mode](#q2--plan-mode)
- [Q3 — Plan approval](#q3--plan-approval)
- [Q4 — Permission prompts (the stop-and-ask question)](#q4--permission-prompts-the-stop-and-ask-question)
- [Q5 — Resume](#q5--resume)
- [Q6 — Write fencing (TD-001)](#q6--write-fencing-td-001)
- [Q7 — Interruption and persistence](#q7--interruption-and-persistence)
- [Q8 — Other providers (survey only)](#q8--other-providers-survey-only)
- [S — Steering surface (WO-0045, measured 2026-08-26)](#s--steering-surface-wo-0045-measured-2026-08-26)
- [Summary & recommendation](#summary--recommendation)

> Throwaway measurement, not application code. Every claim about observed output
> cites a file under `raw/`. Status: all eight questions measured; Q4 verdict (a)
> observable; Q6 fence holds; ready for verification.

## Measured versions

| Surface | Version | Evidence |
| --- | --- | --- |
| `claude` CLI | **2.1.220 (Claude Code)** — `/opt/homebrew/bin/claude` | `raw/q0-cli-version.txt` |
| Claude Agent SDK (TypeScript) | **`@anthropic-ai/claude-agent-sdk@0.3.221`** (dist-tags: `latest 0.3.221`, `next 0.3.222`) | `raw/q0-sdk-version.txt` |
| SDK type definitions | from the installed `sdk.d.ts` of 0.3.221 | `raw/q0-sdk-types.txt` |
| SDK runtime smoke | one 4-turn session, model `glm-5.2[1m]`, cost `$0.383583` | `raw/q0-sdk-smoke.log` |

Note: `@anthropic-ai/claude-code-sdk` 404s on npm — the package was renamed to
`@anthropic-ai/claude-agent-sdk`. The CLI flag surface (incl. `--output-format`,
`--permission-mode`, `--resume`, `--include-hook-events`, `--add-dir`,
`--allowedTools`/`--disallowedTools`, `--dangerously-skip-permissions`) is
captured verbatim in `raw/q0-cli-help.txt`.

## Q0 — CLI or SDK?

**Verdict: the Agent SDK exposes a contractual, programmatic channel for both
tool-permission decisions and plan approval. Spawning the CLI and parsing
`stream-json` is not required to get a stable permission/approval channel.**

This triggers the order's **Gate 1** ("if the SDK offers a contractual permission
channel, stop and report before measuring the CLI in depth"). Stopping for a
ruling; the remaining questions are re-scoped pending it.

### What was measured

**Permission channel — callback (runtime-confirmed).** `query({ options: { canUseTool } })`
accepts a host-supplied async callback. The installed type (`raw/q0-sdk-types.txt`,
line 206) is:

```ts
type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {
  signal: AbortSignal; suggestions?: PermissionUpdate[]; blockedPath?: string;
  decisionReason?: string; title?: string; displayName?: string; description?: string;
  toolUseID: string; agentID?: string; requestId: string; matchedAskRule?: {...};
}) => Promise<PermissionResult | null>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: ...; updatedPermissions?: ...; toolUseID?: string }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string };
```

The smoke (`raw/q0-sdk-smoke.log`) drove one session that tried to write a file in
`default` mode with a `canUseTool` that denied. The callback **fired 3 times** —
verbatim first invocation:

```json
CAN_USE_TOOL {"EVENT":"canUseTool","toolName":"Write",
"toolUseID":"call_f447758ca34147d6aa6384f2","requestId":"a891061f-d354-4017-85ae-c01de906897a",
"displayName":"Write","input":{"file_path":"/tmp/cc-sdk-smoke/probe-marker.txt","content":"hello"}}
```

The `{behavior:'deny'}` return was honored — nothing was written; the model
attempted a `Write` retry, then fell back to `Bash`, and that `Bash` call hit the
callback too (`CAN_USE_TOOL_CALLS 3`). So the channel is real, per-call, carries
the full tool input plus a stable `requestId`/`toolUseID`, and the host's decision
is binding.

**Permission channel — stream event (wire form).** The same request exists on the
wire as `SDKControlPermissionRequest` with `subtype: 'can_use_tool'`, `tool_name`,
`input`, `request_id`, `decision_reason`, `decision_reason_type`
(`raw/q0-sdk-types.txt`). With a `canUseTool` callback present, the raw control
request does **not** appear in the async-generator stream (0 occurrences in the
smoke) — the SDK delivers the decision through the callback, so a host never has
to parse stdout for it. (Without a callback it would surface as a control request
the host must answer.)

**Plan approval.** `permissionMode: 'plan'` ("file edits are never auto-approved…
prompt through your `canUseTool` callback"; shell writes too on CLI ≥ v2.1.212) —
so plan-mode approval handoff rides the **same** `canUseTool` channel. `Options.planModeInstructions`
customizes the workflow; `Query.setPermissionMode(mode)` changes mode mid-stream.
Plan-exit is the model's `ExitPlanMode` tool (observed in this very session's tool
list). `permissionMode` values: `'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`.

**Session id + cost.** `session_id` first arrives in the `system/init` message
(`raw/q0-sdk-smoke.log`: `"subtype":"init","session_id":"c0f2c5d2-…"`). Per-turn and
total cost/usage arrive in the `result` message: `total_cost_usd`, `usage`
(`input_tokens`, `cache_read_input_tokens`, `output_tokens`), `num_turns`, plus a
`permission_denials[]` summary of denied calls. Resume is a first-class option:
`Options.{ resume, forkSession, resumeSessionAt, persistSession }`.

### Recommendation (for the ruling)

Adopt the **SDK as the measured primary surface** for the rest of the probe. The
CLI is kept only as light ground-truth where it is cheap and decision-relevant
(Q1 stream schema, since the SDK yields the same `SDKMessage` stream; Q5/Q7 resume
& persistence, which are about the on-disk session files shared by both). This is
also the path Docket's M2 session runner would take (drive the SDK from the
Electron main process), so measuring it is the most decision-relevant use of the
probe. Deep CLI-spawning-for-permissions (Q2/Q3/Q4 via stdout) would measure a
deliberately degraded interface and is dropped unless the operator rules
otherwise.

---

## Q1 — Stream schema

**What ran.** SDK: `query({ prompt:"Reply with one word: pong", maxTurns:1 })` →
`raw/q1-sdk-stream.log` (8 lines). CLI ground-truth:
`claude -p "…" --output-format stream-json --verbose` → `raw/q1-cli-stream.jsonl`
(21 lines). Both emit the **same event shapes**; the SDK yields parsed
`SDKMessage` objects, the CLI emits them as JSONL.

**Event order.** `system` (`subtype: hook_started` → `hook_response` → `init`) →
`assistant` (carries `message.content` text/thinking blocks) → `result`.

**Where `session_id` first arrives.** On the very first `system` message
(`hook_started` carries `session_id`); the canonical init is `system/init`, which
also carries `cwd` and the full `tools[]` list. Verbatim
(`raw/q1-sdk-stream.log`):

```json
{"type":"system","subtype":"init","cwd":"/private/tmp/cc-sdk-smoke","session_id":"9143c3a5-…","tools":["Task","Bash",…]}
```

**Token/cost usage.** On the `result` message — `total_cost_usd`, `usage`
(`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
`output_tokens`, `server_tool_use`), plus `num_turns`, `duration_api_ms`,
`stop_reason`. The per-turn `assistant.message.usage` field exists but read
`{"input_tokens":0,"output_tokens":0}` in this run — use the `result` message
for accounting.

**CLI ground-truth gotchas (verbatim, `raw/q1-cli-stderr.txt`).** `--print
--output-format stream-json` **requires `--verbose`** — without it the CLI exits 1
with `Error: When using --print, --output-format=stream-json requires --verbose`.
And stdin should be redirected (`< /dev/null`), else it warns and waits 3s for
piped input.

## Q2 — Plan mode

**What ran.** SDK `permissionMode:"plan"` on a file-creation task (maxTurns 8) →
`raw/q2-plan.log`. Session id `f9af86c2-9de0-49bb-9d27-61bc54611c3b` (reused in Q3).

**How the finished plan is signalled.** Per the surface, plan completion is the
model calling the `ExitPlanMode` tool (its input carries the plan), observed as a
`tool_use` block in the stream. **Caveat from this run:** `ExitPlanMode` was *not*
in the advertised `tools[]` list and the model could not invoke it — it said so
verbatim: *"ExitPlanMode isn't in my available tools list explicitly … I don't see
ExitPlanMode in my function list."* It delivered the plan as assistant **text**
instead (`raw/q2-plan.log` final assistant message: *"Here's my plan: …"*). The
docs state plan mode is "wrapped with read-only enforcement preamble and
ExitPlanMode protocol footer," so the missing tool may be version/config-specific
— flag for re-measurement; it does not change the two load-bearing facts below.

**Exit or wait?** The stream **ends** — a `result` message with `stop_reason:
"end_turn"`, `num_turns: 4`, `subtype: "success"`. It does **not** block or wait
for interactive approval. (Verbatim result in `raw/q2-plan.log`.)

**Stray write during planning.** The model attempted one `Write` and two `Bash`
calls despite the "do not make changes" instruction; the file was **not** created
and `result.permission_denials` was `[]`. With no `canUseTool` set, a plan-mode
write in headless mode was a no-op here rather than a recorded denial.

**Conclusion.** Plan completion terminates the turn (no blocking). Programmatic
approval is therefore a **separate step**, not an in-band reply to a waiting
process — measured in Q3 as `resume` + `setPermissionMode` away from `plan`.

## Q3 — Plan approval

**What ran.** Resumed Q2's session (`resume:"f9af86c2-…"`) with
`permissionMode:"acceptEdits"` and the prompt *"Approved — go ahead and create
the file exactly as you planned."* → `raw/q3-approve.log`.

**Result (verbatim).** Same `session_id` (`f9af86c2-…`); one `Write` tool use,
**auto-approved** (`CAN_USE_TOOL_CALLS 0` — `acceptEdits` never calls `canUseTool`
for file ops); the file was created with contents `demo`; `num_turns:2`,
`total_cost_usd:0.060` (cheap — context was served from cache).

**Verdict.** Approval is delivered programmatically by **resuming the session with
the permission mode moved off `plan`** (here `acceptEdits`; `default` would route
through `canUseTool` instead) plus a plain *"approved, proceed"* user message.
No special "approve" verb or in-band reply to a waiting process is needed (the
process had already ended at Q2). The approved plan **survives the resume**: the
model continued the planned work on the same session id with prior context intact.

## Q4 — Permission prompts (the stop-and-ask question)

**Verdict: (a) observable in the stream.** A tool-permission request is observable
— and answerable — through a stable, contractual channel. Gate 2 is **not**
triggered. The stop-and-ask design has a firm foundation.

**Three independent observable channels were confirmed:**

1. **`canUseTool` callback** (default mode) — the *decision* channel. Runtime proof
   from the Q0 smoke (`raw/q0-sdk-smoke.log`): fired for `Write` and the `Bash`
   fallback, each carrying `{toolName, input, toolUseID, requestId, title,
   displayName, decisionReason, blockedPath}`; the host's `{behavior:'allow'|'deny'}`
   is binding.
2. **`SDKControlPermissionRequest` wire event** (`subtype:"can_use_tool"`,
   `request_id`) — the stream form, present in `sdk.d.ts` (`raw/q0-sdk-types.txt`).
   With a `canUseTool` callback present the request is delivered through the
   callback and does not appear separately in the stream (0 occurrences in the
   smoke); without a callback it surfaces as a control request the host answers.
3. **Hooks** — a `PreToolUse` hook fires on every tool call, and there is a
   dedicated **`PermissionRequest`** hook event. Runtime proof (`raw/q4-hooks.log`):
   ```
   HOOK_PreToolUse keys=["session_id","transcript_path","cwd","prompt_id",
     "permission_mode","effort","hook_event_name","tool_name","tool_input",
     "tool_use_id"] tool="Write" event="PreToolUse"
   HOOK_PermissionRequest keys=[…,"tool_name","tool_input","permission_suggestions"]
     event="PermissionRequest"
   ```
   The same `Write` also reached `canUseTool` (`requestId:"f5505be8…"`) and then
   executed. Hook events reach the stream when `includeHookEvents:true`.
   `HOOK_EVENTS` also includes `PermissionDenied` (`raw/q0-sdk-types.txt`).

**Under the other modes:**
- `acceptEdits` — file ops auto-approved; `canUseTool`/`PermissionRequest` **not**
  invoked (Q3: a `Write` under `acceptEdits` ran with `CAN_USE_TOOL_CALLS 0`).
- `bypassPermissions` — **not measured**: constructing the scenario
  (`permissionMode:"bypassPermissions"` + `allowDangerouslySkipPermissions:true`)
  was denied by the host session's auto-mode classifier (`raw/q4-bypass.txt`).
  Consistent with its documented semantics — it auto-approves everything that
  reaches the permission-mode step, so by design there is no gating event to
  observe. No workaround attempted.
- `dontAsk` — denies anything not pre-approved; `canUseTool` never called
  (documented, `raw/q0-sdk-types.txt`).

**What this implies for the design.** Docket's stop-and-ask UI maps directly onto
`canUseTool` (the host decides allow/deny per call) for the "ask" path; the
`PermissionRequest` hook is a clean pre-render/logging point for the consent card;
and `acceptEdits`/`bypassPermissions`/`dontAsk` are the "don't ask" modes for
trusted or autonomous tracks, where the stop-and-ask surface is simply not
invoked. The central mechanism the product depends on is buildable on a
contractual channel — no stdout-scraping required.

## Q5 — Resume

**Does `--resume` work in `-p` mode? Yes — but it is cwd/project-scoped.**

- **CLI from the wrong cwd fails** (`raw/q5-cli-resume.stderr.txt`):
  `No conversation found with session ID: f9af86c2-…` — the session was created in
  `/tmp/cc-sdk-smoke`, and the resume was attempted from the docket repo root (a
  different project key).
- **CLI from the matching cwd succeeds** (`raw/q5-cli-resume-fromcwd.json`,
  exit 0): same `session_id`, `num_turns:1`, and the model recalled the prior
  context — answer: *"The file `plan-demo.txt`."* So the id is reusable across the
  CLI boundary.
- **SDK resume** was already proven in Q3 (`options.resume` + matching `cwd`).

**Is the session id stable across restarts? Yes.** It is a UUID, used verbatim as
the on-disk filename, and reloadable by any process (SDK or CLI) that resumes from
the originating project directory. `options.persistSession:false` skips writing the
file (no resume possible); default `true` persists.

**Relationship to on-disk files.** One JSONL transcript per session, at
`~/.claude/projects/<projectKey>/<sessionId>.jsonl`, where `<projectKey>` is the
session `cwd` with `/` → `-` (e.g. cwd `/private/tmp/cc-sdk-smoke` →
`-private-tmp-cc-sdk-smoke`). A second `~/.claude/session-env/<sessionId>/` holds
env state. The transcript (inspection of the Q2 session's on-disk JSONL: 33 records)
carries the full history — `assistant`/`user`/`tool_use`/`tool_result`/`thinking`/
`attachment` records; the first record is a summary (`type/operation/timestamp/
sessionId`). `resume` reads this file back.

**Design implication.** A track's session is resumable as long as Docket resumes it
from that track's repo cwd — which is exactly where the session ran. Cross-cwd
resume is not supported by id alone; the project directory is part of the address.

## Q6 — Write fencing (TD-001)

**TD-001 verdict: the fence HOLDS.** A session can be restricted to writing only
under `docs/**` while retaining read access to the rest of the repo. Attempted
violations are denied. Single-repo role separation (ADR-0002) is enforceable by
configuration — the tool's permission mechanism, not a prompt. Gate 3 is **not**
triggered.

**The working mechanism is the host `canUseTool` policy.** A scratch repo
`/tmp/cc-fence/{docs,src}` was fenced by a `canUseTool` callback that allows writes
only under `/tmp/cc-fence/docs/`, denies writes elsewhere, denies `Bash`, and
allows reads anywhere. The model was asked to (1) read `src/keep.txt`, (2) write
`docs/marker.txt`, (3) write `src/marker.txt`. Verbatim decisions
(`raw/q6-fence.log`):

```
DECISION {"toolName":"Write","path":"/tmp/cc-fence/docs/marker.txt","behavior":"allow"}
DECISION {"toolName":"Write","path":"/tmp/cc-fence/src/marker.txt","behavior":"deny"}
POST docs/marker.txt=true src/marker.txt=false
```

Read was retained — the model quoted `src/keep.txt` (`src original`) — and
`src/marker.txt` was **not** created. The fence is asymmetric and holds.

**Two caveats that shape how Docket must build it:**

1. **The allowlist-by-path approach does not work as a fence.**
   `allowedTools:["Edit(docs/**)","Read","Grep","Glob"]` + `permissionMode:"dontAsk"`
   denied the `docs/` write too — the scoped `Edit(docs/**)` allow rule did **not**
   auto-approve the `Write` tool call, so the result was a total write-lock, not an
   asymmetric fence (`raw/q6-allowlist.log`: both writes appear in
   `permission_denials`). Path-scoped *allow* rules are unreliable for fencing
   writes; use a `canUseTool` policy or path-scoped *deny* rules.
2. **Declarative deny rules cover file tools but not `Bash`.** `disallowedTools`
   like `Edit(src/**)` deny `Write`/`Edit`/`NotebookEdit` under that path in every
   mode, but a `Bash` redirection (`printf > src/x`) is a different tool and is not
   caught by an `Edit(...)` rule. The general mechanism — the one that catches both
   — is the host `canUseTool` policy, which can inspect the `Bash` command too.
   Docket's session runner must therefore enforce role write-scopes in `canUseTool`,
   not rely on declarative rules alone.

**What this means for ADR-0002.** The architect role (write scope = the decision
store, e.g. `docs/`) and the implementer role (write scope = the track's repo) can
both be fenced in a single shared repo by per-role `canUseTool` policies, with
reads retained across the repo. The "isolation rests on the tool's permission
mechanism" assumption holds; TD-001 can move toward closure with the addendum that
the fence is a host-side policy, not a declarative-only rule.

## Q7 — Interruption and persistence

**After a hard kill, the session is resumable.** A multi-file-write session
(`eb4bceea-…`) was SIGKILLed mid-run. The on-disk transcript had persisted
partial progress — 21 records incl. `system/init`, assistant turns, and
`tool_use`/`tool_result` pairs — despite the host node process being killed. The
SDK writes the transcript incrementally per turn, not only at completion.

Resuming the same id (`raw/q7-resume.log`, same `session_id`, `num_turns:5`,
`subtype:success`) loaded that history; the model re-grounded on disk state and
reported verbatim: *"All six files exist and contain the correct spelled-out
numbers. Nothing is missing."*

**After an app restart, the prior transcript is read from**
`~/.claude/projects/<projectKey>/<sessionId>.jsonl` (the same file Q5 maps), where
`<projectKey>` is the session cwd with `/` → `-`. `resume` loads it; no separate
snapshot store is involved.

**Graceful interrupt.** The SDK exposes `Query.interrupt(): Promise<SDKControlInterruptResponse | undefined>`
(`sdk.d.ts` line 2293) — the preferred in-process stop, versus killing the process.

**Caveat for the runner design.** Killing the SDK **host** (node) does not
necessarily stop the spawned `claude` child immediately — after the SIGKILL the
child had still completed the pending writes before exiting. Docket's runner
should use `interrupt()` for a controlled stop and ensure child cleanup on a hard
kill.

## Q8 — Other providers (survey only)

Docs-level survey (no install/drive); details and sources in `raw/q8-survey.md`.

**OpenAI Codex CLI** — streaming JSONL events (`codex exec --json`, `thread.*`
events); resumable (`codex exec resume <id>`); permissions are **mode-based**
(read-only / workspace-write / full-auto), no documented per-call host callback.

**Google Gemini CLI** — headless `-p` with JSON output (coarser than a granular
event schema); resumable (`--resume <id>`); `--sandbox`/`-s`, with headless
permissions pre-configured/auto-approved, no documented per-call host callback.

**What generalises (for M2's session-runner port).** Streaming events and
resumable session ids are common to all three. The **per-call programmatic
permission channel** (Q4's `canUseTool`) is currently Claude-specific; Codex and
Gemini gate by coarse modes and auto-approve in headless. A provider-neutral port
should treat fine-grained stop-and-ask as a Claude-adapter capability and fall back
to coarse modes elsewhere — consistent with ADR-0006's "one adapter first."

---

## S — Steering surface (WO-0045, measured 2026-08-26)

Measured for the operator-tempo order: queueing a note into a RUNNING query via
streaming-input mode, its delivery boundary, the interrupt receipt, and cancel.
Harness: `probe-steer.mjs` (sibling of `probe.mjs` — the scenarios need an inline
`AsyncIterable<SDKUserMessage>` prompt plus control-request calls, which a JSON
config cannot express). Every claim below cites a `raw/s*.log`.

### What was measured

**Setup common to all s-runs.** `query({ prompt: <AsyncIterable<SDKUserMessage>,
options: { cwd, permissionMode: 'default', maxTurns: 6, abortController,
canUseTool: allow } })` — a push-side queue seeds one uuid-stamped user message
("the seed") and can push more ("notes") later; closing the iterable completes it.
`system/init` reports `capabilities: ["interrupt_receipt_v1",
"interrupt_cancel_queued_v1", "msg_lifecycle_v1"]` (`raw/s1-baseline.log`).

**Input mode is selected by the prompt's TYPE — and the iterable must be an
AsyncIterable, not a bare iterator.** Passing `queue[Symbol.asyncIterator]()`
(a `{next}`-only iterator) kills the child process at once ("Operation aborted",
`raw/s1-baseline.log` first run — harness bug, kept as the negative evidence);
passing the iterable itself works. The seed message consumes normally.

**Closing the input iterable is SAFE at any time.** Closed immediately after the
seed push (`s1`): the CLI still ran the whole turn and the generator ended cleanly
after the result (`STREAM_ENDED`, `raw/s1-baseline.log`). Closed only after the
final result (`s2b`): ended cleanly 0.3s later (`raw/s2b-late-note.log`). Left
open: the generator stays open after a result until input closes (watchdog close
in `raw/s2-midturn-note.log`). So the adapter rule is: keep the iterable open
while notes may still be live; close it at the final result; closing never kills
in-flight work.

**`command_lifecycle` messages track OUR uuid through the queue** (capability
`msg_lifecycle_v1`): `state: queued → started → completed` (and `cancelled`),
one event per state transition, `command_uuid` = the uuid we stamped
(`raw/s1-baseline.log`, `raw/s2-midturn-note.log`). This is the delivery
observability channel.

**Delivery (the WO's core assumption — corrected).** A note pushed mid-turn is
consumed at the next agent-turn boundary — the tool-result slot — exactly once
(`queued` at push, `started` at the boundary, `raw/s2-midturn-note.log`). A note
pushed while the query is IDLE (after a result) starts a NEW turn spontaneously
and produces a SECOND result (`results=2`, `raw/s2b-late-note.log`) — the drive
extension, on both boundary kinds. TWO notes pushed together coalesce into ONE
merged turn: both `started` at the same boundary, one assistant call, one result
(`raw/s3-two-notes.log`). **No note (nor the streaming seed) is ever echoed back
as a `user` message** (`echoes=0` in every s-log; the only `user` text message
ever observed is the system-synthesized interrupt notice with a uuid that is not
ours, `raw/s4-interrupt-receipt.log`). Order.md's "delivery surfaces as the
transcript's user turn" is therefore DISPROVEN as an SDK observation; the adapter
detects delivery from `command_lifecycle` (uuid match) and Docket renders the
operator line from its own fold — the product behavior is unchanged.

**Interrupt receipt (AC1).** With a note queued, `query.interrupt()` resolves
`{ still_queued: ["<our-uuid>"] }` — exactly the documented shape
(`raw/s4-interrupt-receipt.log`). BUT the interrupt cancels only the RUNNING
command (`command_lifecycle: cancelled` + `result` subtype
`error_during_execution`): **the queued note then runs anyway** (`started` in the
same tick, `result#2 success`) — the queue survives an interrupt BY DESIGN. On a
fresh `resume` query the model's history shows the note's effect
(`RESUME_ASSISTANT`, same log). Docket's Durdur is NOT `interrupt()` — it is
`abortController.abort()`, which kills the CLI process; a queued note DIES with
it (never `started`, no result, `raw/s4b-abort-pending.log`) — the measured
justification for the mirror-is-truth rule (Docket's persisted mirror is the only
carrier across a stop→resume).

**Cancel / retract (AC5).** `Query.cancelAsyncMessage(uuid)` exists at runtime
(`typeof function`) though missing from `sdk.d.ts` (`raw/s5-cancel.log`). An
IMMEDIATE cancel (same tick as the push) returns `false` and the note still runs
— the message reaches the CLI's own queue before the cancel (`raw/s5-cancel.log`).
A cancel 2s after the push (mid-turn, pre-drain) returns `true`, emits
`command_lifecycle: cancelled`, and the note never runs
(`raw/s5b-cancel-delayed.log`). So retract is genuinely best-effort with a real
sub-second-to-seconds window; `false` means the note WILL run.

**Cost across results.** A steered drive emits ONE result per command (the note's
merged command gets its own result — `raw/s2b-late-note.log`, `raw/s5-cancel.log`)
and assistant-message `usage` is all zeros (every s-log) — the result is the only
cost source. Whether `total_cost_usd` is cumulative or resets per command is
ambiguous across runs (s2b fits cumulative; s2 fits per-command); the adapter
must therefore accumulate deltas between consecutive result figures within a
drive (add the figure when it is lower than the previous — a reset; add the
difference when it is higher), which is correct under either model.

**shouldQuery:false (documented, not shipped).** The note is queued, then
`started`→`completed` immediately with an all-zero-usage result — an explicit
no-op turn receipt, not a silent append (`raw/s7-shouldquery.log`).

**Resume echo (s6).** A streaming-mode seed on `resume` produces NO user echoes
and NO replayed user messages (`raw/s6-resume-echo.log`) — echo detection is not
a viable delivery channel on resumes either; `command_lifecycle` is.

### Verdict for WO-0045

The two gated shapes measured TRUE: `streamInput` queueing (type-selected input,
uuid-stamped, boundary-consumed exactly once) and the `interrupt()` receipt
(`still_queued` with our uuid). The corrected facts the adapter is built on:
delivery via `command_lifecycle` uuid matching (never user echoes); extension is
real on both boundary kinds and is the delivery mechanism (operator ruling
2026-08-26 embraced it); Durdur (abort) kills the SDK queue — the Docket mirror
carries notes across stops; retract is best-effort with a `cancelled` lifecycle
receipt; cost accumulates across per-command results by delta.

**Measured versions (this section):** `claude` CLI **2.1.231** (drifted from the
2.1.220 of Q0 — capabilities unchanged), `@anthropic-ai/claude-agent-sdk`
**0.3.221**, model observed `glm-5.3`. Re-measure on bump (TD-016).

---

## Summary & recommendation

**Headline.** Claude Code's programmatic surface is **contractual enough to build
the session pane on.** The two fragile points the order worried about both hold:

- **Stop-and-ask (Q4)** — observable *and answerable* through a stable channel:
  `canUseTool` (decision), `SDKControlPermissionRequest` (wire event), and
  `PreToolUse`/`PermissionRequest` hooks. Verdict **(a)**. Gate 2 not triggered.
- **Plan approval (Q2/Q3)** — `permissionMode:'plan'` routes writes to the same
  `canUseTool` channel; the turn ends on plan completion (no blocking), and approval
  is `resume` + a mode change + an "approved" message. The approved plan survives
  resume.
- **Write fencing / TD-001 (Q6)** — a session can be fenced to `docs/**`-only
  writes with reads retained, via a host `canUseTool` policy. **Fence holds.** Gate
  3 not triggered → ADR-0002's single-repo role separation is enforceable.

**CLI vs SDK (Q0, for the architect's ruling).** Recommend the **Agent SDK
(`@anthropic-ai/claude-agent-sdk@0.3.221`)** as the session-runner mechanism: it
exposes `canUseTool`, `permissionMode`/`setPermissionMode`, `includeHookEvents`,
`resume`/`persistSession`, structured `SDKMessage` streaming, and per-session
`total_cost_usd` — all as a typed, in-process library. Spawning the CLI and parsing
`stream-json` is not needed for a stable channel (and carries two gotchas:
`--print --output-format stream-json` requires `--verbose`, and `--resume` is
cwd-scoped). The CLI remains useful as a subprocess for non-TS runtimes.

**Carries forward to M2.** Define the session-runner **port in `core`** from these
observed facts, with one SDK adapter. The port's load-bearing operations: drive a
session (`query`), observe the stream (`SDKMessage`), decide permissions
(`canUseTool`), switch mode (`setPermissionMode`), resume/fork (`resume`,
`forkSession`), and read cost (`result.total_cost_usd`). Do **not** generalize the
permission channel into the port's required shape before a second provider is
measured — per ADR-0006, it is currently Claude-specific.

**Measured versions.** `claude` CLI 2.1.220; `@anthropic-ai/claude-agent-sdk`
0.3.221. This surface is not a stable contract — re-measure on bump.

---

## C — Context usage + resume cost (WO-0046, measured 2026-08-26)

Measured for the live-honesty order: the live `Query` control request
`getContextUsage()` (cadence, latency, availability in streaming-input mode) and the
resume-leg semantics of `result.total_cost_usd` — the ambiguity §S left open
("s2b fits cumulative; s2 fits per-command"). Harness: `probe-context.mjs`
(same shape as `probe-steer.mjs`: push-side queue, canUseTool attached,
timestamped log). Every claim below cites a `raw/c*.log`.

### What was measured

**c1 — cadence (`raw/c1.log`).** A three-tool drive
(`echo one/two/three`, streaming input) called `q.getContextUsage()` after every
assistant / user / result message: **9 calls, 0 failures**, latency
**2.0–2.8 s** each (first call 2.76 s). The probe awaited inline, so the cadence
serialized ~2.3 s per call into the stream — the app's feed must be
fire-and-forget, never an inline `await` in the consume loop. Response carries
`totalTokens` / `maxTokens` / `percentage` (integer) / `model` /
`isAutoCompactEnabled` / `autoCompactThreshold` / per-category tokens; wire size
~38 KB (fine for the renderer event channel, never persisted). Example read
mid-drive: `{"totalTokens":50438,"maxTokens":1000000,"percentage":5,...}`
(`raw/c1.log` CTX entries). No EXPERIMENTAL warning on this control (unlike
`usage_EXPERIMENTAL…`, sdk.d.ts:2444).

**c1 — thinking liveness (design input, `raw/c1.log`).** During generation the
stream carries bursts of `system:thinking_tokens` messages (estimated-token
deltas) with NO transcript-bearing message between them — a long-thinking model
can run minutes producing no assistant text. A staleness line keyed only to
transcript entries would lie in exactly the window it exists for. The adapter
therefore treats a throttled context read (≥30 s since the last one) on
`thinking_tokens` as a liveness proof too — one event kind carries both the
gauge refresh and the staleness anchor.

**c1 — mid-park control call: NOT triggered.** The planned 6 s `canUseTool`
hold never fired — the ambient CLI auto-allowed the `echo` commands, so
`canUseTool` was never consulted (no PARK_START in `raw/c1.log`). Left
unmeasured; harmless by construction: while an ask parks the stream no new
messages arrive, so no feed trigger fires, and the staleness line is gated to
`status === 'running'` (never during `stopped_asking`).

**c2 — resume-leg cost semantics (`raw/c2.log`).** Leg 1 (fresh session,
one Bash turn) ended with `result.total_cost_usd = 0.094824`. Leg 2 resumed the
SAME `session_id` (`ff9f5662…`, confirmed identical in leg-2 `system:init`;
cache_read grew 91 008 → 100 608, i.e. the context carried over) and its first
result reported **`0.056219` — smaller than leg 1's total**. A cumulative figure
would have been ≥ 0.094 8. **The cost figure RESETS at the resume (process)
boundary; it is NOT session-cumulative across legs.**

**Within one query: usd cumulative (s2b reconciled); usage tokens PER-RESULT.**
§S's ambiguity dissolves with the across-leg reset: `raw/s2b-late-note.log`
result#1 `0.176580` → result#2 `0.205902` (diff `0.029322` — plausible for the
note's call; the raw figure is not). s2/s3 never produced a second result (notes
coalesced into one turn), which is why they "fit" per-command. Model for **usd**:
cumulative within one SDK query process, reset at resume. The TOKEN axis is
different (WO-0046 review round): s2b's result#2 usage is `44/158` after
result#1's `27802/50` — a cache-hit call's own uncached figures, never a process
total. **usage tokens are per-result and sum plainly; only usd carries the
cumulative/reset behavior.**

**Consequences (pinned by the WO-0046 tests):**
- The adapter's per-drive accumulation is correct under the measured model WITH
  THE AXIS SPLIT (review round): usd keeps the `>= prior → difference; < prior →
  the figure itself` guard (within a drive the figures are monotone cumulative;
  on a resumed leg per-drive locals start at 0, so the leg's first figure is
  taken whole — right); usage tokens are per-result and SUM with no guard (the
  first cut's shared max-guard under-counted cache-busting turns — s2b result#2
  44/158 would have "delta'd" to 0/108).
- The store's `prior + input` add-rule is therefore correct across legs — NO
  double-count, NO seeding, NO migration. The WO-0046 correctness item closes as
  a **recorded verification** (test pins the rule; comment at the accumulation
  site states the measured semantics).
- `getContextUsage` after a resume reflects the carried context (leg2-init
  totalTokens 50 333 = leg1-final, Messages 4 253 → 4 275) — the gauge is valid
  on resumed legs.

**Measured versions.** `@anthropic-ai/claude-agent-sdk` 0.3.221 (package.json
pin); model glm-5.3[1m] served the drives. Not a stable contract — re-measure on
bump (TD-016).
