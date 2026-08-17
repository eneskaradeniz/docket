WO-0025 "test" is an unfilled scaffold — its real objective is exercising the Docket loop (plan approval → step → merge) end-to-end, not shipping a feature. Approach: one doc-only implementer step confined to `docs/work-orders/WO-0025-test/` — fill the Context/Scope/Acceptance placeholders in `order.md`, commit the approved steps as `plan.md`, open the PR — then one architect step to verify evidence and hand the operator the merge decision. Key decisions: no changes under `src/` (nothing exists to build, keeps `full_auto` riskless); no verifier step (review: light); the `WO-0025` id collision with the already-merged provider/auth order is tolerated — this order stays isolated in its `-test` directory.

```steps
[
  { "role": "implementer", "aim": "doc-only order fill + PR", "scope": "docket" },
  { "role": "architect", "aim": "verify evidence, prep merge", "scope": "docket" }
]
```
