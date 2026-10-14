// mcp-docket-tool-names.ts — tool names shown on the MCP status row (A-380). The full schemas live
// under services/docket-tools; this leaf stays free of services so mcp-status never pulls the
// dispatch graph.
import type { RunTokenKind } from '../ports';

/** Names returned by `tools/list` per token kind; must match `DOCKET_TOOL_DEFINITIONS_BY_KIND`. */
export const MCP_DOCKET_TOOL_NAMES_BY_KIND: Readonly<Record<RunTokenKind, readonly string[]>> = {
  run: ['page_publish', 'page_update', 'page_comments', 'propose_memory'],
  chat: [
    'docket_get',
    'docket_search',
    'docket_read_file',
    'page_publish',
    'page_update',
    'page_comments_read',
    'draft_work_order',
    'propose_change',
    'propose_setting',
    'docket_repo_analyze',
    'docket_read_path',
    'docket_setup_propose',
  ],
};
