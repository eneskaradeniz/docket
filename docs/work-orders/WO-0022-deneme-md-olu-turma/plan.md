# WO-0022 — deneme.md oluşturma

## Context

Trivial dogfood trial: validate the plan→implement→verify→merge loop end-to-end on a one-line artifact. The objective is literally to create `deneme.md` containing `merhaba dünya`. No path is given in the order, so the file lands at the repo root — consistent with how prior throwaway trial files (`dogfood-trial.md`, `probe-trial.md`) were treated. No code, no `core/`/`ui/` change, no boundary or display-text rule implicated.

## Plan

Create `deneme.md` at the `docket` repo root with the single line `merhaba dünya`. Commit on a branch, open a PR. Light review, gates cadence — verifier only needs to confirm the file exists with the literal content at the head sha.

```steps
[
  { "role": "implementer", "aim": "create deneme.md", "scope": "docket" },
  { "role": "verifier", "aim": "confirm content at head sha", "scope": "docket" }
]
```

## Verification

`cat deneme.md` prints `merhaba dünya`; `git show HEAD:deneme.md` matches; PR CI green.
