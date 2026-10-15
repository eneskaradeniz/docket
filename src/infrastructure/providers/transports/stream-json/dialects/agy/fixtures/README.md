# agy dialect fixtures

Operator captures from the probe issue (2026-09-27, capture 2 — stream-json mode, the mode the
provider def launches). The transcripts are reproduced exactly as captured, in their redacted
form: where the operator elided a value (`cwd`, the 60-entry `tools` list, a `…same shape…`
`usage` block), a representative value of the same shape stands in; every value the capture
shows in full is verbatim. Nothing here is sensitive — the identifiers are random UUIDs and
`/tmp` probe paths only.

- `text-turn.jsonl` — a pure text turn: `init`, `user_input` step, `agent_response` with
  `text_delta`, `result` `SUCCESS`.
- `tool-turn.jsonl` — a tool turn in headless mode: the `write_to_file` permission cannot be
  asked for and is auto-denied (`tool` step `ACTIVE` → `ERROR`, `denied_actions` on the result;
  `agent_response` carries no `text_delta`).
- `error-result.jsonl` — the robustness shape the operator produced with malformed input
  envelopes: the stream stays valid NDJSON and ends in `result` `status:"ERROR"`.
- `denied-result.jsonl` — NOT a capture: derived 2026-10-16 (#1211) from the `tool-turn.jsonl`
  shape to exercise a multi-entry `denied_actions` (one entry per denied tool, the count the probe
  measured) — two auto-denied `write_to_file` calls, entry objects verbatim from the capture.
