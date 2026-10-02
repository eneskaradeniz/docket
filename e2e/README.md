# e2e

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
