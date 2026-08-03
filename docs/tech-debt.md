# Tech debt

Updating this file is a closure gate. Debt knowingly taken on during a work order is recorded here before
that work order can close. Entries are removed only when the debt is actually paid.

| id | opened by | description | risk | status |
| --- | --- | --- | --- | --- |
| TD-001 | design | **Architect write isolation in single-repo workspaces.** In a multi-repo workspace the architect sits in a different repo, so isolation is physical. In a single-repo workspace it rests entirely on Claude Code's permission mechanism. If that does not hold, role separation is nominal in single-repo projects. | high | open, measured by WO-0001 |
| TD-002 | design | **`Forge` has one implementation.** The interface exists but only GitHub-over-`gh` is written. Untested abstraction. | low | accepted |
| TD-003 | design | **Briefing bundle selection is undesigned.** We know a fresh architect session receives work order + linked ADRs + roadmap section + open debt. *How* linked ADRs are found (tags? front matter? directory?) is not decided. | medium | open |
| TD-005 | WO-0002 | **The plan was approved but never committed.** `plan_approval` requires "architect verdict **and** plan committed"; the verdict was given in-session and the plan was never written to the decision store. The first work order to use the pipeline passed a gate without its evidence. Reconstructed retroactively and labelled as such. Root cause is manual relay: ADR-0003 already assigns the plan commit to the application, which does not exist yet. | high | closed by reconstruction; structurally closed when the app commits approved plans | 
| TD-006 | WO-0002 | **`update_docs` is a dead `ActionIntent`.** No producer in `ADVANCE_INTENT`; the closure stage renders an absent action with a reason instead. An enum variant with no producer overstates what the app can do. Remove it, or give it a producer when the architect session can be dispatched to update the docs. Touches `src/core/`, so it is out of WO-0003's scope. | low | open |
| TD-007 | WO-0002 | **Verification screenshots cannot be attached automatically.** `gh` cannot upload images to a PR and GitHub has no token-authenticated endpoint for it, so attaching them is a manual step for the operator. Mitigated by the capture script making them reproducible, but it is a relay Docket should eventually close. | low | open |
| TD-004 | design | **Bootstrap gap.** WO-0001 runs the pipeline by hand because the tool it specifies does not exist yet. Its evidence is recorded in git, not in the app. Backfill is out of scope. | low | accepted |
