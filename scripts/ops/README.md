# Ops Scripts

Mechanical PR verification and guarded merge scripts for Docket.

## verify-pr.sh

Verifies a PR against required build, test, and lint chains in an isolated worktree.

```bash
# Verify a PR (automatically detects UI PRs based on touched files)
scripts/ops/verify-pr.sh <pr>

# Force UI verification mode (runs E2E suites)
scripts/ops/verify-pr.sh <pr> --ui

# Print planned steps without running them
scripts/ops/verify-pr.sh <pr> --dry-run

# Run UI verification even if background workers are active
scripts/ops/verify-pr.sh <pr> --allow-busy
```

Results and logs are stored under `~/.hy/state/verify/<pr>-<sha7>/`.
Any early failure prints an `Aborting: …` line and exits non-zero — a run with no output was never started.

## merge-pr.sh

Guards PR squash-merging by checking verification result and CI status.

```bash
# Dry run: check preconditions and print the merge command (exits 0)
scripts/ops/merge-pr.sh <pr>

# Merge PR after operator approval
scripts/ops/merge-pr.sh <pr> --yes
```
