# ADR-0018 — The operator's console: Docket as the hand, never the decider

- Status: accepted
- Date: 2026-09-19
- Deciders: Enes (operator)
- Amends: ADR-0017 decision 3 ("Docket itself never pushes and never opens PRs") — the amend is scoped in Consequences; ADR-0017's agent-path freeze stands.

## Context

The WO-0067 console line — "the diff-peek idiom grown into a work-order Changes surface with
one-click commit / PR / merge" — has Docket performing git and forge WRITES. ADR-0017 froze
"Docket never pushes and never opens PRs" to keep the AGENT path silent-write-free; the console
is a different actor. The distinction needed a ruling before any channel exists.

## Decision

1. **The operator's click is the operator's act.** Console writes (commit, push, PR-create,
   merge) fire ONLY from an explicit renderer action — never from the drive pipeline, never
   from the agent's fence, never on a timer, never as a side effect. Docket is the hand; the
   operator remains the decider. ADR-0017's freeze is therefore AMENDED, not broken: the forge
   write surface exists in the adapter but is reachable ONLY through the console's IPC channels
   (`docket:console:*`), which the agent cannot call.
2. **Repo-jailed, per the diff-peek precedent.** Every console read and write resolves its
   target through the work order's connected repo paths (the `woRepoPaths` jail) with
   main-side containment. A console channel cannot touch a path outside the work order's repos.
3. **Destructive and world-facing acts confirm.** Merge confirms (the delete-confirm
   discipline's grammar: counted, stating the consequence). Push and PR-create confirm when
   their target is not obvious (first push creates the remote branch — the button says so).
   Commit carries the operator's own message — never an agent-authored one.
4. **The forge port stays read-only.** `Forge` (core) never gains a write method. The write
   ops live as adapter-extra methods (`GitHubForge`'s own, not the port's), imported only by
   the composition root's console handlers — the type system keeps the agent's drive path
   structurally unable to reach them.
5. **Observation still wins.** A console act's truth lands via the same read paths as any
   other outside act: the next scan observes the new PR (the title rule fills the track link),
   the closure evidence sees the merge. The console writes; Docket still records only what it
   SAW.

## Consequences

- ADR-0017's "Docket itself never pushes and never opens PRs" narrows to "Docket never pushes
  and never opens PRs ON THE AGENT PATH; the operator's console channels are the operator's
  own acts." The agent-path guarantee is structural (the drive pipeline holds no reference to
  the write ops).
- The console's commits are the operator-authored kind (message typed by the operator); the
  agent-authored commits remain the ADR-0017 flow (the agent's own git, witnessed).
- The decision store's commits stay the operator's act everywhere (ADR-0017 stands; the
  console covers WORK repos only — `woRepoPaths` includes the decision-store repo as a
  connected repo, and its working-tree commits through the console are the operator's clicks,
  consistent with today's floor).

## Alternatives rejected

- **Keeping Docket write-blind and shipping a "copy these commands" panel.** The console line
  exists because copy-paste is the bot-in-the-loop problem this product removes.
- **Forge writes on the core `Forge` port.** Type-level reach from the drive path is exactly
  what the port's read-only shape prevents; putting writes there would make every future
  consumer one autocomplete away from them.
- **Merge without confirm.** A merge is the one console act that ends a PR; it gets the counted
  confirm.
