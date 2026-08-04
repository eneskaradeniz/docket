# WO-0008 — headless adapter drive (verification)

Run: `npx vite-node src/adapters/runner/_drive.ts` (throwaway script, not committed).
Drive input: `{ role:'implementer', cwd:<repo>, mode:'direct', prompt:'Reply with exactly one word: pong' }`.

Proves the full chain `createRunner() → drive() → query() → SDKMessage → RunnerEvent`,
including cost capture from the provider's `result` message (findings Q1). The fence /
stop-and-ask path is covered by unit tests (`src/core/__tests__/runner.test.ts`); this
drive exercises the event stream + cost.

```
EVENT {"kind":"started","sessionId":"3bc369c7-b747-40bb-9e64-a4c85f6b0b0a"}
EVENT {"kind":"assistant_text","text":"pong"}
EVENT {"kind":"turn_complete","stopReason":"end_turn","cost":{"usd":0.179606,"tokensIn":34470,"tokensOut":24}}
DONE events= 3
```

`tokensIn: 34470` for a one-word reply is the provider's system-prompt / tool-definition
overhead (cache read), not the reply — consistent with the WO-0001 smoke. The cost is real
and read from the `result` message, not the unreliable per-turn usage (findings Q1).

## Stop-and-ask path (canUseTool → permission_request → decide → hold released)

Drive: implementer, `mode:'direct'`, prompt "create `_probe_marker.tmp` with content hi".
Proves the adapter's load-bearing glue: an in-repo `Write` is classified by the fence as
`ask` (not auto-allow, not denied), surfaced as `permission_request`, and the provider
**holds** the tool call until `decide()` resolves it.

```
EVENT {"kind":"started","sessionId":"7b492dfd-…"}
EVENT {"kind":"tool_use","callId":"call_a0a5…","tool":"Write","input":{"file_path":"…/_probe_marker.tmp","content":"hi"}}
EVENT {"kind":"permission_request","requestId":"147dc2e5-…","tool":"Write","input":{…}}
  -> decide allow
EVENT {"kind":"tool_result","callId":"call_a0a5…","summary":"File created successfully at: …/_probe_marker.tmp …"}
EVENT {"kind":"assistant_text","text":"done"}
EVENT {"kind":"turn_complete","stopReason":"end_turn","cost":{"usd":0.245591,"tokensIn":42541,"tokensOut":486}}
DONE sawAsk= true events= 6
```

The fence's deny paths (out-of-scope writes, verifier writes, Bash redirection) are covered
by unit tests (`src/core/__tests__/runner.test.ts`); this drive exercises the `ask` path and
the hold end-to-end. Marker file and throwaway script removed after the run.

