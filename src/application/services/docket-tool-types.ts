// services/docket-tool-types.ts — the wire vocabulary shared by every tool of Docket's own MCP
// server (run tools and chat tools): a request, a response, and the stable failure codes.
import type { PageError } from '../../domain/index';

export type DocketToolCode =
  | 'unauthorized'
  | 'unknown_tool'
  | 'bad_input'
  | 'forbidden'
  | 'rate_limited'
  | 'too_many_pages'
  | 'internal'
  | 'not_text'
  | 'too_large'
  | PageError['code'];

export type DocketToolResponse =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: DocketToolCode };

export interface DocketToolRequest {
  readonly token: string;
  readonly tool: string;
  readonly args: unknown;
}

export interface DocketToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the arguments, as `tools/list` hands it to the agent. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export const fail = (code: DocketToolCode): DocketToolResponse => ({ ok: false, code });
export const succeed = (result: unknown): DocketToolResponse => ({ ok: true, result });

export type ToolArgs = Readonly<Record<string, unknown>>;
export const asArgs = (value: unknown): ToolArgs | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as ToolArgs) : undefined;
