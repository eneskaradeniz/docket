# e2e

e2e worlds pin dispatch.mode=fixed so results never depend on the host's load.

- `npm run design` — builds the app (skip with `--no-build`), seeds a fresh throwaway data dir,
  prints its path, and opens the built app on it with the seed's fake agent binary; quitting the
  window ends the run and the temp dir stays in place. Pure-part tests:
  `node --test e2e/design-run.test.mjs`.
- `npm run operator-run -- <provider-def-id> [--account <route-kind>] [--model <id>]
  [--effort <level>] [--cap-usd <n>] [--canary <sentence>]` — starts ONE real run of the named
  provider through Docket's own launch path (real node deps, dispatcher tick, executor and
  transport) in a throwaway data dir and git repo under the OS temp dir. It prints what will run
  and waits for a typed `yes` (anything else starts nothing and exits 0). A model that is not
  billed `included` also needs `--cap-usd`, recorded as the account's daily cap. A permission ask
  is printed and answered on stdin with `allow` or `deny`; nothing is auto-approved. The default
  account is the machine login; an API-key route kind (`--account`) reads its key from the macOS
  keychain item `docket-operator-run` / account `<route-kind>`
  (`security add-generic-password -s docket-operator-run -a <route-kind> -w`). `--canary` checks
  the run's events for a sentence you put into your own instructions file beforehand; the script
  never reads or writes your files. The summary is printed and written to
  `~/source/docket-tasarim/operator-runs/<date>-<provider>.json`. Pure-part tests:
  `node --test e2e/operator-run.test.mjs`. Never run it from a test or CI.
- `npm run operator-handoff [-- --cap-usd <n>]` — ONE real three-leg limit handoff through
  Docket's own services (the closing gate of #581): leg 1 runs `claude-code` on a two-step fixture
  task in a throwaway repo until its first committed file change, where the harness stops the CLI
  and records the run as a limit stop — that limit signal is the only simulated part of the whole
  run; leg 2 continues on `codex` from the handoff pack the real launch path builds (`buildHandoff`
  with the real cwd, no resume); leg 3 is a short review-style run back on `claude-code`, placed
  there by `orderForReview`. The fixture repo carries a `CLAUDE.md` with a unique canary sentence
  (reported only as present/absent) and an `AGENTS.md`, so leg 2's prompt must inline the canary as
  quoted data while legs 1 and 3 never do. It prints the full plan (providers, accounts by name,
  billing class, prompts, spend cap) and waits for a typed `yes` (anything else starts nothing and
  exits 0); a route not billed `included` also needs `--cap-usd`; a provider the probe saw logged
  out refuses before consent. Permission asks are answered on stdin with `allow`/`deny`. The
  result record is written to `~/source/docket-tasarim/operator-runs/<date>-handoff.json` (per leg
  outcome, first-output latency, pack stats, canary per leg, whether leg 2 finished the second step
  from the pack alone, audit actions in order). Pure-part tests:
  `node --test e2e/operator-handoff.test.mjs`. Never run it from a test or CI.
