# amp dialect fixtures

Sample transcripts derived from the provider's own streaming-json documentation
(ampcode.com/docs/cli/streaming-json, read 2026-10-02). No operator capture exists yet — the CLI
was installed after discovery and no prompt has been sent — so every line follows the documented
schema with representative values: `T-fake…` session ids, `/tmp/amp-probe` paths and small token
counts. Nothing here is sensitive. The operator run the issue keeps open replaces these with real
captured lines (tokens and environment values masked).

- `text-turn.jsonl` — a pure text turn: `system/init`, the echoed `user` message, one `assistant`
  text message with `usage`, and a `result` `success` carrying `usage`.
- `tool-turn.jsonl` — a tool turn: a `thinking` block (present only under the CLI's
  `--stream-json-thinking` extension, mapped when it appears), a `tool_use` whose name keeps the
  CLI's own inconsistent casing (`read`), the paired `user` `tool_result`, a final text message
  and a `result` `success`.
- `error-result.jsonl` — the failure shape: a `result` with `is_error: true`, subtype
  `error_during_execution`, an `error` text and `permission_denials`.
