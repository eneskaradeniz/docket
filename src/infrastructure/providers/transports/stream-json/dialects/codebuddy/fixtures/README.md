# codebuddy dialect fixtures

Sample transcripts derived from the provider's own SDK documentation
(codebuddy.ai/docs/cli/sdk-typescript, read 2026-10-02; the line schema is documented as aligned
with Claude Code's). No logged-in capture exists yet — the CLI on the discovery machine was never
logged in and no prompt was ever sent — so every line follows the documented schema with
representative values: `cbf…` session ids, `/tmp/cb-probe` paths and small token counts. Nothing
here is sensitive. The operator run the issue keeps open replaces these with real captured lines
(tokens and environment values masked).

- `text-turn.jsonl` — a pure text turn: `system/init` (carrying the run's `model`), the echoed
  `user` message, one `assistant` text message with `usage`, and a `result` `success` carrying
  `usage` plus `total_cost_usd`.
- `tool-turn.jsonl` — a tool turn: an `assistant` `tool_use`, the paired `user` `tool_result`, a
  final text message and a `result` `success`.
- `quota-result.jsonl` — the limit shape: a `result` with `is_error: true` and an `errors_info`
  entry of `category: "quota"`.
- `auth-result.jsonl` — the logged-out shape: a `result` with `is_error: true` and an
  `errors_info` entry of `category: "auth"` (the same refusal the ACP login probe reads).
- `error-result.jsonl` — the failure shape: a `result` with `is_error: true`, subtype
  `error_max_turns` and an `errors_info` entry of `category: "internal"`.
