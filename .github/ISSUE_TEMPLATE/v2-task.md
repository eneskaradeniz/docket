---
name: v2 task
about: One implementable unit of the v2 rebuild (written by the architect)
labels: v2
---

## Goal
<!-- one sentence -->

## Phase · Model · Wave
Phase N · `model:…` · wave N

## Depends on
<!-- issue numbers that must be merged into `v2` first, or "none" -->

## Context
<!-- links into docs/v2/*.md; v1 reference as `git show v1-final:<path>` if any -->

## Scope
<!-- what to build -->

## Out of scope
<!-- what NOT to touch -->

## Test location (checked against `scripts/check-layers.mjs`)
<!-- colocated test file path. Domain-internal tests import module-relative
     (./validate, ../gates/evaluate — D4 bans ../index there); application and
     infrastructure tests may import their own layer barrel (../index). -->

## Interfaces (exact — do not change)
```ts
```

## Rules to test (test-first)
<!-- R-n list from docs/v2/domain.md -->

## Acceptance
1.

## Touches
<!-- the only paths this issue may change -->

## Manual check
<!-- operator steps, or "none (no UI)" -->

## Done when
- [ ] tests for every listed rule, named `R-n: …`
- [ ] `npm run typecheck && npm test && npm run check:boundaries` green
- [ ] PR into `v2` with **Model Used** line and `Closes #…`
