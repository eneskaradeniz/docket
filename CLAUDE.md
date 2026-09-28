# CLAUDE.md

Rules for every session in this repository (v2 rebuild, from 2026-09-26). The design lives in
`docs/v2/` — read `docs/v2/README.md` first. When this file, the docs, and an issue disagree, stop and
ask; do not pick one yourself.

## Status
- Docket is being rebuilt from the ground up (v2). v1 is frozen at git tag **`v1-final`**; its code
  still sits in `src/core/`, `src/adapters/`, `src/ui/`, `src/renderer/` until Phase 4 and must not
  be extended, imported by v2 code, or treated as the design.
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
7. **No third-party code.** Do not copy source code from other projects, and do not name them in
   code or comments. Integrations are written from the CLI's or protocol's own documentation.
8. **No new npm dependencies** unless the issue names them.
9. Ambiguity → stop and ask on the issue. Never decide architecture.

## Code rules (v2)
- Layers and imports: `docs/v2/architecture.md`. Enforced by `scripts/check-layers.mjs`.
- `src/domain/`: pure TypeScript — no npm packages, no Node builtins, no `Date`, no `Math.random`,
  no classes with behaviour, no exceptions for expected failures (return `Result`), no mutation of
  inputs. Only import other modules through their `index.ts`, following the module dependency map in
  `docs/v2/domain.md`.
- No `any`, no default exports, no non-null assertions (`!`) in v2 code. Prefer `readonly` types.
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

## Operator gate
- Work that changes the UI ends with a short numbered manual scenario for the operator; no merge to
  `main` before the operator's verdict. The assistant never launches the app itself.
- Batch mode (unattended, no UI): merges go into the `v2` integration branch only; the operator
  reviews the `v2 → main` PR in the morning. Full protocol: `docs/v2/roadmap.md` → "Batch mode".

## CI
- `npm run typecheck`, `npm test`, `npm run build`, `npm run check:boundaries` run on every PR and on
  pushes to `main`. `check:boundaries` runs the v1 checks and the v2 layer checks.

## Do not read
- `~/source/docket-arsiv/` — archived v1 memories. Stale by definition.
