# CLAUDE.md

Rules for every session in this repository (v2 rebuild, from 2026-09-26). The design lives in
`docs/v2/` — read `docs/v2/README.md` first. When this file, the docs, and an issue disagree, stop and
ask; do not pick one yourself.

## Status
- Docket is being rebuilt from the ground up (v2). v1 is frozen at git tag **`v1-final`**; its code
  was removed from the tree in Phase 4 (#331); it is reference only through
  `git show v1-final:<path>`.
- The product is local, single-user, free and open source (Apache-2.0), built team-ready
  (`docs/v2/architecture.md` → "Team-ready rules").
- Product name: "Docket" — final. (A rename was considered and cancelled on 2026-09-27; no rename work
  is planned. See the closed rename issue for the decision record.)

## Who does what
- **Architect session**: writes `docs/v2/`, fixes interfaces, opens issues, reviews PRs. Only the
  architect changes `docs/v2/**` and this file.
- **Coding sessions**: implement exactly ONE GitHub issue each. The issue fixes scope, out-of-scope,
  interfaces, and acceptance criteria.

## Rules for coding sessions
1. **No issue → no code.** Asked to change product code without an issue: stop and ask.
2. **Stay inside the issue.** Touch only the paths its "Touches" section allows. A refactor, rename,
   or "while I'm here" fix is a new issue, not part of this PR.
3. **Contracts are fixed.** Types and signatures from `docs/v2/domain.md` (copied into the issue) are
   implemented exactly — same names, same shapes, same exports. If one cannot work, stop and comment
   on the issue with the reason.
4. **Test-first for `src/domain/`.** Write a test for every rule `R-n` the issue lists, named
   `R-n: …`, run it red, then implement until green. Cover edge cases the rule implies.
5. **Before every commit:** `npm run typecheck && npm test && npm run check:boundaries` — all green.
6. **v1 is reference only**, reached through the exact path an issue names:
   `git show v1-final:<path>`. Never restore v1 documents; never follow a v1 rule or ADR.
7. **Reference projects.** Take only ideas and behaviour from other projects; write the code independently, under this repo's layer rules. Never copy source code. If a part cannot be solved without staying near-verbatim, stop and ask the operator. Never name another project in code, comments, documents, or the `NOTICE` file. Integrations are written from the CLI's or protocol's own documentation. The agent/provider-name restriction in Code rules applies to code and comments under `src/`; the README and product documents may name providers.
8. **No new npm dependencies** unless the issue names them.
9. Ambiguity → stop and ask on the issue. Never decide architecture.

## Code rules (v2)
- Layers and imports: `docs/v2/architecture.md`. Enforced by `scripts/check-layers.mjs`.
- `src/domain/`: pure TypeScript — no npm packages, no Node builtins, no `Date`, no `Math.random`,
  no classes with behaviour, no exceptions for expected failures (return `Result`), no mutation of
  inputs. Only import other modules through their `index.ts`, following the module dependency map in
  `docs/v2/domain.md`.
- No `any`, no default exports, no non-null assertions (`!`) in v2 code. Prefer `readonly` types.
- Corner radius only from the three tokens `rounded-control` (6px), `rounded-card` (8px), `rounded-panel` (12px), plus `rounded-full` for lamps and round badges — no other `rounded-*`, no hand-typed radius (U-23; a test enforces it).
- Names: files `kebab-case.ts`; types `PascalCase`; functions and values `camelCase`; constants
  `UPPER_SNAKE_CASE`.
- Comments explain *why*, never history. No issue numbers or dates in code comments.
- Code and repository documents are English. UI copy is Turkish by default with English as a peer
  locale; copy lives in label bundles, never inline in components.
- Records and logs never carry secrets or environment values; they may name targets (paths,
  commands). Secrets live only in the OS keychain.
- No agent-vendor names outside `src/infrastructure/providers/`.

## Git and PRs
- Branch per issue: `v2-<issue-number>-<short-slug>` (a `v2/…` name is impossible while the branch `v2` exists). Batch mode bases on `origin/v2`; interactive
  work bases on `origin/v2` too unless the issue says `main`.
- Commit: `<type>(<scope>): <summary> (#<issue>)`, e.g. `feat(domain/quota): headroom rules (#131)`.
- PR body starts with `**Model Used:** <provider> — <model id>` then `Closes #<issue>`, a short
  summary, and the test evidence (the three commands' results).
- Never push to `main`, never force-push, never delete branches you did not create.

- **`main` is the only integration branch (added 2026-10-10; supersedes every `origin/v2` base and "`v2` integration branch" rule above and in `docs/v2/roadmap.md` → "Batch mode").** `v2` was merged into `main` (#925) and is retired. Branches are still `v2-<issue-number>-<short-slug>` but base on `origin/main` and their PRs go into `main`; batch mode merges into `main` only when CI is green and, for UI work, only after the operator's verdict (operator gate below). Issues now close automatically with `Closes #<issue>`; still check the PR state is MERGED.

## Operator gate
- Work that changes the UI ends with a short numbered manual scenario for the operator; no merge to
  `main` before the operator's verdict. The assistant never launches the app itself.
- Batch mode (unattended, no UI): merges go into the `v2` integration branch only; the operator
  reviews the `v2 → main` PR in the morning. Full protocol: `docs/v2/roadmap.md` → "Batch mode".
- **Verification before handoff (added 2026-10-05; supersedes "The assistant never launches the app
  itself" for automated verification only).** Green commands are not evidence for UI work. Before a
  UI change reaches the operator, an automated session launches the built app headless (Playwright
  Electron as in `e2e/ui.mjs`) with `DOCKET_DATA_DIR` aimed at a fresh temporary directory — no
  keychain writes, no model or agent runs, no real spend — walks the scenario, records page/console
  errors, screenshots and timings, and fixes what it finds. The operator receives a candidate with
  that evidence; the operator's verdict stays the gate for merging to `main`, and an operator is
  never asked to find a crash or a wrong layout that a walk-through would have shown. Throwaway
  walk scripts live outside the repo unless an issue adds them.
- **Live runs with GLM only (added 2026-10-07; narrows "no model or agent runs" above).** An automated session may start real agent runs inside Docket only through the `zai-glm` route of the claude-code provider, against a dedicated persistent test data directory (`~/.docket-test`, never `~/.docket`, never the operator's real projects) and a throw-away repository created for the run. No other provider route may be used or adopted in that directory, and machine-login (subscription) accounts must not be adopted there. The z.ai token is entered by the operator once, through the app's own account step; an assistant never reads, prints, logs, or writes a secret value. Everything else in the paragraph above stays: a temporary data directory is the default, and there is no real spend on any other provider.
- **Live runs with GLM or Antigravity (added 2026-10-09; widens "Live runs with GLM only" above).** An automated session may start real agent runs inside Docket through the `zai-glm` route of the claude-code provider or through the Antigravity route, in both cases against the dedicated persistent test data directory (`~/.docket-test`, never `~/.docket`, never the operator's real projects) and a throw-away repository created for the run. In that directory the Antigravity subscription account may be adopted for this purpose and no other subscription or provider account (Claude, Codex, Copilot, Cursor, OpenCode and the rest stay out). The Antigravity account is a machine-login account: an assistant never reads, prints, logs or writes any credential of it; the operator signs in with the vendor's own tool beforehand. Runs consume the account's quota, not money; a run stops at the first billing prompt or sign of spend. Everything else in the two paragraphs above stays.

## CI
- `npm run typecheck`, `npm test`, `npm run build`, `npm run check:boundaries` run on every PR and on
  pushes to `main`. `check:boundaries` runs the agent-vendor check on `electron/`, the layer checks
  (`scripts/check-layers.mjs`) and the rule-coverage check (`scripts/check-rule-coverage.mjs`).
