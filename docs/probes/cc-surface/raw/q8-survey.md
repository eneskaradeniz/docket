# Q8 — other agent CLIs (survey, docs level only; not installed or driven)

## İçindekiler

- [OpenAI Codex CLI](#openai-codex-cli)
- [Google Gemini CLI](#google-gemini-cli)
- [How this maps to Q1–Q5 (does it generalise?)](#how-this-maps-to-q1q5-does-it-generalise)

Collected via web search on 2026-08-05. Per ADR-0006 / WO-0001 scope: documentation
level only — purpose is to know which of Q1–Q5 generalise before M2 designs the
session-runner port. No CLI was installed or driven.

## OpenAI Codex CLI
- Non-interactive mode: `codex exec`. With `--json`, stdout is a **JSONL stream** of
  events (event types include `thread.*`: thread id / session id, assistant
  responses, tool calls). Source: https://learn.chatgpt.com/docs/non-interactive-mode
- Resume: **`codex exec resume <session-id>`** resumses a prior session in headless
  mode (same source). Feature requests track `--from-pr` (#10311), custom
  `--session-id` (#17782), `--output-schema` on resume (#14343).
- Structured output: `--output-schema` (JSON Schema) constrains the final response.
- Permissions: **three sandbox/approval modes** — read-only, workspace-write
  (on-request approval), and full-access / `danger-full-auto`. Mode-based gating
  (config `autoApprove`), with an open request (#33974) to switch mode mid-session.
  Sources: https://github.com/openai/codex/issues/33974 ,
  https://blakecrosley.com/guides/codex , https://www.philschmid.de/openai-codex-cli
- **No documented per-call programmatic approval callback** (analogous to Claude's
  `canUseTool`) surfaced by the search; permission handling is mode/config-based.

## Google Gemini CLI
- Headless: `-p` (prompt); emit **JSON for programmatic parsing**. Less clearly a
  granular streaming-event schema than Claude/Codex ("output JSON and parse it").
  Sources: https://google-gemini.github.io/gemini-cli/ ,
  https://geminicli.com/docs/cli/headless/ , https://cheatsheets.zip/gemini-cli
- Resume: **`--resume <session_id_or_index>`** restores full conversation context.
  Sources: https://proflead.dev/posts/gemini-cli-tutorial-session-management ,
  https://github.com/addyosmani/gemini-cli-tips/blob/main/README.md
- Permissions: `--sandbox`/`-s` flag; in headless, permissions are typically
  pre-configured / auto-approved (no interactive prompt). Source:
  https://cheatsheets.zip/gemini-cli
- **No documented per-call programmatic approval callback** surfaced; mode/config.

## How this maps to Q1–Q5 (does it generalise?)
| Question | Claude (measured) | Codex | Gemini |
| --- | --- | --- | --- |
| Q1 streaming event schema | SDKMessage stream / stream-json | JSONL `thread.*` events | JSON output (coarser) |
| Q2/Q3 plan mode + approval handoff | permissionMode 'plan' + canUseTool | not documented | not documented |
| Q4 per-call permission channel | canUseTool (contractual) + hooks | mode-based only | mode-based only |
| Q5 resume by stable id | yes (cwd-scoped) | yes (`exec resume`) | yes (`--resume`) |

**Implication for ADR-0006 / M2.** Streaming events and resumable session ids
generalise across all three. The **per-call programmatic permission channel
(Q4's `canUseTool`)** is currently Claude-specific — Codex and Gemini gate by
coarse modes (read-only / workspace-write / full-auto, or sandbox) and auto-approve
in headless, with no documented host callback. A provider-neutral session-runner
port should therefore treat the fine-grained stop-and-ask (host decides per tool
call) as a Claude-adapter capability, and fall back to coarse modes for providers
that lack it — consistent with ADR-0006's "one adapter first, do not grow the
`AgentProvider` interface before at least one provider is measured."
