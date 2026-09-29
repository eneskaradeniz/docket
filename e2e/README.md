# e2e

- `npm run design` — builds the app (skip with `--no-build`), seeds a fresh throwaway data dir,
  prints its path, and opens the built app on it with the seed's fake agent binary; quitting the
  window ends the run and the temp dir stays in place. Pure-part tests:
  `node --test e2e/design-run.test.mjs`.
