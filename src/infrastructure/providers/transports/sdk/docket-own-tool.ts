// The SDK permission callback names an MCP tool by the server key plus the tool
// (`mcp__<server>__<tool>`). Docket attaches its own server as `docket-pages`. The
// application allow-list speaks the bare tool name, so the prefix is resolved here
// and nowhere else. Matching is the whole string: a longer name, another server,
// or a write tool is not one of Docket's own read tools.

export type DocketOwnReadTool = 'docket_get' | 'docket_search';

/** The own-tool identity for an SDK tool name, or undefined when it is not one. */
export const docketOwnReadTool = (toolName: string): DocketOwnReadTool | undefined => {
  if (toolName === 'mcp__docket-pages__docket_get') return 'docket_get';
  if (toolName === 'mcp__docket-pages__docket_search') return 'docket_search';
  return undefined;
};
