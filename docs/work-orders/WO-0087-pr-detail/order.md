---
id: WO-0087
title: "The PR detail — in-app, fetched from the forge; the browser stays one chip away"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0086"]
---

# WO-0087 — the PR detail: in-app, fetched from the forge

## Objective

The operator's follow-up to the atelier-approved depo design (KARAR 5, `surface-review.html`):
a PR row must not send anyone to github.com — the row opens its DETAIL in Docket (author, branch
pair, file breakdown ±, body), the data fetched live from the forge; AND one chip opens the PR's
web page in the browser for those who want the full view. Both readings coexist: in-app first,
browser one chip away.

## The pieces

- **core/forge.ts**: `ForgePrDetail` (number, branches, url; absent-discipline for title/body/
  author/counts) + `ForgeWatch.prDetail(id, repoRemote, number)` and `.prDiff(id, repoRemote,
  number)` (the unified diff, VERBATIM — the renderer caps the display).
- **adapter** (`github.ts`, fixture-pinned): `prDetail` = `gh pr view N --json number,title,
  body,author,headRefName,baseRefName,additions,deletions,changedFiles,url` (empty title/body/
  author stay ABSENT at the edge); `prDiff` = `gh pr diff N` verbatim. Both throw the shaped
  ForgeError on failure.
- **composition root**: two ipc handlers resolving the repoRemote → RepoRef via
  `store.forgeScanTargets` + `parseRepoRemote` (unparseable → ForgeError); one
  `docket:shell:openExternal` handler, HTTPS-allowlisted (only https urls open externally).
- **UI** (`ForgeSection`): a PR row becomes a toggle — the detail opens UNDER the row (loading →
  data → error, the error human with the raw reason in the tooltip per WO-0078); «Farkı
  görüntüle» lazily fetches the diff (capped display); «↗ Tarayıcıda aç» rides the forge PR's
  own url through `shell.openExternal`. The label is vendor-NEUTRAL (ADR-0006: the boundary
  check bans the name in src — the url is data).
- **preload** carries the two new forge invokes + the shell group; `preload.d.ts` flows the
  core type.

## Non-goals

- No E2E pins for the detail fetch (real gh calls are network; the adapter's fixture tests pin
  the wire mapping) — the E2E keeps its 98 green without them.
- No review/comment threads, no merge-from-detail — v1 is a READ surface (the ADR-0018 writes
  stay on the changes console).

## Verification

- Adapter fixture pins (github.test.ts): the prView wire maps verbatim (author login, counts,
  branch pair), empty strings stay ABSENT, failures are the shaped ForgeError, the diff passes
  through verbatim.
- Mechanical pass + `npm run test:ui` (the depo rows' new toggles are unpinned E2E-wise — the
  forge section carried no board pins).
- Atelier: the operator clicks a real PR row in their own workspace and reads the detail.
