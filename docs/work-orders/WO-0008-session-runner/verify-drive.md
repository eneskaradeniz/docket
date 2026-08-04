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
