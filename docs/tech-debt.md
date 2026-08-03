# Tech debt

Updating this file is a closure gate. Debt knowingly taken on during a work order is recorded here before
that work order can close. Entries are removed only when the debt is actually paid.

| id | opened by | description | risk | status |
| --- | --- | --- | --- | --- |
| TD-001 | design | **Architect write isolation in single-repo workspaces.** In a multi-repo workspace the architect sits in a different repo, so isolation is physical. In a single-repo workspace it rests entirely on Claude Code's permission mechanism. If that does not hold, role separation is nominal in single-repo projects. | high | open, measured by WO-0001 |
| TD-002 | design | **`Forge` has one implementation.** The interface exists but only GitHub-over-`gh` is written. Untested abstraction. | low | accepted |
| TD-003 | design | **Briefing bundle selection is undesigned.** We know a fresh architect session receives work order + linked ADRs + roadmap section + open debt. *How* linked ADRs are found (tags? front matter? directory?) is not decided. | medium | open |
| TD-004 | design | **Bootstrap gap.** WO-0001 runs the pipeline by hand because the tool it specifies does not exist yet. Its evidence is recorded in git, not in the app. Backfill is out of scope. | low | accepted |
