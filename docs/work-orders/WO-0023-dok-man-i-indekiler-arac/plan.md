# WO-0023 — Doküman İçindekiler aracı: plan

## İçindekiler

- [Context](#context)
- [Approach + key decisions](#approach--key-decisions)
- [Verification](#verification)

## Context

docs/ holds 44 .md files (PRODUCT.md + tech-debt.md, 11 ADRs, 22 WO `order.md` + 5 `plan.md` + 1 `verify-drive.md`, TEMPLATE.md, 2 probe docs). None has a TOC today; zero existing in-page anchors/`#slug` links, no duplicate headings. ROADMAP.md sits at repo root — outside "docs/ altındaki her .md", so out of scope. Docs-only WO: repo code/test/config untouched; the generator is a throwaway script under `/tmp` (not committed), the PR contains only docs/ changes.

## Approach + key decisions

- Sweep all 44 `docs/**/*.md` with the /tmp script: fence-aware heading scan (`##`/`###` only, skip fenced code blocks), GitHub-slugger rules for anchors — lowercase, strip punctuation/backticks/em-dashes, spaces→hyphens, Turkish letters preserved (`İçindekiler` → `#içindekiler`), `-1/-2` suffixes on duplicates.
- TOC = `## İçindekiler` inserted immediately after the H1 (after YAML frontmatter where present — the 23 WO/template files; ADRs and top-level docs have no frontmatter). Body: `- [title](#slug)`, `###` indented one level; never lists itself.
- Update semantics: an existing `## İçindekiler` section is replaced in place (needed because Docket appends `## Closure note` to order.md at closure). Script must be idempotent — second run produces an empty diff.
- review:light → implementer implements directly (no implementer plan round, per standing feedback), commits, opens PR, stops.

## Verification

- Verifier, at PR head sha: re-derive headings + slugs for every changed file and assert each `](#…)` target matches a real heading; spot-check Turkish-char headings (WO-0022/WO-0023 order.md) and backtick headings (ADR-0011, WO-0007 plan.md) against the GitHub PR render; report the changed-file list (ÇIKTI).

```steps
[
  { "role": "implementer", "aim": "docs TOC sweep + PR", "scope": "docket" },
  { "role": "verifier", "aim": "verify TOC links + report changed files", "scope": "docket" }
]
```
