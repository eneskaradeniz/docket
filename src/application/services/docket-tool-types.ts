// services/docket-tool-types.ts — the wire vocabulary shared by every tool of Docket's own MCP
// server (run tools and chat tools): a request, a response, the stable failure codes, and the
// page-argument decoding both the run and the chat page tools use, so the shared page tools keep
// one input grammar whatever token kind is calling.
import type { PageComment, PageError, PageId, PageKind } from '../../domain/index';
import { parseUlid } from '../../domain/index';

import type { PageFileInput } from '../use-cases/index';

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

/** How a comment reaches an agent: visibly the operator's data, never an instruction. */
export const wrapComment = (comment: PageComment): Record<string, unknown> => ({
  kind: 'operator_comment',
  id: comment.id,
  version: comment.version,
  text: comment.text,
  ...(comment.anchor === undefined ? {} : { anchor: comment.anchor }),
  at: comment.at,
});

// --- the page tool argument grammar (shared by the run and the chat page tools) -----------------------

export const PAGE_TOOL_KINDS: ReadonlySet<string> = new Set(['html', 'diagram', 'markdown', 'table', 'image', 'report']);

const DEFAULT_ENTRY: Readonly<Partial<Record<PageKind, string>>> = {
  html: 'index.html',
  diagram: 'diagram.mmd',
  markdown: 'page.md',
  table: 'table.csv',
  report: 'report.md',
};

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const decodeBase64 = (text: string): Uint8Array | undefined => {
  if (!BASE64.test(text)) return undefined;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const encoder = new TextEncoder();

export interface PageDraft {
  readonly files: readonly PageFileInput[];
  readonly explicitEntry: string | undefined;
  readonly shorthand: boolean;
}

/** `content` and `files` are exclusive; a file carries exactly one of `text` and `base64`. */
export const readPageFiles = (args: ToolArgs, kind: PageKind): PageDraft | undefined => {
  const { content, files, entry } = args;
  if (entry !== undefined && typeof entry !== 'string') return undefined;
  if ((content === undefined) === (files === undefined)) return undefined;
  if (content !== undefined) {
    if (typeof content !== 'string') return undefined;
    const name = entry ?? DEFAULT_ENTRY[kind];
    if (name === undefined) return undefined; // an image page cannot be written as text
    return { files: [{ path: name, bytes: encoder.encode(content) }], explicitEntry: name, shorthand: true };
  }
  if (!Array.isArray(files)) return undefined;
  const out: PageFileInput[] = [];
  for (const item of files as readonly unknown[]) {
    const file = asArgs(item);
    if (file === undefined || typeof file['path'] !== 'string') return undefined;
    const { text, base64 } = file;
    if ((text === undefined) === (base64 === undefined)) return undefined;
    if (text !== undefined) {
      if (typeof text !== 'string') return undefined;
      out.push({ path: file['path'], bytes: encoder.encode(text) });
    } else {
      if (typeof base64 !== 'string') return undefined;
      const bytes = decodeBase64(base64);
      if (bytes === undefined) return undefined;
      out.push({ path: file['path'], bytes });
    }
  }
  return { files: out, explicitEntry: entry, shorthand: false };
};

/** An explicit entry wins; else the kind's own file name when present, else the previous
 *  version's entry, else the only file. Anything else is ambiguous and left to the caller. */
export const entryOf = (draft: PageDraft, kind: PageKind, previous?: string): string | undefined => {
  if (draft.explicitEntry !== undefined) return draft.explicitEntry;
  const paths = draft.files.map((file) => file.path);
  const kindName = DEFAULT_ENTRY[kind];
  if (kindName !== undefined && paths.includes(kindName)) return kindName;
  if (previous !== undefined && paths.includes(previous)) return previous;
  return paths.length === 1 ? paths[0] : undefined;
};

export const parsePageId = (value: unknown): PageId | undefined => {
  if (typeof value !== 'string') return undefined;
  const parsed = parseUlid<'page'>(value);
  return parsed.ok ? parsed.value : undefined;
};
