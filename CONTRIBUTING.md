# Contributing

Thanks for your interest. Docket is in the middle of a ground-up rebuild (v2), so the process is
strict for now.

1. **Read the design first.** `docs/v2/README.md`, then `docs/v2/architecture.md`. The domain
   contracts in `docs/v2/domain.md` are exact.
2. **Work from an issue.** Every change starts from a GitHub issue that fixes its scope, out-of-scope
   list, interfaces, and acceptance criteria. No issue → open one to discuss before writing code.
3. **Follow `CLAUDE.md`.** It holds the rules for every contributor, human or AI: layering, test-first
   domain code, no `any`, no default exports, no copied third-party code.
4. **Before opening a PR:** `npm run typecheck && npm test && npm run check:boundaries` must be green.
5. **PRs target `v2`** during the rebuild (unless the issue says `main`). The PR body starts with a
   `**Model Used:**` line when an AI model authored the change, and `Closes #<issue>`.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
