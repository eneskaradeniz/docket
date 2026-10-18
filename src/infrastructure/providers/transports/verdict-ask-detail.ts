// What the permission card needs from a call of Docket's verdict tool, read off the tool input a
// transport's permission hook already holds. The one reading both routes share: the SDK callback
// hands over the input as is, the agy ask child forwards the three fields it found in the CLI's
// own call shape. Redaction and the card's length cut belong to the executor, which owns what is
// stored — this only drops what the card never shows (the pointers) and bounds the text carried.
import type { VerdictAskDetail } from '../../../domain/index';

/** The verdict tool as the MCP server prefix spells it on both routes. */
export const DOCKET_VERDICT_TOOL = 'mcp__docket-pages__submit_verdict';

/** The tool's own summary limit: text past it would be refused by the tool itself. */
const SUMMARY_READ_MAX_CHARS = 2000;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The verdict, the summary and the pointer count of one call, or undefined when the input is
 *  missing or not the tool's shape — the card then stays as it is for any other tool. */
export const verdictAskDetailOf = (input: unknown): VerdictAskDetail | undefined => {
  if (!isRecord(input)) return undefined;
  const { verdict, summary, pointers } = input;
  if (verdict !== 'approve' && verdict !== 'reject') return undefined;
  if (typeof summary !== 'string') return undefined;
  if (!Array.isArray(pointers) || !pointers.every((pointer) => typeof pointer === 'string')) return undefined;
  const text = summary.trim();
  if (text === '') return undefined;
  return { verdict, summary: [...text].slice(0, SUMMARY_READ_MAX_CHARS).join(''), pointerCount: pointers.length };
};
