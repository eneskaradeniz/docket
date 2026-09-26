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
| Claude Code · Pro/Max | account; 5h + 7d; 7d per model family (Opus/Sonnet) | stream event + SDK `get_usage` | exact |
| Claude Code · API key | per-minute throughput + monthly spend cap | own spend tracking | month start |
| Codex · ChatGPT plans | primary ≈5h, secondary ≈weekly; read `windowDurationMins` | app-server `account/rateLimits/*` | exact |
| Antigravity `agy` · Google AI Pro/Ultra | **per model group** ("Gemini models", "Claude and GPT models"), each 5h + weekly | `/usage` JSON in print mode (probe in Phase 0) | exact via query; relative in errors |
| Gemini CLI · Code Assist Std/Ent | requests per day | none headless | unverified |
| Copilot CLI | monthly AI credits; hidden session/weekly guardrails | SDK `account.getQuota` | monthly exact; weekly only retry-after |
| opencode Go | per-model $ over 5h / week / month | the CLI waits itself; surface its retry time | exact |
| z.ai GLM Coding | 5h (from first use) + weekly, credits | unofficial quota endpoint; 429 error codes | message text (assume UTC+8, confirm) |
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

Caps at three scopes — account (day, month), workspace (month), work order — each with a warn
percent (default 80). The most restrictive status wins. `hard_stop` blocks new runs; running runs are
never killed.
