# CLAUDE.md

Interim rules for the v2 preparation period (from 2026-09-26). They replace every v1 rule. When the
v2 design is approved, this file is rewritten from `docs/v2/`; until then, this is the whole contract.

## Status
- The product is being redesigned from the ground up (v2): user-configurable roles, flows, gates,
  capabilities (MCP/skills/hooks), multi-provider agent CLIs, subscription- and API-aware budgets,
  a roadmap layer and parallel work orders — set up through a first-run wizard.
- v1 is frozen at git tag **`v1-final`**: all v1 source, work orders, ADRs, research and mockups.
  The v1 source still in `src/`, `electron/`, `e2e/` is migration material, NOT the design to extend.
- The product name is undecided. Keep using "Docket" until a rename issue says otherwise.

## Who does what
- **Architect session** (Claude Opus): writes the design (`docs/v2/`, English), defines interfaces
  and types, opens GitHub issues, reviews PRs for architecture.
- **Coding sessions**: implement exactly ONE open GitHub issue. The issue fixes the scope, the
  out-of-scope list, the interfaces and the acceptance criteria.

## Rules for coding sessions
1. No issue → no code. If asked to change product code without an issue, stop and ask.
2. Stay inside the issue's scope. Anything outside it — a refactor, a rename, an "while I'm here"
   fix — is a new issue, not part of this PR.
3. Do not change an interface or type the issue gives you. If it cannot work as written, stop and
   explain why in the PR or the issue.
4. Reach v1 code only through the path the issue names: `git show v1-final:<path>`. Never restore
   deleted v1 documents, and never treat a v1 rule, ADR or work order as current.
5. Ambiguity or a contradiction with this file → stop and ask. Do not decide architecture.

## Repository conventions
- Code and repository documents are English. UI copy is Turkish by default, with English as a peer
  locale.
- Persisted records and logs never carry environment values, credentials or provider keys.
- A PR names the model that authored it (provider + model id) in a "Model Used" line at the top of
  its body. A PR without it is incomplete.
- Commit messages: `<type>(<scope>): <summary>`, scope = issue number when there is one.

## Operator manual-check gate
- Every chunk of work ends with a short, numbered manual scenario for the operator (minutes, not
  hours). The assistant never launches the app itself; the operator does.
- Until the operator's verdict: no commit, no next chunk, no closure.

## CI
- `npm run typecheck`, `npm test`, `npm run build` and `npm run check:boundaries` run on every pull
  request and every push to `main`. They still check the v1 code; do not break them until an issue
  replaces that code.

## Do not read
- `~/source/docket-arsiv/` — archived v1 AI memories and local history. Stale by definition.
