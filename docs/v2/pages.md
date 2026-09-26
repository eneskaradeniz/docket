# Pages — visual artifacts from agents

Agents publish visual pages (UI mockups, diagrams, plans, reports) attached to a work order or a
conversation. The user views them, pins comments on them, and approves them; comments flow back to
the agent as steer notes and the agent publishes a new version.

## How agents publish (Phase 6)

Docket runs a small MCP server of its own and attaches it to every run as a capability (a role can
turn it off). Tools:

| Tool | Effect |
| --- | --- |
| `page_publish(title, kind, content)` | Creates a page linked to the current work order; returns its id |
| `page_update(pageId, content)` | Publishes a new immutable version |
| `page_comments(pageId)` | Reads the user's comments to address them |
| `ask_operator(question, options)` | A structured multiple-choice question |

Kinds: `html` (interactive mockup), `diagram` (Mermaid), `markdown`, `table` (CSV/JSON), `image`,
`report`. Providers without MCP (experimental tier) write pages to `.docket/out/` in the worktree;
Docket collects them when the run ends.

## In the flow

- Gate kind `page_approval`: e.g. "the screen mockup must be approved before Implement".
- A comment is delivered to the agent as a steer note; the agent answers with a new version.
- Versions are immutable; the viewer shows differences between versions.
- "Save to repo" writes a page into the repository; committing stays the user's act.

## Security — a page is untrusted content

- Rendered in a sandboxed renderer: separate session partition, no Node integration, context
  isolation on, no access to Docket's data.
- No network: CSP blocks every external request; downloads, popups and top-level navigation are
  blocked. Mermaid and chart libraries are bundled with Docket.
- The only channel from a page to Docket is a narrow `postMessage` for "user clicked / commented";
  pages cannot issue commands.
- Page text is data: when another agent reads a page, its text is never treated as instructions.
  Instructions come only from the user's comments.

## Storage

`~/.docket/pages/<pageId>/v<n>/` holds each version's files; `docket.db` holds the page record, link,
author, comments, and approval state.
