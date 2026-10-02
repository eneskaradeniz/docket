# Quota and budget

Limits belong to the **account**, not the project. An account has one or more **pools** (for example
a model group), and each pool has one or more **meters** (windows: 5-hour, weekly, monthly, …). A run
starts only when every meter of every pool its model routes to has headroom. Types and rules:
[domain.md §6–§8](domain.md#6-quota--accounts-pools-meters-limits).

## Where the numbers come from

Every value carries its `source`, shown in the UI, because pools are shared with other clients (the
provider's chat app, IDE plugins) and Docket's own accounting is never authoritative.

| Source | Meaning | Example |
| --- | --- | --- |
| `pushed` | The provider sent it during a run | Claude `rate_limit_event` |
| `polled` | Docket asked | Claude `get_usage`, Codex `account/rateLimits/read`, `agy -p "/usage" --output-format json` |
| `captured_from_error` | Read from a limit error | z.ai 429 codes 1308/1310/1316–1321 with a reset time in the message |
| `estimated` | Derived from Docket's own records | API spend = tokens × editable price table |
| `unknown` | Nothing available | Cursor pool amounts |

## Provider notes (verified 2026-09-26; details in the design research)

| Provider · plan | Pools / windows | Best channel | Reset time |
| --- | --- | --- | --- |
| Claude Code · Pro/Max | account; 5h + 7d; 7d per model family (Opus/Sonnet); model-scoped rows (for example Fable) arrive in the usage report's model-scoped list and are matched by display name; on Max the Fable row is its own weekly meter that the documentation describes as a share of the weekly limit, and the operator observed that it also lowers the 5-hour and weekly meters (the 5-hour part is not documented); on Pro, Fable is outside the plan limits and billed through usage credits at API rates, only with extra usage enabled | stream event + SDK `get_usage` | exact |
| Claude Code · API key | per-minute throughput + monthly spend cap | own spend tracking | month start |
| Codex · ChatGPT plans | primary ≈5h, secondary ≈weekly; read `windowDurationMins`; the window set depends on the plan: a free plan reports one 30-day window and no secondary window (observed live) | app-server `account/rateLimits/*` | exact |
| Antigravity `agy` · Google AI Pro/Ultra | **per model group** ("Gemini models", "Claude and GPT models"), each 5h + weekly | `/usage` JSON in print mode (verified, see below) | exact via query; relative in errors |
| Copilot CLI | monthly AI credits; hidden session/weekly guardrails | SDK `account.getQuota`; the quota snapshot carries entitlement counts and percentages but no credit field, spend arrives as nano AI units on the usage channel (1 credit = $0.01), and the snapshot does not change within a turn | monthly exact; weekly only retry-after |
| opencode Go | per-model $ over 5h / week / month | the CLI waits itself; surface its retry time | exact |
| z.ai GLM Coding | 5h (from first use) + weekly, credits; the endpoint observed by the operator reports a 5-hour token window and a monthly tool window, no weekly one (the probe issue confirms) | unofficial quota endpoint; 429 error codes | message text (assume UTC+8, confirm) |
| Cursor, Qwen, Kiro, Mistral | monthly / opaque | none | unknown → ask |

Pitfalls: Claude's `utilization` is 0–1 in pushed `unifiedWindows` but 0–100 in `get_usage`; resets
can move **earlier** (never trust a stored `resetsAt` without re-polling); Claude's `total_cost_usd`
is a list-price estimate (show as `equivalent` on subscriptions and custom endpoints).

## Limit policies (per account)

| Policy | Behaviour |
| --- | --- |
| `wait_resume` | Park the run as `limit_waiting`; at `resetsAt + 60 s` re-query quota first; resume with the provider's resume mechanism; max 3 automatic resumes, then ask |
| `switch_pool` | Continue on another pool of the same account (e.g. agy: Claude group empty → Gemini group) |
| `fallback_account` | Next account in the role's chain; a new session starts with a hand-off summary |
| `ask` | Put it in "Senden bekleyenler" |

Throughput (per-minute) limits are not quota: they show as "retrying", never as remaining quota.

## Budgets (API accounts)

Caps at six scopes — account (day, week, month), project (month — the **ceiling**, the sum over all
repos of the project), repo (month — one repo's **limit**), work order (Phase 5) — each with a warn
percent (default 80). Checks run in order repo limit → project ceiling and the most restrictive
status wins (R-48 in [domain.md](domain.md)). `hard_stop` blocks new runs: a project-ceiling stop in
every repo of the project, a repo stop only in that repo; running runs are never killed. Project and
repo caps live in `project.yaml` / `repo.yaml` (versioned, S1); account caps stay in the
machine-local account record.

## Observed: Antigravity `/usage` (agy 1.2.11, probe #138)

`agy -p "/usage" --output-format json` returns at once without an agent turn (`num_turns: 0`, zero tokens).
The quota lives in `command.data`; `response` is the same data as tab-separated text and is ignored.

```json
{ "status": "SUCCESS", "num_turns": 0,
  "command": { "name": "usage", "data": { "description": "…", "groups": [
    { "name": "Gemini Models", "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        { "id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly",
          "remaining_fraction": 0.6869, "reset_time": "2026-09-29T15:24:06Z", "description": "…" },
        { "id": "gemini-5h", "name": "Five Hour Limit Remaining", "window": "5h",
          "remaining_fraction": 1, "reset_time": "2026-09-26T19:17:25Z" } ] },
    { "name": "Claude and GPT models", "buckets": [ { "id": "3p-weekly", … }, { "id": "3p-5h", … } ] } ] } } }
```

Mapping: group → `Pool` (`label` = `name`, model matchers from the model list in `description`, verbatim
text only); bucket → `Meter` (`label` = `name`, `unit: 'fraction'`, `remaining` = `remaining_fraction`,
`resetsAt` = `reset_time`, `resetPrecision: 'exact'`, `source: 'polled'`). `window` (`weekly`, `5h`) is kept as
data; `durationMs` is set only from a value the CLI states, never from the window name. The parser must
read both stdout and stderr (the probe run showed the payload on stderr).
