# ADR-0019 — The risky-excluded guardrail: a cheap second look before the operator's

- Status: accepted
- Date: 2026-09-23
- Deciders: Enes (operator), architect session
- Origin: issue #100 ("cheap structured 'guardrail' classifier, Jev-style, using our existing adapter")

## Context

`risky_excluded` (WO-0031c) auto-approves every in-scope ask except a fixed set `isRiskyPermission`
(`src/core/risky.ts`) flags — file writes into CI/agent-config/lockfile/secret-shaped paths, and a
fixed list of shell substrings (`git push`, package-manager installs, `rm`, forge writes). The set
is deliberately over-asking: its own doc comment states the rule plainly — "an `echo` that mentions
`npm install` classifies risky, and that is accepted." Under-asking would be the actual defect; the
static classifier cannot tell a real `rm -rf node_modules` from a comment string that merely
contains the word, so it treats both alike.

Every over-ask is a `stop_and_ask` interruption the operator did not actually need — `risky_excluded`
exists to REDUCE interruptions, and the static filter's necessary conservatism works against that
exact goal on its false-positive share.

TypeSafe AI's "Jev" write-ups (linked from issue #100) describe using a cheap, structured,
low-latency model call — not a full generation — as a pre-execution guardrail: a typed, calibrated
answer (yes/no/unsure with a reason) instead of free text. Docket does not adopt Jev: it is a paid
third-party service, and ADR-0006 confines a provider integration to `src/adapters/`, one composition
root, no new vendor. The pattern does not need Jev — the same shape of call runs through the adapter
Docket already has.

## Decision

1. **A second pass, not a replacement.** `isRiskyPermission`'s static set still runs first and is
   unchanged; the classifier is consulted ONLY for a call the static set already flagged risky, and
   only under `risky_excluded`. `ask_every` and `full_auto` are untouched — an operator who chose
   "ask me everything" or "never ask me" gets no new machinery either way. The static set's
   under-asking guarantee is therefore preserved exactly: nothing the classifier sees was ever going
   to be silently allowed by today's code, and nothing outside its flagged set is newly exposed to a
   model's judgment.
2. **Three-valued verdict, unsure defers.** The classifier answers `benign`, `risky`, or `unsure` —
   the same discipline WO-0091's `stallVerdict` and WO-0053's absent-is-not-zero rule already set for
   this codebase: a call it cannot confidently place is `unsure`, and `unsure` behaves exactly like
   `risky` (defer to the operator). A timeout, a malformed response, a provider error, or the
   workspace's own budget cap already being crossed (WO-0047 — a running drive keeps going, but a NEW
   spend decision still respects the cap) all fold into `unsure`. The gate never fails open.
3. **A new core port, a `src/adapters/` implementation — ADR-0006 held exactly.** Core gains
   `GuardrailClassifier` (an interface: one method, the `{tool, input, title?, reason?}` shape
   `isRiskyPermission` already takes in, a `Promise<'benign' | 'risky' | 'unsure'>` out). The
   implementation lives beside the existing runner adapter and reuses the SAME provider connection a
   drive already has open — no new vendor, no new credential, no second adapter. The composition root
   wires it exactly like `askOperatorPolicy`: one instance, injected into `PipelineDeps`.
4. **`PermissionPolicy.onAsk` becomes async.** `AskOutcome` is unchanged; `onAsk` returns
   `Promise<AskOutcome>` instead of `AskOutcome`. `askOperatorPolicy` and `autoAllowPolicy` wrap
   their existing synchronous answer in an immediately-resolved promise — no behavior change, no new
   latency on either. Only `riskyExcludedPolicy`'s classifier-augmented form actually awaits
   anything, and only on the already-narrow flagged-risky path.
5. **The call costs real money and is counted as such.** No guardrail spend is invisible spend
   (CLAUDE.md's own line on usage records: metrics carried verbatim, never hidden). It rides the
   asking session's own `session_usage` ledger like any other turn — no new accounting dimension, no
   new UI surface, because a "cheap structured call" is by design a rounding error against a drive's
   own spend; inventing a separate ledger for it would be over-engineering the exact thing this ADR
   exists to keep cheap.
6. **`risky_excluded` gets smarter in place — no fourth `PermissionRule`.** The operator who already
   chose "auto-approve except risky things" is the one this ADR serves; a new rule value would split
   that one choice into two for no operator-visible benefit, and would need its own order.md
   front-matter migration story for zero gain. The guardrail is `risky_excluded`'s own refinement,
   not a sibling mode.

## Consequences

- `PermissionPolicy` implementations must return a promise from `onAsk`; `pipeline.ts`'s call site
  awaits it. `autoAllowPolicy`/`askOperatorPolicy`/the plain `riskyExcludedPolicy` (no classifier
  injected — tests, and any host that has not wired one) keep today's byte-for-byte behavior.
- A classifier call that is slow enough to matter degrades to feeling like `ask_every` for that one
  call, never to a wrong allow — the operator waits a beat longer for the ask card, not less often
  for a real refusal.
- `GuardrailClassifier` is a genuinely new async seam in what was a fully synchronous, pure decision
  path (`isRiskyPermission` itself stays pure and synchronous — only the policy wrapping it gains the
  await). Tests that exercise `riskyExcludedPolicy` with a classifier need a fake implementing the
  port, the same `FakeRunner`/`FakeStore` precedent ADR-0006 already established.
- This is scoped as an architectural commitment, not a work order. Scoping the actual `WO-NNNN`
  (the classifier's exact prompt/output contract, which existing role — architect, a dedicated
  system-role — issues the call, and the fake for tests) is separate follow-up work.

## Alternatives rejected

- **Replacing `isRiskyPermission` outright.** Throws away a fast, deterministic, already-tested
  filter for a slower, non-deterministic one on every single ask — including the overwhelming
  majority that were never going to be risky in the first place. The two-pass shape keeps the common
  case exactly as fast as today.
- **A fourth `PermissionRule`.** Considered and rejected in decision 6 — see above.
- **Adopting Jev (or an equivalent paid classifier vendor).** ADR-0006 confines provider
  integrations to one adapter layer with no new vendor; a second, unrelated paid API for a
  narrow classification task multiplies the vendor surface for a job the existing adapter can do.
- **Silent/uncounted classifier spend.** Rejected in decision 5 — a "cheap" call is still a real
  charge against the operator's account and the workspace's monthly cap; hiding it would be exactly
  the kind of silent behavior ADR-0001's evidence model exists to prevent, applied to money instead
  of process state.
